"use client";

import { useState } from "react";

interface CallRoom {
  id: string;
  name: string;
  participants: {
    id: number;
    name: string;
    profileImg?: string;
    isSpeaking?: boolean;
    isMuted?: boolean;
  }[];
  isActive: boolean;
}

const mockCallRooms: CallRoom[] = [
  {
    id: "call-general",
    name: "일반 통화",
    participants: [
      { id: 1, name: "김철수", isSpeaking: true },
      { id: 2, name: "이영희", isMuted: true },
    ],
    isActive: true,
  },
  {
    id: "call-standup",
    name: "스탠드업 미팅",
    participants: [],
    isActive: false,
  },
  {
    id: "call-brainstorm",
    name: "브레인스토밍",
    participants: [
      { id: 3, name: "박민수" },
      { id: 4, name: "정수진", isSpeaking: true },
      { id: 5, name: "최동훈" },
    ],
    isActive: true,
  },
];

interface CallsSectionProps {
  channelId?: string;
}

export default function CallsSection({ channelId }: CallsSectionProps) {
  const [selectedRoom, setSelectedRoom] = useState<string | null>(channelId || null);

  const activeRoom = selectedRoom
    ? mockCallRooms.find((r) => r.id === selectedRoom)
    : null;

  return (
    <div className="h-full flex">
      {/* Room List */}
      <div className="w-80 border-r border-black/5 flex flex-col">
        <div className="px-6 py-5 border-b border-black/5">
          <h1 className="text-xl font-semibold text-black">통화방</h1>
          <p className="text-sm text-black/40 mt-0.5">음성 채널</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {mockCallRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setSelectedRoom(room.id)}
                className={`w-full p-4 rounded-xl text-left transition-all ${
                  selectedRoom === room.id
                    ? "bg-black text-white"
                    : "bg-black/[0.02] hover:bg-black/[0.05]"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <svg
                      className={`w-5 h-5 ${
                        selectedRoom === room.id ? "text-white/70" : "text-black/40"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                      />
                    </svg>
                    <span className="font-medium">{room.name}</span>
                  </div>
                  {room.isActive && (
                    <span
                      className={`w-2 h-2 rounded-full ${
                        selectedRoom === room.id ? "bg-green-400" : "bg-green-500"
                      } animate-pulse`}
                    />
                  )}
                </div>

                {room.participants.length > 0 && (
                  <div className="flex items-center gap-1 mt-2">
                    <div className="flex -space-x-1.5">
                      {room.participants.slice(0, 3).map((p) => (
                        <div
                          key={p.id}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-medium ${
                            selectedRoom === room.id
                              ? "border-black bg-white/20 text-white"
                              : "border-white bg-black/10 text-black/50"
                          }`}
                        >
                          {p.name.charAt(0)}
                        </div>
                      ))}
                    </div>
                    <span
                      className={`text-xs ml-1 ${
                        selectedRoom === room.id ? "text-white/60" : "text-black/40"
                      }`}
                    >
                      {room.participants.length}명 참여 중
                    </span>
                  </div>
                )}

                {room.participants.length === 0 && (
                  <p
                    className={`text-xs ${
                      selectedRoom === room.id ? "text-white/50" : "text-black/30"
                    }`}
                  >
                    참여자 없음
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Create New Room */}
          <button className="w-full mt-4 p-4 border-2 border-dashed border-black/10 rounded-xl text-black/40 hover:border-black/20 hover:text-black/60 transition-colors flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">새 통화방 만들기</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {activeRoom ? (
          <>
            {/* Room Header */}
            <div className="px-8 py-5 border-b border-black/5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-black">{activeRoom.name}</h2>
                <p className="text-sm text-black/40">
                  {activeRoom.participants.length}명 참여 중
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-4 py-2 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  참여하기
                </button>
              </div>
            </div>

            {/* Participants Grid */}
            <div className="flex-1 p-8 overflow-y-auto">
              {activeRoom.participants.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {activeRoom.participants.map((participant) => (
                    <div
                      key={participant.id}
                      className={`aspect-video rounded-2xl p-6 flex flex-col items-center justify-center relative ${
                        participant.isSpeaking
                          ? "bg-green-50 ring-2 ring-green-500"
                          : "bg-black/[0.03]"
                      }`}
                    >
                      {/* Avatar */}
                      <div
                        className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-medium ${
                          participant.isSpeaking
                            ? "bg-green-500 text-white"
                            : "bg-black/10 text-black/50"
                        }`}
                      >
                        {participant.name.charAt(0)}
                      </div>
                      <p className="mt-3 font-medium text-black">{participant.name}</p>

                      {/* Status */}
                      {participant.isMuted && (
                        <div className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </svg>
                        </div>
                      )}

                      {participant.isSpeaking && (
                        <div className="absolute bottom-3 right-3 flex items-center gap-0.5">
                          {[1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className="w-1 bg-green-500 rounded-full animate-pulse"
                              style={{
                                height: `${8 + Math.random() * 8}px`,
                                animationDelay: `${i * 0.1}s`,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 rounded-full bg-black/5 flex items-center justify-center mb-4">
                    <svg className="w-10 h-10 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-black/60 mb-1">
                    아직 아무도 없어요
                  </h3>
                  <p className="text-sm text-black/40 mb-6">
                    첫 번째로 통화에 참여해보세요
                  </p>
                  <button className="px-6 py-2.5 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-colors">
                    통화 시작하기
                  </button>
                </div>
              )}
            </div>

            {/* Controls (when in call) */}
            {activeRoom.participants.length > 0 && (
              <div className="px-8 py-4 border-t border-black/5 flex items-center justify-center gap-3">
                <button className="w-12 h-12 rounded-full bg-black/5 hover:bg-black/10 transition-colors flex items-center justify-center">
                  <svg className="w-6 h-6 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
                <button className="w-12 h-12 rounded-full bg-black/5 hover:bg-black/10 transition-colors flex items-center justify-center">
                  <svg className="w-6 h-6 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <button className="w-12 h-12 rounded-full bg-black/5 hover:bg-black/10 transition-colors flex items-center justify-center">
                  <svg className="w-6 h-6 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </button>
                <button className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                  </svg>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="w-24 h-24 rounded-full bg-black/5 flex items-center justify-center mb-6">
              <svg className="w-12 h-12 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-medium text-black/60 mb-2">
              통화방을 선택하세요
            </h3>
            <p className="text-sm text-black/40 max-w-sm">
              왼쪽에서 통화방을 선택하거나 새로운 통화방을 만들어 팀원들과 소통하세요
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
