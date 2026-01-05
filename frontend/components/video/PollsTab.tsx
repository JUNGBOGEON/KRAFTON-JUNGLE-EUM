'use client';

import { useState, useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

interface PollOption {
    id: number;
    text: string;
    voteCount: number;
}

interface Poll {
    id: number;
    question: string;
    options: PollOption[];
    isActive: boolean;
    createdAt: string;
}

interface PollsTabProps {
    roomId: string; // Meeting Code or ID
}

export default function PollsTab({ roomId }: PollsTabProps) {
    const { localParticipant } = useLocalParticipant();
    const [polls, setPolls] = useState<Poll[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'create'>('list');

    // Create Poll State
    const [newQuestion, setNewQuestion] = useState('');
    const [newOptions, setNewOptions] = useState<string[]>(['', '']);

    // Fetch Polls
    const fetchPolls = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/polls?roomName=${encodeURIComponent(roomId)}`);
            if (res.ok) {
                const data = await res.json();
                setPolls(data.polls || []);
            }
        } catch (e) {
            console.error("Failed to fetch polls", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchPolls();
        // Simple polling for now
        const interval = setInterval(fetchPolls, 5000);
        return () => clearInterval(interval);
    }, [roomId]);

    const handleVote = async (pollId: number, optionId: number) => {
        try {
            await fetch('/api/polls/vote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pollId, optionId }),
            });
            fetchPolls(); // Refresh immediately
        } catch (e) {
            console.error("Vote failed", e);
            alert("투표에 실패했습니다. 잠시 후 다시 시도해주세요.");
        }
    };

    const handleCreatePoll = async () => {
        if (!newQuestion.trim() || newOptions.some(o => !o.trim())) return;

        try {
            const res = await fetch('/api/polls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomName: roomId,
                    question: newQuestion,
                    options: newOptions
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to create poll");
            }

            setViewMode('list');
            setNewQuestion('');
            setNewOptions(['', '']);
            fetchPolls();
        } catch (e: any) {
            console.error("Create poll failed", e);
            alert(`투표 생성에 실패했습니다.\n\n오류: ${e.message}\n\n서버 상태를 확인해주세요.`);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white">
            {viewMode === 'list' ? (
                <>
                    <div className="p-4 border-b border-black/5 flex justify-between items-center">
                        <h3 className="font-bold text-lg">투표</h3>
                        <button
                            onClick={() => setViewMode('create')}
                            className="text-sm bg-black text-white px-3 py-1.5 rounded-lg hover:bg-black/80 transition-colors"
                        >
                            + 새 투표
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                        {polls.length === 0 ? (
                            <div className="text-center text-black/40 py-10">
                                진행 중인 투표가 없습니다.
                            </div>
                        ) : (
                            polls.map(poll => (
                                <div key={poll.id} className="bg-black/[0.02] border border-black/5 rounded-xl p-4">
                                    <h4 className="font-semibold mb-3 text-lg">{poll.question}</h4>
                                    <div className="space-y-2">
                                        {poll.options.map(opt => {
                                            const totalVotes = poll.options.reduce((sum, o) => sum + o.voteCount, 0);
                                            const percent = totalVotes > 0 ? (opt.voteCount / totalVotes) * 100 : 0;

                                            return (
                                                <div key={opt.id} className="relative">
                                                    <button
                                                        onClick={() => handleVote(poll.id, opt.id)}
                                                        className="w-full text-left p-3 rounded-lg border border-black/10 relative overflow-hidden hovering z-10 hover:bg-black/5 transition-all"
                                                    >
                                                        <span className="relative z-10 flex justify-between">
                                                            <span>{opt.text}</span>
                                                            <span className="font-medium">{opt.voteCount}표 ({Math.round(percent)}%)</span>
                                                        </span>
                                                        <div
                                                            className="absolute top-0 left-0 bottom-0 bg-blue-100/50 transition-all duration-500"
                                                            style={{ width: `${percent}%` }}
                                                        />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-2 text-xs text-black/40 text-right">
                                        {new Date(poll.createdAt).toLocaleTimeString()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            ) : (
                <div className="p-4 flex flex-col h-full">
                    <div className="flex items-center gap-2 mb-6">
                        <button onClick={() => setViewMode('list')} className="p-2 hover:bg-black/5 rounded-full">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <h3 className="font-bold text-lg">새 투표 만들기</h3>
                    </div>

                    <div className="space-y-4 flex-1">
                        <div>
                            <label className="block text-sm font-medium text-black/60 mb-1">질문</label>
                            <input
                                type="text"
                                value={newQuestion}
                                onChange={e => setNewQuestion(e.target.value)}
                                className="w-full px-4 py-3 bg-white border border-black rounded-xl text-black focus:ring-2 focus:ring-black/20 outline-none"
                                placeholder="무엇을 투표할까요?"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-black/60 mb-1">옵션</label>
                            <div className="space-y-2">
                                {newOptions.map((opt, idx) => (
                                    <input
                                        key={idx}
                                        type="text"
                                        value={opt}
                                        onChange={e => {
                                            const newOpts = [...newOptions];
                                            newOpts[idx] = e.target.value;
                                            setNewOptions(newOpts);
                                        }}
                                        className="w-full px-4 py-2.5 bg-white border border-black rounded-xl text-black focus:ring-2 focus:ring-black/20 outline-none"
                                        placeholder={`옵션 ${idx + 1}`}
                                    />
                                ))}
                            </div>
                            <button
                                onClick={() => setNewOptions([...newOptions, ''])}
                                className="mt-2 text-sm text-blue-600 font-medium px-2 py-1 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                                + 옵션 추가
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleCreatePoll}
                        disabled={!newQuestion.trim() || newOptions.some(o => !o.trim())}
                        className="w-full py-4 bg-black text-white font-bold rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/90 transition-all shadow-lg active:scale-[0.98]"
                    >
                        투표 시작하기
                    </button>
                </div>
            )}
        </div>
    );
}
