"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { apiClient, ChatMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

interface ChatSectionProps {
  workspaceId: number;
  roomId: number;
  onRoomTitleChange?: (title: string) => void;
  onBack?: () => void;
  canSendMessages?: boolean;
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
const MESSAGES_PER_PAGE = 30;

export default function ChatSection({ workspaceId, roomId, onRoomTitleChange, onBack, canSendMessages = true }: ChatSectionProps) {
  const { user } = useAuth();

  // 메시지 관련 상태
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [lastSentTime, setLastSentTime] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalMessages, setTotalMessages] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [roomTitle, setRoomTitle] = useState("");

  // Refs
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const isComposingRef = useRef(false);
  const isInitialLoadRef = useRef(true);
  const isAutoScrollingRef = useRef(false);
  const userIdRef = useRef<number | undefined>(user?.id);

  // user.id 변경 시 ref 업데이트
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  const SPAM_COOLDOWN = 1000;
  const TYPING_INDICATOR_TIMEOUT = 5000;

  // 맨 아래로 스크롤
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    isAutoScrollingRef.current = true;
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior });
    // smooth 스크롤 완료 후 플래그 해제
    setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, behavior === "smooth" ? 500 : 100);
  }, []);

  // 초기 메시지 로드 (최신 메시지부터)
  const loadInitialMessages = useCallback(async () => {
    try {
      setIsLoadingMessages(true);
      setMessages([]);
      setHasMore(true);
      isInitialLoadRef.current = true;

      const response = await apiClient.getChatRoomMessages(workspaceId, roomId, MESSAGES_PER_PAGE, 0);

      // 서버에서 이미 오래된순(ASC)으로 정렬하여 반환
      setMessages(response.messages);
      setTotalMessages(response.total);
      setHasMore(response.messages.length >= MESSAGES_PER_PAGE);
    } catch (error) {
      console.error("Failed to load messages:", error);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [workspaceId, roomId]);

  // 이전 메시지 로드 (스크롤 업 시)
  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    // 현재 스크롤 위치 저장
    const previousScrollHeight = container.scrollHeight;

    try {
      setIsLoadingMore(true);
      const offset = messages.length;
      const response = await apiClient.getChatRoomMessages(workspaceId, roomId, MESSAGES_PER_PAGE, offset);

      if (response.messages.length > 0) {
        // 서버에서 이미 오래된순(ASC)으로 정렬하여 반환
        setMessages(prev => {
          // 기존 메시지 ID Set 생성
          const existingIds = new Set(prev.map(m => m.id));
          // 중복되지 않은 메시지만 필터링
          const uniqueOlderMessages = response.messages.filter(m => !existingIds.has(m.id));
          return [...uniqueOlderMessages, ...prev];
        });
        setHasMore(response.messages.length >= MESSAGES_PER_PAGE);

        // 스크롤 위치 유지
        requestAnimationFrame(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = newScrollHeight - previousScrollHeight;
          }
        });
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to load more messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [workspaceId, roomId, messages.length, isLoadingMore, hasMore]);

  // 스크롤 이벤트 핸들러
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // 상단에서 100px 이내에 도달하면 더 로드
    if (container.scrollTop < 100 && !isLoadingMore && hasMore) {
      loadMoreMessages();
    }

    // 하단에서 300px 이상 떨어지면 "최신 메시지로" 버튼 표시 (자동 스크롤 중에는 제외)
    if (!isAutoScrollingRef.current) {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollButton(distanceFromBottom > 300);
    }
  }, [loadMoreMessages, isLoadingMore, hasMore]);

  // 채팅방 정보 로드
  const loadRoomInfo = useCallback(async () => {
    try {
      const response = await apiClient.getChatRooms(workspaceId);
      const room = response.rooms.find(r => r.id === roomId);
      if (room) {
        setRoomTitle(room.title);
        if (onRoomTitleChange) {
          onRoomTitleChange(room.title);
        }
      }
    } catch (error) {
      console.error("Failed to load room info:", error);
    }
  }, [workspaceId, roomId, onRoomTitleChange]);

  // roomId 변경 시 메시지 로드 및 WebSocket 연결
  useEffect(() => {
    loadInitialMessages();
    loadRoomInfo();
    setTypingUsers([]);

    let isMounted = true;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      if (!isMounted) return;

      const ws = new WebSocket(`${WS_BASE_URL}/ws/chat/${workspaceId}/${roomId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) {
          console.log(`Chat WebSocket connected: room=${roomId}`);
        }
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;

        try {
          const data: WSMessage = JSON.parse(event.data);

          switch (data.type) {
            case "message":
              if (data.payload) {
                const msgId = data.payload.id || Date.now() + Math.random();
                const newMsg: ChatMessage = {
                  id: msgId,
                  meeting_id: roomId,
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

                // 내 메시지인 경우 optimistic 메시지를 대체
                const isMyMsg = data.payload.sender_id === userIdRef.current;

                setMessages((prev) => {
                  // 이미 같은 ID가 있으면 무시
                  if (data.payload?.id && prev.some((m) => m.id === msgId)) return prev;

                  if (isMyMsg) {
                    // 내 메시지: 같은 내용의 optimistic 메시지(임시 ID) 찾아서 대체
                    const optimisticIndex = prev.findIndex(
                      (m) => m.sender_id === userIdRef.current &&
                        m.message === newMsg.message &&
                        m.id > 1000000000000 // 임시 ID는 Date.now()로 생성되어 매우 큰 값
                    );
                    if (optimisticIndex !== -1) {
                      const updated = [...prev];
                      updated[optimisticIndex] = newMsg;
                      return updated;
                    }
                  }

                  // 새 메시지 추가
                  return [...prev, newMsg];
                });

                // 다른 사람 메시지일 때만 스크롤 및 읽음 처리
                if (!isMyMsg) {
                  requestAnimationFrame(() => scrollToBottom("smooth"));
                  // 읽음 처리 (비동기, 에러 무시)
                  apiClient.markChatRoomAsRead(workspaceId, roomId).catch(() => { });
                }
              }
              break;

            case "typing":
              if (data.payload?.user_id && data.payload?.nickname) {
                const userId = data.payload.user_id;
                const nickname = data.payload.nickname;
                setTypingUsers((prev) => {
                  if (prev.find((u) => u.userId === userId)) return prev;
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
          reconnectTimeout = setTimeout(connectWebSocket, 3000);
        }
      };

      ws.onerror = () => { };
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [roomId, workspaceId, loadInitialMessages, loadRoomInfo, scrollToBottom]);

  // 초기 로드 완료 후 맨 아래로 스크롤
  useEffect(() => {
    if (!isLoadingMessages && messages.length > 0 && isInitialLoadRef.current) {
      scrollToBottom();
      isInitialLoadRef.current = false;
    }
  }, [isLoadingMessages, messages.length, scrollToBottom]);

  // 타이핑 상태 전송
  const sendTypingStatus = (isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: isTyping ? "typing" : "stop_typing" }));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    if (!isTypingRef.current && e.target.value.length > 0) {
      isTypingRef.current = true;
      sendTypingStatus(true);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        sendTypingStatus(false);
      }
    }, TYPING_INDICATOR_TIMEOUT);
  };

  const handleSend = useCallback(() => {
    const messageText = message.trim();
    if (!messageText) return;

    const now = Date.now();
    if (now - lastSentTime < SPAM_COOLDOWN) return;

    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTypingStatus(false);
    }

    // 입력창 즉시 비우기
    setMessage("");
    setLastSentTime(now);

    // 즉시 메시지 추가 (optimistic update)
    const tempId = now;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      meeting_id: roomId,
      sender_id: user?.id,
      message: messageText,
      type: "TEXT",
      created_at: new Date().toISOString(),
      sender: {
        id: user?.id || 0,
        email: user?.email || "",
        nickname: user?.nickname || "",
        profile_img: user?.profileImg,
      },
    };

    // 즉시 화면에 표시
    setMessages((prev) => [...prev, optimisticMessage]);

    // 스크롤
    requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });

    // WebSocket으로 전송
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "message",
        payload: { message: messageText },
      }));
    } else {
      // API 폴백
      apiClient.sendChatRoomMessage(workspaceId, roomId, messageText).catch(() => {
        // 실패 시 optimistic message 제거
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      });
    }
  }, [message, lastSentTime, roomId, user, workspaceId, scrollToBottom]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const isMyMessage = (msg: ChatMessage) => msg.sender_id === user?.id;

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden relative">
      {/* Header with Back Button */}
      <div className="h-16 px-6 flex items-center border-b border-black/5 bg-white flex-shrink-0 gap-3 z-10">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full hover:bg-black/5 text-black/40 hover:text-black transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h2 className="font-semibold text-lg text-black">{roomTitle || "채팅"}</h2>
      </div>
      {/* 최신 메시지로 이동 버튼 */}
      <button
        onClick={() => scrollToBottom("smooth")}
        className={`absolute bottom-24 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 bg-white text-blue-600 text-sm font-medium rounded-full shadow-lg border border-blue-200 transition-all duration-300 ease-out hover:bg-blue-50 hover:border-blue-300 hover:scale-105 ${showScrollButton
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4 pointer-events-none"
          }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
        최신 메시지
      </button>

      {/* 메시지 목록 */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-6 py-4"
        onScroll={handleScroll}
      >
        {isLoadingMessages ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-black/40">
            <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm">아직 메시지가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 더 로드 중 표시 */}
            {isLoadingMore && (
              <div className="flex justify-center py-2">
                <div className="w-5 h-5 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
              </div>
            )}

            {/* 더 이상 메시지 없음 표시 */}
            {!hasMore && messages.length > 0 && (
              <div className="flex justify-center py-2">
                <span className="text-xs text-black/30">채팅방의 시작입니다</span>
              </div>
            )}

            {messages.map((msg, index) => {
              const isMe = isMyMessage(msg);
              const showAvatar = index === 0 || messages[index - 1].sender_id !== msg.sender_id;
              const showName = showAvatar && !isMe;

              return (
                <div key={msg.id} className="flex animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {/* 왼쪽 영역 (다른 유저) - 45% */}
                  <div className="w-[45%] flex justify-start">
                    {!isMe && (
                      <div className="flex gap-2">
                        <div className="w-8 flex-shrink-0 mt-5">
                          {showAvatar && (
                            msg.sender?.profile_img ? (
                              <img src={msg.sender.profile_img} alt={msg.sender.nickname} className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                                <span className="text-xs font-medium text-gray-500">{msg.sender?.nickname?.charAt(0) || "?"}</span>
                              </div>
                            )
                          )}
                        </div>
                        <div className="flex flex-col items-start">
                          {showName && (
                            <span className="text-xs text-black/50 mb-1 ml-1">{msg.sender?.nickname || "알 수 없음"}</span>
                          )}
                          <div
                            className="px-4 py-2 bg-gray-100 text-black"
                            style={{ borderRadius: "20px 20px 20px 4px" }}
                          >
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-all">{msg.message}</p>
                          </div>
                          <span className="text-[10px] text-black/30 mt-0.5 mx-1">{formatTime(msg.created_at)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 중앙 여백 - 10% */}
                  <div className="w-[10%]" />

                  {/* 오른쪽 영역 (나) - 45% */}
                  <div className="w-[45%] flex justify-end">
                    {isMe && (
                      <div className="flex flex-col items-end">
                        <div
                          className="px-4 py-2 bg-black text-white"
                          style={{ borderRadius: "20px 20px 4px 20px" }}
                        >
                          <p className="text-sm leading-relaxed whitespace-pre-wrap break-all">{msg.message}</p>
                        </div>
                        <span className="text-[10px] text-black/30 mt-0.5 mx-1">{formatTime(msg.created_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 타이핑 인디케이터 - 메시지 영역 내 채팅 버블 스타일 */}
            {typingUsers.length > 0 && (
              <div className="flex animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="w-[45%] flex justify-start">
                  <div className="flex gap-2">
                    <div className="w-8 flex-shrink-0 mt-5">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-xs font-medium text-gray-500">{typingUsers[0]?.nickname?.charAt(0) || "?"}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-xs text-black/50 mb-1 ml-1">
                        {typingUsers.map((u) => u.nickname).join(", ")}
                      </span>
                      <div
                        className="px-4 py-3 bg-gray-100"
                        style={{ borderRadius: "20px 20px 20px 4px" }}
                      >
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-black/40 rounded-full animate-[bounce_1s_ease-in-out_infinite]" />
                          <span className="w-2 h-2 bg-black/40 rounded-full animate-[bounce_1s_ease-in-out_infinite_150ms]" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-black/40 rounded-full animate-[bounce_1s_ease-in-out_infinite_300ms]" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="w-[10%]" />
                <div className="w-[45%]" />
              </div>
            )}

            {/* 스크롤 앵커 */}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div className="px-4 py-3 border-t border-black/5">
        <div className="flex items-center gap-3 bg-gray-100 rounded-full px-4 py-2 focus-within:ring-2 focus-within:ring-black/10 transition-all">
          <textarea
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            placeholder={canSendMessages ? "메시지 입력..." : "메시지 전송 권한이 없습니다"}
            rows={1}
            disabled={!canSendMessages}
            className="flex-1 bg-transparent resize-none text-sm text-black placeholder:text-black/40 focus:outline-none py-1.5 max-h-24 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || !canSendMessages}
            className={`p-2 rounded-full transition-all ${message.trim() && canSendMessages ? "bg-black text-white hover:bg-black/80" : "bg-black/10 text-black/30"
              }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
