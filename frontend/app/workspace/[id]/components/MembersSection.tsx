"use client";

import { useState } from "react";

interface Member {
  id: number;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "online" | "away" | "offline";
  profileImg?: string;
}

const mockMembers: Member[] = [
  { id: 1, name: "김철수", email: "chulsoo@example.com", role: "owner", status: "online", profileImg: undefined },
  { id: 2, name: "이영희", email: "younghee@example.com", role: "admin", status: "online", profileImg: undefined },
  { id: 3, name: "박민수", email: "minsoo@example.com", role: "member", status: "away", profileImg: undefined },
  { id: 4, name: "정수진", email: "soojin@example.com", role: "member", status: "online", profileImg: undefined },
  { id: 5, name: "최동훈", email: "donghun@example.com", role: "member", status: "offline", profileImg: undefined },
  { id: 6, name: "강민지", email: "minji@example.com", role: "member", status: "offline", profileImg: undefined },
];

const roleLabels = {
  owner: "소유자",
  admin: "관리자",
  member: "멤버",
};

const statusColors = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  offline: "bg-gray-300",
};

export default function MembersSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "online">("all");

  const filteredMembers = mockMembers.filter((member) => {
    const matchesSearch =
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === "all" || member.status === "online";
    return matchesSearch && matchesFilter;
  });

  const onlineCount = mockMembers.filter((m) => m.status === "online").length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-6 border-b border-black/5">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-black">멤버</h1>
            <p className="text-sm text-black/40 mt-1">
              {mockMembers.length}명의 멤버 · {onlineCount}명 온라인
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            멤버 초대
          </button>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder="이름 또는 이메일로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-black/[0.03] border-0 rounded-lg text-sm placeholder:text-black/30 focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="flex items-center bg-black/[0.03] rounded-lg p-1">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                filter === "all"
                  ? "bg-white text-black shadow-sm"
                  : "text-black/50 hover:text-black/70"
              }`}
            >
              전체
            </button>
            <button
              onClick={() => setFilter("online")}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                filter === "online"
                  ? "bg-white text-black shadow-sm"
                  : "text-black/50 hover:text-black/70"
              }`}
            >
              온라인
            </button>
          </div>
        </div>
      </div>

      {/* Member List */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="space-y-1">
          {filteredMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-4 p-3 rounded-xl hover:bg-black/[0.02] transition-colors group"
            >
              {/* Avatar */}
              <div className="relative">
                {member.profileImg ? (
                  <img
                    src={member.profileImg}
                    alt={member.name}
                    className="w-11 h-11 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-black/10 to-black/5 flex items-center justify-center">
                    <span className="text-sm font-medium text-black/50">
                      {member.name.charAt(0)}
                    </span>
                  </div>
                )}
                <div
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${statusColors[member.status]}`}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-black">{member.name}</span>
                  {member.role !== "member" && (
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        member.role === "owner"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {roleLabels[member.role]}
                    </span>
                  )}
                </div>
                <p className="text-sm text-black/40 truncate">{member.email}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </button>
                <button className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
