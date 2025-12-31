"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { RemoteParticipant, Track } from "livekit-client";

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_INTERVAL_MS = 1500;

interface UseParticipantAudioCaptureOptions {
    participant: RemoteParticipant;
    enabled: boolean;
    onAudioData?: (data: Int16Array, participantId: string) => void;
    chunkIntervalMs?: number;
}

interface UseParticipantAudioCaptureReturn {
    isCapturing: boolean;
    error: Error | null;
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

export function useParticipantAudioCapture({
    participant,
    enabled,
    onAudioData,
    chunkIntervalMs = CHUNK_INTERVAL_MS,
}: UseParticipantAudioCaptureOptions): UseParticipantAudioCaptureReturn {
    const [isCapturing, setIsCapturing] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const audioBufferRef = useRef<Float32Array[]>([]);
    const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const actualSampleRateRef = useRef<number>(48000);
    const onAudioDataRef = useRef(onAudioData);

    // Keep callback ref updated
    useEffect(() => {
        onAudioDataRef.current = onAudioData;
    }, [onAudioData]);

    const startCapture = useCallback(async () => {
        try {
            setError(null);

            // Get remote participant's microphone track
            const micPub = participant.getTrackPublication(Track.Source.Microphone);
            if (!micPub?.track?.mediaStreamTrack) {
                console.log(`[ParticipantAudioCapture] ${participant.identity}: No microphone track available`);
                return;
            }

            const mediaStreamTrack = micPub.track.mediaStreamTrack;
            const mediaStream = new MediaStream([mediaStreamTrack]);

            // Create AudioContext
            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            actualSampleRateRef.current = audioContext.sampleRate;
            console.log(`[ParticipantAudioCapture] ${participant.identity}: AudioContext created (${audioContext.sampleRate}Hz)`);

            // Load AudioWorklet
            await audioContext.audioWorklet.addModule('/audio-processor.js');

            // Create source node
            const sourceNode = audioContext.createMediaStreamSource(mediaStream);
            sourceNodeRef.current = sourceNode;

            // Create worklet node
            const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
            workletNodeRef.current = workletNode;

            // Handle audio data from worklet
            workletNode.port.onmessage = (event) => {
                const { audioData } = event.data;
                if (audioData) {
                    audioBufferRef.current.push(new Float32Array(audioData));
                }
            };

            // Connect nodes (NOT to destination - just for processing)
            sourceNode.connect(workletNode);

            // Start chunk interval
            chunkIntervalRef.current = setInterval(() => {
                if (audioBufferRef.current.length === 0) return;

                const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
                if (totalLength === 0) return;

                const combined = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of audioBufferRef.current) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }

                audioBufferRef.current = [];

                // Resample to 16kHz
                const resampled = resample(combined, actualSampleRateRef.current, TARGET_SAMPLE_RATE);
                const int16Data = float32ToInt16(resampled);

                console.log(`[ParticipantAudioCapture] ${participant.identity}: Sending ${int16Data.length} samples`);
                onAudioDataRef.current?.(int16Data, participant.identity);
            }, chunkIntervalMs);

            setIsCapturing(true);
            console.log(`[ParticipantAudioCapture] ${participant.identity}: Capture started`);

        } catch (err) {
            console.error(`[ParticipantAudioCapture] ${participant.identity}: Failed to start:`, err);
            const error = err instanceof Error ? err : new Error('Failed to start capture');
            setError(error);
        }
    }, [participant, chunkIntervalMs]);

    const stopCapture = useCallback(() => {
        if (chunkIntervalRef.current) {
            clearInterval(chunkIntervalRef.current);
            chunkIntervalRef.current = null;
        }

        // Send remaining audio buffer
        if (audioBufferRef.current.length > 0) {
            const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
            if (totalLength > 0) {
                const combined = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of audioBufferRef.current) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }
                const resampled = resample(combined, actualSampleRateRef.current, TARGET_SAMPLE_RATE);
                const int16Data = float32ToInt16(resampled);
                onAudioDataRef.current?.(int16Data, participant.identity);
            }
        }

        if (workletNodeRef.current) {
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
        }

        if (sourceNodeRef.current) {
            sourceNodeRef.current.disconnect();
            sourceNodeRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        audioBufferRef.current = [];
        setIsCapturing(false);
        console.log(`[ParticipantAudioCapture] ${participant.identity}: Capture stopped`);
    }, [participant.identity]);

    // Start/stop based on enabled state
    useEffect(() => {
        if (enabled) {
            startCapture();
        } else {
            stopCapture();
        }

        return () => {
            stopCapture();
        };
    }, [enabled, startCapture, stopCapture]);

    // Handle participant track changes
    useEffect(() => {
        const handleTrackPublished = () => {
            if (enabled && !isCapturing) {
                startCapture();
            }
        };

        const handleTrackUnpublished = () => {
            stopCapture();
        };

        participant.on('trackPublished', handleTrackPublished);
        participant.on('trackUnpublished', handleTrackUnpublished);

        return () => {
            participant.off('trackPublished', handleTrackPublished);
            participant.off('trackUnpublished', handleTrackUnpublished);
        };
    }, [participant, enabled, isCapturing, startCapture, stopCapture]);

    return {
        isCapturing,
        error,
    };
}
