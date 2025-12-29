"use client";

import { useState, useEffect } from "react";
import { apiClient, UserSearchResult } from "../../../lib/api";
import { APP_CONFIG } from "../../../lib/config";

interface InviteMemberModalProps {
    workspaceId: number;
    workspaceName: string;
    currentMembers: number[];
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function InviteMemberModal({
    workspaceId,
    workspaceName,
    currentMembers,
    isOpen,
    onClose,
    onSuccess,
}: InviteMemberModalProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<UserSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isInviting, setIsInviting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 검색
    useEffect(() => {
        const searchUsers = async () => {
            if (searchQuery.length < 2) {
                setSearchResults([]);
                return;
            }

            try {
                setIsSearching(true);
                const response = await apiClient.searchUsers(searchQuery);
                // 이미 멤버인 사람 제외
                const filteredResults = response.users.filter(
                    (user) => !currentMembers.includes(user.id)
                );
                setSearchResults(filteredResults);
            } catch (err) {
                console.error("Failed to search users:", err);
            } finally {
                setIsSearching(false);
            }
        };

        const debounceTimer = setTimeout(searchUsers, APP_CONFIG.SEARCH_DEBOUNCE_DELAY);
        return () => clearTimeout(debounceTimer);
    }, [searchQuery, currentMembers]);

    // 모달 닫을 때 초기화
    useEffect(() => {
        if (!isOpen) {
            setSearchQuery("");
            setSearchResults([]);
            setSelectedUsers([]);
            setError(null);
        }
    }, [isOpen]);

    const handleSelectUser = (user: UserSearchResult) => {
        if (selectedUsers.find((u) => u.id === user.id)) {
            setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
        } else {
            setSelectedUsers([...selectedUsers, user]);
        }
    };

    const handleInvite = async () => {
        if (selectedUsers.length === 0) return;

        try {
            setIsInviting(true);
            setError(null);
            await apiClient.addWorkspaceMembers(
                workspaceId,
                selectedUsers.map((u) => u.id)
            );
            onSuccess();
            onClose();
        } catch (err) {
            console.error("Failed to invite members:", err);
            setError("멤버 초대에 실패했습니다. 다시 시도해주세요.");
        } finally {
            setIsInviting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="px-6 py-5 border-b border-black/5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-black">멤버 초대</h2>
                            <p className="text-sm text-black/40 mt-0.5">{workspaceName}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="px-6 py-4 border-b border-black/5">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="이름 또는 이메일로 검색..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-black/[0.03] border-0 rounded-lg text-sm placeholder:text-black/30 focus:outline-none focus:ring-2 focus:ring-black/10"
                            autoFocus
                        />
                        <svg
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/30"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {isSearching && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <div className="w-4 h-4 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Selected Users */}
                {selectedUsers.length > 0 && (
                    <div className="px-6 py-3 border-b border-black/5 bg-black/[0.02]">
                        <p className="text-xs font-medium text-black/50 mb-2">
                            선택된 사용자 ({selectedUsers.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {selectedUsers.map((user) => (
                                <div
                                    key={user.id}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-black text-white rounded-full text-sm"
                                >
                                    <span>{user.nickname}</span>
                                    <button
                                        onClick={() => handleSelectUser(user)}
                                        className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Search Results */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {searchQuery.length < 2 ? (
                        <div className="text-center py-12">
                            <svg className="w-16 h-16 mx-auto mb-4 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <p className="text-black/40 text-sm">
                                이름 또는 이메일을 입력하여 사용자를 검색하세요
                            </p>
                        </div>
                    ) : searchResults.length === 0 && !isSearching ? (
                        <div className="text-center py-12">
                            <svg className="w-16 h-16 mx-auto mb-4 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                            <p className="text-black/40 text-sm">검색 결과가 없습니다</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {searchResults.map((user) => {
                                const isSelected = selectedUsers.find((u) => u.id === user.id);
                                return (
                                    <button
                                        key={user.id}
                                        onClick={() => handleSelectUser(user)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${isSelected
                                            ? "bg-black text-white"
                                            : "hover:bg-black/[0.02] text-black"
                                            }`}
                                    >
                                        {/* Avatar */}
                                        {user.profile_img ? (
                                            <img
                                                src={user.profile_img}
                                                alt={user.nickname}
                                                className="w-10 h-10 rounded-full object-cover"
                                            />
                                        ) : (
                                            <div
                                                className={`w-10 h-10 rounded-full flex items-center justify-center ${isSelected
                                                    ? "bg-white/20"
                                                    : "bg-gradient-to-br from-black/10 to-black/5"
                                                    }`}
                                            >
                                                <span
                                                    className={`text-sm font-medium ${isSelected ? "text-white" : "text-black/50"
                                                        }`}
                                                >
                                                    {user.nickname.charAt(0)}
                                                </span>
                                            </div>
                                        )}

                                        {/* Info */}
                                        <div className="flex-1 text-left min-w-0">
                                            <p className="font-medium truncate">{user.nickname}</p>
                                            <p
                                                className={`text-sm truncate ${isSelected ? "text-white/60" : "text-black/40"
                                                    }`}
                                            >
                                                {user.email}
                                            </p>
                                        </div>

                                        {/* Checkbox */}
                                        <div
                                            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isSelected
                                                ? "bg-white border-white"
                                                : "border-black/20"
                                                }`}
                                        >
                                            {isSelected && (
                                                <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Error Message */}
                {error && (
                    <div className="px-6 py-3 border-t border-red-100 bg-red-50">
                        <p className="text-sm text-red-600">{error}</p>
                    </div>
                )}

                {/* Footer */}
                <div className="px-6 py-4 border-t border-black/5 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-black/60 hover:text-black transition-colors"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleInvite}
                        disabled={selectedUsers.length === 0 || isInviting}
                        className={`px-6 py-2 text-sm font-medium rounded-lg transition-all ${selectedUsers.length > 0 && !isInviting
                            ? "bg-black text-white hover:bg-black/80"
                            : "bg-black/10 text-black/30 cursor-not-allowed"
                            }`}
                    >
                        {isInviting ? (
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>초대 중...</span>
                            </div>
                        ) : (
                            `${selectedUsers.length}명 초대하기`
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
