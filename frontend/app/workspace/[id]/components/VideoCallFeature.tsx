'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    useLocalParticipant,
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
    const [sourceLanguage, setSourceLanguage] = useState<TargetLanguage>('ko');  // 내가 말하는 언어
    const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>('en');  // 듣고 싶은 언어
    const [unreadCount, setUnreadCount] = useState(0);
    const [voiceRecords, setVoiceRecords] = useState<VoiceRecord[]>([]);
    const [currentSpeaker, setCurrentSpeaker] = useState<{ name: string; profileImg?: string; isLocal?: boolean } | null>(null);
    const [currentTranscript, setCurrentTranscript] = useState<string | null>(null);
    const [currentOriginal, setCurrentOriginal] = useState<string | null>(null);
    const lastTranscriptRef = useRef<string | null>(null);
    const transcriptTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // 로컬 참가자 접근
    const { localParticipant } = useLocalParticipant();

    // 로컬 참가자의 메타데이터에 sourceLanguage 저장 (다른 참가자가 알 수 있도록)
    useEffect(() => {
        if (!localParticipant) return;

        // 연결 상태 확인 후 메타데이터 설정
        const updateMetadata = async () => {
            try {
                // 참가자가 완전히 연결될 때까지 대기
                if (!localParticipant.sid) {
                    console.log('[VideoCallContent] Waiting for participant to be fully connected...');
                    return;
                }

                // 기존 메타데이터 파싱 (있으면)
                let existingMetadata: Record<string, unknown> = {};
                if (localParticipant.metadata) {
                    try {
                        existingMetadata = JSON.parse(localParticipant.metadata);
                    } catch {
                        // 파싱 실패 시 빈 객체 사용
                    }
                }

                // sourceLanguage 추가/업데이트
                const newMetadata = {
                    ...existingMetadata,
                    sourceLanguage: sourceLanguage,
                    profileImg: user?.profileImg,
                };

                // 기존 메타데이터와 같으면 업데이트 스킵
                const newMetadataStr = JSON.stringify(newMetadata);
                if (localParticipant.metadata === newMetadataStr) {
                    return;
                }

                await localParticipant.setMetadata(newMetadataStr);
                console.log(`[VideoCallContent] Updated local participant metadata:`, newMetadata);
            } catch (err) {
                // 타임아웃이나 연결 오류는 무시 (재시도하지 않음)
                console.warn('[VideoCallContent] Failed to update metadata (non-critical):', err);
            }
        };

        // 약간의 딜레이 후 메타데이터 업데이트 (연결 안정화 대기)
        const timeoutId = setTimeout(updateMetadata, 500);
        return () => clearTimeout(timeoutId);
    }, [localParticipant, localParticipant?.sid, sourceLanguage, user?.profileImg]);

    // STT/번역 결과 처리 (모든 원격 참가자)
    const handleTranscript = useCallback((data: RemoteTranscriptData) => {
        console.log("[VideoCallFeature] Transcript:", data.participantName, "-", data.original, "translated:", data.translated);

        const key = `${data.participantId}-${data.original}`;
        const hasTranslation = data.translated && data.translated.length > 0;

        // 번역이 있는 경우: 기존 레코드 업데이트 또는 새로 추가
        // 번역이 없는 경우: 중복 방지 체크 후 추가
        if (!hasTranslation && key === lastTranscriptRef.current) {
            // STT만 있고 이미 처리된 경우 스킵
            return;
        }

        // 번역이 포함된 경우 기존 레코드 업데이트
        if (hasTranslation) {
            setVoiceRecords(prev => {
                // 같은 original을 가진 마지막 레코드 찾기
                const lastIndex = prev.findLastIndex(r =>
                    r.speaker === (data.participantName || data.participantId) &&
                    r.original === data.original
                );

                if (lastIndex >= 0) {
                    // 기존 레코드 업데이트
                    const updated = [...prev];
                    updated[lastIndex] = {
                        ...updated[lastIndex],
                        translated: isTranslationOpen ? data.translated : undefined,
                        targetLanguage: isTranslationOpen ? targetLanguage : undefined,
                    };
                    return updated;
                }

                // 없으면 새로 추가
                return [...prev, {
                    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    speaker: data.participantName || data.participantId,
                    profileImg: data.profileImg,
                    original: data.original,
                    translated: isTranslationOpen ? data.translated : undefined,
                    targetLanguage: isTranslationOpen ? targetLanguage : undefined,
                    timestamp: Date.now(),
                }];
            });
        } else {
            // STT만 있는 경우 새 레코드 추가
            lastTranscriptRef.current = key;

            const newRecord: VoiceRecord = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                speaker: data.participantName || data.participantId,
                profileImg: data.profileImg,
                original: data.original,
                translated: undefined,
                targetLanguage: undefined,
                timestamp: Date.now(),
            };
            setVoiceRecords(prev => [...prev, newRecord]);
        }

        // 번역 모드일 때만 자막 표시 (번역이 있을 때)
        if (isTranslationOpen && hasTranslation) {
            setCurrentSpeaker({
                name: data.participantName || data.participantId,
                profileImg: data.profileImg,
                isLocal: false,
            });
            setCurrentOriginal(data.original);
            setCurrentTranscript(data.translated);

            // 3초 후 자막 클리어 (더 빠르게)
            if (transcriptTimeoutRef.current) {
                clearTimeout(transcriptTimeoutRef.current);
            }
            transcriptTimeoutRef.current = setTimeout(() => {
                setCurrentTranscript(null);
                setCurrentOriginal(null);
                setCurrentSpeaker(null);
            }, 3000);
        }
    }, [isTranslationOpen, targetLanguage]);

    // 원격 참가자 음성 캡처 훅 (STT는 항상 활성화, TTS는 번역 모드일 때만)
    const {
        isActive: isTranslationActive,
    } = useRemoteParticipantTranslation({
        roomId,                      // 방 ID (같은 방의 동일 언어 그룹을 묶기 위해)
        enabled: isTranslationOpen,  // TTS 재생 여부 (번역 모드)
        sttEnabled: true,            // STT는 항상 활성화
        sourceLanguage,              // 발화자가 말하는 언어
        targetLanguage,              // 듣고 싶은 언어
        listenerId: localParticipant?.identity,  // 리스너 ID
        autoPlayTTS: true,
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
                        sourceLanguage={sourceLanguage}
                        targetLanguage={targetLanguage}
                        onSourceLanguageChange={setSourceLanguage}
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
