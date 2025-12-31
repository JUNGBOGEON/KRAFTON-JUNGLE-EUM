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
    targetLanguage?: string;  // 번역 언어 (ja, zh, en 등)
    timestamp: number;
}

interface ChatPanelProps {
    roomId: string;
    onClose: () => void;
    onNewMessage?: () => void;
    voiceRecords?: VoiceRecord[];
}

type TabType = 'chat' | 'voice';

export default function ChatPanel({ roomId, onClose, onNewMessage, voiceRecords = [] }: ChatPanelProps) {
    const room = useRoomContext();
    const { localParticipant } = useLocalParticipant();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>('chat');
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
        console.log("[ChatPanel] voiceRecords received:", voiceRecords.length, "records");
        if (voiceRecords.length > 0) {
            console.log("[ChatPanel] Latest record:", voiceRecords[voiceRecords.length - 1]);
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
                const data = JSON.parse(new TextDecoder().decode(payload));
                if (data.type === 'chat') {
                    const newMessage: ChatMessage = {
                        id: data.id,
                        sender: data.sender,
                        content: data.content,
                        timestamp: data.timestamp,
                        isOwn: participant?.identity === localParticipant?.identity,
                    };
                    setMessages((prev) => [...prev, newMessage]);
                    onNewMessage?.();
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

    const sendMessage = useCallback(async () => {
        if (!input.trim() || !room || !localParticipant) return;

        const message = {
            type: 'chat',
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sender: localParticipant.name || localParticipant.identity,
            content: input.trim(),
            timestamp: Date.now(),
        };

        try {
            await localParticipant.publishData(
                new TextEncoder().encode(JSON.stringify(message)),
                { reliable: true }
            );

            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, message }),
            });

            setMessages((prev) => [...prev, { ...message, isOwn: true }]);
            setInput('');
        } catch (e) {
            console.error('Failed to send message:', e);
        }
    }, [input, room, localParticipant, roomId]);

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
        <div className="h-full flex flex-col bg-white/95 backdrop-blur-xl border-l border-black/5">
            {/* Header with Tabs */}
            <div className="flex-shrink-0 border-b border-black/5">
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex gap-1 p-1 bg-black/5 rounded-lg">
                        <button
                            onClick={() => setActiveTab('chat')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                                activeTab === 'chat'
                                    ? 'bg-white text-black shadow-sm'
                                    : 'text-black/50 hover:text-black/70'
                            }`}
                        >
                            채팅
                        </button>
                        <button
                            onClick={() => setActiveTab('voice')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
                                activeTab === 'voice'
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
                            messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`flex flex-col ${msg.isOwn ? 'items-end' : 'items-start'}`}
                                >
                                    {!msg.isOwn && (
                                        <span className="text-[11px] text-black/40 mb-1 ml-3 font-medium">{msg.sender}</span>
                                    )}
                                    <div
                                        className={`max-w-[80%] px-4 py-2.5 ${
                                            msg.isOwn
                                                ? 'bg-black text-white rounded-2xl rounded-br-sm'
                                                : 'bg-black/[0.04] text-black rounded-2xl rounded-bl-sm'
                                        }`}
                                    >
                                        <p className="text-[13px] leading-relaxed break-words">{msg.content}</p>
                                    </div>
                                    <span className="text-[10px] text-black/25 mt-1 mx-3">
                                        {formatTime(msg.timestamp)}
                                    </span>
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Chat Input */}
                    <div className="flex-shrink-0 p-3 border-t border-black/5">
                        <div className="flex gap-2">
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
                                onClick={sendMessage}
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
                                        <span className="text-[10px] text-black/40 bg-black/5 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0">KO</span>
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
