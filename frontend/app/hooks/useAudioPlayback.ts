"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UseAudioPlaybackOptions {
    volume?: number;
    onPlayStart?: (participantId?: string) => void;
    onPlayEnd?: (participantId?: string) => void;
    onError?: (error: Error) => void;
}

// 참가자별 오디오 채널
interface ParticipantChannel {
    participantId: string;
    gainNode: GainNode;
    sourceNode: AudioBufferSourceNode | null;
    isPlaying: boolean;
    lastPlayTime: number;
}

interface UseAudioPlaybackReturn {
    isPlaying: boolean;
    currentParticipantId: string | null;
    activeChannels: number;
    volume: number;
    setVolume: (volume: number) => void;
    playAudio: (audioData: ArrayBuffer, participantId?: string) => Promise<void>;
    playPCMAudio: (audioData: ArrayBuffer, sampleRate?: number, participantId?: string) => Promise<void>;
    stopAudio: (participantId?: string) => void;
    stopAllAudio: () => void;
    // 레거시 호환성
    queueAudio: (audioData: ArrayBuffer, sampleRate?: number, participantId?: string) => void;
}

// 설정
const CONFIG = {
    MAX_CHANNELS: 10,           // 최대 동시 재생 채널 수
    CHANNEL_TIMEOUT_MS: 30000,  // 30초 후 비활성 채널 정리
    DEFAULT_VOLUME: 0.8,        // 기본 볼륨
};

