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
    text: string;
    originalText?: string;
    timestamp: number;
    displayText: string;
    isTyping: boolean;
    isExiting: boolean;
}

interface SubtitleOverlayProps {
    text: string | null;
    originalText?: string | null;
    speaker?: Speaker;
    isActive?: boolean;
    showTranslation?: boolean;
}

// 여러 발화자 지원을 위한 전역 상태
const subtitleStore = {
    entries: new Map<string, SubtitleEntry>(),
    listeners: new Set<() => void>(),

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    },

    notify() {
        this.listeners.forEach(l => l());
    },

    addOrUpdate(speaker: Speaker, text: string, originalText?: string) {
        const id = speaker.name || 'unknown';
        const existing = this.entries.get(id);

        if (existing && existing.text === text) {
            return; // 같은 텍스트면 무시
        }

        const entry: SubtitleEntry = {
            id,
            speaker,
            text,
            originalText,
            timestamp: Date.now(),
            displayText: '',
            isTyping: true,
            isExiting: false,
        };

        this.entries.set(id, entry);
        this.notify();
    },

    remove(id: string) {
        const entry = this.entries.get(id);
        if (entry) {
            entry.isExiting = true;
            this.notify();
            setTimeout(() => {
                this.entries.delete(id);
                this.notify();
            }, 400);
        }
    },

    updateDisplayText(id: string, displayText: string, isTyping: boolean) {
        const entry = this.entries.get(id);
        if (entry) {
            entry.displayText = displayText;
            entry.isTyping = isTyping;
            this.notify();
        }
    },

    getAll(): SubtitleEntry[] {
        return Array.from(this.entries.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-3); // 최대 3개만 표시
    },
};

