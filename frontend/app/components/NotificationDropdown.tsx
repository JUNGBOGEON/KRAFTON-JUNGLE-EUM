"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiClient, Notification } from "../lib/api";
import { NotificationType } from "../lib/constants";
import { usePresence } from "../contexts/presence-context";
import { useAuth } from "../lib/auth-context";

interface NotificationDropdownProps {
    onInvitationAccepted?: (workspaceId: number) => void;
}

export default function NotificationDropdown({ onInvitationAccepted }: NotificationDropdownProps) {
    const { isAuthenticated } = useAuth();
    const { latestNotification } = usePresence();
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [processingId, setProcessingId] = useState<number | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // 알림 목록 가져오기
    const fetchNotifications = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            setIsLoading(true);
            const response = await apiClient.getMyNotifications();
            setNotifications(response.notifications || []);
        } catch (err) {
            console.error("Failed to fetch notifications:", err);
        } finally {
            setIsLoading(false);
        }
    }, [isAuthenticated]);

    // 실시간 알림 수신 (Context 사용)
    useEffect(() => {
        if (latestNotification) {
            setNotifications(prev => {
                // 중복 방지
                if (prev.some(n => n.id === latestNotification.id)) {
                    return prev;
                }
                // 새 알림을 맨 앞에 추가
                return [latestNotification, ...prev];
            });
        }
    }, [latestNotification]);

    // 인증 시 알림 목록 로드
    useEffect(() => {
        if (isAuthenticated) {
            fetchNotifications();
        } else {
            setNotifications([]);
        }
    }, [isAuthenticated, fetchNotifications]);

    // 드롭다운 열릴 때 알림 목록 가져오기
    useEffect(() => {
        if (isOpen && isAuthenticated) {
            fetchNotifications();
        }
    }, [isOpen, isAuthenticated, fetchNotifications]);

    // 외부 클릭 시 드롭다운 닫기
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // 초대 수락
    const handleAccept = async (notification: Notification) => {
        try {
            setProcessingId(notification.id);
            const response = await apiClient.acceptInvitation(notification.id);
            setNotifications(prev => prev.filter(n => n.id !== notification.id));
            if (onInvitationAccepted && response.workspace_id) {
                onInvitationAccepted(response.workspace_id);
            }
        } catch (err) {
            console.error("Failed to accept invitation:", err);
        } finally {
            setProcessingId(null);
        }
    };

    // 초대 거절
    const handleDecline = async (notification: Notification) => {
        try {
            setProcessingId(notification.id);
            await apiClient.declineInvitation(notification.id);
            setNotifications(prev => prev.filter(n => n.id !== notification.id));
        } catch (err) {
            console.error("Failed to decline invitation:", err);
        } finally {
            setProcessingId(null);
        }
    };

    // 상대 시간 계산
    const getRelativeTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return "방금 전";
        if (diffMins < 60) return `${diffMins}분 전`;
        if (diffHours < 24) return `${diffHours}시간 전`;
        return `${diffDays}일 전`;
    };

    return (
        <div ref={dropdownRef} className="relative">
            {/* 알림 버튼 */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors relative"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {/* 알림 배지 */}
                {notifications.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
                        {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                )}
            </button>

            {/* 드롭다운 */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-black/10 overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-black/5">
                        <h3 className="font-semibold text-black">알림</h3>
                    </div>

                    {isLoading ? (
                        <div className="p-4 text-center text-black/50">로딩 중...</div>
                    ) : notifications.length === 0 ? (
                        <div className="p-6 text-center text-black/40">
                            <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                            </svg>
                            <p className="text-sm">새로운 알림이 없습니다</p>
                        </div>
                    ) : (
                        <div className="max-h-80 overflow-y-auto">
                            {notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className="p-4 border-b border-black/5 last:border-b-0 hover:bg-black/[0.02] transition-colors"
                                >
                                    <div className="flex items-start gap-3">
                                        {/* 발신자 아바타 */}
                                        {notification.sender?.profile_img ? (
                                            <img
                                                src={notification.sender.profile_img}
                                                alt={notification.sender.nickname}
                                                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                            />
                                        ) : notification.sender ? (
                                            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center flex-shrink-0">
                                                <span className="text-sm font-medium text-white">
                                                    {notification.sender.nickname.charAt(0).toUpperCase()}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                                </svg>
                                            </div>
                                        )}

                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-black">
                                                {notification.content}
                                            </p>
                                            <p className="text-xs text-black/40 mt-1">
                                                {getRelativeTime(notification.created_at)}
                                            </p>

                                            {/* 초대 알림인 경우 수락/거절 버튼 */}
                                            {notification.type === NotificationType.WORKSPACE_INVITE && (
                                                <div className="flex gap-2 mt-3">
                                                    <button
                                                        onClick={() => handleAccept(notification)}
                                                        disabled={processingId === notification.id}
                                                        className="flex-1 px-3 py-1.5 bg-black text-white text-xs font-medium rounded-lg hover:bg-black/80 transition-colors disabled:opacity-50"
                                                    >
                                                        {processingId === notification.id ? "처리 중..." : "수락"}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDecline(notification)}
                                                        disabled={processingId === notification.id}
                                                        className="flex-1 px-3 py-1.5 bg-black/5 text-black/70 text-xs font-medium rounded-lg hover:bg-black/10 transition-colors disabled:opacity-50"
                                                    >
                                                        거절
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