export function useAudioPlayback({
    volume: initialVolume = 1.0,
    onPlayStart,
    onPlayEnd,
    onError,
}: UseAudioPlaybackOptions = {}): UseAudioPlaybackReturn {
    // 공유 AudioContext
    const audioContextRef = useRef<AudioContext | null>(null);
    const masterGainRef = useRef<GainNode | null>(null);

    // 참가자별 채널 맵
    const channelsRef = useRef<Map<string, ParticipantChannel>>(new Map());

    const [volume, setVolumeState] = useState(initialVolume);
    const [activeChannels, setActiveChannels] = useState(0);

    // AudioContext 초기화 (공유)
    const getAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            masterGainRef.current = audioContextRef.current.createGain();
            masterGainRef.current.gain.value = volume;
            masterGainRef.current.connect(audioContextRef.current.destination);
        }

        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }

        return audioContextRef.current;
    }, [volume]);

    // 참가자 채널 가져오기 (없으면 생성)
    const getOrCreateChannel = useCallback((participantId: string): ParticipantChannel => {
        const existing = channelsRef.current.get(participantId);
        if (existing) {
            return existing;
        }

        const audioContext = getAudioContext();

        // 새 채널 생성
        const gainNode = audioContext.createGain();
        gainNode.gain.value = CONFIG.DEFAULT_VOLUME;
        gainNode.connect(masterGainRef.current!);

        const channel: ParticipantChannel = {
            participantId,
            gainNode,
            sourceNode: null,
            isPlaying: false,
            lastPlayTime: Date.now(),
        };

        channelsRef.current.set(participantId, channel);
        console.log(`[AudioPlayback] Created channel for ${participantId}, total channels: ${channelsRef.current.size}`);

        return channel;
    }, [getAudioContext]);

    // 비활성 채널 정리
    const cleanupInactiveChannels = useCallback(() => {
        const now = Date.now();
        const toRemove: string[] = [];

        channelsRef.current.forEach((channel, pid) => {
            if (!channel.isPlaying && (now - channel.lastPlayTime) > CONFIG.CHANNEL_TIMEOUT_MS) {
                toRemove.push(pid);
            }
        });

        toRemove.forEach(pid => {
            const channel = channelsRef.current.get(pid);
            if (channel) {
                channel.gainNode.disconnect();
                channelsRef.current.delete(pid);
                console.log(`[AudioPlayback] Removed inactive channel: ${pid}`);
            }
        });

        // 채널 수 제한
        if (channelsRef.current.size > CONFIG.MAX_CHANNELS) {
            const sorted = Array.from(channelsRef.current.entries())
                .filter(([_, ch]) => !ch.isPlaying)
                .sort((a, b) => a[1].lastPlayTime - b[1].lastPlayTime);

            const removeCount = channelsRef.current.size - CONFIG.MAX_CHANNELS;
            for (let i = 0; i < removeCount && i < sorted.length; i++) {
                const [pid, channel] = sorted[i];
                channel.gainNode.disconnect();
                channelsRef.current.delete(pid);
                console.log(`[AudioPlayback] Removed oldest channel: ${pid}`);
            }
        }
    }, []);

    // 활성 채널 수 업데이트
    const updateActiveCount = useCallback(() => {
        const count = Array.from(channelsRef.current.values()).filter(ch => ch.isPlaying).length;
        setActiveChannels(count);
    }, []);

    // 볼륨 설정
    const setVolume = useCallback((newVolume: number) => {
        const clampedVolume = Math.max(0, Math.min(1, newVolume));
        setVolumeState(clampedVolume);

        if (masterGainRef.current) {
            masterGainRef.current.gain.value = clampedVolume;
        }
    }, []);

    // MP3 오디오 재생 (참가자별 병렬)
    const playAudio = useCallback(async (audioData: ArrayBuffer, participantId?: string): Promise<void> => {
        const pid = participantId || 'unknown';

        try {
            const audioContext = getAudioContext();
            const channel = getOrCreateChannel(pid);

            // 이전 재생 중지 (같은 참가자의 이전 오디오만)
            if (channel.sourceNode) {
                try {
                    channel.sourceNode.stop();
                    channel.sourceNode.disconnect();
                } catch (e) {
                    // 이미 중지된 경우 무시
                }
                channel.sourceNode = null;
            }

            // MP3 디코딩
            const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

            // 새 소스 노드 생성
            const sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(channel.gainNode);

            channel.sourceNode = sourceNode;
            channel.isPlaying = true;
            channel.lastPlayTime = Date.now();

            updateActiveCount();
            onPlayStart?.(pid);

            console.log(`[AudioPlayback] ▶ Playing for ${pid}: ${audioBuffer.duration.toFixed(2)}s, active=${channelsRef.current.size}`);

            return new Promise<void>((resolve) => {
                sourceNode.onended = () => {
                    channel.isPlaying = false;
                    channel.sourceNode = null;
                    updateActiveCount();
                    onPlayEnd?.(pid);
                    resolve();
                };

                sourceNode.start(0);
            });
        } catch (error) {
            console.error(`[AudioPlayback] Failed to play for ${pid}:`, error);
            const channel = channelsRef.current.get(pid);
            if (channel) {
                channel.isPlaying = false;
                channel.sourceNode = null;
            }
            updateActiveCount();
            onError?.(error instanceof Error ? error : new Error('Audio playback failed'));
        }
    }, [getAudioContext, getOrCreateChannel, updateActiveCount, onPlayStart, onPlayEnd, onError]);

    // PCM 오디오 재생
    const playPCMAudio = useCallback(async (audioData: ArrayBuffer, sampleRate: number = 22050, participantId?: string): Promise<void> => {
        const pid = participantId || 'unknown';

        try {
            const audioContext = getAudioContext();
            const channel = getOrCreateChannel(pid);

            // 이전 재생 중지
            if (channel.sourceNode) {
                try {
                    channel.sourceNode.stop();
                    channel.sourceNode.disconnect();
                } catch (e) {
                    // 이미 중지된 경우 무시
                }
                channel.sourceNode = null;
            }

            // Int16 → Float32 변환
            const int16Array = new Int16Array(audioData);
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            // AudioBuffer 생성 (AudioContext의 sampleRate로 리샘플링됨)
            const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
            audioBuffer.getChannelData(0).set(float32Array);

            // 새 소스 노드 생성
            const sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(channel.gainNode);

            channel.sourceNode = sourceNode;
            channel.isPlaying = true;
            channel.lastPlayTime = Date.now();

            updateActiveCount();
            onPlayStart?.(pid);

            console.log(`[AudioPlayback] ▶ Playing PCM for ${pid}: ${audioBuffer.duration.toFixed(2)}s`);

            return new Promise<void>((resolve) => {
                sourceNode.onended = () => {
                    channel.isPlaying = false;
                    channel.sourceNode = null;
                    updateActiveCount();
                    onPlayEnd?.(pid);
                    resolve();
                };

                sourceNode.start(0);
            });
        } catch (error) {
            console.error(`[AudioPlayback] Failed to play PCM for ${pid}:`, error);
            const channel = channelsRef.current.get(pid);
            if (channel) {
                channel.isPlaying = false;
                channel.sourceNode = null;
            }
            updateActiveCount();
            onError?.(error instanceof Error ? error : new Error('PCM audio playback failed'));
        }
    }, [getAudioContext, getOrCreateChannel, updateActiveCount, onPlayStart, onPlayEnd, onError]);

    // 특정 참가자 오디오 중지
    const stopAudio = useCallback((participantId?: string) => {
        if (participantId) {
            const channel = channelsRef.current.get(participantId);
            if (channel?.sourceNode) {
                try {
                    channel.sourceNode.stop();
                    channel.sourceNode.disconnect();
                } catch (e) {
                    // 이미 중지된 경우 무시
                }
                channel.sourceNode = null;
                channel.isPlaying = false;
            }
        }
        updateActiveCount();
    }, [updateActiveCount]);

    // 모든 오디오 중지
    const stopAllAudio = useCallback(() => {
        channelsRef.current.forEach((channel) => {
            if (channel.sourceNode) {
                try {
                    channel.sourceNode.stop();
                    channel.sourceNode.disconnect();
                } catch (e) {
                    // 이미 중지된 경우 무시
                }
                channel.sourceNode = null;
                channel.isPlaying = false;
            }
        });
        updateActiveCount();
    }, [updateActiveCount]);

    // 레거시 호환성: queueAudio (이제 즉시 재생)
    const queueAudio = useCallback((audioData: ArrayBuffer, sampleRate?: number, participantId?: string) => {
        // 병렬 재생이므로 큐 없이 즉시 재생
        if (sampleRate !== undefined) {
            playPCMAudio(audioData, sampleRate, participantId);
        } else {
            playAudio(audioData, participantId);
        }
    }, [playAudio, playPCMAudio]);

    // 주기적 채널 정리
    useEffect(() => {
        const interval = setInterval(cleanupInactiveChannels, 10000);
        return () => clearInterval(interval);
    }, [cleanupInactiveChannels]);

    // 클린업
    useEffect(() => {
        return () => {
            stopAllAudio();
            channelsRef.current.forEach((channel) => {
                channel.gainNode.disconnect();
            });
            channelsRef.current.clear();
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        };
    }, [stopAllAudio]);

    // isPlaying은 하나라도 재생 중이면 true
    const isPlaying = activeChannels > 0;

    // currentParticipantId는 가장 최근 재생 시작한 참가자
    const currentParticipantId = Array.from(channelsRef.current.entries())
        .filter(([_, ch]) => ch.isPlaying)
        .sort((a, b) => b[1].lastPlayTime - a[1].lastPlayTime)[0]?.[0] || null;

    return {
        isPlaying,
        currentParticipantId,
        activeChannels,
        volume,
        setVolume,
        playAudio,
        playPCMAudio,
        stopAudio,
        stopAllAudio,
        queueAudio,
    };
}
