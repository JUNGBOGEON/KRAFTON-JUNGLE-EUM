"use client";

import { useState } from "react";

interface SidebarProps {
  workspaceName: string;
  activeSection: string;
  onSectionChange: (section: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  children?: { id: string; label: string }[];
}

export default function Sidebar({
  workspaceName,
  activeSection,
  onSectionChange,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>(["calls"]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const navItems: NavItem[] = [
    {
      id: "members",
      label: "멤버",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      id: "chat",
      label: "채팅",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      id: "calls",
      label: "통화방",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      children: [
        { id: "call-general", label: "일반 통화" },
        { id: "call-standup", label: "스탠드업 미팅" },
        { id: "call-brainstorm", label: "브레인스토밍" },
      ],
    },
    {
      id: "calendar",
      label: "캘린더",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: "storage",
      label: "저장소",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className={`h-screen bg-stone-50 border-r border-black/5 flex flex-col transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-black/5">
        {!isCollapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">
                {workspaceName.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="font-medium text-sm text-black truncate">
              {workspaceName}
            </span>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className={`p-1.5 rounded-md hover:bg-black/5 transition-colors text-black/40 hover:text-black/70 ${
            isCollapsed ? "mx-auto" : ""
          }`}
        >
          <svg
            className={`w-4 h-4 transition-transform ${isCollapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navItems.map((item) => (
          <div key={item.id}>
            <button
              onClick={() => {
                if (item.children) {
                  toggleExpand(item.id);
                } else {
                  onSectionChange(item.id);
                }
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all mb-0.5 ${
                activeSection === item.id || (item.children && activeSection.startsWith("call-"))
                  ? "bg-black/5 text-black"
                  : "text-black/60 hover:bg-black/[0.03] hover:text-black"
              } ${isCollapsed ? "justify-center" : ""}`}
              title={isCollapsed ? item.label : undefined}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!isCollapsed && (
                <>
                  <span className="text-sm font-medium flex-1 text-left">{item.label}</span>
                  {item.children && (
                    <svg
                      className={`w-4 h-4 transition-transform ${
                        expandedItems.includes(item.id) ? "rotate-90" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </>
              )}
            </button>

            {/* Children */}
            {item.children && expandedItems.includes(item.id) && !isCollapsed && (
              <div className="ml-4 pl-4 border-l border-black/10 mt-1 mb-2">
                {item.children.map((child) => (
                  <button
                    key={child.id}
                    onClick={() => onSectionChange(child.id)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-all text-sm ${
                      activeSection === child.id
                        ? "bg-black/5 text-black font-medium"
                        : "text-black/50 hover:bg-black/[0.03] hover:text-black/70"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      {!isCollapsed && (
        <div className="p-3 border-t border-black/5">
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-black/40 hover:bg-black/[0.03] hover:text-black/60 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm">설정</span>
          </button>
        </div>
      )}
    </div>
  );
}
