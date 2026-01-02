'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

export interface TranscriptEntry {
    id: string;
    speaker: {
        id: string;
        name: string;
        profileImg?: string;
        language?: string;
    };
    originalText: string;
    translatedText?: string;
    targetLanguage?: string;
    timestamp: number;
    isFinal?: boolean;
}

interface TranscriptPanelProps {
    transcripts: TranscriptEntry[];
    isOpen: boolean;
    onClose: () => void;
    showTranslation?: boolean;
    currentUserId?: string;
}

// 언어 코드 → 표시 이름
const languageNames: Record<string, string> = {
    ko: '한국어',
    en: 'English',
    zh: '中文',
    ja: '日本語',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
};

// 화자별 그라데이션 색상
const speakerGradients = [
    'from-violet-500 to-purple-500',
    'from-blue-500 to-cyan-500',
    'from-emerald-500 to-teal-500',
    'from-orange-500 to-amber-500',
    'from-pink-500 to-rose-500',
    'from-indigo-500 to-blue-500',
];

function getSpeakerGradient(speakerId: string): string {
    let hash = 0;
    for (let i = 0; i < speakerId.length; i++) {
        hash = speakerId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return speakerGradients[Math.abs(hash) % speakerGradients.length];
}

export default function TranscriptPanel({
    transcripts,
    isOpen,
    onClose,
    showTranslation = true,
    currentUserId,
}: TranscriptPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isAutoScroll, setIsAutoScroll] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // 자동 스크롤
    useEffect(() => {
        if (isAutoScroll && !isPaused && scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, [transcripts, isAutoScroll, isPaused]);

    // 스크롤 이벤트 감지 (수동 스크롤 시 일시 정지)
    const handleScroll = useCallback(() => {
        if (!scrollRef.current) return;

        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

        if (!isAtBottom) {
            // 사용자가 위로 스크롤함 → 자동 스크롤 일시 정지
            setIsPaused(true);

            // 5초 후 자동 스크롤 재개
            if (pauseTimeoutRef.current) {
                clearTimeout(pauseTimeoutRef.current);
            }
            pauseTimeoutRef.current = setTimeout(() => {
                setIsPaused(false);
            }, 5000);
        } else {
            // 맨 아래로 스크롤함 → 자동 스크롤 재개
            setIsPaused(false);
            if (pauseTimeoutRef.current) {
                clearTimeout(pauseTimeoutRef.current);
                pauseTimeoutRef.current = null;
            }
        }
    }, []);

    // 맨 아래로 스크롤 버튼
    const scrollToBottom = useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth',
            });
            setIsPaused(false);
        }
    }, []);

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-y-0 right-0 w-96 z-50 pointer-events-auto">
            {/* Glassmorphism 패널 */}
            <div
                className="h-full flex flex-col"
                style={{
                    background: 'linear-gradient(180deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.85) 100%)',
                    backdropFilter: 'blur(24px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                    borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
                }}
            >
                {/* 헤더 */}
                <div className="flex-shrink-0 px-5 py-4 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-white font-semibold">실시간 자막</h3>
                                <p className="text-white/40 text-xs">
                                    {transcripts.length}개의 기록
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* 자동 스크롤 상태 표시 */}
                    {isPaused && (
                        <div className="mt-3 flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg">
                            <span className="text-white/60 text-xs">자동 스크롤 일시 정지됨</span>
                            <button
                                onClick={scrollToBottom}
                                className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                            >
                                맨 아래로
                            </button>
                        </div>
                    )}
                </div>

                {/* 자막 목록 */}
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
                >
                    {transcripts.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-white/30">
                            <svg className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                            <p className="text-sm">대화가 시작되면 자막이 표시됩니다</p>
                        </div>
                    ) : (
                        transcripts.map((entry, index) => {
                            const isCurrentUser = entry.speaker.id === currentUserId;
                            const gradient = getSpeakerGradient(entry.speaker.id);
                            const showSpeakerInfo = index === 0 || transcripts[index - 1]?.speaker.id !== entry.speaker.id;

                            return (
                                <div
                                    key={entry.id}
                                    className={`group animate-transcript-enter ${isCurrentUser ? 'ml-8' : 'mr-4'}`}
                                    style={{ animationDelay: `${Math.min(index * 50, 200)}ms` }}
                                >
                                    {/* 발화자 정보 (연속 발화 시 첫 번째만) */}
                                    {showSpeakerInfo && (
                                        <div className={`flex items-center gap-2 mb-2 ${isCurrentUser ? 'justify-end' : ''}`}>
                                            {!isCurrentUser && (
                                                <div className={`w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br ${gradient} flex items-center justify-center ring-1 ring-white/20`}>
                                                    <Image
                                                        src={entry.speaker.profileImg || `https://ui-avatars.com/api/?name=${encodeURIComponent(entry.speaker.name)}&background=6366f1&color=fff&size=32`}
                                                        alt={entry.speaker.name}
                                                        width={32}
                                                        height={32}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            )}
                                            <div className={`flex items-center gap-2 ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
                                                <span className="text-white/80 text-xs font-medium">
                                                    {entry.speaker.name}
                                                    {isCurrentUser && <span className="text-white/40 ml-1">(나)</span>}
                                                </span>
                                                <span className="text-white/30 text-xs">
                                                    {formatTime(entry.timestamp)}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* 자막 버블 */}
                                    <div
                                        className={`
                                            relative px-4 py-3 rounded-2xl
                                            ${isCurrentUser
                                                ? 'bg-gradient-to-br from-violet-600/90 to-purple-600/90 rounded-tr-md'
                                                : 'bg-white/10 rounded-tl-md'
                                            }
                                            ${!showSpeakerInfo ? (isCurrentUser ? 'rounded-tr-2xl' : 'rounded-tl-2xl') : ''}
                                            transition-all duration-200 hover:bg-white/15
                                        `}
                                    >
                                        {/* 원본 텍스트 */}
                                        <p className={`text-sm leading-relaxed ${isCurrentUser ? 'text-white' : 'text-white/90'}`}>
                                            {entry.originalText}
                                        </p>

                                        {/* 번역 텍스트 */}
                                        {showTranslation && entry.translatedText && (
                                            <div className="mt-2 pt-2 border-t border-white/10">
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <svg className="w-3 h-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                                                    </svg>
                                                    <span className="text-white/40 text-xs">
                                                        {languageNames[entry.targetLanguage || 'en'] || entry.targetLanguage}
                                                    </span>
                                                </div>
                                                <p className={`text-sm leading-relaxed ${isCurrentUser ? 'text-white/80' : 'text-white/70'}`}>
                                                    {entry.translatedText}
                                                </p>
                                            </div>
                                        )}

                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* 하단 컨트롤 */}
                <div className="flex-shrink-0 px-5 py-4 border-t border-white/10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsAutoScroll(!isAutoScroll)}
                                className={`
                                    flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors
                                    ${isAutoScroll
                                        ? 'bg-violet-500/20 text-violet-400'
                                        : 'bg-white/5 text-white/40 hover:bg-white/10'
                                    }
                                `}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                </svg>
                                자동 스크롤
                            </button>
                        </div>

                        {transcripts.length > 0 && (
                            <span className="text-white/30 text-xs">
                                실시간 업데이트 중
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <style jsx>{`
                @keyframes transcript-enter {
                    0% {
                        opacity: 0;
                        transform: translateY(10px);
                    }
                    100% {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                .animate-transcript-enter {
                    animation: transcript-enter 0.3s ease-out forwards;
                }

                .scrollbar-thin::-webkit-scrollbar {
                    width: 6px;
                }

                .scrollbar-thumb-white\/10::-webkit-scrollbar-thumb {
                    background-color: rgba(255, 255, 255, 0.1);
                    border-radius: 3px;
                }

                .scrollbar-track-transparent::-webkit-scrollbar-track {
                    background-color: transparent;
                }
            `}</style>
        </div>
    );
}
