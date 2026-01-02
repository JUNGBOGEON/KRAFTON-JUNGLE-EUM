"use client";

/**
 * useRoomTranslation - Room 기반 단일 WebSocket 번역 훅
 *
 * 기존 useRemoteParticipantTranslation과 달리:
 * - Room당 1 WebSocket (참가자당 1 → Room당 1, N² → N 연결 감소)
 * - 단일 AudioContext 공유
 * - 모든 원격 참가자 오디오를 하나의 스트림으로 처리
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParticipants, useLocalParticipant, useTracks } from "@livekit/components-react";
import { Track, RemoteParticipant, LocalParticipant } from "livekit-client";
import { TargetLanguage } from "./useAudioWebSocket";
import { useAudioPlayback } from "./useAudioPlayback";
import { useAudioDucking } from "./useAudioDucking";

// Room WebSocket endpoint
const WS_ROOM_URL = process.env.NEXT_PUBLIC_VOICE_WS_URL?.replace('/ws/audio', '/ws/room')
    || 'ws://localhost:8080/ws/room';
const SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_AUDIO_SAMPLE_RATE) || 16000;

// Audio capture settings
const ANALYSIS_INTERVAL_MS = 30;
const SILENCE_THRESHOLD = 0.004;
const SPEECH_THRESHOLD = 0.006;
const SILENCE_DURATION_MS = 350;
const FORCED_SEND_INTERVAL_MS = 2500;
const MAX_BUFFER_SAMPLES = SAMPLE_RATE * 5;

export interface RoomTranscriptData {
    participantId: string;
    participantName?: string;
    profileImg?: string;
    original: string;
    translated?: string;
    isFinal: boolean;
    language?: string;
}

interface UseRoomTranslationOptions {
    roomId: string;
    enabled: boolean;
    targetLanguage: TargetLanguage;
    listenerId?: string;
    autoPlayTTS?: boolean;
    onTranscript?: (data: RoomTranscriptData) => void;
    onError?: (error: Error) => void;
}

interface SpeakerCapture {
    speakerId: string;
    sourceLang: string;
    nickname: string;
    sourceNode: MediaStreamAudioSourceNode | null;
    workletNode: AudioWorkletNode | null;
    audioBuffer: Float32Array[];
    analysisInterval: NodeJS.Timeout | null;
    isSpeaking: boolean;
    silenceStartTime: number | null;
    lastSendTime: number;
}

interface UseRoomTranslationReturn {
    isActive: boolean;
    activeParticipantCount: number;
    transcripts: Map<string, RoomTranscriptData>;
    error: Error | null;
}

// Helper functions
function calculateRMS(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
}

function float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

function resample(inputBuffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
    if (inputSampleRate === outputSampleRate) return inputBuffer;
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

function getParticipantSourceLanguage(participant: RemoteParticipant | LocalParticipant): TargetLanguage | null {
    try {
        if (participant.metadata) {
            const metadata = JSON.parse(participant.metadata);
            const lang = metadata.sourceLanguage || metadata.source_language || metadata.language;
            if (lang && typeof lang === 'string') {
                return lang as TargetLanguage;
            }
        }
    } catch {
        // Metadata is not valid JSON
    }
    return null;
}

function getParticipantProfileImg(participant: RemoteParticipant | LocalParticipant): string | undefined {
    try {
        if (participant.metadata) {
            const metadata = JSON.parse(participant.metadata);
            return metadata.profileImg || metadata.profile_img || metadata.avatar;
        }
    } catch {
        // ignore
    }
    return undefined;
}

export function useRoomTranslation({
    roomId,
    enabled,
    targetLanguage,
    listenerId,
    autoPlayTTS = true,
    onTranscript,
    onError,
}: UseRoomTranslationOptions): UseRoomTranslationReturn {
    const [isActive, setIsActive] = useState(false);
    const [activeParticipantCount, setActiveParticipantCount] = useState(0);
    const [transcripts, setTranscripts] = useState<Map<string, RoomTranscriptData>>(new Map());
    const [error, setError] = useState<Error | null>(null);

    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();
    const audioTracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const speakerCapturesRef = useRef<Map<string, SpeakerCapture>>(new Map());
    const isConnectedRef = useRef(false);
    const targetLanguageRef = useRef(targetLanguage);
    const enabledRef = useRef(enabled);
    const autoPlayTTSRef = useRef(autoPlayTTS);
    const onTranscriptRef = useRef(onTranscript);
    const onErrorRef = useRef(onError);
    const participantsRef = useRef(participants);

    // Audio ducking
    const { duckParticipant, unduckParticipant, unduckAll } = useAudioDucking();
    const duckParticipantRef = useRef(duckParticipant);
    const unduckParticipantRef = useRef(unduckParticipant);
    const unduckAllRef = useRef(unduckAll);

    // TTS playback
    const { queueAudio, stopAllAudio } = useAudioPlayback({
        onPlayStart: (participantId) => {
            if (participantId) duckParticipantRef.current(participantId);
        },
        onPlayEnd: (participantId) => {
            if (participantId) unduckParticipantRef.current(participantId);
        },
        onError: console.error,
    });
    const queueAudioRef = useRef(queueAudio);
    const stopAllAudioRef = useRef(stopAllAudio);

    // Keep refs updated
    useEffect(() => {
        targetLanguageRef.current = targetLanguage;
        enabledRef.current = enabled;
        autoPlayTTSRef.current = autoPlayTTS;
        onTranscriptRef.current = onTranscript;
        onErrorRef.current = onError;
        participantsRef.current = participants;
        duckParticipantRef.current = duckParticipant;
        unduckParticipantRef.current = unduckParticipant;
        unduckAllRef.current = unduckAll;
        queueAudioRef.current = queueAudio;
        stopAllAudioRef.current = stopAllAudio;
    }, [targetLanguage, enabled, autoPlayTTS, onTranscript, onError, participants, duckParticipant, unduckParticipant, unduckAll, queueAudio, stopAllAudio]);

    // Memoize participant IDs
    const participantIds = useMemo(
        () => participants.map(p => p.identity).sort().join(','),
        [participants]
    );

    const audioTrackInfo = useMemo(
        () => audioTracks.map(t => `${t.participant.identity}:${t.publication?.trackSid || 'none'}`).sort().join(','),
        [audioTracks]
    );

    // Cleanup a single speaker capture
    const cleanupSpeakerCapture = useCallback((speakerId: string) => {
        const capture = speakerCapturesRef.current.get(speakerId);
        if (!capture) return;

        console.log(`[RoomTranslation] Cleaning up speaker: ${speakerId}`);

        if (capture.analysisInterval) {
            clearInterval(capture.analysisInterval);
        }
        if (capture.workletNode) {
            capture.workletNode.port.onmessage = null;
            capture.workletNode.port.close();
            capture.workletNode.disconnect();
        }
        if (capture.sourceNode) {
            capture.sourceNode.disconnect();
        }

        speakerCapturesRef.current.delete(speakerId);
    }, []);

    // Cleanup everything
    const cleanupAll = useCallback(() => {
        console.log(`[RoomTranslation] Cleaning up all`);

        // Cleanup speaker captures
        speakerCapturesRef.current.forEach((_, id) => cleanupSpeakerCapture(id));
        speakerCapturesRef.current.clear();

        // Close WebSocket
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        // Close AudioContext
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
        }

        isConnectedRef.current = false;
        unduckAllRef.current();
        stopAllAudioRef.current();
        setTranscripts(new Map());
    }, [cleanupSpeakerCapture]);

    // Send audio for a speaker
    const sendSpeakerAudio = useCallback((capture: SpeakerCapture, reason: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!isConnectedRef.current) return;
        if (capture.audioBuffer.length === 0) return;
        if (!audioContextRef.current) return;

        const totalLength = capture.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
        if (totalLength === 0) return;

        // Combine buffer
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of capture.audioBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        capture.audioBuffer = [];

        // Resample
        const resampled = resample(combined, audioContextRef.current.sampleRate, SAMPLE_RATE);
        const int16Data = float32ToInt16(resampled);

        // Build message: [speakerId(36 bytes)][sourceLang(2 bytes)][audio data]
        const speakerIdBytes = new TextEncoder().encode(capture.speakerId.padEnd(36, ' ').slice(0, 36));
        const sourceLangBytes = new TextEncoder().encode(capture.sourceLang.padEnd(2, ' ').slice(0, 2));
        const audioBytes = new Uint8Array(int16Data.buffer);

        const message = new Uint8Array(36 + 2 + audioBytes.length);
        message.set(speakerIdBytes, 0);
        message.set(sourceLangBytes, 36);
        message.set(audioBytes, 38);

        wsRef.current.send(message.buffer);
        console.log(`[RoomTranslation] Sent audio for ${capture.speakerId}: ${int16Data.length} samples - ${reason}`);
    }, []);

    // Start capture for a speaker
    const startSpeakerCapture = useCallback(async (
        speakerId: string,
        sourceLang: string,
        nickname: string,
        mediaStream: MediaStream
    ) => {
        if (!audioContextRef.current) return;
        if (speakerCapturesRef.current.has(speakerId)) return;

        console.log(`[RoomTranslation] Starting capture for ${speakerId} (${sourceLang})`);

        const capture: SpeakerCapture = {
            speakerId,
            sourceLang,
            nickname,
            sourceNode: null,
            workletNode: null,
            audioBuffer: [],
            analysisInterval: null,
            isSpeaking: false,
            silenceStartTime: null,
            lastSendTime: Date.now(),
        };

        speakerCapturesRef.current.set(speakerId, capture);

        try {
            // Load AudioWorklet if not already loaded
            try {
                await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
            } catch {
                // Module might already be loaded
            }

            const sourceNode = audioContextRef.current.createMediaStreamSource(mediaStream);
            const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');

            capture.sourceNode = sourceNode;
            capture.workletNode = workletNode;

            // Handle audio data
            workletNode.port.onmessage = (event) => {
                const currentCapture = speakerCapturesRef.current.get(speakerId);
                if (!currentCapture) return;

                if (event.data.debug) return;

                const { audioData } = event.data;
                if (audioData && currentCapture.audioBuffer) {
                    currentCapture.audioBuffer.push(new Float32Array(audioData));
                }
            };

            sourceNode.connect(workletNode);

            // Analysis interval
            capture.analysisInterval = setInterval(() => {
                const currentCapture = speakerCapturesRef.current.get(speakerId);
                if (!currentCapture || currentCapture.audioBuffer.length === 0) return;

                const now = Date.now();

                // Calculate RMS from recent chunks
                const recentChunks = currentCapture.audioBuffer.slice(-5);
                const recentSamples: number[] = [];
                for (const chunk of recentChunks) {
                    for (let i = 0; i < chunk.length; i++) {
                        recentSamples.push(chunk[i]);
                    }
                }
                const rms = calculateRMS(new Float32Array(recentSamples));

                const totalSamples = currentCapture.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
                const timeSinceLastSend = now - currentCapture.lastSendTime;

                // Speech detection
                if (rms >= SPEECH_THRESHOLD) {
                    currentCapture.isSpeaking = true;
                    currentCapture.silenceStartTime = null;
                } else if (rms < SILENCE_THRESHOLD) {
                    if (currentCapture.isSpeaking && currentCapture.silenceStartTime === null) {
                        currentCapture.silenceStartTime = now;
                    }
                }

                // Send conditions
                let shouldSend = false;
                let sendReason = '';

                if (currentCapture.isSpeaking && currentCapture.silenceStartTime !== null) {
                    const silenceDuration = now - currentCapture.silenceStartTime;
                    if (silenceDuration >= SILENCE_DURATION_MS) {
                        shouldSend = true;
                        sendReason = `utterance complete (silence: ${silenceDuration}ms)`;
                        currentCapture.isSpeaking = false;
                        currentCapture.silenceStartTime = null;
                    }
                }

                if (!shouldSend && timeSinceLastSend >= FORCED_SEND_INTERVAL_MS) {
                    shouldSend = true;
                    sendReason = `forced send (${(timeSinceLastSend / 1000).toFixed(1)}s)`;
                }

                if (!shouldSend && totalSamples >= MAX_BUFFER_SAMPLES) {
                    shouldSend = true;
                    sendReason = `buffer full`;
                    currentCapture.isSpeaking = false;
                    currentCapture.silenceStartTime = null;
                }

                if (shouldSend) {
                    sendSpeakerAudio(currentCapture, sendReason);
                    currentCapture.lastSendTime = now;
                }
            }, ANALYSIS_INTERVAL_MS);

            // Send speaker info to server
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'speaker_info',
                    speakerId,
                    sourceLang,
                    nickname,
                }));
            }

            console.log(`[RoomTranslation] Capture started for ${speakerId}`);
        } catch (err) {
            console.error(`[RoomTranslation] Failed to start capture for ${speakerId}:`, err);
            speakerCapturesRef.current.delete(speakerId);
        }
    }, [sendSpeakerAudio]);

    // Main effect: Connect WebSocket and manage speakers
    useEffect(() => {
        const localId = localParticipant?.identity;
        if (!localId || !roomId || !enabled) {
            cleanupAll();
            setIsActive(false);
            return;
        }

        const actualListenerId = listenerId || localId;

        // Connect WebSocket
        const wsUrl = `${WS_ROOM_URL}?roomId=${encodeURIComponent(roomId)}&listenerId=${encodeURIComponent(actualListenerId)}&targetLang=${targetLanguage}`;
        console.log(`[RoomTranslation] Connecting to ${wsUrl}`);

        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        // Create shared AudioContext
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new AudioContext();
        }

        ws.onopen = () => {
            console.log(`[RoomTranslation] WebSocket connected`);
        };

        ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const data = JSON.parse(event.data);

                    if (data.status === 'ready') {
                        console.log(`[RoomTranslation] Room connection ready`);
                        isConnectedRef.current = true;
                        setIsActive(true);
                    } else if (data.type === 'transcript') {
                        const stripPrefixes = (text: string | undefined): string => {
                            if (!text) return '';
                            return text
                                .replace(/^\[FINAL\]\s*/i, '')
                                .replace(/^\[LLM\]\s*/i, '')
                                .replace(/^\[PARTIAL\]\s*/i, '')
                                .trim();
                        };

                        const transcriptData: RoomTranscriptData = {
                            participantId: data.speakerId || data.participantId,
                            original: stripPrefixes(data.data?.original) || stripPrefixes(data.data?.text),
                            translated: stripPrefixes(data.data?.translated),
                            isFinal: data.data?.isFinal ?? true,
                            language: data.data?.language,
                        };

                        // Try to get participant info (use ref to avoid reconnection)
                        const participant = participantsRef.current.find(p => p.identity === transcriptData.participantId);
                        if (participant) {
                            transcriptData.participantName = participant.name || participant.identity;
                            transcriptData.profileImg = getParticipantProfileImg(participant);
                        }

                        setTranscripts(prev => {
                            const newMap = new Map(prev);
                            newMap.set(transcriptData.participantId, transcriptData);
                            return newMap;
                        });

                        onTranscriptRef.current?.(transcriptData);
                    }
                } catch (e) {
                    console.error(`[RoomTranslation] Failed to parse message:`, e);
                }
            } else if (event.data instanceof ArrayBuffer) {
                // TTS audio - only play when enabled
                if (autoPlayTTSRef.current && enabledRef.current) {
                    queueAudioRef.current(event.data, undefined, undefined);
                }
            }
        };

        ws.onerror = (event) => {
            console.error(`[RoomTranslation] WebSocket error:`, event);
            const err = new Error('WebSocket error');
            setError(err);
            onErrorRef.current?.(err);
        };

        ws.onclose = () => {
            console.log(`[RoomTranslation] WebSocket closed`);
            isConnectedRef.current = false;
        };

        return () => {
            cleanupAll();
        };
    // autoPlayTTS, participants는 ref로 관리되므로 dependency에서 제외 (불필요한 재연결 방지)
    }, [roomId, enabled, targetLanguage, listenerId, localParticipant?.identity, cleanupAll]);

    // Effect: Manage speaker captures based on audio tracks
    useEffect(() => {
        if (!isConnectedRef.current || !audioContextRef.current) return;

        const localId = localParticipant?.identity;
        if (!localId) return;

        // Find remote participants with audio tracks
        const remoteAudioTracks = audioTracks.filter(t =>
            t.participant.identity !== localId &&
            t.publication?.track?.mediaStreamTrack
        );

        const currentSpeakerIds = new Set(speakerCapturesRef.current.keys());
        const newSpeakerIds = new Set(remoteAudioTracks.map(t => t.participant.identity));

        // Add new speakers
        for (const trackRef of remoteAudioTracks) {
            const speakerId = trackRef.participant.identity;
            if (currentSpeakerIds.has(speakerId)) continue;

            const participant = trackRef.participant as RemoteParticipant;
            const sourceLang = getParticipantSourceLanguage(participant) || 'ko';
            const nickname = participant.name || participant.identity;
            const mediaStream = new MediaStream([trackRef.publication!.track!.mediaStreamTrack!]);

            startSpeakerCapture(speakerId, sourceLang, nickname, mediaStream);
        }

        // Remove departed speakers
        for (const speakerId of currentSpeakerIds) {
            if (!newSpeakerIds.has(speakerId)) {
                cleanupSpeakerCapture(speakerId);
            }
        }

        setActiveParticipantCount(speakerCapturesRef.current.size);
    }, [audioTrackInfo, participantIds, localParticipant?.identity, audioTracks, startSpeakerCapture, cleanupSpeakerCapture]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanupAll();
        };
    }, [cleanupAll]);

    return {
        isActive,
        activeParticipantCount,
        transcripts,
        error,
    };
}
