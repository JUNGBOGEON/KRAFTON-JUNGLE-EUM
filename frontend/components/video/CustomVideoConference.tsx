'use client';

import {
    useTracks,
    useParticipants,
    useLocalParticipant,
    useConnectionState,
    DisconnectButton,
    VideoTrack,
    useIsSpeaking,
    TrackReferenceOrPlaceholder,
    isTrackReference,
} from '@livekit/components-react';
import { Track, Participant } from 'livekit-client';
import { useMemo, useEffect, useState } from 'react';
import { SUPPORTED_LANGUAGES, TargetLanguage } from '@/app/hooks/useAudioWebSocket';

interface CurrentUser {
    nickname: string;
    profileImg?: string;
}

interface CustomVideoConferenceProps {
    customRoomName?: string;
    isChatOpen?: boolean;
    isWhiteboardOpen?: boolean;
    isTranslationOpen?: boolean;
    targetLanguage?: TargetLanguage;
    onTargetLanguageChange?: (lang: TargetLanguage) => void;
    unreadCount?: number;
    onToggleChat?: () => void;
    onToggleWhiteboard?: () => void;
    onToggleTranslation?: () => void;
    onLeave?: () => void;
    currentUser?: CurrentUser;
}

export default function CustomVideoConference({
    customRoomName,
    isChatOpen = false,
    isTranslationOpen = false,
    targetLanguage = 'en',
    onTargetLanguageChange,
    unreadCount = 0,
    onToggleChat,
    onToggleWhiteboard,
    onToggleTranslation,
    onLeave,
    currentUser,
}: CustomVideoConferenceProps) {
    const connectionState = useConnectionState();
    const participants = useParticipants();
    const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();

    const tracks = useTracks(
        [
            { source: Track.Source.Camera, withPlaceholder: true },
            { source: Track.Source.ScreenShare, withPlaceholder: false },
        ],
        { onlySubscribed: false }
    );

    // 디버깅 로그 (개발 중에만)
    useEffect(() => {
        console.log('Connection state:', connectionState);
        console.log('Participants:', participants.length, participants.map(p => p.identity));
        console.log('Tracks:', tracks.length, tracks.map(t => ({
            participant: t.participant.identity,
            source: t.source,
            isTrackRef: isTrackReference(t)
        })));
    }, [connectionState, participants, tracks]);

    // 카메라 트랙만 필터링
    const cameraTracks = useMemo(() => {
        return tracks.filter((trackRef) => trackRef.source === Track.Source.Camera);
    }, [tracks]);

    // 화면 공유 트랙
    const screenShareTracks = useMemo(() => {
        return tracks.filter((trackRef) => trackRef.source === Track.Source.ScreenShare);
    }, [tracks]);

    // 그리드 레이아웃 계산
    const getGridClass = (count: number) => {
        if (count === 1) return 'grid-cols-1';
        if (count === 2) return 'grid-cols-2';
        if (count <= 4) return 'grid-cols-2';
        if (count <= 6) return 'grid-cols-3';
        return 'grid-cols-4';
    };

    // 연결 중
    if (connectionState === 'connecting') {
        return (
            <div className="h-full flex items-center justify-center bg-white">
                <div className="text-center">
                    <div className="w-10 h-10 border-2 border-black/10 border-t-black rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-black/40 text-sm">연결 중...</p>
                </div>
            </div>
        );
    }

    const totalTracks = screenShareTracks.length + cameraTracks.length;

    return (
        <div className="h-full w-full flex flex-col bg-white">
            {/* 비디오 그리드 */}
            <div className="flex-1 min-h-0 p-4 overflow-hidden">
                {totalTracks > 0 ? (
                    <div className={`grid ${getGridClass(totalTracks)} gap-3 h-full auto-rows-fr`}>
                        {/* 화면 공유 먼저 표시 */}
                        {screenShareTracks.map((trackRef, index) => (
                            <CustomParticipantTile
                                key={`screen-${trackRef.participant.identity}-${index}`}
                                trackRef={trackRef}
                                currentUser={currentUser}
                                localParticipantIdentity={localParticipant?.identity}
                            />
                        ))}
                        {/* 카메라 트랙 */}
                        {cameraTracks.map((trackRef, index) => (
                            <CustomParticipantTile
                                key={`camera-${trackRef.participant.identity}-${index}`}
                                trackRef={trackRef}
                                currentUser={currentUser}
                                localParticipantIdentity={localParticipant?.identity}
                            />
                        ))}
                    </div>
                ) : (
                    /* 참가자가 없을 때 대기 화면 */
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-20 h-20 bg-black/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <svg className="w-10 h-10 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <p className="text-black text-lg font-medium mb-1">{customRoomName || '통화방'}</p>
                            <p className="text-black/40 text-sm">{participants.length}명 참가 중</p>
                        </div>
                    </div>
                )}
            </div>

            {/* 컨트롤바 */}
            <ControlBarComponent
                isChatOpen={isChatOpen}
                isTranslationOpen={isTranslationOpen}
                targetLanguage={targetLanguage}
                onTargetLanguageChange={onTargetLanguageChange}
                unreadCount={unreadCount}
                isMicEnabled={isMicrophoneEnabled}
                isCamEnabled={isCameraEnabled}
                isScreenEnabled={isScreenShareEnabled}
                onToggleMic={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
                onToggleCam={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
                onToggleScreen={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
                onToggleChat={onToggleChat}
                onToggleWhiteboard={onToggleWhiteboard}
                onToggleTranslation={onToggleTranslation}
                onLeave={onLeave}
            />
        </div>
    );
}

// 커스텀 참가자 타일 - 카메라 OFF 시 프로필 이미지 + 이름 표시
function CustomParticipantTile({
    trackRef,
    currentUser,
    localParticipantIdentity
}: {
    trackRef?: TrackReferenceOrPlaceholder;
    currentUser?: CurrentUser;
    localParticipantIdentity?: string;
}) {
    if (!trackRef) return null;

    const participant = trackRef.participant;
    const isSpeaking = useIsSpeaking(participant);

    // 카메라가 활성화되어 있는지 확인
    const hasActiveVideoTrack = isTrackReference(trackRef) &&
        trackRef.publication?.track !== undefined &&
        !trackRef.publication?.isMuted;

    // 카메라 로딩 중인지 확인 (트랙이 있지만 아직 활성화되지 않은 상태)
    const isVideoLoading = isTrackReference(trackRef) &&
        trackRef.publication?.track !== undefined &&
        trackRef.publication?.isMuted === false &&
        !hasActiveVideoTrack;

    // 참가자 이름
    const displayName = participant.name || participant.identity || 'Unknown';
    const initial = displayName.charAt(0).toUpperCase();

    // 로컬 참가자인지 확인하고 프로필 이미지 결정
    const isLocalParticipant = participant.identity === localParticipantIdentity;
    let profileImg: string | undefined;

    if (isLocalParticipant && currentUser?.profileImg) {
        // 로컬 참가자면 currentUser에서 프로필 이미지 가져오기
        profileImg = currentUser.profileImg;
    } else {
        // 원격 참가자는 메타데이터에서 시도
        try {
            if (participant.metadata) {
                const metadata = JSON.parse(participant.metadata);
                profileImg = metadata.profileImg;
            }
        } catch (e) {
            // 메타데이터 파싱 실패 시 무시
        }
    }

    return (
        <div className="relative w-full h-full bg-[#1a1a1a] rounded-xl overflow-hidden">
            {/* 비디오 트랙 - 항상 렌더링하고 opacity로 전환 */}
            {isTrackReference(trackRef) && trackRef.publication?.track && (
                <div className={`absolute inset-0 transition-opacity duration-300 ${hasActiveVideoTrack ? 'opacity-100' : 'opacity-0'}`}>
                    <VideoTrack
                        trackRef={trackRef as any}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            {/* 프로필 화면 - 카메라 OFF 시 표시 */}
            <div className={`absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#2a2a2a] to-[#1a1a1a] transition-opacity duration-300 ${hasActiveVideoTrack ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                {/* 프로필 아바타 */}
                <div className={`relative mb-4 rounded-full ${isSpeaking ? 'ring-[3px] ring-green-400 ring-offset-2 ring-offset-[#1a1a1a]' : ''}`}>
                    {profileImg ? (
                        <img
                            src={profileImg}
                            alt={displayName}
                            className="w-24 h-24 rounded-full object-cover shadow-lg"
                        />
                    ) : (
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                            <span className="text-4xl font-bold text-white">{initial}</span>
                        </div>
                    )}
                </div>
                {/* 이름 */}
                <p className="text-white font-medium text-lg">{displayName}</p>
            </div>

            {/* 카메라 로딩 오버레이 */}
            {isVideoLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a] z-20">
                    <img
                        src="/logo_white.png"
                        alt="Loading"
                        className="w-12 h-12 animate-pulse"
                    />
                </div>
            )}

            {/* 참가자 정보 오버레이 - 카메라 켜졌을 때만 표시 */}
            {hasActiveVideoTrack && (
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent z-10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {profileImg ? (
                                <img
                                    src={profileImg}
                                    alt={displayName}
                                    className="w-6 h-6 rounded-full object-cover"
                                />
                            ) : (
                                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                                    <span className="text-xs font-medium text-white">{initial}</span>
                                </div>
                            )}
                            <span className="text-white text-sm font-medium truncate">{displayName}</span>
                        </div>
                        <SpeakingIndicator participant={participant} />
                    </div>
                </div>
            )}
        </div>
    );
}

// 발언 표시 인디케이터
function SpeakingIndicator({ participant }: { participant: Participant }) {
    const isSpeaking = useIsSpeaking(participant);

    if (!isSpeaking) return null;

    return (
        <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <div className="w-1.5 h-3 rounded-full bg-green-400 animate-pulse" />
            <div className="w-1.5 h-2 rounded-full bg-green-400 animate-pulse" />
        </div>
    );
}

// 통합 컨트롤바 컴포넌트
function ControlBarComponent({
    isChatOpen,
    isTranslationOpen,
    targetLanguage,
    onTargetLanguageChange,
    unreadCount,
    isMicEnabled,
    isCamEnabled,
    isScreenEnabled,
    onToggleMic,
    onToggleCam,
    onToggleScreen,
    onToggleChat,
    onToggleWhiteboard,
    onToggleTranslation,
    onLeave,
}: {
    isChatOpen?: boolean;
    isTranslationOpen?: boolean;
    targetLanguage?: TargetLanguage;
    onTargetLanguageChange?: (lang: TargetLanguage) => void;
    unreadCount?: number;
    isMicEnabled?: boolean;
    isCamEnabled?: boolean;
    isScreenEnabled?: boolean;
    onToggleMic?: () => void;
    onToggleCam?: () => void;
    onToggleScreen?: () => void;
    onToggleChat?: () => void;
    onToggleWhiteboard?: () => void;
    onToggleTranslation?: () => void;
    onLeave?: () => void;
}) {
    const [showLanguageMenu, setShowLanguageMenu] = useState(false);
    const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage) || SUPPORTED_LANGUAGES[1];
    return (
        <div className="flex-shrink-0 px-6 py-5 border-t border-black/5">
            <div className="flex items-center justify-center gap-2">
                {/* 마이크 */}
                <button
                    onClick={onToggleMic}
                    className="p-3.5 rounded-xl !bg-transparent hover:bg-black/10 !text-black transition-colors"
                >
                    {isMicEnabled ? (
                        /* On (Filled) */
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                        </svg>
                    ) : (
                        /* Off (Outlined) */
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                    )}
                </button>

                {/* 카메라 */}
                <button
                    onClick={onToggleCam}
                    className="p-3.5 rounded-xl !bg-transparent hover:bg-black/10 !text-black transition-colors"
                >
                    {isCamEnabled ? (
                        /* On (Filled) */
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    ) : (
                        /* Off (Outlined) */
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    )}
                </button>

                {/* 화면 공유 */}
                <button
                    onClick={onToggleScreen}
                    className="p-3.5 rounded-xl !bg-transparent hover:bg-black/10 !text-black transition-colors"
                >
                    {isScreenEnabled ? (
                        /* On (Sharing) - Filled Arrow Box */
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20 3H4a2 2 0 00-2 2v10a2 2 0 002 2h4v2.5a.5.5 0 00.5.5h7a.5.5 0 00.5-.5V17h4a2 2 0 002-2V5a2 2 0 00-2-2zm-8 9.5l-4-4h2.5V5h3v3.5H16l-4 4z" />
                        </svg>
                    ) : (
                        /* Off (Not Sharing) - Outlined Monitor */
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                    )}
                </button>

                <div className="w-px h-8 bg-black/10 mx-2" />

                {/* 채팅 */}
                <button
                    onClick={onToggleChat}
                    className="relative p-3.5 rounded-xl !bg-transparent hover:bg-black/10 !text-black transition-colors"
                >
                    {isChatOpen ? (
                        /* On (Open) - Filled Chat Bubble */
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M2.003 5.884C2.003 3.743 3.791 2 6 2h12a4 4 0 014 4v10a4 4 0 01-4 4H6.877l-2.022 1.942a1 1 0 01-1.691-.72V18.5A2.5 2.5 0 012 16.035v-10.15zM13.5 9h-3a1 1 0 100 2h3a1 1 0 100-2zm-3 4h3a1 1 0 100 2h-3a1 1 0 100-2z" />
                        </svg>
                    ) : (
                        /* Off (Closed) - Outlined Chat Bubble */
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                    )}
                    {(unreadCount ?? 0) > 0 && !isChatOpen && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-black text-white text-[10px] rounded-full flex items-center justify-center font-medium">
                            {(unreadCount ?? 0) > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </button>

                {/* 화이트보드 */}
                <button
                    onClick={onToggleWhiteboard}
                    className="p-3.5 rounded-xl !bg-transparent hover:bg-black/10 !text-black transition-colors"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>

                {/* 실시간 번역 + 언어 선택 */}
                <div className="relative">
                    <div className="flex items-center">
                        {/* 번역 토글 버튼 */}
                        <button
                            onClick={onToggleTranslation}
                            className={`p-3.5 rounded-l-xl transition-colors ${
                                isTranslationOpen
                                    ? 'bg-blue-500 text-white'
                                    : '!bg-transparent hover:bg-black/10 !text-black'
                            }`}
                            title="실시간 번역"
                        >
                            {isTranslationOpen ? (
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                                </svg>
                            )}
                        </button>

                        {/* 언어 선택 버튼 */}
                        <button
                            onClick={() => setShowLanguageMenu(!showLanguageMenu)}
                            className={`px-2 py-3.5 rounded-r-xl transition-colors flex items-center gap-1 ${
                                isTranslationOpen
                                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                                    : '!bg-transparent hover:bg-black/10 !text-black border-l border-black/10'
                            }`}
                            title="번역 언어 선택"
                        >
                            <span className="text-sm">{currentLang.flag}</span>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    </div>

                    {/* 언어 선택 드롭다운 */}
                    {showLanguageMenu && (
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-lg border border-black/10 py-1 min-w-[140px] z-50">
                            <div className="px-3 py-1.5 text-[10px] text-black/40 uppercase tracking-wide">
                                번역 언어
                            </div>
                            {SUPPORTED_LANGUAGES.map((lang) => (
                                <button
                                    key={lang.code}
                                    onClick={() => {
                                        onTargetLanguageChange?.(lang.code);
                                        setShowLanguageMenu(false);
                                    }}
                                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-black/5 transition-colors ${
                                        targetLanguage === lang.code ? 'bg-blue-50 text-blue-600' : 'text-black'
                                    }`}
                                >
                                    <span>{lang.flag}</span>
                                    <span>{lang.name}</span>
                                    {targetLanguage === lang.code && (
                                        <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="w-px h-8 bg-black/10 mx-2" />

                {/* 나가기 */}
                <DisconnectButton
                    onClick={onLeave}
                    className="px-5 py-3 rounded-xl border border-black/20 hover:bg-black hover:text-white hover:border-black !text-black transition-colors font-medium text-sm flex items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    나가기
                </DisconnectButton>
            </div>
        </div>
    );
}
