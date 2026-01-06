'use client';

import { useState, useEffect } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import '@livekit/components-styles';
import { apiClient } from '@/app/lib/api';
import { useAuth } from '@/app/lib/auth-context';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import ActiveMeeting from './ActiveMeeting';

interface NotionMeetingWorkspaceProps {
  roomId: string;
  roomTitle?: string;
  onLeave: () => void;
}

export default function NotionMeetingWorkspace({
  roomId,
  roomTitle = '회의',
  onLeave
}: NotionMeetingWorkspaceProps) {
  const { user } = useAuth();
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [liveKitUrl, setLiveKitUrl] = useState<string>(process.env.NEXT_PUBLIC_LIVEKIT_URL || '');

  const participantName = user?.nickname || 'Anonymous';

  // Determine LiveKit URL on client side if not in env
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_LIVEKIT_URL && typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      setLiveKitUrl(`${protocol}//${window.location.hostname}:7880`);
    }
  }, []);

  // Fetch LiveKit token
  useEffect(() => {
    const fetchToken = async () => {
      try {
        setError(null);
        const response = await apiClient.getVideoToken(roomId, participantName);
        setToken(response.token);
      } catch (err) {
        console.error('[NotionMeetingWorkspace] Failed to get token:', err);
        setError('연결에 실패했습니다. 다시 시도해주세요.');
      }
    };

    if (roomId && participantName) {
      fetchToken();
    }
  }, [roomId, participantName]);

  // Retry handler
  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      setError(null);
      const response = await apiClient.getVideoToken(roomId, participantName);
      setToken(response.token);
    } catch (err) {
      console.error('[NotionMeetingWorkspace] Retry failed:', err);
      setError('연결에 실패했습니다. 네트워크를 확인해주세요.');
    } finally {
      setIsRetrying(false);
    }
  };

  // Error state
  if (error) {
    return (
      <div className="h-full w-full bg-white flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-black/30" />
          </div>
          <h2 className="text-xl font-semibold text-black mb-2">연결 실패</h2>
          <p className="text-sm text-black/40 mb-8">{error}</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="w-full py-3 bg-black text-white rounded-xl hover:bg-black/80 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isRetrying ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  재시도 중...
                </>
              ) : (
                <>
                  <RefreshCw size={18} />
                  다시 시도
                </>
              )}
            </button>
            <button
              onClick={onLeave}
              className="w-full py-3 bg-black/[0.04] text-black/70 rounded-xl hover:bg-black/[0.08] transition-colors font-medium"
            >
              돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (!token || !liveKitUrl) {
    return (
      <div className="h-full w-full bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-black/10 border-t-black rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-black/40">연결 중...</p>
          <p className="text-xs text-black/30 mt-1">{roomTitle}에 참가하는 중입니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-white overflow-hidden">
      <LiveKitRoom
        serverUrl={liveKitUrl}
        token={token}
        connect={true}
        video={false}
        audio={true}
        onDisconnected={onLeave}
        onError={(err) => {
          console.error('[NotionMeetingWorkspace] LiveKit error:', err);
          setError(err.message);
        }}
        options={{
          adaptiveStream: true,
          dynacast: true,
          disconnectOnPageLeave: true,
          videoCaptureDefaults: {
            resolution: { width: 1280, height: 720, frameRate: 30 },
          },
          publishDefaults: {
            simulcast: true,
            videoCodec: 'vp8',
          },
        }}
        className="h-full w-full"
      >
        <ActiveMeeting
          roomId={roomId}
          roomTitle={roomTitle}
          onLeave={onLeave}
          currentUser={{
            nickname: user?.nickname || 'Anonymous',
            profileImg: user?.profileImg,
          }}
        />
      </LiveKitRoom>
    </div>
  );
}
