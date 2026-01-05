import React, { useState, useEffect } from 'react';

interface PollData {
    id: string;
    question: string;
    options: string[];
    isAnonymous: boolean;
    createdAt: number;
    expiresAt?: number;
    isClosed?: boolean;
}

interface PollBubbleProps {
    poll: PollData;
    isOwn: boolean;
    onVote: (pollId: string, optionIndex: number) => void;
    votes: Record<number, number>; // optionIndex -> count
    myVote?: number; // 내가 투표한 인덱스
    isClosed?: boolean;
    onClosePoll?: () => void;
}

export default function PollBubble({ poll, isOwn, onVote, votes, myVote, isClosed, onClosePoll }: PollBubbleProps) {
    const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
    const [timeLeft, setTimeLeft] = useState<string>('');
    const [isExpired, setIsExpired] = useState(false);

    const isEnded = isExpired || isClosed;

    useEffect(() => {
        if (!poll.expiresAt) return;

        const updateTimer = () => {
            const now = Date.now();
            const diff = poll.expiresAt! - now;

            if (diff <= 0) {
                setTimeLeft('투표 종료');
                setIsExpired(true);
            } else {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')} 남음`);
                setIsExpired(false);
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [poll.expiresAt]);

    return (
        <div className={`max-w-[85%] min-w-[280px] p-4 rounded-2xl bg-white border border-black/10 shadow-sm ${isOwn ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full tracking-wider">Poll</span>
                    {(timeLeft || isClosed) && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${isEnded ? 'bg-red-50 text-red-500' : 'bg-black/5 text-black/50'
                            }`}>
                            {isClosed ? '투표 종료됨' : timeLeft}
                        </span>
                    )}
                </div>
                {poll.isAnonymous && (
                    <span className="text-[10px] text-black/40 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                        비공개
                    </span>
                )}
            </div>

            <h4 className="font-bold text-black/90 mb-4 leading-tight text-[15px]">{poll.question}</h4>

            <div className="space-y-2">
                {poll.options.map((option, idx) => {
                    const count = votes[idx] || 0;
                    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    const isSelected = myVote === idx;

                    return (
                        <button
                            key={idx}
                            onClick={() => !isEnded && onVote(poll.id, idx)}
                            disabled={isEnded}
                            className={`w-full relative group overflow-hidden rounded-lg border transition-all duration-200 ${isSelected
                                ? 'border-blue-500 bg-blue-50/50'
                                : isEnded
                                    ? 'border-black/5 bg-gray-50 opacity-80 cursor-not-allowed'
                                    : 'border-black/5 hover:border-black/20 hover:bg-black/[0.02]'
                                }`}
                        >
                            {/* Progress Bar Background */}
                            <div
                                className={`absolute inset-y-0 left-0 transition-all duration-500 ease-out ${isSelected ? 'bg-blue-100/50' : 'bg-black/[0.03]'
                                    }`}
                                style={{ width: `${percentage}%` }}
                            />

                            <div className="relative px-3 py-2.5 flex justify-between items-center">
                                <span className={`text-sm font-medium z-10 ${isSelected ? 'text-blue-700' : 'text-black/80'}`}>
                                    {option}
                                </span>
                                <div className="flex items-center gap-2 z-10">
                                    {isSelected && (
                                        <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    <span className="text-xs text-black/40 font-medium tabular-nums">
                                        {percentage}% ({count})
                                    </span>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="mt-3 pt-3 border-t border-black/5 flex justify-between items-center">
                <span className="text-[11px] text-black/40">총 {totalVotes}명 참여</span>

                <div className="flex items-center gap-2">
                    {isOwn && !isEnded && (
                        <button
                            onClick={onClosePoll}
                            className="text-[10px] bg-red-50 text-red-500 hover:bg-red-100 px-2 py-1 rounded transition-colors font-medium"
                        >
                            투표 종료하기
                        </button>
                    )}
                    {isOwn && <span className="text-[11px] text-black/30">내가 만듦</span>}
                </div>
            </div>
        </div>
    );
}
