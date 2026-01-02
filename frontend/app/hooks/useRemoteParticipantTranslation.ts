"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParticipants, useLocalParticipant, useTracks } from "@livekit/components-react";
import { Track, RemoteParticipant, LocalParticipant } from "livekit-client";
import { TranscriptData, TargetLanguage } from "./useAudioWebSocket";
import { useAudioPlayback } from "./useAudioPlayback";
import { useAudioDucking } from "./useAudioDucking";

const WS_BASE_URL = process.env.NEXT_PUBLIC_VOICE_WS_URL || 'ws://localhost:8080/ws/audio';
const SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_AUDIO_SAMPLE_RATE) || 16000;

// 실시간 번역 설정: 문장 완성도 vs 속도 밸런스
const MIN_SAMPLES_TO_SEND = 0;  // 모든 오디오 전송 (스킵 없음)
const MAX_BUFFER_DURATION_MS = 5000;  // 최대 5초 버퍼 (안전장치)
const MAX_BUFFER_SAMPLES = SAMPLE_RATE * (MAX_BUFFER_DURATION_MS / 1000);
const SILENCE_THRESHOLD = 0.004;  // 침묵 감지 RMS 임계값 (민감하게)
const SPEECH_THRESHOLD = 0.006;  // 발화 시작 감지 RMS 임계값
const SILENCE_DURATION_MS = 350;  // 350ms 침묵 = 발화 종료 (침묵 감지로 빠르게)
const FORCED_SEND_INTERVAL_MS = 2500;  // 2.5초마다 강제 전송 (문장 완성 대기)
const ANALYSIS_INTERVAL_MS = 30;  // 30ms마다 버퍼 분석

export interface RemoteTranscriptData extends TranscriptData {
    participantId: string;
    participantName?: string;
    profileImg?: string;
}

