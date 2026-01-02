import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../app/lib/auth-context";
import { usePresence } from "../app/contexts/presence-context";
import StatusIndicator from "./StatusIndicator";

interface GlobalUserProfileMenuProps {
    onClose: () => void;
    onEditProfile: () => void;
    onLogout: () => void;
}

export default function GlobalUserProfileMenu({ onClose, onEditProfile, onLogout }: GlobalUserProfileMenuProps) {
    const { user } = useAuth();
    const { updateStatus, updateCustomStatus, presenceMap } = usePresence();
    const [isEditingStatus, setIsEditingStatus] = useState(false);
    const [statusText, setStatusText] = useState("");
    const [statusEmoji, setStatusEmoji] = useState("💬");

    // 내 상태 가져오기
    const myPresence = user ? presenceMap[user.id] : null;
    const currentStatus = myPresence?.status || user?.default_status || "online";

    const handleStatusChange = (status: string) => {
        updateStatus(status);
    };

    const handleSaveCustomStatus = (e: React.FormEvent) => {
        e.preventDefault();
        updateCustomStatus(statusText, statusEmoji);
        setIsEditingStatus(false);
    };

    return (
        <>
            <div
                className="fixed inset-0 z-10"
                onClick={onClose}
            />
            <div className="absolute right-0 mt-2 w-72 bg-white border border-black/10 shadow-lg z-20 rounded-md overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                {/* User Info */}
                <div className="p-4 border-b border-black/5 bg-black/[0.02]">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="relative">
                            {user?.profileImg ? (
                                <img
                                    src={user.profileImg}
                                    alt={user?.nickname}
                                    className="w-12 h-12 rounded-full object-cover border border-black/10"
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
                                className="absolute bottom-0 right-0 ring-2 ring-white"
                            />
                        </div>
                        <div className="overflow-hidden">
                            <p className="font-bold text-black truncate">{user?.nickname}</p>
                            <p className="text-xs text-black/50 truncate">{user?.email}</p>
                        </div>
                    </div>

                    {/* Custom Status Section - V3 Card UI */}
                    <div className="px-4 pb-4 border-b border-black/5">
                        {isEditingStatus ? (
                            <form onSubmit={handleSaveCustomStatus} className="bg-black/[0.03] p-3 rounded-lg border border-black/5 animate-in fade-in zoom-in-95 duration-200">
                                <p className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-2">상태 설정</p>

                                {/* Emoji Presets */}
                                <div className="grid grid-cols-6 gap-2 mb-3">
                                    {EMOJI_PRESETS.map((emoji) => (
                                        <button
                                            key={emoji}
                                            type="button"
                                            onClick={() => setStatusEmoji(emoji)}
                                            className={`w-7 h-7 flex items-center justify-center rounded-md transition-all text-base ${statusEmoji === emoji ? "bg-white shadow-sm ring-1 ring-black/10" : "hover:bg-white/50"}`}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>

                                {/* Inputs */}
                                <div className="flex gap-2 mb-3">
                                    <input
                                        type="text"
                                        value={statusEmoji}
                                        onChange={(e) => setStatusEmoji(e.target.value)}
                                        className="w-10 p-2 text-center bg-white border border-black/10 rounded-md text-lg focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black/20 transition-all shadow-sm"
                                        placeholder="😀"
                                        maxLength={2}
                                    />
                                    <input
                                        type="text"
                                        value={statusText}
                                        onChange={(e) => setStatusText(e.target.value)}
                                        className="flex-1 p-2 bg-white border border-black/10 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black/20 transition-all shadow-sm placeholder:text-black/30"
                                        placeholder="무슨 생각을 하고 계신가요?"
                                        maxLength={30}
                                        autoFocus
                                    />
                                </div>

                                {/* Actions */}
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingStatus(false)}
                                        className="px-3 py-1.5 text-xs font-medium text-black/60 hover:text-black hover:bg-black/5 rounded-md transition-colors"
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-3 py-1.5 text-xs font-medium bg-black text-white rounded-md hover:bg-black/80 shadow-sm transition-all active:scale-95"
                                    >
                                        저장하기
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <button
                                onClick={() => {
                                    setIsEditingStatus(true);
                                    setStatusText(myPresence?.custom_status_text || "");
                                    setStatusEmoji(myPresence?.custom_status_emoji || "💬");
                                }}
                                className="w-full group"
                            >
                                {(myPresence?.custom_status_text || myPresence?.custom_status_emoji) ? (
                                    <div className="relative overflow-hidden bg-white border border-black/10 p-3 rounded-xl shadow-sm hover:shadow-md hover:border-black/20 transition-all duration-300 text-left">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-black/5 group-hover:bg-black/10 transition-colors" />
                                        <div className="pl-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2.5 overflow-hidden">
                                                <span className="text-2xl filter drop-shadow-sm group-hover:scale-110 transition-transform duration-300">
                                                    {myPresence.custom_status_emoji || "💬"}
                                                </span>
                                                <span className="font-medium text-black/80 truncate text-sm">
                                                    {myPresence.custom_status_text || "상태 메시지 없음"}
                                                </span>
                                            </div>
                                            <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center text-black/40 group-hover:bg-black/10 group-hover:text-black transition-all">
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-full py-3 border border-dashed border-black/20 rounded-xl flex items-center justify-center gap-2 text-sm text-black/40 hover:text-black hover:border-black/40 hover:bg-black/[0.02] transition-all duration-300">
                                        <span className="text-lg">💬</span>
                                        <span>상태 메시지 설정하기</span>
                                    </div>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* Status Selection */}
                <div className="p-2 border-b border-black/5">
                    <p className="px-2 py-1.5 text-[10px] font-bold text-black/40 uppercase tracking-wider">상태 설정</p>
                    {[
                        { id: "online", label: "온라인", color: "bg-green-500" },
                        { id: "idle", label: "자리 비움", color: "bg-yellow-500" },
                        { id: "dnd", label: "방해 금지", color: "bg-red-500" },
                        { id: "offline", label: "오프라인 표시", color: "bg-gray-400" },
                    ].map((item) => (
                        <button
                            key={item.id}
                            onClick={() => handleStatusChange(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded hover:bg-black/5 transition-colors ${currentStatus === item.id ? "bg-black/[0.04]" : ""}`}
                        >
                            <span className={`w-2.5 h-2.5 rounded-full ${item.color} ring-1 ring-black/5`} />
                            <span className="text-black/80 font-medium">{item.label}</span>
                            {currentStatus === item.id && (
                                <svg className="w-4 h-4 text-black/60 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                            onClose();
                            onEditProfile();
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5 rounded transition-colors flex items-center gap-2.5"
                    >
                        <svg className="w-4 h-4 text-black/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        프로필 및 상태 메시지 수정
                    </button>
                    <button
                        onClick={onLogout}
                        className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 rounded transition-colors flex items-center gap-2.5"
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

const EMOJI_PRESETS = ["💬", "🕐", "🍔", "📅", "🌴", "🤒", "😀", "😂", "😎", "😴", "🎮", "💻"];
