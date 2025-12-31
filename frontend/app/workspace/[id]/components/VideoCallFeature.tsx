'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    LiveKitRoom,
    RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { apiClient } from '@/app/lib/api';
import { useAuth } from '@/app/lib/auth-context';
import CustomVideoConference from '@/components/video/CustomVideoConference';
import WhiteboardCanvas from '@/components/video/whiteboard/WhiteboardCanvas';
import ParticipantSidebar from '@/components/video/ParticipantSidebar';
import ChatPanel, { VoiceRecord } from '@/components/video/ChatPanel';
import SubtitleOverlay from '@/components/video/SubtitleOverlay';
import { useRemoteParticipantTranslation, RemoteTranscriptData } from '@/app/hooks/useRemoteParticipantTranslation';
import { TargetLanguage } from '@/app/hooks/useAudioWebSocket';

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880';

interface VideoCallFeatureProps {
    roomId: string;
    roomTitle?: string;
    onLeave: () => void;
}

// LiveKitRoom 내부에서 사용할 컴포넌트 (번역 훅 사용)
function VideoCallContent({
    roomId,
    roomTitle,
    onLeave,
    user,
}: {
    roomId: string;
    roomTitle?: string;
    onLeave: () => void;
    user: { nickname?: string; profileImg?: string } | null;
}) {
    const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isTranslationOpen, setIsTranslationOpen] = useState(false);
    const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>('en');
    const [unreadCount, setUnreadCount] = useState(0);
    const [voiceRecords, setVoiceRecords] = useState<VoiceRecord[]>([]);
    const [currentSpeaker, setCurrentSpeaker] = useState<{ name: string; profileImg?: string; isLocal?: boolean } | null>(null);
    const [currentTranscript, setCurrentTranscript] = useState<string | null>(null);
    const [currentOriginal, setCurrentOriginal] = useState<string | null>(null);
    const lastTranscriptRef = useRef<string | null>(null);
    const transcriptTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // STT/번역 결과 처리 (모든 원격 참가자)
    const handleTranscript = useCallback((data: RemoteTranscriptData) => {
        console.log("[VideoCallFeature] Transcript:", data.participantName, "-", data.original);

        // 중복 방지
        const key = `${data.participantId}-${data.original}`;
        if (key === lastTranscriptRef.current) {
            return;
        }
        lastTranscriptRef.current = key;

        // 음성 기록에 항상 추가 (STT)
        // 번역 모드일 때만 translated와 targetLanguage 포함
        const newRecord: VoiceRecord = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            speaker: data.participantName || data.participantId,
            profileImg: undefined,
            original: data.original,
            translated: isTranslationOpen ? data.translated : undefined,
            targetLanguage: isTranslationOpen ? targetLanguage : undefined,
            timestamp: Date.now(),
        };
        setVoiceRecords(prev => [...prev, newRecord]);

        // 번역 모드일 때만 자막 표시
        if (isTranslationOpen) {
            setCurrentSpeaker({
                name: data.participantName || data.participantId,
                profileImg: undefined,
                isLocal: false,
            });
            setCurrentOriginal(data.original);
            setCurrentTranscript(data.translated);

            // 5초 후 자막 클리어
            if (transcriptTimeoutRef.current) {
                clearTimeout(transcriptTimeoutRef.current);
            }
            transcriptTimeoutRef.current = setTimeout(() => {
                setCurrentTranscript(null);
                setCurrentOriginal(null);
                setCurrentSpeaker(null);
            }, 5000);
        }
    }, [isTranslationOpen, targetLanguage]);

    // 원격 참가자 음성 캡처 훅 (STT는 항상 활성화, TTS는 번역 모드일 때만)
    const {
        isActive: isTranslationActive,
    } = useRemoteParticipantTranslation({
        enabled: isTranslationOpen,  // TTS 재생 여부 (번역 모드)
        sttEnabled: true,            // STT는 항상 활성화
        targetLanguage,
        autoPlayTTS: true,
        chunkIntervalMs: 1500,
        onTranscript: handleTranscript,
    });

    const toggleChat = useCallback(() => {
        setIsChatOpen(prev => {
            if (!prev) setUnreadCount(0);
            return !prev;
        });
    }, []);

    const toggleWhiteboard = useCallback(() => {
        setIsWhiteboardOpen(prev => !prev);
    }, []);

    const toggleTranslation = useCallback(() => {
        setIsTranslationOpen(prev => !prev);
    }, []);

    const handleNewMessage = useCallback(() => {
        if (!isChatOpen) setUnreadCount(prev => prev + 1);
    }, [isChatOpen]);

    return (
        <>
            <RoomAudioRenderer />

            {/* 화이트보드 모드 */}
            {isWhiteboardOpen ? (
                <div className="flex-1 flex gap-4 p-4 bg-black/5 overflow-hidden">
                    <div className="flex-1 flex flex-col bg-white rounded-2xl overflow-hidden border border-black/10">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-black/5">
                            <div className="flex items-center gap-3">
                                <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                                <span className="font-medium text-black">화이트보드</span>
                                <span className="text-xs text-black/40 bg-black/5 px-2 py-0.5 rounded-full">
                                    {roomTitle || roomId}
                                </span>
                            </div>
                            <button
                                onClick={toggleWhiteboard}
                                className="p-2 text-black/40 hover:text-black hover:bg-black/5 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <WhiteboardCanvas />
                        </div>
                    </div>
                    <div className="w-72 bg-white rounded-2xl overflow-hidden border border-black/10 flex-shrink-0">
                        <ParticipantSidebar />
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-hidden">
                    <CustomVideoConference
                        customRoomName={roomTitle}
                        isChatOpen={isChatOpen}
                        isWhiteboardOpen={isWhiteboardOpen}
                        isTranslationOpen={isTranslationOpen}
                        targetLanguage={targetLanguage}
                        onTargetLanguageChange={setTargetLanguage}
                        unreadCount={unreadCount}
                        onToggleChat={toggleChat}
                        onToggleWhiteboard={toggleWhiteboard}
                        onToggleTranslation={toggleTranslation}
                        onLeave={onLeave}
                        currentUser={{
                            nickname: user?.nickname || 'Anonymous',
                            profileImg: user?.profileImg
                        }}
                    />
                </div>
            )}

            {/* 채팅 패널 */}
            <div className={`fixed top-14 right-0 bottom-0 w-80 z-40 transform transition-transform duration-300 ease-out ${
                isChatOpen && !isWhiteboardOpen ? 'translate-x-0' : 'translate-x-full'
            }`}>
                <ChatPanel
                    roomId={roomId}
                    onClose={toggleChat}
                    onNewMessage={handleNewMessage}
                    voiceRecords={voiceRecords}
                />
            </div>

            {/* 실시간 자막 오버레이 */}
            <SubtitleOverlay
                text={currentTranscript}
                originalText={currentOriginal}
                speaker={currentSpeaker || undefined}
                isActive={isTranslationActive}
                showTranslation={isTranslationOpen}
            />
        </>
    );
}

