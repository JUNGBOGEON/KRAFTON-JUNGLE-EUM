"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiClient, ChatMessage, ChatRoom } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

interface ChatSectionProps {
  workspaceId: number;
  selectedRoomId?: number;
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

interface ContextMenu {
  x: number;
  y: number;
  messageId: number;
}

const WS_BASE_URL = process.env.NEXT_PUBLIC_CHAT_WS_URL || 'ws://localhost:8080';
const MESSAGES_PER_PAGE = 30;

export default function ChatSection({ workspaceId, selectedRoomId }: ChatSectionProps) {
  const { user } = useAuth();

  // 채팅방 상태
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(true);

  // 메시지 상태
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [lastSentTime, setLastSentTime] = useState(0);

  // 스크롤 상태
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isMessagesReady, setIsMessagesReady] = useState(false);

  // 메시지 편집/삭제 상태
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<number | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [editedMessageIds, setEditedMessageIds] = useState<Set<number>>(new Set());

  // Refs
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollButtonTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const isComposingRef = useRef(false);
  const previousScrollHeightRef = useRef<number>(0);

  const SPAM_COOLDOWN = 1000;
  const SCROLL_THRESHOLD = 100;

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.overflowY = 'hidden';
    }
  };

  const scrollToBottom = (smooth = true) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  // 스크롤 위치 체크
  const checkScrollPosition = useCallback(() => {
    if (!messagesContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    setIsAtBottom(distanceFromBottom < SCROLL_THRESHOLD);

    // 디바운스로 버튼 깜빡임 방지
    if (scrollButtonTimeoutRef.current) {
      clearTimeout(scrollButtonTimeoutRef.current);
    }

    const shouldShow = distanceFromBottom > SCROLL_THRESHOLD * 3;
    if (shouldShow) {
      scrollButtonTimeoutRef.current = setTimeout(() => {
        setShowScrollToBottom(true);
      }, 150);
    } else {
      setShowScrollToBottom(false);
    }
  }, []);

  // 채팅방 정보 로드
  const loadRoom = useCallback(async () => {
    if (!selectedRoomId) {
      setSelectedRoom(null);
      setIsLoadingRoom(false);
      return;
    }

    try {
      setIsLoadingRoom(true);
      const response = await apiClient.getChatRooms(workspaceId);
      const room = response.chatrooms.find(r => r.id === selectedRoomId);
      setSelectedRoom(room || null);
    } catch (error) {
      console.error("Failed to load room:", error);
    } finally {
      setIsLoadingRoom(false);
    }
  }, [workspaceId, selectedRoomId]);

  // 초기 메시지 로드
  const loadMessages = useCallback(async (roomId: number) => {
    try {
      setIsLoadingMessages(true);
      setIsMessagesReady(false);
      setHasMore(true);
      const response = await apiClient.getChatRoomMessages(workspaceId, roomId, MESSAGES_PER_PAGE, 0);
      setMessages(response.messages);
      setHasMore(response.messages.length >= MESSAGES_PER_PAGE);

      // 초기 로드 후 맨 아래로 스크롤 (즉시, 애니메이션 없이)
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
        // 스크롤 완료 후 메시지 표시
        setIsMessagesReady(true);
      });
    } catch (error) {
      console.error("Failed to load messages:", error);
      setIsMessagesReady(true);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [workspaceId]);

  // 이전 메시지 로드 (무한 스크롤)
  const loadMoreMessages = useCallback(async () => {
    if (!selectedRoom || isLoadingMore || !hasMore) return;

    try {
      setIsLoadingMore(true);

      // 현재 스크롤 높이 저장
      if (messagesContainerRef.current) {
        previousScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
      }

      const response = await apiClient.getChatRoomMessages(
        workspaceId,
        selectedRoom.id,
        MESSAGES_PER_PAGE,
        messages.length
      );

      if (response.messages.length > 0) {
        // 이전 메시지를 앞에 추가
        setMessages(prev => [...response.messages, ...prev]);
        setHasMore(response.messages.length >= MESSAGES_PER_PAGE);

        // 스크롤 위치 유지
        requestAnimationFrame(() => {
          if (messagesContainerRef.current) {
            const newScrollHeight = messagesContainerRef.current.scrollHeight;
            const scrollDiff = newScrollHeight - previousScrollHeightRef.current;
            messagesContainerRef.current.scrollTop = scrollDiff;
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
  }, [selectedRoom, workspaceId, messages.length, isLoadingMore, hasMore]);

  // 스크롤 이벤트 핸들러
  const handleScroll = useCallback(() => {
    checkScrollPosition();

    // 상단에 도달하면 이전 메시지 로드
    if (messagesContainerRef.current) {
      const { scrollTop } = messagesContainerRef.current;
      if (scrollTop < 100 && hasMore && !isLoadingMore) {
        loadMoreMessages();
      }
    }
  }, [checkScrollPosition, hasMore, isLoadingMore, loadMoreMessages]);

  // 채팅방 로드
  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  // 선택된 채팅방 변경 시 메시지 로드 및 WebSocket 연결
  useEffect(() => {
    if (!selectedRoom) return;

    setIsMessagesReady(false);
    loadMessages(selectedRoom.id);
    setTypingUsers([]);
    setShowScrollToBottom(false);
    setIsAtBottom(true);
    setEditedMessageIds(new Set());

    let isMounted = true;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      if (!isMounted) return;

      const ws = new WebSocket(`${WS_BASE_URL}/ws/chat/${workspaceId}/${selectedRoom.id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) {
          console.log("Chat WebSocket connected to room:", selectedRoom.id);
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
                  meeting_id: selectedRoom.id,
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
                setMessages((prev) => {
                  if (prev.some((m) => m.id === newMsg.id)) {
                    return prev;
                  }
                  return [...prev, newMsg];
                });

                // 내가 보낸 메시지거나 맨 아래에 있으면 스크롤
                if (data.payload.sender_id === user?.id) {
                  setTimeout(() => scrollToBottom(true), 50);
                }
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

            case "message_update":
              if (data.payload?.id && data.payload?.message !== undefined) {
                const msgId = data.payload.id;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === msgId
                      ? { ...m, message: data.payload?.message || "" }
                      : m
                  )
                );
                setEditedMessageIds((prev) => new Set(prev).add(msgId));
              }
              break;

            case "message_delete":
              if (data.payload?.id) {
                setMessages((prev) =>
                  prev.filter((m) => m.id !== data.payload?.id)
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
          reconnectTimeout = setTimeout(connectWebSocket, 3000);
        }
      };

      ws.onerror = () => {
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
  }, [selectedRoom, workspaceId, loadMessages, user?.id]);

  // 맨 아래에 있을 때만 새 메시지에 자동 스크롤
  useEffect(() => {
    if (isAtBottom && messages.length > 0) {
      scrollToBottom(true);
    }
  }, [messages, isAtBottom]);

  // Shift 키 상태 감지
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftPressed(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const sendTypingStatus = (isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: isTyping ? "typing" : "stop_typing",
        })
      );
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    const maxHeight = 120; // 최대 높이 (약 5줄)
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';

    if (!isTypingRef.current && e.target.value.length > 0) {
      isTypingRef.current = true;
      sendTypingStatus(true);
    }

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
    if (!message.trim() || isSending || !selectedRoom) return;

    const now = Date.now();
    if (now - lastSentTime < SPAM_COOLDOWN) {
      return;
    }

    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTypingStatus(false);
    }

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
      resetTextareaHeight();
    } else {
      try {
        setIsSending(true);
        const newMessage = await apiClient.sendChatRoomMessage(workspaceId, selectedRoom.id, message.trim());
        setMessages((prev) => [...prev, newMessage]);
        setMessage("");
        setLastSentTime(now);
        resetTextareaHeight();
        setTimeout(() => scrollToBottom(true), 50);
      } catch (error) {
        console.error("Failed to send message:", error);
      } finally {
        setIsSending(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 편집 모드일 때
    if (editingMessageId) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEditing();
      } else if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
        e.preventDefault();
        saveEdit();
      }
      return;
    }

    // 일반 전송 모드
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

  // 컨텍스트 메뉴 열기
  const handleContextMenu = (e: React.MouseEvent, msgId: number) => {
    e.preventDefault();
    const msg = messages.find(m => m.id === msgId);
    if (msg && isMyMessage(msg)) {
      setContextMenu({ x: e.clientX, y: e.clientY, messageId: msgId });
    }
  };

  // 컨텍스트 메뉴 닫기
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 편집 모드 시작 - 메인 입력창으로 이동
  const startEditing = (msgId: number) => {
    const msg = messages.find(m => m.id === msgId);
    if (msg) {
      setEditingMessageId(msgId);
      setMessage(msg.message);
      setContextMenu(null);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(
            textareaRef.current.value.length,
            textareaRef.current.value.length
          );
          // 높이 자동 조절
          textareaRef.current.style.height = 'auto';
          const maxHeight = 120;
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, maxHeight) + 'px';
        }
      }, 0);
    }
  };

  // 편집 취소
  const cancelEditing = () => {
    setEditingMessageId(null);
    setMessage("");
    resetTextareaHeight();
  };

  // 편집 저장
  const saveEdit = () => {
    if (!editingMessageId || !message.trim()) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "message_update",
          payload: {
            id: editingMessageId,
            message: message.trim(),
          },
        })
      );
    }
    setEditingMessageId(null);
    setMessage("");
    resetTextareaHeight();
  };

  // 메시지 삭제
  const deleteMessage = (msgId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "message_delete",
          payload: {
            id: msgId,
          },
        })
      );
    }
    setContextMenu(null);
  };


  // 클릭 외부 감지로 컨텍스트 메뉴 닫기
  useEffect(() => {
    const handleClick = () => closeContextMenu();
    if (contextMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [contextMenu, closeContextMenu]);

  if (isLoadingRoom) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (!selectedRoom) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-black/40">
        <svg className="w-20 h-20 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p className="text-lg">채팅방을 선택하세요</p>
        <p className="text-sm mt-1">왼쪽 사이드바에서 채팅방을 선택하세요</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden relative">
      {/* Room Header */}
      <div className="px-8 py-5 border-b border-black/5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-black">{selectedRoom.title}</h2>
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
      <div
        ref={messagesContainerRef}
        className={`flex-1 overflow-y-auto px-8 py-6 transition-opacity duration-150 ${
          isMessagesReady ? "opacity-100" : "opacity-0"
        }`}
        onScroll={handleScroll}
      >
        {/* Loading More Indicator */}
        {isLoadingMore && (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
          </div>
        )}

        {/* Beginning of conversation */}
        {!hasMore && messages.length > 0 && (
          <div className="flex justify-center py-6 mb-4">
            <p className="text-sm text-black/30">여기서 이야기가 시작되었습니다</p>
          </div>
        )}

        {isLoadingMessages ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
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
              const isHovered = hoveredMessageId === msg.id;
              const isBeingEdited = editingMessageId === msg.id;
              // 서버에서 updated_at이 있거나, 로컬에서 편집된 경우 수정됨 표시
              const wasEdited = msg.updated_at !== undefined || editedMessageIds.has(msg.id);

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"} group relative`}
                  onMouseEnter={() => setHoveredMessageId(msg.id)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                  onContextMenu={(e) => handleContextMenu(e, msg.id)}
                >
                  {/* Quick Action Buttons - Shift + Hover */}
                  {isMe && isHovered && isShiftPressed && !isBeingEdited && (
                    <div
                      className="absolute -top-2 right-0 flex items-center gap-1 z-10"
                      style={{ transform: 'translateY(-50%)' }}
                    >
                      <button
                        onClick={() => startEditing(msg.id)}
                        className="p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-lg border border-black/5 hover:bg-white hover:scale-110 transition-all duration-200"
                        title="수정"
                      >
                        <svg className="w-3.5 h-3.5 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteMessage(msg.id)}
                        className="p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-lg border border-black/5 hover:bg-red-50 hover:scale-110 transition-all duration-200 group/delete"
                        title="삭제"
                      >
                        <svg className="w-3.5 h-3.5 text-black/60 group-hover/delete:text-red-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}

                  <div className={`flex gap-2 max-w-[40%] ${isMe ? "flex-row-reverse" : ""}`}>
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

                    <div className={`flex flex-col min-w-0 ${isMe ? "items-end" : "items-start"}`}>
                      {showName && (
                        <span className="text-xs text-black/50 mb-1 ml-1">
                          {msg.sender?.nickname || "알 수 없음"}
                        </span>
                      )}

                      <div
                        className={`px-4 py-2 ${
                          isMe
                            ? "bg-black text-white"
                            : "bg-gray-100 text-black"
                        } ${isMe ? "chat-markdown-dark" : "chat-markdown-light"} ${
                          isBeingEdited ? "ring-2 ring-blue-500/50" : ""
                        }`}
                        style={{
                          borderRadius: isMe
                            ? "20px 20px 4px 20px"
                            : "20px 20px 20px 4px",
                        }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => (
                              <p className="text-sm leading-relaxed whitespace-pre-wrap break-all m-0">
                                {children}
                              </p>
                            ),
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`underline ${isMe ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-800"}`}
                              >
                                {children}
                              </a>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-bold">{children}</strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic">{children}</em>
                            ),
                            code: ({ children, className }) => {
                              const isInline = !className;
                              return isInline ? (
                                <code className={`px-1 py-0.5 rounded text-xs font-mono ${isMe ? "bg-white/20" : "bg-black/10"}`}>
                                  {children}
                                </code>
                              ) : (
                                <code className={`block p-2 rounded text-xs font-mono my-1 overflow-x-auto ${isMe ? "bg-white/10" : "bg-black/5"}`}>
                                  {children}
                                </code>
                              );
                            },
                            pre: ({ children }) => (
                              <pre className="m-0 overflow-x-auto">{children}</pre>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside text-sm my-1 space-y-0.5">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-inside text-sm my-1 space-y-0.5">{children}</ol>
                            ),
                            li: ({ children }) => (
                              <li className="text-sm">{children}</li>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className={`border-l-2 pl-2 my-1 ${isMe ? "border-white/40 text-white/80" : "border-black/30 text-black/70"}`}>
                                {children}
                              </blockquote>
                            ),
                            hr: () => (
                              <hr className={`my-2 border-t ${isMe ? "border-white/20" : "border-black/10"}`} />
                            ),
                            del: ({ children }) => (
                              <del className="line-through opacity-70">{children}</del>
                            ),
                          }}
                        >
                          {msg.message}
                        </ReactMarkdown>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 mx-1">
                        <span className="text-xs text-black/50">
                          {formatTime(msg.created_at)}
                        </span>
                        {wasEdited && (
                          <span className="text-xs text-black/40 italic">(수정됨)</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed bg-white rounded-lg shadow-xl border border-black/10 py-1 z-50 min-w-[120px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => startEditing(contextMenu.messageId)}
              className="w-full px-3 py-2 text-left text-sm text-black/70 hover:bg-gray-100 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              수정
            </button>
            <button
              onClick={() => deleteMessage(contextMenu.messageId)}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              삭제
            </button>
          </div>
        )}
      </div>

      {/* Scroll to Bottom Button */}
      <button
        onClick={() => scrollToBottom(true)}
        className={`absolute bottom-32 left-1/2 -translate-x-1/2 px-4 py-2 bg-black text-white text-sm rounded-full shadow-lg hover:bg-black/80 flex items-center gap-2 transition-all duration-300 ease-out ${
          showScrollToBottom
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
        최신 메시지로 이동
      </button>

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
        {/* 편집 모드 표시 */}
        {editingMessageId && (
          <div className="flex items-center justify-between mb-2 px-2">
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              <span>메시지 수정 중</span>
            </div>
            <button
              onClick={cancelEditing}
              className="text-sm text-black/40 hover:text-black/70 transition-colors"
            >
              취소
            </button>
          </div>
        )}

        <div className={`flex items-end gap-3 rounded-[24px] px-4 py-2 transition-all ${
          editingMessageId
            ? "bg-blue-50 ring-2 ring-blue-500/30"
            : "bg-gray-100 focus-within:bg-gray-50 focus-within:ring-2 focus-within:ring-black/10"
        }`}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={editingMessageId ? "메시지 수정..." : "메시지 입력..."}
            maxLength={2000}
            rows={1}
            className="flex-1 bg-transparent resize-none text-[15px] text-black placeholder:text-black/40 focus:outline-none focus:ring-0 focus:border-0 border-0 outline-none ring-0 py-2 leading-5 overflow-hidden"
            style={{ outline: 'none', boxShadow: 'none' }}
          />
          <button
            onClick={editingMessageId ? saveEdit : handleSend}
            disabled={!message.trim() || isSending}
            className={`p-2 rounded-full transition-all flex-shrink-0 ${
              message.trim() && !isSending
                ? editingMessageId
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : "bg-black text-white hover:bg-black/80"
                : "bg-black/10 text-black/30 cursor-not-allowed"
            }`}
          >
            {isSending ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : editingMessageId ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>

        {/* 편집 모드 힌트 */}
        {editingMessageId && (
          <div className="flex items-center gap-2 mt-2 px-2 text-xs text-black/40">
            <span>ESC로 취소</span>
            <span>•</span>
            <span>Enter로 저장</span>
          </div>
        )}
      </div>
    </div>
  );
}
