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

export default function WorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [activeSection, setActiveSection] = useState("members");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

    switch (activeSection) {
      case "members":
        return <MembersSection workspace={workspace} />;
      case "chat":
        return <ChatSection workspaceId={workspace.id} />;
      case "calls":
        return <CallsSection workspaceId={workspace.id} />;
      case "calendar":
        return <CalendarSection workspaceId={workspace.id} />;
      case "storage":
        return <StorageSection workspaceId={workspace.id} />;
      default:
        return <MembersSection workspace={workspace} />;
    }
  };

  return (
    <div className="h-screen bg-white flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        workspaceName={workspace.name}
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
            {/* Breadcrumb could go here */}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/workspace")}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors mr-2"
              title="워크스페이스 나가기"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              나가기
            </button>
            <button className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>
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
