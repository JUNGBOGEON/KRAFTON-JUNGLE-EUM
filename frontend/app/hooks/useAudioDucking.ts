"use client";

import { useCallback, useRef } from "react";
import { useParticipants } from "@livekit/components-react";
import { Track, RemoteAudioTrack } from "livekit-client";

// 요구사항: TTS 재생 시 원본 볼륨을 20-30%로 줄임
const DUCK_VOLUME = 0.25;      // 25% (20-30% 사이)
const NORMAL_VOLUME = 1.0;
const FADE_DURATION_MS = 300;  // 부드러운 전환을 위해 300ms
const FADE_STEPS = 15;         // 더 부드러운 페이드

interface DuckingState {
    participantId: string;
    intervalId: NodeJS.Timeout | null;
    currentVolume: number;
}

interface UseAudioDuckingReturn {
    duckParticipant: (participantId: string) => void;
    unduckParticipant: (participantId: string) => void;
    unduckAll: () => void;
    isDucked: (participantId: string) => boolean;
}

export function useAudioDucking(): UseAudioDuckingReturn {
    const participants = useParticipants();
    const duckingStatesRef = useRef<Map<string, DuckingState>>(new Map());

    const getRemoteAudioTrack = useCallback((participantId: string): RemoteAudioTrack | null => {
        const participant = participants.find(p => p.identity === participantId);
        if (!participant || participant.isLocal) {
            return null;
        }

        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        if (!micPub?.track || !(micPub.track instanceof RemoteAudioTrack)) {
            return null;
        }

        return micPub.track as RemoteAudioTrack;
    }, [participants]);

    const fadeVolume = useCallback((
        participantId: string,
        fromVolume: number,
        toVolume: number,
        onComplete?: () => void
    ) => {
        const audioTrack = getRemoteAudioTrack(participantId);
        if (!audioTrack) {
            onComplete?.();
            return;
        }

        // Clear existing fade interval
        const existingState = duckingStatesRef.current.get(participantId);
        if (existingState?.intervalId) {
            clearInterval(existingState.intervalId);
        }

        const stepTime = FADE_DURATION_MS / FADE_STEPS;
        const volumeStep = (toVolume - fromVolume) / FADE_STEPS;
        let currentStep = 0;
        let currentVolume = fromVolume;

        const intervalId = setInterval(() => {
            currentStep++;
            currentVolume += volumeStep;

            if (currentStep >= FADE_STEPS) {
                currentVolume = toVolume;
                clearInterval(intervalId);

                duckingStatesRef.current.set(participantId, {
                    participantId,
                    intervalId: null,
                    currentVolume: toVolume,
                });

                onComplete?.();
            }

            // Apply volume using setVolume API
            try {
                audioTrack.setVolume(currentVolume);
            } catch (e) {
                console.warn(`[AudioDucking] Failed to set volume for ${participantId}:`, e);
            }
        }, stepTime);

        duckingStatesRef.current.set(participantId, {
            participantId,
            intervalId,
            currentVolume,
        });
    }, [getRemoteAudioTrack]);

    const duckParticipant = useCallback((participantId: string) => {
        const state = duckingStatesRef.current.get(participantId);
        const fromVolume = state?.currentVolume ?? NORMAL_VOLUME;

        console.log(`[AudioDucking] Ducking participant: ${participantId}, from ${fromVolume} to ${DUCK_VOLUME}`);

        fadeVolume(participantId, fromVolume, DUCK_VOLUME);
    }, [fadeVolume]);

    const unduckParticipant = useCallback((participantId: string) => {
        const state = duckingStatesRef.current.get(participantId);
        const fromVolume = state?.currentVolume ?? DUCK_VOLUME;

        console.log(`[AudioDucking] Unducking participant: ${participantId}, from ${fromVolume} to ${NORMAL_VOLUME}`);

        fadeVolume(participantId, fromVolume, NORMAL_VOLUME, () => {
            duckingStatesRef.current.delete(participantId);
        });
    }, [fadeVolume]);

    const unduckAll = useCallback(() => {
        console.log(`[AudioDucking] Unducking all participants`);

        duckingStatesRef.current.forEach((state, participantId) => {
            unduckParticipant(participantId);
        });
    }, [unduckParticipant]);

    const isDucked = useCallback((participantId: string): boolean => {
        const state = duckingStatesRef.current.get(participantId);
        return state !== undefined && state.currentVolume < NORMAL_VOLUME;
    }, []);

    return {
        duckParticipant,
        unduckParticipant,
        unduckAll,
        isDucked,
    };
}
