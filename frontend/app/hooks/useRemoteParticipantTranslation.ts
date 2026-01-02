"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParticipants, useLocalParticipant, useTracks } from "@livekit/components-react";
import { Track, RemoteParticipant, LocalParticipant } from "livekit-client";
import { TranscriptData, TargetLanguage } from "./useAudioWebSocket";
import { useAudioPlayback } from "./useAudioPlayback";
import { useAudioDucking } from "./useAudioDucking";

const WS_BASE_URL = process.env.NEXT_PUBLIC_VOICE_WS_URL || 'ws://localhost:8080/ws/audio';
const SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_AUDIO_SAMPLE_RATE) || 16000;

// 하이브리드 전송 설정: 침묵 감지 + 주기적 강제 전송 (오디오 손실 방지)
const MIN_SAMPLES_TO_SEND = 0;  // 모든 오디오 전송 (스킵 없음)
const MAX_BUFFER_DURATION_MS = 10000;  // 최대 10초 버퍼 (안전장치)
const MAX_BUFFER_SAMPLES = SAMPLE_RATE * (MAX_BUFFER_DURATION_MS / 1000);
const SILENCE_THRESHOLD = 0.005;  // 침묵 감지 RMS 임계값 (매우 민감하게)
const SPEECH_THRESHOLD = 0.008;  // 발화 시작 감지 RMS 임계값 (낮게 설정)
const SILENCE_DURATION_MS = 600;  // 600ms 침묵 = 발화 종료
const FORCED_SEND_INTERVAL_MS = 3000;  // 3초마다 강제 전송 (오디오 손실 방지)
const ANALYSIS_INTERVAL_MS = 50;  // 50ms마다 버퍼 분석

export interface RemoteTranscriptData extends TranscriptData {
    participantId: string;
    participantName?: string;
    profileImg?: string;
}

interface UseRemoteParticipantTranslationOptions {
    enabled: boolean;              // TTS 재생 여부 (번역 모드)
    sttEnabled?: boolean;          // STT 항상 활성화 여부 (기본: true)
    sourceLanguage?: TargetLanguage;  // 발화자가 말하는 언어 (기본: 'ko')
    targetLanguage?: TargetLanguage;  // 듣고 싶은 언어 (번역 대상)
    autoPlayTTS?: boolean;
    onTranscript?: (data: RemoteTranscriptData) => void;
    onError?: (error: Error) => void;
}

interface ParticipantStream {
    participantId: string;
    ws: WebSocket;
    audioContext: AudioContext;
    sourceNode: MediaStreamAudioSourceNode | null;
    workletNode: AudioWorkletNode | null;
    audioBuffer: Float32Array[];
    analysisInterval: NodeJS.Timeout | null;
    isHandshakeComplete: boolean;
    // 침묵 감지 관련 상태
    isSpeaking: boolean;
    silenceStartTime: number | null;
    lastSpeechTime: number;
    // 오디오 손실 방지를 위한 강제 전송 타이머
    lastSendTime: number;
}

interface UseRemoteParticipantTranslationReturn {
    isActive: boolean;
    activeParticipantCount: number;
    transcripts: Map<string, RemoteTranscriptData>;
    error: Error | null;
}

// 12 byte metadata header (Little Endian)
function createMetadataHeader(sampleRate: number, channels: number, bitsPerSample: number): ArrayBuffer {
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    view.setUint32(0, sampleRate, true);
    view.setUint16(4, channels, true);
    view.setUint16(6, bitsPerSample, true);
    view.setUint32(8, 0, true);
    return buffer;
}

// Float32 -> Int16 PCM
function float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

// Parse participant metadata to extract profileImg
function getParticipantProfileImg(participant: RemoteParticipant | LocalParticipant): string | undefined {
    try {
        if (participant.metadata) {
            const metadata = JSON.parse(participant.metadata);
            return metadata.profileImg || metadata.profile_img || metadata.avatar;
        }
    } catch {
        // Metadata is not valid JSON
    }
    return undefined;
}

// RMS 계산 (음성 활동 감지용)
function calculateRMS(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
}

