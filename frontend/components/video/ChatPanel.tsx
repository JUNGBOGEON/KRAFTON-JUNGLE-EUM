'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

interface ChatMessage {
    id: string;
    sender: string;
    content: string;
    timestamp: number;
    isOwn: boolean;
}

export interface VoiceRecord {
    id: string;
    speaker: string;
    profileImg?: string;
    original: string;
    translated?: string;      // 번역 모드일 때만 존재
    sourceLanguage?: string;  // 원본 언어 (ko, ja, zh, en 등)
    targetLanguage?: string;  // 번역 언어 (ja, zh, en 등)
    timestamp: number;
    _isFinal?: boolean;       // 내부용: final 여부 추적
}

interface ChatPanelProps {
    roomId: string;
    onClose: () => void;
    onNewMessage?: () => void;
    voiceRecords?: VoiceRecord[];
}

type TabType = 'chat' | 'voice';

import PollBubble from './PollBubble';
import PollCreateForm from './PollCreateForm';

interface PollData {
    id: string;
    question: string;
    options: string[];
    isAnonymous: boolean;
    createdAt: number;
    expiresAt?: number; // timestamp
    isClosed?: boolean;
}

export default function ChatPanel({ roomId, onClose, onNewMessage, voiceRecords = [] }: ChatPanelProps) {
    const room = useRoomContext();
    const { localParticipant } = useLocalParticipant();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>('chat');

    // Poll States
    const [showPollForm, setShowPollForm] = useState(false);
    const [showPlusMenu, setShowPlusMenu] = useState(false);
    const [pollVotes, setPollVotes] = useState<Record<string, Record<number, number>>>({}); // pollId -> optionIdx -> count
    const [myVotes, setMyVotes] = useState<Record<string, number>>({}); // pollId -> myOptionIdx
    const [closedPolls, setClosedPolls] = useState<Set<string>>(new Set()); // manually closed poll IDs

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const voiceEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = useCallback(() => {
        if (activeTab === 'chat') {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        } else {
            voiceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [activeTab]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, voiceRecords, scrollToBottom]);

    // voiceRecords 변경 감지 디버깅
    useEffect(() => {
        if (voiceRecords.length > 0) {
            // console.log("[ChatPanel] Latest record:", voiceRecords[voiceRecords.length - 1]);
        }
    }, [voiceRecords]);

    useEffect(() => {
        if (activeTab === 'chat') {
            inputRef.current?.focus();
        }
    }, [activeTab]);

    useEffect(() => {
        const loadMessages = async () => {
            try {
                const res = await fetch(`/api/chat?roomId=${encodeURIComponent(roomId)}`);
                if (res.ok) {
                    const data = await res.json();
                    const loadedMessages = data.messages.map((msg: any) => ({
                        ...msg,
                        isOwn: msg.sender === (localParticipant?.name || localParticipant?.identity),
                    }));
                    setMessages(loadedMessages);

                    // Reconstruct closed polls from history
                    const initialClosedPolls = new Set<string>();
                    loadedMessages.forEach((msg: ChatMessage) => {
                        try {
                            const parsed = JSON.parse(msg.content);
                            if (parsed.type === 'POLL_CLOSE') {
                                initialClosedPolls.add(parsed.pollId);
                            }
                        } catch { }
                    });
                    setClosedPolls(initialClosedPolls);
                }
            } catch (e) {
                console.error('Failed to load messages:', e);
            } finally {
                setIsLoading(false);
            }
        };

        if (roomId && localParticipant) {
            loadMessages();
        }
    }, [roomId, localParticipant]);

    useEffect(() => {
        if (!room) return;

        const handleData = (payload: Uint8Array, participant: any) => {
            try {
                const strData = new TextDecoder().decode(payload);
                const data = JSON.parse(strData);

                if (data.type === 'chat') {
                    // Check if content is a JSON string (Poll)
                    let isPoll = false;
                    try {
                        const contentJson = JSON.parse(data.content);
                        if (contentJson.type === 'POLL_CREATE') isPoll = true;
                    } catch { }

                    const newMessage: ChatMessage = {
                        id: data.id,
                        sender: data.sender,
                        content: data.content,
                        timestamp: data.timestamp,
                        isOwn: participant?.identity === localParticipant?.identity,
                    };
                    setMessages((prev) => [...prev, newMessage]);
                    onNewMessage?.();
                } else if (data.type === 'POLL_VOTE') {
                    // Handle incoming vote
                    const { pollId, optionIndex } = data;
                    setPollVotes(prev => {
                        const currentPollVotes = prev[pollId] || {};
                        return {
                            ...prev,
                            [pollId]: {
                                ...currentPollVotes,
                                [optionIndex]: (currentPollVotes[optionIndex] || 0) + 1
                            }
                        };
                    });
                } else if (data.type === 'POLL_CLOSE') {
                    setClosedPolls(prev => new Set(prev).add(data.pollId));
                }
            } catch (e) {
                // Ignore non-chat messages
            }
        };

        room.on(RoomEvent.DataReceived, handleData);
        return () => {
            room.off(RoomEvent.DataReceived, handleData);
        };
    }, [room, localParticipant?.identity, onNewMessage]);

    const sendMessage = useCallback(async (customContent?: string, type: 'chat' | 'POLL_VOTE' | 'POLL_CLOSE' = 'chat') => {
        if ((!input.trim() && !customContent) || !room || !localParticipant) return;

        const contentToSend = customContent || input.trim();

        // Special message types (invisible to chat history locally)
        if (type === 'POLL_VOTE' || type === 'POLL_CLOSE') {
            const message = JSON.parse(contentToSend!);
            await localParticipant.publishData(
                new TextEncoder().encode(JSON.stringify(message)),
                { reliable: true }
            );
            return;
        }

        const message = {
            type: 'chat',
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sender: localParticipant.name || localParticipant.identity,
            content: contentToSend,
            timestamp: Date.now(),
        };

        try {
            await localParticipant.publishData(
                new TextEncoder().encode(JSON.stringify(message)),
                { reliable: true }
            );

            // Persist valid chat messages (including Polls)
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, message }), // Persist poll creation messages too
            });

            setMessages((prev) => [...prev, { ...message, isOwn: true }]);
            if (!customContent) setInput('');
        } catch (e) {
            console.error('Failed to send message:', e);
        }
    }, [input, room, localParticipant, roomId]);

    const handleCreatePoll = (question: string, options: string[], duration: number) => {
        const pollId = `poll-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const now = Date.now();
        const pollPayload: PollData & { type: string } = {
            type: 'POLL_CREATE',
            id: pollId,
            question,
            options,
            isAnonymous: true,
            createdAt: now,
            expiresAt: duration > 0 ? now + duration : undefined
        };
        sendMessage(JSON.stringify(pollPayload));
        setShowPollForm(false);
        setShowPlusMenu(false);
    };

    const handleClosePoll = (pollId: string) => {
        setClosedPolls(prev => new Set(prev).add(pollId));
        const closePayload = {
            type: 'POLL_CLOSE',
            pollId
        };
        sendMessage(JSON.stringify(closePayload), 'POLL_CLOSE');
    };

    const handleVote = (pollId: string, optionIndex: number) => {
        // Prevent double voting locally (simple check)
        if (myVotes[pollId] !== undefined) return;

        // Find existing poll message to check expiration
        const pollMsg = messages.find(m => {
            try {
                const data = JSON.parse(m.content);
                return data.type === 'POLL_CREATE' && data.id === pollId;
            } catch { return false; }
        });

        if (pollMsg) {
            try {
                const pollData = JSON.parse(pollMsg.content) as PollData;
                if (pollData.expiresAt && Date.now() > pollData.expiresAt) {
                    alert('투표가 마감되었습니다.');
                    return;
                }
            } catch { }
        }

        if (closedPolls.has(pollId)) {
            alert('투표가 종료되었습니다.');
            return;
        }

        setMyVotes(prev => ({ ...prev, [pollId]: optionIndex }));

        // Optimistic update
        setPollVotes(prev => {
            const currentPollVotes = prev[pollId] || {};
            return {
                ...prev,
                [pollId]: {
                    ...currentPollVotes,
                    [optionIndex]: (currentPollVotes[optionIndex] || 0) + 1
                }
            };
        });

        // Broadcast invisible vote
        const votePayload = {
            type: 'POLL_VOTE',
            pollId,
            optionIndex
        };
        sendMessage(JSON.stringify(votePayload), 'POLL_VOTE');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const formatTime = (ts: number) => {
        return new Date(ts).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="h-full flex flex-col bg-white/95 backdrop-blur-xl border-l border-black/5 relative">
            {/* Header with Tabs */}
            <div className="flex-shrink-0 border-b border-black/5">
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex gap-1 p-1 bg-black/5 rounded-lg">
                        <button
                            onClick={() => setActiveTab('chat')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'chat'
                                ? 'bg-white text-black shadow-sm'
                                : 'text-black/50 hover:text-black/70'
                                }`}
                        >
                            채팅
                        </button>
                        <button
                            onClick={() => setActiveTab('voice')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${activeTab === 'voice'
                                ? 'bg-white text-black shadow-sm'
                                : 'text-black/50 hover:text-black/70'
                                }`}
                        >
                            음성 기록
                            {voiceRecords.length > 0 && (
                                <span className="w-5 h-5 flex items-center justify-center text-[10px] bg-black/10 rounded-full">
                                    {voiceRecords.length}
                                </span>
                            )}
                        </button>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-black/40 hover:text-black hover:bg-black/5 rounded-lg transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Poll Creation Form Overlay */}
            {showPollForm && (
                <div className="absolute inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-end justify-center p-4">
                    <div className="w-full max-w-sm mb-16" onClick={e => e.stopPropagation()}>
                        <PollCreateForm
                            onSubmit={handleCreatePoll}
                            onCancel={() => setShowPollForm(false)}
                        />
                    </div>
                    <div className="absolute inset-0 -z-10" onClick={() => setShowPollForm(false)} />
                </div>
            )}

            {/* Content */}
            {activeTab === 'chat' ? (
                <>
                    {/* Chat Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="w-5 h-5 border-2 border-black/10 border-t-black rounded-full animate-spin" />
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center py-12">
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-black/5 to-black/10 flex items-center justify-center mb-4">
                                    <svg className="w-7 h-7 text-black/25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                    </svg>
                                </div>
                                <p className="text-black/40 text-sm font-medium">아직 메시지가 없습니다</p>
                                <p className="text-black/25 text-xs mt-1">대화를 시작해보세요</p>
                            </div>
                        ) : (
                            messages.map((msg) => {
                                // Check if message is a poll
                                let pollData: PollData | null = null;
                                try {
                                    const parsed = JSON.parse(msg.content);
                                    if (parsed.type === 'POLL_CREATE') {
                                        pollData = parsed;
                                    }
                                } catch { }

                                return (
                                    <div
                                        key={msg.id}
                                        className={`flex flex-col ${msg.isOwn ? 'items-end' : 'items-start'}`}
                                    >
                                        {!msg.isOwn && (
                                            <span className="text-[11px] text-black/40 mb-1 ml-3 font-medium">{msg.sender}</span>
                                        )}

                                        {pollData ? (
                                            <PollBubble
                                                poll={pollData}
                                                isOwn={msg.isOwn}
                                                onVote={handleVote}
                                                votes={pollVotes[pollData.id] || {}}
                                                myVote={myVotes[pollData.id]}
                                                isClosed={closedPolls.has(pollData.id)}
                                                onClosePoll={() => handleClosePoll(pollData.id)}
                                            />
                                        ) : (
                                            <div
                                                className={`max-w-[80%] px-4 py-2.5 ${msg.isOwn
                                                    ? 'bg-black text-white rounded-2xl rounded-br-sm'
                                                    : 'bg-black/[0.04] text-black rounded-2xl rounded-bl-sm'
                                                    }`}
                                            >
                                                <p className="text-[13px] leading-relaxed break-words">{msg.content}</p>
                                            </div>
                                        )}

                                        <span className="text-[10px] text-black/25 mt-1 mx-3">
                                            {formatTime(msg.timestamp)}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Chat Input */}
                    <div className="flex-shrink-0 p-3 border-t border-black/5 relative">
                        {/* Plus Menu Dropdown */}
                        {showPlusMenu && (
                            <div className="absolute bottom-16 left-4 bg-white rounded-lg shadow-lg border border-black/10 py-1 min-w-[160px] animate-in slide-in-from-bottom-2 fade-in duration-200 z-40">
                                <button
                                    onClick={() => {
                                        setShowPollForm(true);
                                        setShowPlusMenu(false);
                                    }}
                                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-black/5 flex items-center gap-2 text-black/80"
                                >
                                    <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                    </svg>
                                    비공개 투표 만들기
                                </button>
                            </div>
                        )}

                        <div className="flex gap-2">
                            {/* Plus Button */}
                            <button
                                onClick={() => setShowPlusMenu(!showPlusMenu)}
                                className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${showPlusMenu
                                    ? 'bg-black text-white rotate-45'
                                    : 'bg-black/[0.04] text-black hover:bg-black/[0.08]'
                                    }`}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>

                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="메시지를 입력하세요..."
                                className="flex-1 px-4 py-2.5 bg-black/[0.04] border-0 rounded-full text-sm text-black placeholder-black/30 focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                            <button
                                onClick={() => sendMessage()}
                                disabled={!input.trim()}
                                className="w-10 h-10 flex items-center justify-center bg-black hover:bg-black/80 disabled:bg-black/10 disabled:text-black/20 text-white rounded-full transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                /* Voice Records */
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {voiceRecords.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <p className="text-black/30 text-sm">음성 기록이 없습니다</p>
                        </div>
                    ) : (
                        voiceRecords.map((record) => (
                            <div
                                key={record.id}
                                className="group"
                            >
                                {/* Speaker info with time */}
                                <div className="flex items-center gap-2 mb-2">
                                    {record.profileImg ? (
                                        <img
                                            src={record.profileImg}
                                            alt={record.speaker}
                                            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                        />
                                    ) : (
                                        <div className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center flex-shrink-0">
                                            <span className="text-[10px] font-medium text-black/50">
                                                {record.speaker.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                    )}
                                    <span className="text-[12px] font-medium text-black/70">{record.speaker}</span>
                                    <span className="text-[10px] text-black/30">{formatTime(record.timestamp)}</span>
                                </div>

                                {/* Content */}
                                <div className="pl-8 space-y-2">
                                    {/* Original text */}
                                    <div className="flex items-start gap-2">
                                        <span className="text-[10px] text-black/40 bg-black/5 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 uppercase">
                                            {record.sourceLanguage || 'KO'}
                                        </span>
                                        <p className="text-[13px] text-black/80 leading-relaxed">{record.original}</p>
                                    </div>
                                    {/* Translated text */}
                                    {record.translated && (
                                        <div className="flex items-start gap-2">
                                            <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 uppercase">
                                                {record.targetLanguage || 'EN'}
                                            </span>
                                            <p className="text-[13px] text-black leading-relaxed">{record.translated}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                    <div ref={voiceEndRef} />
                </div>
            )}
        </div>
    );
}
