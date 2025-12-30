"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { apiClient, Workspace } from "../../lib/api";
import Sidebar from "./components/Sidebar";
import MembersSection from "./components/MembersSection";
import ChatSection from "./components/ChatSection";
import CallsSection from "./components/CallsSection";
import CalendarSection from "./components/CalendarSection";
import StorageSection from "./components/StorageSection";
import NotificationDropdown from "../../components/NotificationDropdown";

export default function WorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [activeSection, setActiveSection] = useState("members");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [currentChatRoomTitle, setCurrentChatRoomTitle] = useState("");

  // 워크스페이스 데이터
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  // 워크스페이스 로드
  useEffect(() => {
    if (isAuthenticated) {
      fetchWorkspace();
    }
  }, [isAuthenticated, fetchWorkspace]);

  if (isLoading || isLoadingWorkspace) {
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

  if (!isAuthenticated || !user) {
    return null;
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
      return <CallsSection workspaceId={workspace.id} channelId={activeSection} />;
    }

    // 채팅방 처리
    if (activeSection.startsWith("chat-")) {
      const roomId = parseInt(activeSection.replace("chat-", ""), 10);
      return <ChatSection workspaceId={workspace.id} roomId={roomId} onRoomTitleChange={setCurrentChatRoomTitle} onBack={() => setActiveSection("members")} />;
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
        return <CallsSection workspaceId={workspace.id} />;
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
        workspaceName={workspace.name}
        workspaceId={workspace.id}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-black/5 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/workspace")}
              className="group flex items-center gap-2 text-black/40 hover:text-black transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-sm font-medium">워크스페이스</span>
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
            {user.profileImg ? (
              <img
                src={user.profileImg}
                alt={user.nickname}
                className="w-8 h-8 rounded-full object-cover hover:ring-2 hover:ring-black/10 transition-all"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full bg-black flex items-center justify-center hover:ring-2 hover:ring-black/20 transition-all"
              >
                <span className="text-xs font-medium text-white">
                  {user.nickname.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-hidden">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
