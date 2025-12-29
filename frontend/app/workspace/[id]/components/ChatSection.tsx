"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { apiClient, ChatMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

interface ChatSectionProps {
  workspaceId: number;
}

interface TypingUser {
  userId: number;
  nickname: string;
}

interface WSMessage {
  type: string;
  payload?: {
    id?: number;
    message?: string;
    sender_id?: number;
    nickname?: string;
    created_at?: string;
    user_id?: number;
  };
}

const WS_BASE_URL = process.env.NEXT_PUBLIC_CHAT_WS_URL || 'ws://localhost:8080';

export default function ChatSection({ workspaceId }: ChatSectionProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [lastSentTime, setLastSentTime] = useState(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const isComposingRef = useRef(false);

  // 스팸 방지: 1초에 1개 메시지만 허용
  const SPAM_COOLDOWN = 1000;

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  // 초기 메시지 로드
  const loadMessages = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getWorkspaceChats(workspaceId);
      setMessages(response.messages);
    } catch (error) {
      console.error("Failed to load messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  // WebSocket 연결
  useEffect(() => {
    loadMessages();

    let isMounted = true;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      if (!isMounted) return;

      const ws = new WebSocket(`${WS_BASE_URL}/ws/chat/${workspaceId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) {
          console.log("Chat WebSocket connected");
        }
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;

        try {
          const data: WSMessage = JSON.parse(event.data);

          switch (data.type) {
            case "message":
              if (data.payload && data.payload.id) {
                const newMsg: ChatMessage = {
                  id: data.payload.id,
                  meeting_id: 0,
                  sender_id: data.payload.sender_id,
                  message: data.payload.message || "",
                  type: "TEXT",
                  created_at: data.payload.created_at || new Date().toISOString(),
                  sender: {
                    id: data.payload.sender_id || 0,
                    email: "",
                    nickname: data.payload.nickname || "",
                  },
                };
                // 중복 메시지 방지
                setMessages((prev) => {
                  if (prev.some((m) => m.id === newMsg.id)) {
                    return prev;
                  }
                  return [...prev, newMsg];
                });
              }
              break;

            case "typing":
              if (data.payload?.user_id && data.payload?.nickname) {
                const userId = data.payload.user_id;
                const nickname = data.payload.nickname;
                setTypingUsers((prev) => {
                  if (prev.find((u) => u.userId === userId)) {
                    return prev;
                  }
                  return [...prev, { userId, nickname }];
                });
              }
              break;

            case "stop_typing":
              if (data.payload?.user_id) {
                setTypingUsers((prev) =>
                  prev.filter((u) => u.userId !== data.payload?.user_id)
                );
              }
              break;
          }
        } catch (e) {
          console.error("Failed to parse WebSocket message:", e);
        }
      };

      ws.onclose = () => {
        if (isMounted) {
          console.log("Chat WebSocket disconnected");
          // 재연결 시도
          reconnectTimeout = setTimeout(connectWebSocket, 3000);
        }
      };

      ws.onerror = () => {
        // Strict Mode에서 발생하는 에러는 무시
        if (!isMounted) return;
      };
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [workspaceId, loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 타이핑 상태 전송
  const sendTypingStatus = (isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: isTyping ? "typing" : "stop_typing",
        })
      );
    }
  };

  // 입력 중 처리
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    // 타이핑 상태 전송
    if (!isTypingRef.current && e.target.value.length > 0) {
      isTypingRef.current = true;
      sendTypingStatus(true);
    }

    // 타이핑 타임아웃 리셋
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        sendTypingStatus(false);
      }
    }, 2000);
  };

  const handleSend = async () => {
    if (!message.trim() || isSending) return;

    // 스팸 방지
    const now = Date.now();
    if (now - lastSentTime < SPAM_COOLDOWN) {
      return;
    }

    // 타이핑 상태 해제
    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTypingStatus(false);
    }

    // WebSocket으로 메시지 전송
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "message",
          payload: {
            message: message.trim(),
          },
        })
      );
      setMessage("");
      setLastSentTime(now);
    } else {
      // Fallback: REST API 사용
      try {
        setIsSending(true);
        const newMessage = await apiClient.sendMessage(workspaceId, message.trim());
        setMessages((prev) => [...prev, newMessage]);
        setMessage("");
        setLastSentTime(now);
      } catch (error) {
        console.error("Failed to send message:", error);
      } finally {
        setIsSending(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = () => {
    isComposingRef.current = false;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const isMyMessage = (msg: ChatMessage) => {
    return msg.sender_id === user?.id;
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-8 py-5 border-b border-black/5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-black">팀 채팅</h1>
          <p className="text-sm text-black/40 mt-0.5">
            {messages.length}개의 메시지
            {typingUsers.length > 0 && (
              <span className="ml-2 text-black/60 animate-pulse">
                · {typingUsers.map((u) => u.nickname).join(", ")} 입력 중...
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-8 py-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-black/40">
            <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p>아직 메시지가 없습니다</p>
            <p className="text-sm mt-1">첫 메시지를 보내보세요!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, index) => {
              const isMe = isMyMessage(msg);
              const showAvatar =
                index === 0 || messages[index - 1].sender_id !== msg.sender_id;
              const showName = showAvatar && !isMe;

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex gap-2 max-w-[75%] ${isMe ? "flex-row-reverse" : ""}`}>
                    {/* Avatar */}
                    {!isMe && (
                      <div className="w-8 flex-shrink-0 self-end">
                        {showAvatar && (
                          msg.sender?.profile_img ? (
                            <img
                              src={msg.sender.profile_img}
                              alt={msg.sender.nickname}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-100 flex items-center justify-center">
                              <span className="text-xs font-medium text-gray-500">
                                {msg.sender?.nickname?.charAt(0) || "?"}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      {showName && (
                        <span className="text-xs text-black/50 mb-1 ml-1">
                          {msg.sender?.nickname || "알 수 없음"}
                        </span>
                      )}
                      <div
                        className={`px-4 py-2 rounded-full ${
                          isMe
                            ? "bg-black text-white"
                            : "bg-gray-100 text-black"
                        }`}
                        style={{
                          borderRadius: isMe
                            ? "20px 20px 4px 20px"
                            : "20px 20px 20px 4px",
                        }}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                          {msg.message}
                        </p>
                      </div>
                      <span className="text-[10px] text-black/30 mt-0.5 mx-1">
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Typing Indicator */}
      {typingUsers.length > 0 && (
        <div className="px-8 py-2">
          <div className="flex items-center gap-2 text-sm text-black/50">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span>{typingUsers.map((u) => u.nickname).join(", ")} 입력 중</span>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-6 py-4 border-t border-black/5">
        <div className="flex items-center gap-3 bg-gray-100 rounded-full px-4 py-2 focus-within:bg-gray-50 focus-within:ring-2 focus-within:ring-black/10 transition-all">
          <textarea
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="메시지 입력..."
            rows={1}
            className="flex-1 bg-transparent resize-none text-[15px] text-black placeholder:text-black/40 focus:outline-none focus:ring-0 focus:border-0 border-0 outline-none ring-0 py-2 max-h-32 leading-relaxed"
            style={{ outline: 'none', boxShadow: 'none' }}
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || isSending}
            className={`p-2.5 rounded-full transition-all flex-shrink-0 ${
              message.trim() && !isSending
                ? "bg-black text-white hover:bg-black/80"
                : "bg-black/10 text-black/30 cursor-not-allowed"
            }`}
          >
            {isSending ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