// 개별 자막 아이템 컴포넌트
function SubtitleItem({
    entry,
    showTranslation,
    onComplete,
}: {
    entry: SubtitleEntry;
    showTranslation: boolean;
    onComplete: () => void;
}) {
    const [displayText, setDisplayText] = useState(entry.text);
    const [isTyping, setIsTyping] = useState(false);
    const exitRef = useRef<NodeJS.Timeout | null>(null);
    const animationRef = useRef<number | null>(null);
    const targetTextRef = useRef(entry.text);
    const currentIndexRef = useRef(0);

    // requestAnimationFrame 기반 부드러운 타이핑 애니메이션
    useEffect(() => {
        const newText = entry.text;
        const prevDisplayed = displayText;
        targetTextRef.current = newText;

        // 기존 타이머/애니메이션 취소
        if (exitRef.current) clearTimeout(exitRef.current);
        if (animationRef.current) cancelAnimationFrame(animationRef.current);

        // 증분 업데이트인지 확인
        if (newText.startsWith(prevDisplayed) && prevDisplayed.length > 0) {
            // 이전 텍스트 유지, 새 부분만 타이핑
            currentIndexRef.current = prevDisplayed.length;
        } else {
            // 완전히 새로운 텍스트
            currentIndexRef.current = 0;
            setDisplayText('');
        }

        setIsTyping(true);

        let lastTime = 0;
        const CHARS_PER_FRAME = 2; // 프레임당 2글자 (더 빠르게)
        const MIN_INTERVAL = 16; // 최소 16ms (60fps)

        const animate = (timestamp: number) => {
            if (timestamp - lastTime >= MIN_INTERVAL) {
                lastTime = timestamp;
                const target = targetTextRef.current;

                if (currentIndexRef.current < target.length) {
                    // 한 번에 여러 글자 추가 (부드럽게)
                    currentIndexRef.current = Math.min(
                        currentIndexRef.current + CHARS_PER_FRAME,
                        target.length
                    );
                    setDisplayText(target.slice(0, currentIndexRef.current));
                    animationRef.current = requestAnimationFrame(animate);
                } else {
                    setIsTyping(false);
                }
            } else {
                animationRef.current = requestAnimationFrame(animate);
            }
        };

        animationRef.current = requestAnimationFrame(animate);

        // 3초 후 자동 제거 (더 빠르게)
        exitRef.current = setTimeout(onComplete, 3000);

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            if (exitRef.current) clearTimeout(exitRef.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry.text, onComplete]);

    return (
        <div
            className={`
                flex items-center gap-3 px-4 py-2.5
                bg-black/80 backdrop-blur-xl
                rounded-full
                shadow-lg shadow-black/20
                border border-white/10
                transition-all duration-400 ease-out
                ${entry.isExiting
                    ? 'opacity-0 translate-y-2 scale-95'
                    : 'opacity-100 translate-y-0 scale-100 animate-subtitle-in'
                }
            `}
        >
            {/* 프로필 이미지 */}
            <div className="relative flex-shrink-0">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center ring-2 ring-white/20">
                    {entry.speaker.profileImg ? (
                        <Image
                            src={entry.speaker.profileImg}
                            alt={entry.speaker.name}
                            width={32}
                            height={32}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <Image
                            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(entry.speaker.name)}&background=6366f1&color=fff&size=32`}
                            alt={entry.speaker.name}
                            width={32}
                            height={32}
                            className="w-full h-full object-cover"
                        />
                    )}
                </div>
            </div>

            {/* 이름 + 텍스트 */}
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-white/60 text-sm font-medium flex-shrink-0">
                    {entry.speaker.name}
                </span>
                <span className="text-white/30">·</span>
                <div className="flex-1 min-w-0">
                    {showTranslation && entry.originalText && entry.originalText !== entry.text ? (
                        <div className="flex items-center gap-2">
                            <span className="text-white/50 text-xs truncate max-w-[120px]">
                                {entry.originalText}
                            </span>
                            <span className="text-white/40 text-xs">→</span>
                            <span className="text-white text-base font-semibold">
                                {displayText}
                                {isTyping && <span className="animate-cursor-blink ml-0.5 text-white/60">|</span>}
                            </span>
                        </div>
                    ) : (
                        <span className="text-white text-base font-semibold">
                            {displayText}
                            {isTyping && <span className="animate-cursor-blink ml-0.5 text-white/60">|</span>}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function SubtitleOverlay({
    text,
    originalText,
    speaker,
    showTranslation = false,
}: SubtitleOverlayProps) {
    const [entries, setEntries] = useState<SubtitleEntry[]>([]);
    const processedRef = useRef<Map<string, string>>(new Map());

    // 스토어 구독
    useEffect(() => {
        const unsubscribe = subtitleStore.subscribe(() => {
            setEntries(subtitleStore.getAll());
        });
        return () => { unsubscribe(); };
    }, []);

    // 새 자막 추가
    useEffect(() => {
        if (text && speaker) {
            const key = `${speaker.name}-${text}`;
            if (!processedRef.current.has(key)) {
                processedRef.current.set(key, text);
                subtitleStore.addOrUpdate(speaker, text, originalText || undefined);

                // 5초 후 캐시 정리 (자막 표시 시간에 맞춤)
                setTimeout(() => {
                    processedRef.current.delete(key);
                }, 5000);
            }
        }
    }, [text, originalText, speaker]);

    const handleComplete = useCallback((id: string) => {
        subtitleStore.remove(id);
    }, []);

    if (entries.length === 0) {
        return null;
    }

    return (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className="flex flex-col items-center gap-2">
                {entries.map((entry) => (
                    <SubtitleItem
                        key={`${entry.id}-${entry.timestamp}`}
                        entry={entry}
                        showTranslation={showTranslation}
                        onComplete={() => handleComplete(entry.id)}
                    />
                ))}
            </div>

            <style jsx global>{`
                @keyframes subtitle-in {
                    0% {
                        opacity: 0;
                        transform: translateY(10px) scale(0.9);
                    }
                    100% {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }

                @keyframes cursor-blink {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                }

                .animate-subtitle-in {
                    animation: subtitle-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }

                .animate-cursor-blink {
                    animation: cursor-blink 0.8s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}
