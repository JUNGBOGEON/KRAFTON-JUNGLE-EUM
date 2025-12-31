"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useAudioWebSocket, ConnectionStatus, TranscriptData, TargetLanguage } from "./useAudioWebSocket";
import { useAudioPlayback } from "./useAudioPlayback";

const SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_AUDIO_SAMPLE_RATE) || 16000;

interface UseLiveKitTranslationOptions {
    chunkIntervalMs?: number;
    autoPlayTTS?: boolean;
    targetLanguage?: TargetLanguage;
    onTranscript?: (data: TranscriptData) => void;
    onError?: (error: Error) => void;
}

interface UseLiveKitTranslationReturn {
    isConnected: boolean;
    isActive: boolean;
    connectionStatus: ConnectionStatus;
    currentTranscript: string | null;
    error: Error | null;
    start: () => void;
    stop: () => void;
}

// Float32 -> Int16 PCM 변환
function float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

// 리샘플링 함수 (선형 보간)
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

        // 선형 보간
        output[i] = inputBuffer[srcIndexFloor] * (1 - fraction) + inputBuffer[srcIndexCeil] * fraction;
    }

    return output;
}

export function useLiveKitTranslation({
    chunkIntervalMs = 1500,
    autoPlayTTS = true,
    targetLanguage = 'en',
    onTranscript,
    onError,
}: UseLiveKitTranslationOptions = {}): UseLiveKitTranslationReturn {
    const [isActive, setIsActive] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState<string | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [wsEnabled, setWsEnabled] = useState(false);

    // LiveKit 로컬 참가자 정보
    const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();

    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const audioBufferRef = useRef<Float32Array[]>([]);
    const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const transcriptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isActiveRef = useRef(false);
    const chunkIntervalMsRef = useRef(chunkIntervalMs);
    const wsEnabledRef = useRef(false);
    const actualSampleRateRef = useRef<number>(48000); // 실제 AudioContext 샘플레이트

    // TTS 재생 훅
    const { queueAudio, stopAudio } = useAudioPlayback({
        onError: (err) => console.error("[LiveKitTranslation] Playback error:", err),
    });

    // Transcript 처리
    const handleTranscript = useCallback((data: TranscriptData) => {
        console.log("[LiveKitTranslation] Received transcript:", data);
        console.log("[LiveKitTranslation] Setting currentTranscript to:", data.translated);
        setCurrentTranscript(data.translated);

        console.log("[LiveKitTranslation] onTranscript exists:", !!onTranscript);
        if (onTranscript) {
            console.log("[LiveKitTranslation] Calling onTranscript callback");
            onTranscript(data);
            console.log("[LiveKitTranslation] onTranscript callback completed");
        }

        if (transcriptTimeoutRef.current) {
            clearTimeout(transcriptTimeoutRef.current);
        }

        transcriptTimeoutRef.current = setTimeout(() => {
            console.log("[LiveKitTranslation] Clearing currentTranscript (timeout)");
            setCurrentTranscript(null);
        }, 5000);
    }, [onTranscript]);

    // TTS 오디오 처리 (PCM with sampleRate)
    const handleAudioResponse = useCallback((audioData: ArrayBuffer, sampleRate: number) => {
        if (autoPlayTTS) {
            queueAudio(audioData, sampleRate);
        }
    }, [autoPlayTTS, queueAudio]);

    // WebSocket 훅
    const {
        status: connectionStatus,
        isConnected,
        sendAudio,
    } = useAudioWebSocket({
        enabled: wsEnabled,
        sampleRate: SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        targetLanguage,
        onTranscript: handleTranscript,
        onAudio: handleAudioResponse,
        onError: (err) => {
            setError(err);
            onError?.(err);
        },
    });

    // 번역 시작
    const start = useCallback(async () => {
        if (!localParticipant) {
            console.warn("[LiveKitTranslation] No local participant");
            return;
        }

        try {
            setError(null);

            // LiveKit 마이크 트랙 가져오기
            const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
            if (!micPub?.track?.mediaStreamTrack) {
                // 마이크가 아직 활성화되지 않았으면 활성화
                if (!isMicrophoneEnabled) {
                    await localParticipant.setMicrophoneEnabled(true);
                    // 약간의 지연 후 다시 시도
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const micPub2 = localParticipant.getTrackPublication(Track.Source.Microphone);
                if (!micPub2?.track?.mediaStreamTrack) {
                    throw new Error("마이크 트랙을 찾을 수 없습니다");
                }
            }

            const mediaStreamTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
            if (!mediaStreamTrack) {
                throw new Error("마이크 트랙을 찾을 수 없습니다");
            }

            // MediaStream 생성
            const mediaStream = new MediaStream([mediaStreamTrack]);

            // AudioContext 생성 (기본 샘플레이트 사용 - 나중에 리샘플링)
            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            actualSampleRateRef.current = audioContext.sampleRate;
            console.log(`[LiveKitTranslation] AudioContext created with sample rate: ${audioContext.sampleRate}`);

            // AudioWorklet 로드
            await audioContext.audioWorklet.addModule('/audio-processor.js');

            // 소스 노드 생성
            const sourceNode = audioContext.createMediaStreamSource(mediaStream);
            sourceNodeRef.current = sourceNode;

            // Worklet 노드 생성
            const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
            workletNodeRef.current = workletNode;

            // 오디오 데이터 수신
            workletNode.port.onmessage = (event) => {
                const { audioData } = event.data;
                if (audioData) {
                    audioBufferRef.current.push(new Float32Array(audioData));
                }
            };

            // 연결 (destination에 연결하지 않음 - LiveKit이 이미 재생 중)
            sourceNode.connect(workletNode);

            // WebSocket 연결 활성화 (useEffect에서 isConnected 감지 후 인터벌 시작)
            wsEnabledRef.current = true;
            setWsEnabled(true);

            isActiveRef.current = true;
            setIsActive(true);
            console.log("[LiveKitTranslation] Started - waiting for WebSocket connection");

        } catch (err) {
            console.error("[LiveKitTranslation] Failed to start:", err);
            const error = err instanceof Error ? err : new Error('Failed to start translation');
            setError(error);
            onError?.(error);
        }
    }, [localParticipant, isMicrophoneEnabled, chunkIntervalMs, onError]);

    // WebSocket 연결 상태 감지하여 청크 전송 시작
    useEffect(() => {
        if (isConnected && isActiveRef.current) {
            console.log("[LiveKitTranslation] WebSocket connected - starting chunk interval");

            // 이전 인터벌 정리
            if (chunkIntervalRef.current) {
                clearInterval(chunkIntervalRef.current);
            }

            // 청크 전송 인터벌 시작
            chunkIntervalRef.current = setInterval(() => {
                if (audioBufferRef.current.length === 0) {
                    return;
                }

                const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
                if (totalLength === 0) return;

                const combined = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of audioBufferRef.current) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }

                audioBufferRef.current = [];

                // 16kHz로 리샘플링
                const resampled = resample(combined, actualSampleRateRef.current, SAMPLE_RATE);
                const int16Data = float32ToInt16(resampled);
                sendAudio(int16Data);

                console.log(`[LiveKitTranslation] Sent ${int16Data.length} samples (resampled from ${combined.length})`);
            }, chunkIntervalMsRef.current);
        }

        return () => {
            if (chunkIntervalRef.current && !isConnected) {
                clearInterval(chunkIntervalRef.current);
                chunkIntervalRef.current = null;
            }
        };
    }, [isConnected, sendAudio]);

    // 번역 중지
    const stop = useCallback(() => {
        if (chunkIntervalRef.current) {
            clearInterval(chunkIntervalRef.current);
            chunkIntervalRef.current = null;
        }

        // 남은 오디오 버퍼 전송
        if (audioBufferRef.current.length > 0 && isConnected) {
            const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
            if (totalLength > 0) {
                const combined = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of audioBufferRef.current) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }
                // 16kHz로 리샘플링
                const resampled = resample(combined, actualSampleRateRef.current, SAMPLE_RATE);
                const int16Data = float32ToInt16(resampled);
                sendAudio(int16Data);
                console.log(`[LiveKitTranslation] Sent final ${int16Data.length} samples`);
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

        wsEnabledRef.current = false;
        setWsEnabled(false);
        stopAudio();
        audioBufferRef.current = [];
        isActiveRef.current = false;
        setIsActive(false);
        setCurrentTranscript(null);

        console.log("[LiveKitTranslation] Stopped");
    }, [isConnected, sendAudio, stopAudio]);

    // 클린업
    useEffect(() => {
        return () => {
            if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
            if (transcriptTimeoutRef.current) clearTimeout(transcriptTimeoutRef.current);
            if (workletNodeRef.current) workletNodeRef.current.disconnect();
            if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
            if (audioContextRef.current) audioContextRef.current.close();
        };
    }, []);

    return {
        isConnected,
        isActive,
        connectionStatus,
        currentTranscript,
        error,
        start,
        stop,
    };
}
