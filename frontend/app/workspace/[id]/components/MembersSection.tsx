"use client";

import { useState, useEffect, useCallback } from "react";
import { Workspace, apiClient } from "../../../lib/api";
import { filterActiveMembers } from "../../../lib/utils";
import InviteMemberModal from "./InviteMemberModal";
import { useAuth } from "../../../lib/auth-context";

interface MembersSectionProps {
  workspace: Workspace;
  onMembersUpdate?: () => void;
  onSectionChange: (section: string) => void;
}

const roleLabels: Record<string, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "멤버",
};

export default function MembersSection({ workspace, onMembersUpdate, onSectionChange }: MembersSectionProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});

  const fetchUnreadCounts = useCallback(async () => {
    try {
      const dms = await apiClient.getMyDMs(workspace.id);
      const counts: Record<number, number> = {};
      if (dms) {
        dms.forEach((dm) => {
          counts[dm.target_user.id] = dm.unread_count;
        });
      }
      setUnreadCounts(counts);
    } catch (e) {
      console.error("Failed to fetch unread counts:", e);
    }
  }, [workspace.id]);

  useEffect(() => {
    fetchUnreadCounts();
  }, [fetchUnreadCounts]);

  // 주기적으로 안읽음 개수 갱신 (3초마다)
  useEffect(() => {
    const interval = setInterval(fetchUnreadCounts, 3000);
    return () => clearInterval(interval);
  }, [fetchUnreadCounts]);



  // 워크스페이스 멤버 목록 변환 (ACTIVE 멤버만 표시)
  const members = filterActiveMembers(workspace.members || []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.user?.nickname || "알 수 없음",
    email: m.user?.email || "",
    profileImg: m.user?.profile_img,
    isOwner: m.user_id === workspace.owner_id,
    joinedAt: m.joined_at,
  }));

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // 소유자를 먼저 표시
  const sortedMembers = [...filteredMembers].sort((a, b) => {
    if (a.isOwner && !b.isOwner) return -1;
    if (!a.isOwner && b.isOwner) return 1;
    return 0;
  });

  const handleInviteSuccess = () => {
    // 멤버 목록 새로고침
    if (onMembersUpdate) {
      onMembersUpdate();
    }
    setShowInviteModal(false);
  };

  const handleStartDM = async (targetUserId: number) => {
    try {
      // Optimistically clear badge for this user
      setUnreadCounts(prev => ({ ...prev, [targetUserId]: 0 }));

      // API 호출
      const { id } = await apiClient.getOrCreateDMRoom(workspace.id, targetUserId);

      // 섹션 변경 (채팅방으로 이동)
      onSectionChange(`dm-${id}`);

      // Refetch unread counts after a short delay
      setTimeout(fetchUnreadCounts, 500);
    } catch (error) {
      console.error("Failed to start DM:", error);
      alert("DM 방을 생성할 수 없습니다.");
      fetchUnreadCounts(); // Revert optimistic update
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-6 border-b border-black/5">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-black">멤버</h1>
            <p className="text-sm text-black/40 mt-1">
              {members.length}명의 멤버
            </p>
          </div>
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-colors"
          >

            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            멤버 초대
          </button>
        </div>

        {/* Search */}
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
        </div>
      </div>

      {/* Member List */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="space-y-1">
          {sortedMembers.map((member) => (
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
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-black">{member.name}</span>
                  {member.isOwner && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      {roleLabels.owner}
                    </span>
                  )}
                </div>
                <p className="text-sm text-black/40 truncate">{member.email}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 transition-opacity">

                {/* DM Button */}
                {user && member.userId !== user.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartDM(member.userId);
                    }}
                    className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-blue-500 transition-colors relative"
                    title="DM 보내기"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {unreadCounts[member.userId] > 0 && (
                      <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                    )}
                  </button>
                )}
                <button className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {/* Empty State */}
          {sortedMembers.length === 0 && (
            <div className="text-center py-12">
              <p className="text-black/40">
                {searchQuery ? "검색 결과가 없습니다" : "멤버가 없습니다"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      <InviteMemberModal
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        currentMembers={members.map(m => m.userId)}
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSuccess={handleInviteSuccess}
      />
    </div>
  );
}
