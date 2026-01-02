"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { usePresence } from "../../contexts/presence-context";
import { apiClient, Workspace } from "../../lib/api";
import Sidebar from "./components/Sidebar";
import MembersSection from "./components/MembersSection";
import ChatSection from "./components/ChatSection";
import CallsSection from "./components/CallsSection";
import CalendarSection from "./components/CalendarSection";
import StorageSection from "./components/StorageSection";
import NotificationDropdown from "../../components/NotificationDropdown";
import EditProfileModal from "../../../components/EditProfileModal";
import StatusIndicator from "../../../components/StatusIndicator";
import GlobalUserProfileMenu from "../../../components/GlobalUserProfileMenu";
import { useVoiceParticipantsWebSocket, VoiceParticipant } from "../../hooks/useVoiceParticipantsWebSocket";
import { usePermission } from "../../hooks/usePermission";

export default function WorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isAuthenticated, isLoading, refreshUser } = useAuth();
  const [activeSection, setActiveSection] = useState("members");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [currentChatRoomTitle, setCurrentChatRoomTitle] = useState("");

  // 통화 상태 (디스코드 스타일)
  interface CallParticipant {
    id: number;
    nickname: string;
    profileImg?: string;
  }
  const [activeCall, setActiveCall] = useState<{
    channelId: string;
    channelName: string;
    participants: CallParticipant[];
  } | null>(null);

  const { presenceMap } = usePresence();
  // 워크스페이스 데이터
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);

  // 음성 참가자 상태 (채널별)
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, VoiceParticipant[]>>({});

  // 음성 참가자 WebSocket (입장/퇴장 알림용)
  const workspaceId = Number(params.id);
  const { sendJoin, sendLeave } = useVoiceParticipantsWebSocket({
    workspaceId: isNaN(workspaceId) ? 0 : workspaceId,
    enabled: isAuthenticated && !isNaN(workspaceId),
    onParticipantsInit: (participants) => {
      setVoiceParticipants(participants);
    },
    onParticipantJoin: (channelId, participant) => {
      setVoiceParticipants(prev => {
        const current = prev[channelId] || [];
        // 중복 제거
        if (current.some(p => p.identity === participant.identity)) return prev;
        return {
          ...prev,
          [channelId]: [...current, participant]
        };
      });
    },
    onParticipantLeave: (channelId, identity) => {
      setVoiceParticipants(prev => {
        const current = prev[channelId] || [];
        return {
          ...prev,
          [channelId]: current.filter(p => p.identity !== identity)
        };
      });
    }
  });

  // 통화 입장 핸들러
  const handleJoinCall = useCallback((channelId: string, channelName: string) => {
    setActiveCall({
      channelId,
      channelName,
      participants: user ? [{
        id: user.id,
        nickname: user.nickname,
        profileImg: user.profileImg
      }] : []
    });

    // WebSocket으로 입장 알림
    if (user) {
      const roomName = `workspace - ${workspaceId} -${channelId} `;
      // Identity를 User ID로 전송
      sendJoin(roomName, user.id.toString(), user.nickname, user.profileImg);
    }
  }, [user, workspaceId, sendJoin]);

  // 통화 퇴장 핸들러
  const handleLeaveCall = useCallback(() => {
    if (activeCall && user) {
      const roomName = `workspace - ${workspaceId} -${activeCall.channelId} `;
      sendLeave(roomName, user.id.toString());
    }
    setActiveCall(null);
  }, [activeCall, user, workspaceId, sendLeave]);

  // 로그아웃 핸들러
  const handleLogout = async () => {
    await useAuth().logout();
    router.push("/");
  };

  // 프로필 수정 핸들러
  const handleUpdateProfile = async () => {
    await refreshUser();
    setIsEditProfileModalOpen(false);
  };

  // 워크스페이스 조회
  const fetchWorkspace = useCallback(async () => {
    const workspaceId = Number(params.id);
    if (isNaN(workspaceId)) {
      setError("잘못된 워크스페이스 ID입니다.");
      setIsLoadingWorkspace(false);
      return;
    }

    try {
      setIsLoadingWorkspace(true);
      const data = await apiClient.getWorkspace(workspaceId);
      setWorkspace(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch workspace:", err);
      setError("워크스페이스를 불러올 수 없습니다.");
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, [params.id]);

  useEffect(() => {
    console.log("[WorkspaceDetailPage] Check Auth Effect. isLoading:", isLoading, "isAuthenticated:", isAuthenticated);
    if (!isLoading && !isAuthenticated) {
      console.log("[WorkspaceDetailPage] Redirecting to / because NOT authenticated");
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  // 워크스페이스 로드
  useEffect(() => {
    if (isAuthenticated) {
      fetchWorkspace();
    }
  }, [isAuthenticated, fetchWorkspace]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <img
          src="/kor_eum_black.png"
          alt="Loading"
          className="w-12 h-12 animate-pulse"
        />
      </div>
    );
  }

  // 인증되지 않았으면 리다이렉트 대기 (useEffect에서 처리)
  if (!isAuthenticated || !user) {
    return null;
  }

  // 인증은 되었으나 워크스페이스 로딩 중
  if (isLoadingWorkspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <img
          src="/kor_eum_black.png"
          alt="Loading"
          className="w-12 h-12 animate-pulse"
        />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
        <p className="text-black/50">{error || "워크스페이스를 찾을 수 없습니다."}</p>
        <button
          onClick={() => router.push("/workspace")}
          className="text-sm text-black/70 hover:text-black underline"
        >
          워크스페이스 목록으로 돌아가기
        </button>
      </div>
    );
  }

  const renderContent = () => {
    // 통화방 채널 처리
    if (activeSection.startsWith("call-")) {
      const canConnectMedia = usePermission(workspace, "CONNECT_MEDIA");

      // 현재 채널의 참가자 목록 변환 (Identity(string ID) -> ID(number))
      const currentParticipants = (voiceParticipants[activeSection] || []).map(p => ({
        id: parseInt(p.identity, 10) || 0, // Identity가 숫자가 아니면 0 (기존 닉네임 방식 호환성 고려 필요하면 처리)
        nickname: p.name,
        profileImg: p.profileImg,
      }));

      return (
        <CallsSection
          workspaceId={workspace.id}
          channelId={activeSection}
          activeCall={activeCall}
          onJoinCall={handleJoinCall}
          onLeaveCall={handleLeaveCall}
          canConnectMedia={canConnectMedia}
          channelParticipants={currentParticipants}
        />
      );
    }

    // 채팅방 처리
    if (activeSection.startsWith("chat-")) {
      const roomId = parseInt(activeSection.replace("chat-", ""), 10);
      const canSendMessages = usePermission(workspace, "SEND_MESSAGES");

      return (
        <ChatSection
          workspaceId={workspace.id}
          roomId={roomId}
          onRoomTitleChange={setCurrentChatRoomTitle}
          onBack={() => setActiveSection("members")}
          canSendMessages={canSendMessages}
        />
      );
    }

    // DM 처리
    if (activeSection.startsWith("dm-")) {
      const roomId = parseInt(activeSection.replace("dm-", ""), 10);
      const canSendMessages = usePermission(workspace, "SEND_MESSAGES");

      return (
        <ChatSection
          workspaceId={workspace.id}
          roomId={roomId}
          onRoomTitleChange={setCurrentChatRoomTitle}
          onBack={() => setActiveSection("members")}
          canSendMessages={canSendMessages}
        />
      );
    }

    switch (activeSection) {
      case "members":
        return <MembersSection workspace={workspace} onMembersUpdate={fetchWorkspace} onSectionChange={setActiveSection} />;
      case "chat":
        // 기본 채팅 섹션 - 채팅방을 선택하라는 메시지 표시
        return (
          <div className="h-full flex flex-col items-center justify-center text-black/40">
            <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p>사이드바에서 채팅방을 선택하세요</p>
          </div>
        );
      case "calls":
        const canConnectMedia = usePermission(workspace, "CONNECT_MEDIA");
        // 전체 통화 채널의 참가자 합계? 아니면 CallsSection이 목록을 보여줄 때 사용?
        // activeSection이 "calls"일 때는 특정 채널이 아닌 대시보드일 수 있음.
        // 하지만 CallsSection은 channelId가 없으면 빈 화면을 보여줄 수 있음.
        // 여기서는 channelId prop이 필수인지 확인 필요.
        // CallsSection 정의: channelId?: string
        return <CallsSection workspaceId={workspace.id} canConnectMedia={canConnectMedia} />;
      case "calendar":
        return <CalendarSection workspaceId={workspace.id} />;
      case "storage":
        return <StorageSection workspaceId={workspace.id} />;
      default:
        return <MembersSection workspace={workspace} onMembersUpdate={fetchWorkspace} onSectionChange={setActiveSection} />;
    }
  };

  return (
    <div className="h-screen bg-white flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        workspace={workspace}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onUpdateWorkspace={(name) => setWorkspace((prev) => (prev ? { ...prev, name } : null))}
        activeCall={activeCall}
        onJoinCall={handleJoinCall}
        onLeaveCall={handleLeaveCall}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-black/5 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/workspace")}
              className="flex items-center gap-1.5 text-sm text-black/50 hover:text-black transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              워크스페이스
            </button>
            {activeSection.startsWith("chat-") && currentChatRoomTitle && (
              <>
                <span className="text-black/20">/</span>
                <span className="text-sm font-medium text-black"># {currentChatRoomTitle}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <NotificationDropdown onInvitationAccepted={() => router.push("/workspace")} />

            {/* Profile */}
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-2 hover:opacity-70 transition-opacity"
              >
                <div className="relative">
                  {user.profileImg ? (
                    <img
                      src={user.profileImg}
                      alt={user.nickname}
                      className="w-8 h-8 rounded-full object-cover hover:ring-2 hover:ring-black/10 transition-all"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center hover:ring-2 hover:ring-black/20 transition-all">
                      <span className="text-xs font-medium text-white">
                        {user.nickname.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  {/* Status Dot */}
                  <StatusIndicator
                    status={presenceMap[user.id]?.status || user.default_status || "online"}
                    size="sm"
                    className="absolute bottom-0 right-0 border-white"
                  />
                </div>
              </button>

              {/* Global Profile Menu */}
              {showProfileMenu && (
                <GlobalUserProfileMenu
                  onClose={() => setShowProfileMenu(false)}
                  onEditProfile={() => {
                    setShowProfileMenu(false);
                    setIsEditProfileModalOpen(true);
                  }}
                  onLogout={handleLogout}
                />
              )}
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-hidden">
          {renderContent()}
        </main>
      </div>

      {/* Edit Profile Modal */}
      {isEditProfileModalOpen && user && (
        <EditProfileModal
          user={user}
          onClose={() => setIsEditProfileModalOpen(false)}
          onUpdate={handleUpdateProfile}
        />
      )}
    </div>
  );
}
