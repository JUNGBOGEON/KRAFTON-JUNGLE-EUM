'use client';

import { useEffect, useRef } from 'react';
import { Track, Participant } from 'livekit-client';
import { useIsSpeaking, VideoTrack as LiveKitVideoTrack } from '@livekit/components-react';
import { MicOff, VideoOff } from 'lucide-react';
import { TrackReferenceOrPlaceholder } from '@livekit/components-core'; // Might need this type if we pass track ref

interface ParticipantVideoTileProps {
  participant: Participant;
  videoTrack?: MediaStreamTrack | null;
  audioTrack?: MediaStreamTrack | null;
  isLocal?: boolean;
  showName?: boolean;
  aspectRatio?: 'video' | 'square' | 'none';
  size?: 'sm' | 'md' | 'lg';
  currentUser?: {
    nickname: string;
    profileImg?: string;
  };
  onClick?: () => void;
}

export default function ParticipantVideoTile({
  participant,
  videoTrack,
  audioTrack,
  isLocal = false,
  showName = true,
  aspectRatio = 'video',
  size = 'md',
  currentUser,
  onClick,
}: ParticipantVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSpeaking = useIsSpeaking(participant);

  // Parse metadata for profile image
  let profileImg: string | undefined;
  try {
    const metadata = participant.metadata ? JSON.parse(participant.metadata) : {};
    profileImg = metadata.profileImg;
  } catch {
    // Ignore parse errors
  }

  // If local, use currentUser profileImg
  if (isLocal && currentUser?.profileImg) {
    profileImg = currentUser.profileImg;
  }

  const displayName = isLocal
    ? (currentUser?.nickname || participant.name || '나')
    : (participant.name || participant.identity);

  const isMuted = !audioTrack;
  const isCameraOff = !videoTrack;

  // No manual video attachment needed with LiveKitVideoTrack
  // useEffect removed

  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  const avatarSizes = {
    sm: 'w-10 h-10 text-sm',
    md: 'w-14 h-14 text-lg',
    lg: 'w-20 h-20 text-2xl',
  };

  return (
    <div
      className={`
        relative overflow-hidden rounded-lg border bg-stone-50
        transition-all duration-200 ease-out
        ${isSpeaking
          ? 'border-black/20 ring-1 ring-black/10'
          : 'border-black/[0.06]'
        }
        ${aspectRatio === 'video' ? 'aspect-video' : aspectRatio === 'square' ? 'aspect-square' : 'h-full'}
        ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-blue-500/50' : ''}
      `}
      onClick={onClick}
    >
      {/* Video or Avatar */}
      {!isCameraOff && videoTrack ? (
        <LiveKitVideoTrack
          trackRef={{
            participant,
            source: Track.Source.Camera,
            publication: participant.getTrackPublication(Track.Source.Camera)!
          }}
          className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-100 to-stone-50">
          {profileImg ? (
            <img
              src={profileImg}
              alt={displayName}
              className={`rounded-full object-cover ${avatarSizes[size]}`}
            />
          ) : (
            <div className={`rounded-full bg-black/10 flex items-center justify-center ${avatarSizes[size]}`}>
              <span className="font-medium text-black/50">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Speaking Indicator Ring */}
      {isSpeaking && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 border-2 border-black/20 rounded-lg animate-pulse" />
        </div>
      )}

      {/* Bottom Info Bar */}
      {showName && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Local indicator */}
              {isLocal && (
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-medium text-white">
                  나
                </span>
              )}
              <span className={`truncate text-white font-medium ${sizeClasses[size]}`}>
                {displayName}
              </span>
            </div>

            {/* Status Icons */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isMuted && (
                <div className="w-5 h-5 rounded bg-black/40 flex items-center justify-center">
                  <MicOff size={12} className="text-white" />
                </div>
              )}
              {isCameraOff && (
                <div className="w-5 h-5 rounded bg-black/40 flex items-center justify-center">
                  <VideoOff size={12} className="text-white" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