export default function VideoCallFeature({ roomId, roomTitle, onLeave }: VideoCallFeatureProps) {
    const { user } = useAuth();
    const [token, setToken] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const participantName = user?.nickname || 'Anonymous';

    useEffect(() => {
        const fetchToken = async () => {
            try {
                const response = await apiClient.getVideoToken(roomId, participantName);
                setToken(response.token);
            } catch (err) {
                console.error('Failed to get token:', err);
                setError('연결에 실패했습니다');
            }
        };

        if (roomId && participantName) {
            fetchToken();
        }
    }, [roomId, participantName]);

    // 에러 상태
    if (error) {
        return (
            <div className="h-full w-full bg-white flex items-center justify-center p-4">
                <div className="max-w-sm w-full text-center">
                    <div className="w-16 h-16 rounded-2xl bg-black/5 flex items-center justify-center mx-auto mb-6">
                        <svg className="w-8 h-8 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold text-black mb-2">연결 실패</h2>
                    <p className="text-black/40 mb-8">{error}</p>
                    <button
                        onClick={onLeave}
                        className="w-full py-3 bg-black text-white rounded-xl hover:bg-black/80 transition-colors font-medium"
                    >
                        돌아가기
                    </button>
                </div>
            </div>
        );
    }

    // 로딩 상태
    if (!token) {
        return (
            <div className="h-full w-full bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-10 h-10 border-2 border-black/10 border-t-black rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-black/40 text-sm">연결 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full bg-white overflow-hidden flex flex-col">
            <LiveKitRoom
                serverUrl={LIVEKIT_URL}
                token={token}
                connect={true}
                video={false}
                audio={true}
                onDisconnected={onLeave}
                onError={(err) => {
                    console.error('LiveKit error:', err);
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
                className="h-full w-full flex flex-col"
            >
                <VideoCallContent
                    roomId={roomId}
                    roomTitle={roomTitle}
                    onLeave={onLeave}
                    user={user}
                />
            </LiveKitRoom>
        </div>
    );
}
