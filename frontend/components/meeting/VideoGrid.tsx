'use client';

import { useMemo } from 'react';
import { Track } from 'livekit-client';
import {
    useParticipants,
    useTracks,
    useLocalParticipant,
} from '@livekit/components-react';
import ParticipantVideoTile from './ParticipantVideoTile';

interface VideoGridProps {
    currentUser: {
        nickname: string;
        profileImg?: string;
    };
    onPin?: (participantId: string) => void;
}

export default function VideoGrid({ currentUser, onPin }: VideoGridProps) {
    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();

    // Get all camera/audio tracks
    const cameraTracks = useTracks([Track.Source.Camera]);
    const audioTracks = useTracks([Track.Source.Microphone]);

    // Create a map of participant tracks
    const participantTracks = useMemo(() => {
        const trackMap = new Map<string, { video?: MediaStreamTrack; audio?: MediaStreamTrack }>();

        // Init map for all participants to ensure everyone gets a tile even without tracks
        participants.forEach(p => {
            trackMap.set(p.identity, {});
        });

        cameraTracks.forEach(track => {
            const participantId = track.participant.identity;
            if (!trackMap.has(participantId)) trackMap.set(participantId, {});
            const entry = trackMap.get(participantId)!;
            entry.video = track.publication?.track?.mediaStreamTrack || undefined;
        });

        audioTracks.forEach(track => {
            const participantId = track.participant.identity;
            if (!trackMap.has(participantId)) trackMap.set(participantId, {});
            const entry = trackMap.get(participantId)!;
            entry.audio = track.publication?.track?.mediaStreamTrack || undefined;
        });

        return trackMap;
    }, [participants, cameraTracks, audioTracks]);

    // Sort: Local first, then by join time
    const sortedParticipants = useMemo(() => {
        return [...participants].sort((a, b) => {
            if (a.isLocal) return -1;
            if (b.isLocal) return 1;
            return (a.joinedAt?.getTime() || 0) - (b.joinedAt?.getTime() || 0);
        });
    }, [participants]);

    const count = sortedParticipants.length;

    // Grid Layout Logic
    const getGridClass = (count: number) => {
        if (count <= 1) return 'grid-cols-1 grid-rows-1';
        if (count <= 2) return 'grid-cols-2 grid-rows-1'; // 1x2 or 2x1 usually better as 2 cols
        if (count <= 4) return 'grid-cols-2 grid-rows-2';
        if (count <= 6) return 'grid-cols-3 grid-rows-2';
        if (count <= 9) return 'grid-cols-3 grid-rows-3';
        if (count <= 12) return 'grid-cols-4 grid-rows-3';
        return 'grid-cols-4 grid-rows-4'; // max 16 usually
    };

    return (
        <div className={`grid ${getGridClass(count)} gap-4 w-full h-full p-4`}>
            {sortedParticipants.map(participant => {
                const tracks = participantTracks.get(participant.identity);
                return (
                    <div key={participant.identity} className="w-full h-full min-h-0 min-w-0">
                        <ParticipantVideoTile
                            participant={participant}
                            videoTrack={tracks?.video}
                            audioTrack={tracks?.audio}
                            isLocal={participant.isLocal}
                            currentUser={currentUser}
                            size="lg"
                            aspectRatio="none"
                            onClick={() => onPin?.(participant.identity)}
                        />
                    </div>
                );
            })}

            {/* Empty State */}
            {count === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                    <p className="text-black/40">참가자가 없습니다</p>
                </div>
            )}
        </div>
    );
}
