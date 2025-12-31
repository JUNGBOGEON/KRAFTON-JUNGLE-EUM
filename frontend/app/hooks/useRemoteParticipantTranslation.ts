"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParticipants, useLocalParticipant } from "@livekit/components-react";
import { Track, RemoteParticipant, LocalParticipant } from "livekit-client";
import { TranscriptData, TargetLanguage } from "./useAudioWebSocket";
import { useAudioPlayback } from "./useAudioPlayback";
import { useAudioDucking } from "./useAudioDucking";

const WS_BASE_URL = process.env.NEXT_PUBLIC_VOICE_WS_URL || 'ws://localhost:8080/ws/audio';
const SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_AUDIO_SAMPLE_RATE) || 16000;
const CHUNK_INTERVAL_MS = 1500;

export interface RemoteTranscriptData extends TranscriptData {
    participantId: string;
    participantName?: string;
}

interface UseRemoteParticipantTranslationOptions {
    enabled: boolean;              // TTS 재생 여부 (번역 모드)
    sttEnabled?: boolean;          // STT 항상 활성화 여부 (기본: true)
    targetLanguage?: TargetLanguage;
    autoPlayTTS?: boolean;
    chunkIntervalMs?: number;
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
    chunkInterval: NodeJS.Timeout | null;
    isHandshakeComplete: boolean;
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
    targetLanguage = 'en',
    autoPlayTTS = true,
    chunkIntervalMs = CHUNK_INTERVAL_MS,
    onTranscript,
    onError,
}: UseRemoteParticipantTranslationOptions): UseRemoteParticipantTranslationReturn {
    const [isActive, setIsActive] = useState(false);
    const [activeParticipantCount, setActiveParticipantCount] = useState(0);
    const [transcripts, setTranscripts] = useState<Map<string, RemoteTranscriptData>>(new Map());
    const [error, setError] = useState<Error | null>(null);

    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();

    // All refs for stable references
    const streamsRef = useRef<Map<string, ParticipantStream>>(new Map());
    const enabledRef = useRef(enabled);
    const sttEnabledRef = useRef(sttEnabled);
    const targetLanguageRef = useRef(targetLanguage);
    const autoPlayTTSRef = useRef(autoPlayTTS);
    const chunkIntervalMsRef = useRef(chunkIntervalMs);
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
        targetLanguageRef.current = targetLanguage;
        autoPlayTTSRef.current = autoPlayTTS;
        chunkIntervalMsRef.current = chunkIntervalMs;
        onTranscriptRef.current = onTranscript;
        onErrorRef.current = onError;
        duckParticipantRef.current = duckParticipant;
        unduckParticipantRef.current = unduckParticipant;
        unduckAllRef.current = unduckAll;
        queueAudioRef.current = queueAudio;
        stopAudioRef.current = stopAudio;
    }, [enabled, sttEnabled, targetLanguage, autoPlayTTS, chunkIntervalMs, onTranscript, onError, duckParticipant, unduckParticipant, unduckAll, queueAudio, stopAudio]);

    // Update local participant identity ref
    useEffect(() => {
        if (localParticipant) {
            localParticipantIdRef.current = localParticipant.identity;
        }
    }, [localParticipant]);

    // Memoize participant IDs for stable comparison
    const participantIds = useMemo(
        () => participants.map(p => p.identity).sort().join(','),
        [participants]
    );

    // Helper functions using refs (not useCallback to avoid dependency issues)
    const cleanupParticipantStream = (participantId: string) => {
        const stream = streamsRef.current.get(participantId);
        if (!stream) return;

        console.log(`[RemoteTranslation] Cleaning up stream for ${participantId}`);

        if (stream.chunkInterval) {
            clearInterval(stream.chunkInterval);
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

            // Handle audio data
            workletNode.port.onmessage = (event) => {
                const { audioData } = event.data;
                if (audioData) {
                    stream.audioBuffer.push(new Float32Array(audioData));
                }
            };

            // Connect (NOT to destination)
            sourceNode.connect(workletNode);

            // Start chunk interval
            stream.chunkInterval = setInterval(() => {
                if (stream.audioBuffer.length === 0) return;
                if (!stream.ws || stream.ws.readyState !== WebSocket.OPEN) return;
                if (!stream.isHandshakeComplete) return;

                const totalLength = stream.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
                if (totalLength === 0) return;

                const combined = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of stream.audioBuffer) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }
                stream.audioBuffer = [];

                // Resample to 16kHz
                const resampled = resample(combined, stream.audioContext.sampleRate, SAMPLE_RATE);
                const int16Data = float32ToInt16(resampled);

                stream.ws.send(int16Data.buffer);
                console.log(`[RemoteTranslation] ${participantId}: Sent ${int16Data.length} samples`);
            }, chunkIntervalMsRef.current);

            console.log(`[RemoteTranslation] ${participantId}: Audio capture started`);

        } catch (err) {
            console.error(`[RemoteTranslation] ${participantId}: Failed to start audio capture:`, err);
        }
    };

    const createParticipantStream = async (participant: RemoteParticipant | LocalParticipant) => {
        if (!participant) return;

        const participantId = participant.identity;
        const isLocal = participantId === localParticipantIdRef.current;

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

        try {
            console.log(`[RemoteTranslation] Creating stream for ${participantId}`);

            // Create WebSocket with participantId
            const wsUrl = `${WS_BASE_URL}?lang=${targetLanguageRef.current}&participantId=${encodeURIComponent(participantId)}`;
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
                chunkInterval: null,
                isHandshakeComplete: false,
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
                            const transcriptData: RemoteTranscriptData = {
                                participantId: data.participantId || participantId,
                                participantName: participant.name || participantId,
                                original: data.original || data.text,
                                translated: data.translated || data.text,
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
                    // TTS audio - only play when translation mode is enabled AND not for local participant
                    console.log(`[RemoteTranslation] ${participantId}: Received TTS audio:`, event.data.byteLength, "bytes");
                    const currentIsLocal = participantId === localParticipantIdRef.current;
                    if (autoPlayTTSRef.current && enabledRef.current && !currentIsLocal) {
                        queueAudioRef.current(event.data, 24000, participantId);
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

    // Main effect: Manage streams based on sttEnabled and participant changes
    useEffect(() => {
        if (!sttEnabled) {
            console.log(`[RemoteTranslation] Stopping STT`);
            cleanupAllStreams();
            setIsActive(false);
            return;
        }

        // Parse participant IDs from the memoized string
        const currentIds = participantIds ? participantIds.split(',').filter(Boolean) : [];

        console.log(`[RemoteTranslation] STT enabled, managing ${currentIds.length} participants (including local)`);
        setIsActive(true);

        const currentParticipantIds = new Set(currentIds);
        const existingStreamIds = new Set(streamsRef.current.keys());

        // Find participants to add
        const participantsToAdd = participants.filter(p => !existingStreamIds.has(p.identity));

        // Add new participants
        participantsToAdd.forEach(participant => {
            console.log(`[RemoteTranslation] Creating stream for: ${participant.identity} (isLocal: ${participant.isLocal})`);
            createParticipantStream(participant as RemoteParticipant);
        });

        // Remove departed participants
        existingStreamIds.forEach(participantId => {
            if (!currentParticipantIds.has(participantId)) {
                console.log(`[RemoteTranslation] Participant left: ${participantId}`);
                cleanupParticipantStream(participantId);
            }
        });

        setActiveParticipantCount(currentIds.length);

        // Cleanup on unmount or when sttEnabled changes
        return () => {
            // Only cleanup if sttEnabled is being turned off
            if (!sttEnabledRef.current) {
                cleanupAllStreams();
            }
        };
    // Only depend on sttEnabled and participantIds - everything else uses refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sttEnabled, participantIds]);

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
