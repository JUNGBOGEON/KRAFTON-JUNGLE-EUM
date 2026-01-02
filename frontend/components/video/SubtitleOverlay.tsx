'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

interface Speaker {
    name: string;
    profileImg?: string;
    isLocal?: boolean;
}

interface SubtitleEntry {
    id: string;
    speaker: Speaker;
    originalText: string;
    translatedText?: string;
    timestamp: number;
    isVisible: boolean;
}

interface SubtitleOverlayProps {
    text: string | null;
    originalText?: string | null;
    speaker?: Speaker;
    isActive?: boolean;
    showTranslation?: boolean;
}

export default function SubtitleOverlay({
    text,
    originalText,
    speaker,
    showTranslation = false,
}: SubtitleOverlayProps) {
    const [displayText, setDisplayText] = useState<string>('');
    const [isVisible, setIsVisible] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [isExiting, setIsExiting] = useState(false);
    const exitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const previousTextRef = useRef<string | null>(null);

    useEffect(() => {
        if (exitTimeoutRef.current) {
            clearTimeout(exitTimeoutRef.current);
            exitTimeoutRef.current = null;
        }
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
        }

        if (text && text !== previousTextRef.current) {
            setIsExiting(false);
            setIsVisible(true);
            setIsTyping(true);

            // 타이핑 애니메이션
            let currentIndex = 0;
            const typeNextChar = () => {
                if (currentIndex <= text.length) {
                    setDisplayText(text.slice(0, currentIndex));
                    currentIndex++;
                    typingTimeoutRef.current = setTimeout(typeNextChar, 20);
                } else {
                    setIsTyping(false);
                }
            };
            typeNextChar();

            previousTextRef.current = text;

            // 5초 후 페이드 아웃
            exitTimeoutRef.current = setTimeout(() => {
                setIsExiting(true);
                setTimeout(() => {
                    setIsVisible(false);
                    setDisplayText('');
                    previousTextRef.current = null;
                }, 500);
            }, 5000);

        } else if (!text && previousTextRef.current) {
            setIsExiting(true);
            setTimeout(() => {
                setIsVisible(false);
                setDisplayText('');
                previousTextRef.current = null;
            }, 500);
        }

        return () => {
            if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        };
    }, [text]);

    if (!isVisible && !text) {
        return null;
    }

    const getInitials = (name: string) => {
        return name.charAt(0).toUpperCase();
    };

    return (
        <div className="fixed bottom-28 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none px-4 max-w-4xl w-full">
            {/* Netflix/OTT 스타일 자막 컨테이너 */}
            <div
                className={`
                    relative
                    flex items-start gap-4
                    px-6 py-4
                    rounded-2xl
                    transition-all duration-500 ease-out
                    ${isExiting
                        ? 'opacity-0 translate-y-4 scale-95 blur-sm'
                        : 'opacity-100 translate-y-0 scale-100 blur-0'
                    }
                    ${!previousTextRef.current && text ? 'animate-subtitle-enter' : ''}
                `}
                style={{
                    // Glassmorphism 효과
                    background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.75) 100%)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
            >
                {/* 발화자 프로필 */}
                <div className="flex-shrink-0 relative">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center ring-2 ring-white/20 shadow-lg">
                        {speaker?.profileImg ? (
                            <Image
                                src={speaker.profileImg}
                                alt={speaker.name || 'Speaker'}
                                width={48}
                                height={48}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="text-white font-bold text-lg drop-shadow-lg">
                                {speaker?.name ? getInitials(speaker.name) : '?'}
                            </span>
                        )}
                    </div>
                    {/* 말하는 중 인디케이터 */}
                    {isTyping && (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-black/80 animate-pulse shadow-lg shadow-green-400/50" />
                    )}
                </div>

                {/* 텍스트 영역 */}
                <div className="flex-1 min-w-0">
                    {/* 발화자 이름 */}
                    {speaker?.name && (
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-white/90 text-sm font-semibold tracking-wide">
                                {speaker.name}
                            </span>
                            {speaker.isLocal && (
                                <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">
                                    나
                                </span>
                            )}
                        </div>
                    )}

                    {/* 자막 텍스트 */}
                    {showTranslation && originalText && originalText !== text ? (
                        <div className="space-y-1.5">
                            {/* 원본 텍스트 (작게, 흐리게) */}
                            <p className="text-white/50 text-sm leading-relaxed font-medium">
                                {originalText}
                            </p>
                            {/* 번역 텍스트 (크게, 강조) */}
                            <p className="text-white text-lg font-semibold leading-relaxed tracking-wide">
                                {displayText}
                                {isTyping && (
                                    <span className="inline-block w-0.5 h-5 bg-white/80 ml-1 animate-cursor-blink align-middle" />
                                )}
                            </p>
                        </div>
                    ) : (
                        /* STT만 표시 */
                        <p className="text-white text-lg font-semibold leading-relaxed tracking-wide">
                            {displayText}
                            {isTyping && (
                                <span className="inline-block w-0.5 h-5 bg-white/80 ml-1 animate-cursor-blink align-middle" />
                            )}
                        </p>
                    )}
                </div>

                {/* 우측 언어 인디케이터 */}
                {showTranslation && (
                    <div className="flex-shrink-0 flex flex-col items-center gap-1">
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                            <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                            </svg>
                        </div>
                    </div>
                )}
            </div>

            <style jsx>{`
                @keyframes subtitle-enter {
                    0% {
                        opacity: 0;
                        transform: translateY(20px) scale(0.95);
                        filter: blur(10px);
                    }
                    100% {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                        filter: blur(0);
                    }
                }

                @keyframes cursor-blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }

                .animate-subtitle-enter {
                    animation: subtitle-enter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }

                .animate-cursor-blink {
                    animation: cursor-blink 0.8s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}
