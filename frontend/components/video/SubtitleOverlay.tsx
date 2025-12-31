'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

interface Speaker {
    name: string;
    profileImg?: string;
    isLocal?: boolean;  // 본인 여부
}

interface SubtitleOverlayProps {
    text: string | null;          // 표시할 메인 텍스트 (original or translated)
    originalText?: string | null; // STT 원본 텍스트
    speaker?: Speaker;
    isActive?: boolean;
    showTranslation?: boolean;    // 번역 표시 여부
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

    // 디버깅 로그
    useEffect(() => {
        console.log("[SubtitleOverlay] text prop changed:", text);
    }, [text]);

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

            let currentIndex = 0;
            const typeNextChar = () => {
                if (currentIndex <= text.length) {
                    setDisplayText(text.slice(0, currentIndex));
                    currentIndex++;
                    typingTimeoutRef.current = setTimeout(typeNextChar, 25);
                } else {
                    setIsTyping(false);
                }
            };
            typeNextChar();

            previousTextRef.current = text;

            exitTimeoutRef.current = setTimeout(() => {
                setIsExiting(true);
                setTimeout(() => {
                    setIsVisible(false);
                    setDisplayText('');
                    previousTextRef.current = null;
                }, 400);
            }, 5000);

        } else if (!text && previousTextRef.current) {
            setIsExiting(true);
            setTimeout(() => {
                setIsVisible(false);
                setDisplayText('');
                previousTextRef.current = null;
            }, 400);
        }

        return () => {
            if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        };
    }, [text]);

    if (!isVisible && !text) {
        return null;
    }

    // 이름 이니셜 생성
    const getInitials = (name: string) => {
        return name.charAt(0).toUpperCase();
    };

    return (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
            <div
                className={`
                    flex items-center gap-3
                    pl-1.5 pr-5 py-1.5
                    bg-black/80 backdrop-blur-xl
                    rounded-full
                    shadow-2xl shadow-black/30
                    border border-white/10
                    transition-all duration-400 ease-out
                    ${isExiting
                        ? 'opacity-0 translate-y-3 scale-95'
                        : 'opacity-100 translate-y-0 scale-100'
                    }
                    ${!previousTextRef.current && text
                        ? 'animate-pill-enter'
                        : ''
                    }
                `}
            >
                {/* 프로필 이미지 */}
                <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center ring-2 ring-white/20">
                        {speaker?.profileImg ? (
                            <Image
                                src={speaker.profileImg}
                                alt={speaker.name || 'Speaker'}
                                width={40}
                                height={40}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="text-white font-semibold text-sm">
                                {speaker?.name ? getInitials(speaker.name) : '?'}
                            </span>
                        )}
                    </div>

                </div>

                {/* 이름 + 텍스트 */}
                <div className="flex flex-col min-w-0 max-w-lg">
                    {/* 이름 + (나) 표시 */}
                    {speaker?.name && (
                        <span className="text-white/60 text-xs font-medium truncate flex items-center gap-1">
                            {speaker.name}
                            {speaker.isLocal && (
                                <span className="text-white/40">(나)</span>
                            )}
                        </span>
                    )}

                    {/* 번역 모드: 원본 텍스트 (작게) + 번역 텍스트 (크게) */}
                    {showTranslation && originalText && originalText !== text ? (
                        <>
                            <p className="text-white/50 text-sm leading-snug mb-0.5">
                                {originalText}
                            </p>
                            <p className="text-white text-base font-medium leading-snug">
                                {displayText}
                                {isTyping && (
                                    <span className="inline-block w-0.5 h-4 bg-white/70 ml-0.5 animate-blink align-middle" />
                                )}
                            </p>
                        </>
                    ) : (
                        /* STT만 표시 */
                        <p className="text-white text-base font-medium leading-snug">
                            {displayText}
                            {isTyping && (
                                <span className="inline-block w-0.5 h-4 bg-white/70 ml-0.5 animate-blink align-middle" />
                            )}
                        </p>
                    )}
                </div>
            </div>

            <style jsx>{`
                @keyframes pill-enter {
                    0% {
                        opacity: 0;
                        transform: translateY(16px) scale(0.9);
                    }
                    100% {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }

                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }

                .animate-pill-enter {
                    animation: pill-enter 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }

                .animate-blink {
                    animation: blink 0.8s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}
