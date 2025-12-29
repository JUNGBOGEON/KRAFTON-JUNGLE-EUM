"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  id: number;
  sender: {
    id: number;
    name: string;
    profileImg?: string;
  };
  content: string;
  timestamp: string;
  isMe?: boolean;
}

const mockMessages: Message[] = [
  {
    id: 1,
    sender: { id: 2, name: "이영희" },
    content: "오늘 회의 시간 확정됐나요?",
    timestamp: "오전 10:23",
  },
  {
    id: 2,
    sender: { id: 1, name: "나" },
    content: "네, 오후 2시로 확정됐어요!",
    timestamp: "오전 10:25",
    isMe: true,
  },
  {
    id: 3,
    sender: { id: 3, name: "박민수" },
    content: "알겠습니다. 회의 자료는 제가 준비할게요.",
    timestamp: "오전 10:28",
  },
  {
    id: 4,
    sender: { id: 2, name: "이영희" },
    content: "좋아요! 저는 발표 슬라이드 마무리하고 있을게요. 혹시 추가로 필요한 자료 있으면 말씀해주세요.",
    timestamp: "오전 10:30",
  },
  {
    id: 5,
    sender: { id: 4, name: "정수진" },
    content: "회의 링크도 공유해주실 수 있을까요?",
    timestamp: "오전 10:45",
  },
  {
    id: 6,
    sender: { id: 1, name: "나" },
    content: "네, 곧 캘린더에 초대 보내드릴게요!",
    timestamp: "오전 10:47",
    isMe: true,
  },
];

export default function ChatSection() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState(mockMessages);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!message.trim()) return;

    const newMessage: Message = {
      id: messages.length + 1,
      sender: { id: 1, name: "나" },
      content: message,
      timestamp: new Date().toLocaleTimeString("ko-KR", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      isMe: true,
    };

    setMessages([...messages, newMessage]);
    setMessage("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-5 border-b border-black/5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-black">팀 채팅</h1>
          <p className="text-sm text-black/40 mt-0.5">6명의 멤버</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="space-y-4">
          {messages.map((msg, index) => {
            const showAvatar =
              index === 0 || messages[index - 1].sender.id !== msg.sender.id;

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.isMe ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar */}
                <div className="w-9 flex-shrink-0">
                  {showAvatar && !msg.isMe && (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-black/10 to-black/5 flex items-center justify-center">
                      <span className="text-xs font-medium text-black/50">
                        {msg.sender.name.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Message */}
                <div className={`max-w-[70%] ${msg.isMe ? "items-end" : ""}`}>
                  {showAvatar && !msg.isMe && (
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-black">
                        {msg.sender.name}
                      </span>
                      <span className="text-xs text-black/30">{msg.timestamp}</span>
                    </div>
                  )}
                  <div
                    className={`px-4 py-2.5 rounded-2xl ${
                      msg.isMe
                        ? "bg-black text-white rounded-tr-md"
                        : "bg-black/[0.04] text-black rounded-tl-md"
                    }`}
                  >
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  </div>
                  {msg.isMe && (
                    <p className="text-xs text-black/30 mt-1 text-right">
                      {msg.timestamp}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="px-8 py-4 border-t border-black/5">
        <div className="flex items-end gap-3 bg-black/[0.03] rounded-2xl p-2">
          <button className="p-2 rounded-xl hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="메시지를 입력하세요..."
            rows={1}
            className="flex-1 bg-transparent border-0 resize-none text-sm placeholder:text-black/30 focus:outline-none py-2 max-h-32"
          />
          <button className="p-2 rounded-xl hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={handleSend}
            disabled={!message.trim()}
            className={`p-2.5 rounded-xl transition-all ${
              message.trim()
                ? "bg-black text-white hover:bg-black/80"
                : "bg-black/10 text-black/30 cursor-not-allowed"
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