// Linear interpolation resampling
function resample(inputBuffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
    if (inputSampleRate === outputSampleRate) {
        return inputBuffer;
    }

    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.floor(inputBuffer.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
        const srcIndex = i * ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, inputBuffer.length - 1);
        const fraction = srcIndex - srcIndexFloor;
        output[i] = inputBuffer[srcIndexFloor] * (1 - fraction) + inputBuffer[srcIndexCeil] * fraction;
    }

    return output;
}

export function useRemoteParticipantTranslation({
    enabled,
    sttEnabled = true,  // STT는 기본적으로 항상 활성화
    sourceLanguage = 'ko',  // 발화자가 말하는 언어 (기본: 한국어)
    targetLanguage = 'en',  // 듣고 싶은 언어 (기본: 영어)
    autoPlayTTS = true,
    onTranscript,
    onError,
}: UseRemoteParticipantTranslationOptions): UseRemoteParticipantTranslationReturn {
    const [isActive, setIsActive] = useState(false);
    const [activeParticipantCount, setActiveParticipantCount] = useState(0);
    const [transcripts, setTranscripts] = useState<Map<string, RemoteTranscriptData>>(new Map());
    const [error, setError] = useState<Error | null>(null);

    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();

    // Track microphone tracks to know when they become available
    const audioTracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });

    // All refs for stable references
    const streamsRef = useRef<Map<string, ParticipantStream>>(new Map());
    const enabledRef = useRef(enabled);
    const sttEnabledRef = useRef(sttEnabled);
    const sourceLanguageRef = useRef(sourceLanguage);
    const targetLanguageRef = useRef(targetLanguage);
    const autoPlayTTSRef = useRef(autoPlayTTS);
    const onTranscriptRef = useRef(onTranscript);
    const onErrorRef = useRef(onError);
    const localParticipantIdRef = useRef<string | null>(null);
    const isInitializedRef = useRef(false);

    // Audio ducking
    const { duckParticipant, unduckParticipant, unduckAll } = useAudioDucking();
    const duckParticipantRef = useRef(duckParticipant);
    const unduckParticipantRef = useRef(unduckParticipant);
    const unduckAllRef = useRef(unduckAll);

    // TTS playback with ducking callbacks
    const { queueAudio, stopAudio } = useAudioPlayback({
        onPlayStart: (participantId) => {
            if (participantId) {
                console.log(`[RemoteTranslation] TTS started for ${participantId}, ducking...`);
                duckParticipantRef.current(participantId);
            }
        },
        onPlayEnd: (participantId) => {
            if (participantId) {
                console.log(`[RemoteTranslation] TTS ended for ${participantId}, unducking...`);
                unduckParticipantRef.current(participantId);
            }
        },
        onError: (err) => {
            console.error("[RemoteTranslation] Playback error:", err);
        },
    });
    const queueAudioRef = useRef(queueAudio);
    const stopAudioRef = useRef(stopAudio);

    // Keep all refs updated
    useEffect(() => {
        enabledRef.current = enabled;
        sttEnabledRef.current = sttEnabled;
        sourceLanguageRef.current = sourceLanguage;
        targetLanguageRef.current = targetLanguage;
        autoPlayTTSRef.current = autoPlayTTS;
        onTranscriptRef.current = onTranscript;
        onErrorRef.current = onError;
        duckParticipantRef.current = duckParticipant;
        unduckParticipantRef.current = unduckParticipant;
        unduckAllRef.current = unduckAll;
        queueAudioRef.current = queueAudio;
        stopAudioRef.current = stopAudio;
    }, [enabled, sttEnabled, sourceLanguage, targetLanguage, autoPlayTTS, onTranscript, onError, duckParticipant, unduckParticipant, unduckAll, queueAudio, stopAudio]);

    // Update local participant identity ref
    useEffect(() => {
        if (localParticipant?.identity) {
            console.log(`[RemoteTranslation] Local participant identified: ${localParticipant.identity}`);
            localParticipantIdRef.current = localParticipant.identity;
        } else {
            console.log(`[RemoteTranslation] Local participant not ready yet:`, {
                localParticipant: !!localParticipant,
                identity: localParticipant?.identity,
            });
        }
    }, [localParticipant, localParticipant?.identity]);

    // Memoize participant IDs for stable comparison
    const participantIds = useMemo(
        () => participants.map(p => p.identity).sort().join(','),
        [participants]
    );

    // Memoize audio track info to detect when new tracks become available
    const audioTrackInfo = useMemo(
        () => audioTracks.map(t => `${t.participant.identity}:${t.publication?.trackSid || 'none'}`).sort().join(','),
        [audioTracks]
    );

    // Track previous language settings to detect changes
    const prevSourceLanguageRef = useRef(sourceLanguage);
    const prevTargetLanguageRef = useRef(targetLanguage);

    // Helper functions using refs (not useCallback to avoid dependency issues)
    const cleanupParticipantStream = (participantId: string) => {
        const stream = streamsRef.current.get(participantId);
        if (!stream) return;

        console.log(`[RemoteTranslation] Cleaning up stream for ${participantId}`);

        if (stream.analysisInterval) {
            clearInterval(stream.analysisInterval);
        }

        if (stream.workletNode) {
            stream.workletNode.disconnect();
        }

        if (stream.sourceNode) {
            stream.sourceNode.disconnect();
        }

        if (stream.audioContext && stream.audioContext.state !== 'closed') {
            stream.audioContext.close();
        }

        if (stream.ws && stream.ws.readyState === WebSocket.OPEN) {
            stream.ws.close();
        }

        streamsRef.current.delete(participantId);
    };

    const cleanupAllStreams = () => {
        console.log(`[RemoteTranslation] Cleaning up all streams`);

        streamsRef.current.forEach((_, participantId) => {
            cleanupParticipantStream(participantId);
        });

        unduckAllRef.current();
        stopAudioRef.current();
        setTranscripts(new Map());
    };

    // 버퍼된 오디오 전송 헬퍼 함수
    const sendBufferedAudio = (stream: ParticipantStream, reason: string) => {
        if (stream.audioBuffer.length === 0) return;
        if (!stream.ws || stream.ws.readyState !== WebSocket.OPEN) return;
        if (!stream.isHandshakeComplete) return;

        const totalLength = stream.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
        if (totalLength === 0) return;

        // 버퍼 합치기
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of stream.audioBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        stream.audioBuffer = [];

        // 리샘플링 및 전송
        const resampled = resample(combined, stream.audioContext.sampleRate, SAMPLE_RATE);
        const int16Data = float32ToInt16(resampled);

        stream.ws.send(int16Data.buffer);
        console.log(`[RemoteTranslation] ${stream.participantId}: Sent ${int16Data.length} samples (${(int16Data.length / SAMPLE_RATE).toFixed(1)}s) - ${reason}`);
    };

    const startAudioCapture = async (participantId: string, mediaStream: MediaStream) => {
        const stream = streamsRef.current.get(participantId);
        if (!stream || !stream.audioContext) return;

        try {
            // Load AudioWorklet
            await stream.audioContext.audioWorklet.addModule('/audio-processor.js');

            // Create source node
            const sourceNode = stream.audioContext.createMediaStreamSource(mediaStream);
            stream.sourceNode = sourceNode;

            // Create worklet node
            const workletNode = new AudioWorkletNode(stream.audioContext, 'audio-processor');
            stream.workletNode = workletNode;

            // Handle audio data - 단순히 버퍼에 축적만 함
            workletNode.port.onmessage = (event) => {
                const { audioData } = event.data;
                if (audioData) {
                    stream.audioBuffer.push(new Float32Array(audioData));
                }
            };

            // Connect (NOT to destination)
            sourceNode.connect(workletNode);

            // 주기적 버퍼 분석 및 하이브리드 전송 (침묵 감지 + 강제 전송)
            stream.analysisInterval = setInterval(() => {
                if (stream.audioBuffer.length === 0) return;
                if (!stream.ws || stream.ws.readyState !== WebSocket.OPEN) return;
                if (!stream.isHandshakeComplete) return;

                const now = Date.now();

                // 버퍼 전체의 RMS 계산 (최근 청크들만)
                const recentChunks = stream.audioBuffer.slice(-5);  // 최근 5개 청크만 분석
                const recentSamples: number[] = [];
                for (const chunk of recentChunks) {
                    for (let i = 0; i < chunk.length; i++) {
                        recentSamples.push(chunk[i]);
                    }
                }
                const rms = calculateRMS(new Float32Array(recentSamples));

                // 총 버퍼 크기
                const totalSamples = stream.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
                const resampledSamples = Math.floor(totalSamples * SAMPLE_RATE / stream.audioContext.sampleRate);
                const timeSinceLastSend = now - stream.lastSendTime;

                // 발화 감지 상태 업데이트
                if (rms >= SPEECH_THRESHOLD) {
                    if (!stream.isSpeaking) {
                        console.log(`[RemoteTranslation] ${participantId}: Speech detected (RMS: ${rms.toFixed(4)})`);
                    }
                    stream.isSpeaking = true;
                    stream.silenceStartTime = null;
                    stream.lastSpeechTime = now;
                } else if (rms < SILENCE_THRESHOLD) {
                    if (stream.isSpeaking && stream.silenceStartTime === null) {
                        stream.silenceStartTime = now;
                    }
                }

                // ============================================
                // 전송 조건 (우선순위 순, 오디오 손실 방지)
                // ============================================

                let shouldSend = false;
                let sendReason = '';

                // 1. 발화 후 침묵 감지 → 즉시 전송 (가장 빠른 응답)
                if (stream.isSpeaking && stream.silenceStartTime !== null) {
                    const silenceDuration = now - stream.silenceStartTime;
                    if (silenceDuration >= SILENCE_DURATION_MS) {
                        shouldSend = true;
                        sendReason = `utterance complete (silence: ${silenceDuration}ms)`;
                        stream.isSpeaking = false;
                        stream.silenceStartTime = null;
                    }
                }

                // 2. 강제 전송 간격 초과 → 무조건 전송 (오디오 손실 방지)
                if (!shouldSend && timeSinceLastSend >= FORCED_SEND_INTERVAL_MS) {
                    shouldSend = true;
                    sendReason = `forced send (${(timeSinceLastSend / 1000).toFixed(1)}s elapsed)`;
                }

                // 3. 최대 버퍼 크기 초과 → 강제 전송 (메모리 보호)
                if (!shouldSend && resampledSamples >= MAX_BUFFER_SAMPLES) {
                    shouldSend = true;
                    sendReason = `buffer full (${resampledSamples} samples)`;
                    stream.isSpeaking = false;
                    stream.silenceStartTime = null;
                }

                // 전송 실행
                if (shouldSend) {
                    sendBufferedAudio(stream, sendReason);
                    stream.lastSendTime = now;
                }
            }, ANALYSIS_INTERVAL_MS);

            console.log(`[RemoteTranslation] ${participantId}: Audio capture started (hybrid mode: silence detection + forced ${FORCED_SEND_INTERVAL_MS}ms)`);

        } catch (err) {
            console.error(`[RemoteTranslation] ${participantId}: Failed to start audio capture:`, err);
        }
    };

    const createParticipantStream = async (participant: RemoteParticipant | LocalParticipant) => {
        if (!participant) return;

        const participantId = participant.identity;

        // 로컬 참가자 체크 (두 가지 방법으로 확인)
        const isLocalByIdentity = participantId === localParticipantIdRef.current;
        const isLocalByProperty = 'isLocal' in participant && participant.isLocal === true;

        console.log(`[RemoteTranslation] Checking participant: ${participantId}`, {
            isLocalByIdentity,
            isLocalByProperty,
            myIdentity: localParticipantIdRef.current,
        });

        // Skip local participant - we only translate remote participants
        if (isLocalByIdentity || isLocalByProperty) {
            console.log(`[RemoteTranslation] ❌ Skipping LOCAL participant: ${participantId}`);
            return;
        }

        console.log(`[RemoteTranslation] ✓ Processing REMOTE participant: ${participantId}`);

        // Check if already exists
        if (streamsRef.current.has(participantId)) {
            console.log(`[RemoteTranslation] Stream already exists for ${participantId}`);
            return;
        }

        // Get microphone track
        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        if (!micPub?.track?.mediaStreamTrack) {
            console.log(`[RemoteTranslation] ${participantId}: No microphone track available`);
            return;
        }

        // Debug: 트랙 정보 확인
        console.log(`[RemoteTranslation] ${participantId}: Track info:`, {
            participantIdentity: participant.identity,
            participantIsLocal: 'isLocal' in participant ? (participant as any).isLocal : 'N/A',
            trackSid: micPub.trackSid,
            trackSource: micPub.source,
            isSubscribed: micPub.isSubscribed,
            isEnabled: micPub.isEnabled,
        });

        try {
            console.log(`[RemoteTranslation] Creating stream for ${participantId}`);

            // Create WebSocket with participantId and language params
            const wsUrl = `${WS_BASE_URL}?sourceLang=${sourceLanguageRef.current}&targetLang=${targetLanguageRef.current}&participantId=${encodeURIComponent(participantId)}`;
            const ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';

            // Create AudioContext
            const audioContext = new AudioContext();
            const mediaStream = new MediaStream([micPub.track.mediaStreamTrack]);

            const stream: ParticipantStream = {
                participantId,
                ws,
                audioContext,
                sourceNode: null,
                workletNode: null,
                audioBuffer: [],
                analysisInterval: null,
                isHandshakeComplete: false,
                // 침묵 감지 상태 초기화
                isSpeaking: false,
                silenceStartTime: null,
                lastSpeechTime: Date.now(),
                // 강제 전송 타이머 초기화
                lastSendTime: Date.now(),
            };

            streamsRef.current.set(participantId, stream);

            // WebSocket handlers
            ws.onopen = async () => {
                console.log(`[RemoteTranslation] ${participantId}: WebSocket opened, sending handshake`);

                // Send metadata header
                const metadata = createMetadataHeader(SAMPLE_RATE, 1, 16);
                ws.send(metadata);
            };

            ws.onmessage = (event) => {
                const currentStream = streamsRef.current.get(participantId);
                if (!currentStream) return;

                // Handshake response
                if (!currentStream.isHandshakeComplete && typeof event.data === 'string') {
                    try {
                        const response = JSON.parse(event.data);
                        if (response.status === 'ready') {
                            console.log(`[RemoteTranslation] ${participantId}: Handshake complete`);
                            currentStream.isHandshakeComplete = true;

                            // Start audio capture after handshake
                            startAudioCapture(participantId, mediaStream);
                        }
                    } catch (e) {
                        console.error(`[RemoteTranslation] ${participantId}: Failed to parse handshake:`, e);
                    }
                    return;
                }

                // Transcript message
                if (typeof event.data === 'string') {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'transcript') {
                            // 접두사 제거 함수
                            const stripPrefixes = (text: string | undefined): string => {
                                if (!text) return '';
                                return text
                                    .replace(/^\[FINAL\]\s*/i, '')
                                    .replace(/^\[LLM\]\s*/i, '')
                                    .replace(/^\[PARTIAL\]\s*/i, '')
                                    .trim();
                            };

                            const transcriptData: RemoteTranscriptData = {
                                participantId: data.participantId || participantId,
                                participantName: participant.name || participantId,
                                profileImg: getParticipantProfileImg(participant),
                                original: stripPrefixes(data.original) || stripPrefixes(data.text),
                                translated: stripPrefixes(data.translated),
                                isFinal: data.isFinal,
                            };

                            console.log(`[RemoteTranslation] ${participantId}: Transcript received:`, transcriptData);

                            setTranscripts(prev => {
                                const newMap = new Map(prev);
                                newMap.set(participantId, transcriptData);
                                return newMap;
                            });

                            onTranscriptRef.current?.(transcriptData);
                        }
                    } catch (e) {
                        console.error(`[RemoteTranslation] ${participantId}: Failed to parse message:`, e);
                    }
                } else if (event.data instanceof ArrayBuffer) {
                    // TTS audio (MP3 format) - only play when translation mode is enabled AND not for local participant
                    console.log(`[RemoteTranslation] ${participantId}: Received TTS audio (MP3):`, event.data.byteLength, "bytes");
                    const currentIsLocal = participantId === localParticipantIdRef.current;
                    if (autoPlayTTSRef.current && enabledRef.current && !currentIsLocal) {
                        // Don't pass sampleRate to use MP3 decoding instead of PCM
                        queueAudioRef.current(event.data, undefined, participantId);
                    } else if (currentIsLocal) {
                        console.log(`[RemoteTranslation] ${participantId}: Skipping TTS for local participant`);
                    }
                }
            };

            ws.onerror = (event) => {
                console.error(`[RemoteTranslation] ${participantId}: WebSocket error:`, event);
                const err = new Error(`WebSocket error for ${participantId}`);
                setError(err);
                onErrorRef.current?.(err);
            };

            ws.onclose = () => {
                console.log(`[RemoteTranslation] ${participantId}: WebSocket closed`);
                // Don't call cleanup here to avoid recursive issues
                streamsRef.current.delete(participantId);
            };

        } catch (err) {
            console.error(`[RemoteTranslation] ${participantId}: Failed to create stream:`, err);
            const error = err instanceof Error ? err : new Error(`Failed to create stream for ${participantId}`);
            setError(error);
            onErrorRef.current?.(error);
        }
    };

    // Main effect: Manage streams based on sttEnabled, participant changes, and language changes
    useEffect(() => {
        // Get local participant ID directly from the hook (more reliable than ref)
        const localId = localParticipant?.identity;

        // Wait for local participant to be identified
        if (!localId) {
            console.log(`[RemoteTranslation] Waiting for local participant to be identified...`);
            return;
        }

        // Update ref for use in other functions
        localParticipantIdRef.current = localId;

        if (!sttEnabled) {
            console.log(`[RemoteTranslation] Stopping STT`);
            cleanupAllStreams();
            setIsActive(false);
            prevSourceLanguageRef.current = sourceLanguage;
            prevTargetLanguageRef.current = targetLanguage;
            return;
        }

        // Check if language has changed - if so, recreate all streams
        const languageChanged =
            prevSourceLanguageRef.current !== sourceLanguage ||
            prevTargetLanguageRef.current !== targetLanguage;

        if (languageChanged && streamsRef.current.size > 0) {
            console.log(`[RemoteTranslation] Language changed: ${prevSourceLanguageRef.current}->${sourceLanguage}, ${prevTargetLanguageRef.current}->${targetLanguage}`);
            console.log(`[RemoteTranslation] Recreating all streams with new language settings...`);
            cleanupAllStreams();
        }

        prevSourceLanguageRef.current = sourceLanguage;
        prevTargetLanguageRef.current = targetLanguage;

        // Parse participant IDs from the memoized string
        const currentIds = participantIds ? participantIds.split(',').filter(Boolean) : [];

        // Count remote participants only (exclude local)
        const remoteIds = currentIds.filter(id => id !== localId);
        console.log(`[RemoteTranslation] Local: ${localId}, Remote participants: [${remoteIds.join(', ')}], Audio tracks: ${audioTracks.length}`);
        setIsActive(true);

        const currentParticipantIds = new Set(currentIds);
        const existingStreamIds = new Set(streamsRef.current.keys());

        // Find REMOTE participants with available audio tracks
        const remoteAudioTracks = audioTracks.filter(t =>
            t.participant.identity !== localId &&
            t.publication?.track?.mediaStreamTrack
        );

        console.log(`[RemoteTranslation] Available remote audio tracks:`, remoteAudioTracks.map(t => ({
            identity: t.participant.identity,
            trackSid: t.publication?.trackSid,
            hasMediaStreamTrack: !!t.publication?.track?.mediaStreamTrack,
        })));

        // Add new remote participants that have audio tracks available
        remoteAudioTracks.forEach(trackRef => {
            const participantId = trackRef.participant.identity;
            if (!existingStreamIds.has(participantId)) {
                console.log(`[RemoteTranslation] Creating stream for REMOTE: ${participantId} (I am: ${localId})`);
                createParticipantStream(trackRef.participant as RemoteParticipant);
            }
        });

        // Remove departed participants
        existingStreamIds.forEach(participantId => {
            if (!currentParticipantIds.has(participantId)) {
                console.log(`[RemoteTranslation] Participant left: ${participantId}`);
                cleanupParticipantStream(participantId);
            }
        });

        // Count how many remote participants have active streams
        const activeRemoteStreams = Array.from(streamsRef.current.keys()).filter(id => id !== localId);
        setActiveParticipantCount(activeRemoteStreams.length);

        // Cleanup on unmount or when sttEnabled changes
        return () => {
            // Only cleanup if sttEnabled is being turned off
            if (!sttEnabledRef.current) {
                cleanupAllStreams();
            }
        };
    // Depend on sttEnabled, participantIds, language changes, localParticipant identity, and audio tracks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sttEnabled, participantIds, sourceLanguage, targetLanguage, localParticipant?.identity, audioTrackInfo]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanupAllStreams();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        isActive,
        activeParticipantCount,
        transcripts,
        error,
    };
}
