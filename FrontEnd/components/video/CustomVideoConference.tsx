'use client';

import {
    GridLayout,
    ParticipantTile,
    useTracks,
    useParticipants,
    ControlBar,
    RoomName,
    useConnectionState,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useMemo } from 'react';

export default function CustomVideoConference() {
    const connectionState = useConnectionState();
    const participants = useParticipants();

    // Filter tracks for camera and screen share
    const tracks = useTracks(
        [
            { source: Track.Source.Camera, withPlaceholder: true },
            { source: Track.Source.ScreenShare, withPlaceholder: false },
        ],
        {
            onlySubscribed: false,
        }
    );

    // Filter to only show active tracks (published video/audio)
    const activeTracks = useMemo(() => {
        return tracks.filter((trackRef) => {
            const participant = trackRef.participant;
            const hasPublishedTrack =
                participant.videoTrackPublications.size > 0 ||
                participant.audioTrackPublications.size > 0;

            return hasPublishedTrack;
        });
    }, [tracks]);

    // Connecting State
    if (connectionState === 'connecting') {
        return (
            <div className="h-full flex items-center justify-center bg-slate-900">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-white text-lg">Connecting...</p>
                </div>
            </div>
        );
    }

    // Waiting State (No tracks active)
    if (activeTracks.length === 0) {
        return (
            <div className="h-full flex flex-col bg-slate-950">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-slate-900/50 backdrop-blur-sm border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                        <RoomName className="text-white font-semibold" />
                    </div>
                    <span className="text-slate-400 text-sm">
                        {participants.length} Participants
                    </span>
                </div>

                {/* Waiting UI */}
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                            <svg className="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <p className="text-slate-400 text-lg">Waiting for others to join...</p>
                        <p className="text-slate-500 text-sm mt-2">Or enable your camera/mic to start.</p>
                    </div>
                </div>

                {/* Control Bar */}
                <div className="p-4 flex justify-center pb-8">
                    <ControlBar variation="minimal" />
                </div>
            </div>
        );
    }

    // Active Call UI
    return (
        <div className="h-full w-full flex flex-col bg-slate-950 overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-slate-900/50 backdrop-blur-sm border-b border-slate-800">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                    <RoomName className="text-white font-semibold" />
                </div>
                <span className="text-slate-400 text-sm">
                    {participants.length} Participants
                </span>
            </div>

            {/* Video Grid */}
            <div className="flex-1 min-h-0 p-4">
                <GridLayout
                    tracks={activeTracks}
                    style={{ height: '100%', width: '100%' }}
                >
                    <ParticipantTile />
                </GridLayout>
            </div>

            {/* Control Bar */}
            <div className="flex-shrink-0 p-6 bg-slate-900/80 backdrop-blur-sm border-t border-slate-800 flex justify-center">
                <ControlBar variation="minimal" />
            </div>
        </div>
    );
}
