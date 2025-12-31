"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UseAudioPlaybackOptions {
    volume?: number;
    onPlayStart?: (participantId?: string) => void;
    onPlayEnd?: (participantId?: string) => void;
    onError?: (error: Error) => void;
}

interface AudioQueueItem {
    data: ArrayBuffer;
    sampleRate: number;
    isPCM: boolean;
    participantId?: string;
}

interface UseAudioPlaybackReturn {
    isPlaying: boolean;
    currentParticipantId: string | null;
    volume: number;
    setVolume: (volume: number) => void;
    playAudio: (audioData: ArrayBuffer, participantId?: string) => Promise<void>;
    playPCMAudio: (audioData: ArrayBuffer, sampleRate?: number, participantId?: string) => Promise<void>;
    stopAudio: () => void;
    queueAudio: (audioData: ArrayBuffer, sampleRate?: number, participantId?: string) => void;
}

export function useAudioPlayback({
    volume: initialVolume = 1.0,
    onPlayStart,
    onPlayEnd,
    onError,
}: UseAudioPlaybackOptions = {}): UseAudioPlaybackReturn {
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const audioQueueRef = useRef<AudioQueueItem[]>([]);
    const isProcessingRef = useRef(false);
    const currentParticipantIdRef = useRef<string | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentParticipantId, setCurrentParticipantId] = useState<string | null>(null);
    const [volume, setVolumeState] = useState(initialVolume);

    // AudioContext 초기화 (특정 샘플레이트로)
    const getAudioContext = useCallback((sampleRate?: number) => {
        // 샘플레이트가 다르면 새 context 생성
        if (audioContextRef.current && sampleRate && audioContextRef.current.sampleRate !== sampleRate) {
            audioContextRef.current.close();
            audioContextRef.current = null;
            gainNodeRef.current = null;
        }

        if (!audioContextRef.current) {
            const options: AudioContextOptions = sampleRate ? { sampleRate } : {};
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(options);
            gainNodeRef.current = audioContextRef.current.createGain();
            gainNodeRef.current.gain.value = volume;
            gainNodeRef.current.connect(audioContextRef.current.destination);
        }

        // suspended 상태면 resume
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }

        return audioContextRef.current;
    }, [volume]);

    // 볼륨 설정
    const setVolume = useCallback((newVolume: number) => {
        const clampedVolume = Math.max(0, Math.min(1, newVolume));
        setVolumeState(clampedVolume);

        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = clampedVolume;
        }
    }, []);

    // PCM 오디오 재생 (Int16 → Float32 변환)
    const playPCMAudio = useCallback(async (audioData: ArrayBuffer, sampleRate: number = 22050, participantId?: string): Promise<void> => {
        try {
            const audioContext = getAudioContext(sampleRate);

            // Int16 → Float32 변환
            const int16Array = new Int16Array(audioData);
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            // AudioBuffer 생성
            const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
            audioBuffer.getChannelData(0).set(float32Array);

            // 이전 재생 중지
            if (sourceNodeRef.current) {
                sourceNodeRef.current.stop();
                sourceNodeRef.current.disconnect();
            }

            // 새 소스 노드 생성
            const sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;

            if (gainNodeRef.current) {
                sourceNode.connect(gainNodeRef.current);
            } else {
                sourceNode.connect(audioContext.destination);
            }

            sourceNodeRef.current = sourceNode;
            currentParticipantIdRef.current = participantId || null;
            setCurrentParticipantId(participantId || null);

            return new Promise<void>((resolve) => {
                sourceNode.onended = () => {
                    setIsPlaying(false);
                    setCurrentParticipantId(null);
                    sourceNodeRef.current = null;
                    currentParticipantIdRef.current = null;
                    onPlayEnd?.(participantId);
                    resolve();
                };

                setIsPlaying(true);
                onPlayStart?.(participantId);
                sourceNode.start(0);
            });
        } catch (error) {
            console.error("[AudioPlayback] Failed to play PCM audio:", error);
            setIsPlaying(false);
            setCurrentParticipantId(null);
            currentParticipantIdRef.current = null;
            onError?.(error instanceof Error ? error : new Error('PCM audio playback failed'));
        }
    }, [getAudioContext, onPlayStart, onPlayEnd, onError]);

    // MP3 오디오 재생 (기존 방식)
    const playAudio = useCallback(async (audioData: ArrayBuffer, participantId?: string): Promise<void> => {
        try {
            const audioContext = getAudioContext();

            // MP3 디코딩
            const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

            // 이전 재생 중지
            if (sourceNodeRef.current) {
                sourceNodeRef.current.stop();
                sourceNodeRef.current.disconnect();
            }

            // 새 소스 노드 생성
            const sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;

            if (gainNodeRef.current) {
                sourceNode.connect(gainNodeRef.current);
            } else {
                sourceNode.connect(audioContext.destination);
            }

            sourceNodeRef.current = sourceNode;
            currentParticipantIdRef.current = participantId || null;
            setCurrentParticipantId(participantId || null);

            return new Promise<void>((resolve) => {
                sourceNode.onended = () => {
                    setIsPlaying(false);
                    setCurrentParticipantId(null);
                    sourceNodeRef.current = null;
                    currentParticipantIdRef.current = null;
                    onPlayEnd?.(participantId);
                    resolve();
                };

                setIsPlaying(true);
                onPlayStart?.(participantId);
                sourceNode.start(0);
            });
        } catch (error) {
            console.error("[AudioPlayback] Failed to play audio:", error);
            setIsPlaying(false);
            setCurrentParticipantId(null);
            currentParticipantIdRef.current = null;
            onError?.(error instanceof Error ? error : new Error('Audio playback failed'));
        }
    }, [getAudioContext, onPlayStart, onPlayEnd, onError]);

    // 큐 처리
    const processQueue = useCallback(async () => {
        if (isProcessingRef.current || audioQueueRef.current.length === 0) {
            return;
        }

        isProcessingRef.current = true;

        while (audioQueueRef.current.length > 0) {
            const item = audioQueueRef.current.shift();
            if (item) {
                if (item.isPCM) {
                    await playPCMAudio(item.data, item.sampleRate, item.participantId);
                } else {
                    await playAudio(item.data, item.participantId);
                }
            }
        }

        isProcessingRef.current = false;
    }, [playAudio, playPCMAudio]);

    // 오디오 큐에 추가 (PCM 형식 - sampleRate가 있으면 PCM으로 처리)
    const queueAudio = useCallback((audioData: ArrayBuffer, sampleRate?: number, participantId?: string) => {
        const isPCM = sampleRate !== undefined;
        audioQueueRef.current.push({
            data: audioData,
            sampleRate: sampleRate || 44100,
            isPCM,
            participantId,
        });

        // 재생 중이 아니면 큐 처리 시작
        if (!isPlaying && !isProcessingRef.current) {
            processQueue();
        }
    }, [isPlaying, processQueue]);

    // 오디오 중지
    const stopAudio = useCallback(() => {
        // 큐 클리어
        audioQueueRef.current = [];
        isProcessingRef.current = false;

        if (sourceNodeRef.current) {
            sourceNodeRef.current.stop();
            sourceNodeRef.current.disconnect();
            sourceNodeRef.current = null;
        }

        setIsPlaying(false);
    }, []);

    // 클린업
    useEffect(() => {
        return () => {
            stopAudio();
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        };
    }, [stopAudio]);

    return {
        isPlaying,
        currentParticipantId,
        volume,
        setVolume,
        playAudio,
        playPCMAudio,
        stopAudio,
        queueAudio,
    };
}
