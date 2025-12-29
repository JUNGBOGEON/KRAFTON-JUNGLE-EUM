"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import Sidebar from "./components/Sidebar";
import MembersSection from "./components/MembersSection";
import ChatSection from "./components/ChatSection";
import CallsSection from "./components/CallsSection";
import CalendarSection from "./components/CalendarSection";
import StorageSection from "./components/StorageSection";

// 임시 워크스페이스 데이터
const mockWorkspace = {
  id: 1,
  name: "프로젝트 A",
};

export default function WorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [activeSection, setActiveSection] = useState("members");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

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

  if (!isAuthenticated || !user) {
    return null;
  }

  const renderContent = () => {
    // 통화방 채널 처리
    if (activeSection.startsWith("call-")) {
      return <CallsSection channelId={activeSection} />;
    }

    switch (activeSection) {
      case "members":
        return <MembersSection />;
      case "chat":
        return <ChatSection />;
      case "calls":
        return <CallsSection />;
      case "calendar":
        return <CalendarSection />;
      case "storage":
        return <StorageSection />;
      default:
        return <MembersSection />;
    }
  };

  return (
    <div className="min-h-screen bg-white flex">
      {/* Sidebar */}
      <Sidebar
        workspaceName={mockWorkspace.name}
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

          {/* User Profile */}
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>
            {user.profileImg ? (
              <img
                src={user.profileImg}
                alt={user.nickname}
                className="w-8 h-8 rounded-full object-cover cursor-pointer hover:ring-2 hover:ring-black/10 transition-all"
                onClick={() => router.push("/workspace")}
              />
            ) : (
              <button
                onClick={() => router.push("/workspace")}
                className="w-8 h-8 rounded-full bg-black flex items-center justify-center hover:ring-2 hover:ring-black/20 transition-all"
              >
                <span className="text-xs font-medium text-white">
                  {user.nickname.charAt(0).toUpperCase()}
                </span>
              </button>
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
