"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "../../../lib/auth-context";
import { usePresence } from "../../../contexts/presence-context";
import StatusIndicator from "../../../../components/StatusIndicator";

interface UserProfileMenuProps {
    onClose: () => void;
    onEditProfile: () => void;
    onLogout: () => void;
}

export default function UserProfileMenu({ onClose, onEditProfile, onLogout }: UserProfileMenuProps) {
    const { user } = useAuth();
    const { updateStatus, presenceMap } = usePresence();

    // 내 상태 가져오기
    const myPresence = user ? presenceMap[user.id] : null;
    const currentStatus = myPresence?.status || user?.default_status || "online";

    const handleStatusChange = (status: string) => {
        updateStatus(status);
        // Dropdown 안 닫고 상태 변경만? 아니면 닫기?
        // 보통 상태 변경은 즉시 반영. 메뉴는 유지하거나 확인.
    };

    return (
        <>
            <div
                className="fixed inset-0 z-10"
                onClick={onClose}
            />
            <div className="absolute right-0 mt-2 w-72 bg-white border border-black/10 shadow-lg z-20 rounded-md overflow-hidden">
                {/* User Info */}
                <div className="p-4 border-b border-black/5 bg-black/5">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="relative">
                            {user?.profileImg ? (
                                <img
                                    src={user.profileImg}
                                    alt={user?.nickname}
                                    className="w-12 h-12 rounded-full object-cover"
                                />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-black flex items-center justify-center">
                                    <span className="text-lg font-medium text-white">
                                        {user?.nickname?.charAt(0).toUpperCase()}
                                    </span>
                                </div>
                            )}
                            <StatusIndicator
                                status={currentStatus}
                                size="lg"
                                className="absolute bottom-0 right-0"
                            />
                        </div>
                        <div>
                            <p className="font-bold text-black">{user?.nickname}</p>
                            <p className="text-xs text-black/50">{user?.email}</p>
                        </div>
                    </div>

                    {/* Custom Status Display */}
                    {myPresence?.custom_status_text && (
                        <div className="text-sm text-black/70 bg-white p-2 rounded border border-black/5 mt-2">
                            {myPresence.custom_status_emoji && <span className="mr-1">{myPresence.custom_status_emoji}</span>}
                            {myPresence.custom_status_text}
                        </div>
                    )}
                </div>

                {/* Status Selection */}
                <div className="p-2 border-b border-black/5">
                    <p className="px-2 py-1 text-xs font-semibold text-black/40 uppercase">상태 설정</p>
                    {[
                        { id: "online", label: "온라인", color: "bg-green-500" },
                        { id: "idle", label: "자리 비움", color: "bg-yellow-500" },
                        { id: "dnd", label: "방해 금지", color: "bg-red-500" },
                        { id: "offline", label: "오프라인 표시", color: "bg-gray-400" },
                    ].map((item) => (
                        <button
                            key={item.id}
                            onClick={() => handleStatusChange(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded hover:bg-black/5 transition-colors ${currentStatus === item.id ? "bg-black/[0.03]" : ""}`}
                        >
                            <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                            <span className="text-black/80">{item.label}</span>
                            {currentStatus === item.id && (
                                <svg className="w-4 h-4 text-black/40 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </button>
                    ))}
                </div>

                {/* Menu Items */}
                <div className="p-2">
                    <button
                        onClick={() => {
                            // 커스텀 상태 변경 로직 (모달 오픈 등)
                            // 현재는 일단 Edit Profile로 유도하거나 추후 구현
                            onEditProfile();
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5 rounded transition-colors flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        프로필 및 상태 메시지 수정
                    </button>
                    <button
                        onClick={onLogout}
                        className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 rounded transition-colors flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        로그아웃
                    </button>
                </div>
            </div>
        </>
    );
}