interface UseRemoteParticipantTranslationOptions {
    roomId: string;                // Room ID for grouping
    enabled: boolean;              // TTS 재생 여부 (번역 모드)
    sttEnabled?: boolean;          // STT 항상 활성화 여부 (기본: true)
    sourceLanguage?: TargetLanguage;  // 발화자가 말하는 언어 (기본: 'ko')
    targetLanguage?: TargetLanguage;  // 듣고 싶은 언어 (번역 대상)
    listenerId?: string;           // 리스너 ID (로컬 사용자)
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

// Parse participant metadata to extract sourceLanguage (the language they speak)
// Returns null if metadata is not available (to distinguish from fallback)
function getParticipantSourceLanguage(participant: RemoteParticipant | LocalParticipant): TargetLanguage | null {
    try {
        if (participant.metadata) {
            const metadata = JSON.parse(participant.metadata);
            // Check various possible field names for source language
            const lang = metadata.sourceLanguage || metadata.source_language || metadata.speakingLanguage || metadata.language;
            if (lang && typeof lang === 'string') {
                return lang as TargetLanguage;
            }
        }
    } catch {
        // Metadata is not valid JSON
    }
    return null; // No metadata available - caller should decide how to handle
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
    roomId,
    enabled,
    sttEnabled = true,  // STT는 기본적으로 항상 활성화
    sourceLanguage = 'ko',  // 발화자가 말하는 언어 (기본: 한국어)
    targetLanguage = 'en',  // 듣고 싶은 언어 (기본: 영어)
    listenerId,
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
    const creatingStreamsRef = useRef<Set<string>>(new Set());  // 중복 생성 방지용 락
    const enabledRef = useRef(enabled);
    const sttEnabledRef = useRef(sttEnabled);
    const roomIdRef = useRef(roomId);
    const listenerIdRef = useRef(listenerId);
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
    const { queueAudio, stopAllAudio } = useAudioPlayback({
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
    const stopAllAudioRef = useRef(stopAllAudio);

    // Keep all refs updated
    useEffect(() => {
        enabledRef.current = enabled;
        sttEnabledRef.current = sttEnabled;
        roomIdRef.current = roomId;
        listenerIdRef.current = listenerId;
        sourceLanguageRef.current = sourceLanguage;
        targetLanguageRef.current = targetLanguage;
        autoPlayTTSRef.current = autoPlayTTS;
        onTranscriptRef.current = onTranscript;
        onErrorRef.current = onError;
        duckParticipantRef.current = duckParticipant;
        unduckParticipantRef.current = unduckParticipant;
        unduckAllRef.current = unduckAll;
        queueAudioRef.current = queueAudio;
        stopAllAudioRef.current = stopAllAudio;
    }, [enabled, sttEnabled, roomId, listenerId, sourceLanguage, targetLanguage, autoPlayTTS, onTranscript, onError, duckParticipant, unduckParticipant, unduckAll, queueAudio, stopAllAudio]);

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

    // Memoize remote participant metadata to detect language changes
    // This triggers stream re-creation when a participant updates their sourceLanguage
    const participantMetadataInfo = useMemo(
        () => participants
            .filter(p => p.identity !== localParticipant?.identity)
            .map(p => {
                const sourceLang = getParticipantSourceLanguage(p);
                return `${p.identity}:${sourceLang || 'none'}`;
            })
            .sort()
            .join(','),
        [participants, localParticipant?.identity]
    );

    // Track previous language settings to detect changes
    const prevSourceLanguageRef = useRef(sourceLanguage);
    const prevTargetLanguageRef = useRef(targetLanguage);
    const prevParticipantMetadataRef = useRef(participantMetadataInfo);

    // Helper functions using refs (not useCallback to avoid dependency issues)
    const cleanupParticipantStream = (participantId: string) => {
        const stream = streamsRef.current.get(participantId);
        if (!stream) return;

        console.log(`[RemoteTranslation] Cleaning up stream for ${participantId}`);

        // 1. 분석 인터벌 중지
        if (stream.analysisInterval) {
            clearInterval(stream.analysisInterval);
            stream.analysisInterval = null;
        }

        // 2. AudioWorklet 포트 메시지 핸들러 제거 및 연결 해제
        if (stream.workletNode) {
            stream.workletNode.port.onmessage = null;
            stream.workletNode.port.close();
            stream.workletNode.disconnect();
            stream.workletNode = null;
        }

        // 3. 소스 노드 연결 해제
        if (stream.sourceNode) {
            stream.sourceNode.disconnect();
            stream.sourceNode = null;
        }

        // 4. AudioContext 닫기 (모든 오디오 처리 중지)
        if (stream.audioContext && stream.audioContext.state !== 'closed') {
            stream.audioContext.close().catch(() => {
                // AudioContext close 실패 무시
            });
        }

        // 5. WebSocket 닫기
        if (stream.ws) {
            if (stream.ws.readyState === WebSocket.OPEN || stream.ws.readyState === WebSocket.CONNECTING) {
                stream.ws.close();
            }
            stream.ws = null as any;
        }

        // 6. 버퍼 비우기
        stream.audioBuffer = [];

        streamsRef.current.delete(participantId);
        console.log(`[RemoteTranslation] Stream cleanup complete for ${participantId}`);
    };

    const cleanupAllStreams = () => {
        console.log(`[RemoteTranslation] Cleaning up all streams`);

        streamsRef.current.forEach((_, participantId) => {
            cleanupParticipantStream(participantId);
        });

        creatingStreamsRef.current.clear();  // 모든 락 해제
        unduckAllRef.current();
        stopAllAudioRef.current();
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

        // 전송 전 오디오 레벨 확인
        const sendRms = calculateRMS(resampled);
        const sendMax = Math.max(...Array.from(resampled).map(Math.abs));

        const int16Data = float32ToInt16(resampled);

        stream.ws.send(int16Data.buffer);
        console.log(`[RemoteTranslation] ${stream.participantId}: Sent ${int16Data.length} samples (${(int16Data.length / SAMPLE_RATE).toFixed(1)}s) - ${reason} | RMS=${sendRms.toFixed(6)}, Max=${sendMax.toFixed(6)}`);
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

            // Handle audio data with debugging
            workletNode.port.onmessage = (event) => {
                // 스트림이 여전히 존재하는지 확인
                const currentStream = streamsRef.current.get(participantId);
                if (!currentStream || !currentStream.workletNode) {
                    return; // 스트림이 정리되었으면 무시
                }

                // 디버그 메시지 처리
                if (event.data.debug) {
                    // 정리된 후 메시지는 무시
                    if (!streamsRef.current.has(participantId)) return;
                    console.log(`[AudioWorklet] ${participantId}: ${event.data.message}`);
                    return;
                }

                const { audioData, rms } = event.data;
                if (audioData && currentStream.audioBuffer) {
                    // 오디오 레벨 로깅 (가끔)
                    if (Math.random() < 0.02) {  // 2% 확률로 로깅
                        console.log(`[AudioCapture] ${participantId}: buffer RMS=${rms?.toFixed(6) || 'N/A'}, samples=${audioData.length}`);
                    }
                    currentStream.audioBuffer.push(new Float32Array(audioData));
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

        // Check if already exists or being created (중복 생성 방지)
        if (streamsRef.current.has(participantId)) {
            console.log(`[RemoteTranslation] Stream already exists for ${participantId}`);
            return;
        }

        if (creatingStreamsRef.current.has(participantId)) {
            console.log(`[RemoteTranslation] Stream already being created for ${participantId}`);
            return;
        }

        // 락 획득
        creatingStreamsRef.current.add(participantId);
        console.log(`[RemoteTranslation] Lock acquired for ${participantId}`);

        // Get microphone track
        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        if (!micPub?.track?.mediaStreamTrack) {
            console.log(`[RemoteTranslation] ${participantId}: No microphone track available`);
            creatingStreamsRef.current.delete(participantId);  // 락 해제
            return;
        }

        // Debug: 트랙 정보 확인
        const mediaStreamTrack = micPub.track.mediaStreamTrack;
        console.log(`[RemoteTranslation] ${participantId}: Track info:`, {
            participantIdentity: participant.identity,
            participantIsLocal: 'isLocal' in participant ? (participant as any).isLocal : 'N/A',
            trackSid: micPub.trackSid,
            trackSource: micPub.source,
            isSubscribed: micPub.isSubscribed,
            isEnabled: micPub.isEnabled,
            // MediaStreamTrack 상세 정보
            mediaTrackId: mediaStreamTrack.id,
            mediaTrackKind: mediaStreamTrack.kind,
            mediaTrackLabel: mediaStreamTrack.label,
            mediaTrackEnabled: mediaStreamTrack.enabled,
            mediaTrackMuted: mediaStreamTrack.muted,
            mediaTrackReadyState: mediaStreamTrack.readyState,
        });

        try {
            // 원격 참가자의 sourceLanguage를 그들의 메타데이터에서 가져옴
            const remoteSourceLangFromMetadata = getParticipantSourceLanguage(participant);
            const myTargetLang = targetLanguageRef.current;

            // 메타데이터가 없는 경우
            if (remoteSourceLangFromMetadata === null) {
                console.log(`[RemoteTranslation] ⚠️ ${participantId}: No sourceLanguage in metadata, using default 'ko'`);
                console.log(`[RemoteTranslation] ${participantId}: metadata = ${participant.metadata}`);
            }

            // 메타데이터가 없으면 기본값 'ko' 사용 (한국어가 가장 흔함)
            // 메타데이터가 있지만 내 타겟 언어와 같으면 번역 불필요
            const remoteSourceLang = remoteSourceLangFromMetadata || 'ko';

            // 같은 언어면 번역 불필요 - 스트림 생성하지 않음
            // 단, 메타데이터가 없는 경우에는 일단 스트림 생성 (나중에 메타데이터가 업데이트될 수 있음)
            if (remoteSourceLangFromMetadata !== null && remoteSourceLang === myTargetLang) {
                console.log(`[RemoteTranslation] ⏭️ Skipping ${participantId}: same language (${remoteSourceLang} == ${myTargetLang})`);
                creatingStreamsRef.current.delete(participantId);  // 락 해제
                return;
            }

            console.log(`[RemoteTranslation] Creating stream for ${participantId}`, {
                remoteSourceLang,  // 원격 참가자가 말하는 언어
                remoteSourceLangFromMetadata,  // 메타데이터에서 읽은 값 (null 가능)
                myTargetLang,  // 내가 듣고 싶은 언어
                participantMetadata: participant.metadata,
            });

            // Create WebSocket with roomId, listenerId, participantId and language params
            // roomId = 방 ID (같은 방의 동일 언어 그룹을 묶기 위해)
            // listenerId = 듣는 사람의 ID (로컬 사용자)
            // sourceLang = 원격 참가자가 말하는 언어 (그들의 메타데이터에서)
            // targetLang = 내가 듣고 싶은 언어 (번역 대상)
            const actualListenerId = listenerIdRef.current || localParticipantIdRef.current || 'unknown';
            const wsUrl = `${WS_BASE_URL}?roomId=${encodeURIComponent(roomIdRef.current)}&listenerId=${encodeURIComponent(actualListenerId)}&sourceLang=${remoteSourceLang}&targetLang=${targetLanguageRef.current}&participantId=${encodeURIComponent(participantId)}`;
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
            creatingStreamsRef.current.delete(participantId);  // 락 해제 (스트림 등록 완료)
            console.log(`[RemoteTranslation] Lock released for ${participantId} (stream registered)`);

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
            creatingStreamsRef.current.delete(participantId);  // 락 해제
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

        // Check if any participant's metadata (sourceLanguage) has changed
        // This handles the case where a participant updates their language after joining
        const metadataChanged = prevParticipantMetadataRef.current !== participantMetadataInfo;
        if (metadataChanged && streamsRef.current.size > 0) {
            console.log(`[RemoteTranslation] Participant metadata changed:`);
            console.log(`  Before: ${prevParticipantMetadataRef.current}`);
            console.log(`  After: ${participantMetadataInfo}`);

            // Find which participants changed their metadata
            const prevMap = new Map(
                prevParticipantMetadataRef.current.split(',').filter(Boolean).map(s => {
                    const [id, lang] = s.split(':');
                    return [id, lang] as [string, string];
                })
            );
            const currentMap = new Map(
                participantMetadataInfo.split(',').filter(Boolean).map(s => {
                    const [id, lang] = s.split(':');
                    return [id, lang] as [string, string];
                })
            );

            // Cleanup and recreate streams for participants whose language changed
            currentMap.forEach((newLang, participantId) => {
                const prevLang = prevMap.get(participantId);
                if (prevLang !== newLang) {
                    console.log(`[RemoteTranslation] ${participantId}: language changed ${prevLang} -> ${newLang}, recreating stream`);
                    cleanupParticipantStream(participantId);
                    // Stream will be recreated below in the "Add new participants" section
                }
            });
        }

        prevSourceLanguageRef.current = sourceLanguage;
        prevTargetLanguageRef.current = targetLanguage;
        prevParticipantMetadataRef.current = participantMetadataInfo;

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
    // Depend on sttEnabled, participantIds, language changes, localParticipant identity, audio tracks, and participant metadata
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sttEnabled, participantIds, sourceLanguage, targetLanguage, localParticipant?.identity, audioTrackInfo, participantMetadataInfo]);

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
