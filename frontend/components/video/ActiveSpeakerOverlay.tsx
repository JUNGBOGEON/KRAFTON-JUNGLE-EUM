import { useEffect, useState, useMemo, useRef } from 'react';
import {
    useSpeakingParticipants,
    VideoTrack,
} from '@livekit/components-react';
import { Participant, Track } from 'livekit-client';

export default function ActiveSpeakerOverlay() {
    const rawSpeakers = useSpeakingParticipants();

    // Filter for remote speakers only
    const activeRemoteSpeaker = useMemo(() => {
        return rawSpeakers.find((p) => !p.isLocal);
    }, [rawSpeakers]);

    const [displaySpeaker, setDisplaySpeaker] = useState<Participant | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [profileImg, setProfileImg] = useState<string | null>(null);
    const [position, setPosition] = useState({ x: window.innerWidth - 120, y: 100 });
    const [isDragging, setIsDragging] = useState(false);

    const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        if (activeRemoteSpeaker) {
            // New speaker active: Show immediately
            if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
            setDisplaySpeaker(activeRemoteSpeaker);
            setIsVisible(true);
        } else {
            // Speaker stopped: Wait before hiding (Delayed Disappearance)
            if (!fadeTimeoutRef.current && isVisible) {
                fadeTimeoutRef.current = setTimeout(() => {
                    setIsVisible(false);
                    fadeTimeoutRef.current = null;
                }, 3000); // Wait 3 seconds before popping out
            }
        }
    }, [activeRemoteSpeaker, isVisible]);

    // Parse metadata
    useEffect(() => {
        if (displaySpeaker?.metadata) {
            try {
                const meta = JSON.parse(displaySpeaker.metadata);
                if (meta.profileImg) {
                    setProfileImg(meta.profileImg);
                } else {
                    setProfileImg(null);
                }
            } catch (e) {
                setProfileImg(null);
            }
        } else {
            setProfileImg(null);
        }
    }, [displaySpeaker, displaySpeaker?.metadata]);

    // Cleanup timeout
    useEffect(() => {
        return () => {
            if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
        };
    }, []);

    // Draggable Handlers
    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault(); // Prevent default text selection
        e.stopPropagation(); // Stop propagation to whiteboard
        setIsDragging(true);
        dragOffsetRef.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
        // Capture pointer to track movement outside element
        (e.target as Element).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        setPosition({
            x: e.clientX - dragOffsetRef.current.x,
            y: e.clientY - dragOffsetRef.current.y
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        (e.target as Element).releasePointerCapture(e.pointerId);
    };

    if (!displaySpeaker) return null;

    const isCameraOn = displaySpeaker.isCameraEnabled;

    return (
        <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
                left: position.x,
                top: position.y,
                // Force cursor override regardless of tool
                cursor: 'move',
                touchAction: 'none'
            }}
            className={`fixed z-[100] transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${isVisible ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                }`}
        >
            {/* Reduced Size: w-24 h-24 (was w-32 h-32) */}
            <div className="relative w-24 h-24 rounded-full overflow-hidden border-4 border-white/20 shadow-2xl bg-black select-none">
                {/* Video Track */}
                {isCameraOn ? (
                    <VideoTrack
                        trackRef={{
                            participant: displaySpeaker,
                            source: Track.Source.Camera,
                        }}
                        className="w-full h-full object-cover transform scale-125 pointer-events-none"
                    />
                ) : (
                    /* Fallback: Profile Image */
                    <div className="w-full h-full flex items-center justify-center bg-zinc-800 pointer-events-none">
                        {profileImg ? (
                            <img
                                src={profileImg}
                                alt="Speaker"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="text-3xl font-bold text-white/40">
                                {displaySpeaker.identity?.charAt(0).toUpperCase()}
                            </span>
                        )}
                    </div>
                )}

                {/* Active Indicator Ring */}
                <div className={`absolute inset-0 rounded-full border-2 pointer-events-none ${isVisible ? 'border-green-400/50' : 'border-transparent'}`} />
            </div>

            {/* Name Tag */}
            <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap pointer-events-none">
                <span className="px-2 py-0.5 bg-black/50 backdrop-blur-md rounded-full text-white text-[10px] font-medium">
                    {displaySpeaker.name || displaySpeaker.identity || 'Unknown'}
                </span>
            </div>
        </div>
    );
}
