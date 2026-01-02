"use client";

import { useState, useEffect, use, useRef } from "react";
import { apiClient, Role, Workspace } from "../../../lib/api";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";

const PRESET_COLORS = [
    { label: "Gray", value: "#6B7280" },
    { label: "Red", value: "#EF4444" },
    { label: "Orange", value: "#F97316" },
    { label: "Yellow", value: "#EAB308" },
    { label: "Green", value: "#22C55E" },
    { label: "Blue", value: "#3B82F6" },
    { label: "Indigo", value: "#6366F1" },
    { label: "Purple", value: "#A855F7" },
    { label: "Pink", value: "#EC4899" },
];

const PERMISSIONS = [
    { code: "ADMIN", label: "관리자 (Admin)", description: "워크스페이스의 모든 권한을 가집니다. (워크스페이스 삭제 포함)" },
    { code: "MANAGE_ROLES", label: "역할 수정", description: "설정 버튼 접근, 역할 생성/수정, 멤버에게 역할을 부여할 수 있습니다." },
    { code: "MANAGE_MEMBERS", label: "멤버 관리", description: "멤버를 초대하거나 추방할 수 있습니다." },
    { code: "MANAGE_CHANNELS", label: "채널 관리", description: "새로운 채팅/음성 채널을 생성하고 수정할 수 있습니다." },
    { code: "SEND_MESSAGES", label: "채팅 입력", description: "채팅방에 메시지를 입력할 수 있습니다. (없으면 읽기 전용)" },
    { code: "CONNECT_MEDIA", label: "영통 참여", description: "음성/화상 통화에 참여할 수 있습니다." },
];

// Notification Component
interface NotificationProps {
    message: string;
    type: "success" | "error";
    onClose: () => void;
}

function Notification({ message, type, onClose }: NotificationProps) {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-fade-in-down">
            <div className={`flex items-center gap-3 px-6 py-3 rounded-full shadow-lg border ${type === "success"
                ? "bg-white border-green-500/20 text-green-800"
                : "bg-white border-red-500/20 text-red-800"
                }`}>
                {type === "success" ? (
                    <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                ) : (
                    <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                )}
                <span className="text-sm font-medium pr-2">{message}</span>
            </div>
        </div>
    );
}

export default function WorkspaceSettingsPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const { id } = use(params);
    const workspaceId = parseInt(id);
    const { user } = useAuth();

    const [activeTab, setActiveTab] = useState<"general" | "roles" | "members">("general");
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // General Tab State
    const [name, setName] = useState("");
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Unified Role Form State
    const [roles, setRoles] = useState<Role[]>([]);
    const [isLoadingRoles, setIsLoadingRoles] = useState(false);
    const [isSubmittingRole, setIsSubmittingRole] = useState(false);

    const [editingRoleId, setEditingRoleId] = useState<number | null>(null); // null = Create Mode
    const [formRoleName, setFormRoleName] = useState("");
    const [formRoleColor, setFormRoleColor] = useState(PRESET_COLORS[0].value);
    const [formRolePermissions, setFormRolePermissions] = useState<string[]>(["SEND_MESSAGES", "CONNECT_MEDIA"]);

    // Notification State
    const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

    const showNotification = (message: string, type: "success" | "error" = "success") => {
        setNotification({ message, type });
    };

    useEffect(() => {
        loadWorkspace();
    }, [workspaceId]);

    useEffect(() => {
        if (activeTab === "roles") {
            loadRoles();
        }
    }, [activeTab]);

    const loadWorkspace = async () => {
        try {
            const data = await apiClient.getWorkspace(workspaceId);
            setWorkspace(data);
            setName(data.name);
        } catch (error) {
            console.error("Failed to load workspace:", error);
            showNotification("워크스페이스 정보를 불러오는데 실패했습니다.", "error");
            router.push(`/workspace/${workspaceId}`); // 실패 시 메인으로 복귀
        } finally {
            setIsLoading(false);
        }
    };

    const loadRoles = async () => {
        setIsLoadingRoles(true);
        try {
            const data = await apiClient.getRoles(workspaceId);
            setRoles(data);
        } catch (error) {
            console.error("Failed to load roles:", error);
        } finally {
            setIsLoadingRoles(false);
        }
    };

    const handleUpdateWorkspace = async () => {
        if (!name.trim() || isUpdating) return;

        try {
            setIsUpdating(true);
            await apiClient.updateWorkspace(workspaceId, name.trim());
            showNotification("워크스페이스 정보가 수정되었습니다.");
            loadWorkspace(); // 정보 갱신
        } catch (error) {
            console.error("Failed to update workspace:", error);
            showNotification("워크스페이스 수정에 실패했습니다.", "error");
        } finally {
            setIsUpdating(false);
        }
    };

    // Use ref to prevent double-submit across renders
    const isDeletingRef = useRef(false);

    const handleDeleteWorkspace = async () => {
        if (isDeletingRef.current || isDeleting) return;

        try {
            isDeletingRef.current = true;
            setIsDeleting(true);
            await apiClient.deleteWorkspace(workspaceId);
            router.push("/workspace");
        } catch (error: any) { // Type assertion for safer access
            // If already deleted (404), consider it a success and redirect
            if (error.message?.includes('Request failed') && error.message?.includes('not found')) {
                router.push("/workspace");
                return;
            }
            // Or simpler check if we trust the "workspace not found" string
            if (error.message === 'Request failed' || error.message?.includes('not found')) {
                // Double check if it's actually 404 logic from ApiClient?
                // ApiClient throws "Request failed" or custom error.
                // Let's rely on the user report "workspace not found"
                router.push("/workspace");
                return;
            }

            console.error("Failed to delete workspace:", error);
            showNotification("워크스페이스 삭제에 실패했습니다.", "error");
            setIsDeleting(false);
            isDeletingRef.current = false;
        }
    };

    // Roles Operations
    const resetForm = () => {
        setEditingRoleId(null);
        setFormRoleName("");
        setFormRoleColor(PRESET_COLORS[0].value);
        setFormRolePermissions(["SEND_MESSAGES", "CONNECT_MEDIA"]);
    };

    const handleCreateRole = async () => {
        if (!formRoleName.trim() || isSubmittingRole) return;

        try {
            setIsSubmittingRole(true);
            const newRole = await apiClient.createRole(
                workspaceId,
                formRoleName.trim(),
                formRoleColor,
                formRolePermissions
            );
            setRoles((prev) => [...prev, newRole]);
            resetForm();
            showNotification("새로운 역할이 생성되었습니다.");
        } catch (error) {
            console.error("Failed to create role:", error);
            showNotification("역할 생성에 실패했습니다.", "error");
        } finally {
            setIsSubmittingRole(false);
        }
    };

    const startEditingRole = (role: Role) => {
        setEditingRoleId(role.id);
        setFormRoleName(role.name);
        setFormRoleColor(role.color || PRESET_COLORS[0].value);
        setFormRolePermissions(role.permissions?.map(p => p.permission_code) || []);

        // Scroll to top to show form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelEditing = () => {
        resetForm();
    };

    const handleUpdateRole = async () => {
        if (!editingRoleId || !formRoleName.trim()) return;

        try {
            setIsSubmittingRole(true);
            const updatedRole = await apiClient.updateRole(
                workspaceId,
                editingRoleId,
                formRoleName.trim(),
                formRoleColor,
                formRolePermissions
            );
            setRoles((prev) =>
                prev.map((r) => (r.id === editingRoleId ? updatedRole : r))
            );
            resetForm();
            showNotification("역할이 수정되었습니다.");
        } catch (error) {
            console.error("Failed to update role:", error);
            showNotification("역할 수정에 실패했습니다.", "error");
        } finally {
            setIsSubmittingRole(false);
        }
    };

    const handleDeleteRole = async (roleId: number) => {
        if (!confirm("이 역할을 삭제하시겠습니까? 해당 역할을 가진 멤버들은 역할이 해제됩니다.")) return;

        try {
            await apiClient.deleteRole(workspaceId, roleId);
            setRoles((prev) => prev.filter((r) => r.id !== roleId));
            showNotification("역할이 삭제되었습니다.");
        } catch (error) {
            console.error("Failed to delete role:", error);
            showNotification("역할 삭제에 실패했습니다.", "error");
        }
    };

    const handleUpdateMemberRole = async (userId: number, roleId: number) => {
        try {
            await apiClient.updateMemberRole(workspaceId, userId, roleId);
            // 로컬 상태 업데이트
            setWorkspace(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    members: prev.members?.map(m =>
                        m.user_id === userId ? { ...m, role_id: roleId } : m
                    )
                };
            });
            showNotification("멤버 역할이 변경되었습니다.");
        } catch (error) {
            console.error("Failed to update member role:", error);
            showNotification("멤버 역할 변경에 실패했습니다.", "error");
        }
    };

    const toggleFormPermission = (code: string) => {
        setFormRolePermissions(prev =>
            prev.includes(code) ? prev.filter(p => p !== code) : [...prev, code]
        );
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-stone-50">
                <div className="text-black/40">Loading settings...</div>
            </div>
        );
    }

    return (
        <div className="h-screen overflow-y-auto bg-stone-50 relative">
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}
            {/* Header */}
            <div className="h-16 bg-white border-b border-black/5 flex items-center justify-between px-6 sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push(`/workspace/${workspaceId}`)}
                        className="p-2 -ml-2 text-black/40 hover:text-black hover:bg-black/5 rounded-full transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="h-4 w-px bg-black/10"></div>
                    <h1 className="text-lg font-bold text-black flex items-center gap-2">
                        설정
                        <span className="text-sm font-normal text-black/40">
                            {workspace?.name}
                        </span>
                    </h1>
                </div>
            </div>

            <div className="max-w-6xl mx-auto p-6 md:p-8 flex flex-col md:flex-row gap-8">
                {/* Sidebar Navigation */}
                <nav className="w-full md:w-64 flex-shrink-0 space-y-1">
                    <button
                        onClick={() => setActiveTab("general")}
                        className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === "general"
                            ? "bg-white text-black shadow-sm ring-1 ring-black/5"
                            : "text-black/60 hover:bg-black/5 hover:text-black"
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            일반
                        </div>
                    </button>
                    <button
                        onClick={() => setActiveTab("roles")}
                        className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === "roles"
                            ? "bg-white text-black shadow-sm ring-1 ring-black/5"
                            : "text-black/60 hover:bg-black/5 hover:text-black"
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                            역할 관리
                        </div>
                    </button>
                    <button
                        onClick={() => setActiveTab("members")}
                        className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === "members"
                            ? "bg-white text-black shadow-sm ring-1 ring-black/5"
                            : "text-black/60 hover:bg-black/5 hover:text-black"
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                            멤버 관리
                        </div>
                    </button>
                </nav>

                {/* content Area */}
                <div className="flex-1 min-w-0">
                    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 md:p-8">
                        {activeTab === "general" ? (
                            <div className="space-y-10 animate-fade-in">
                                {/* Workspace Name */}
                                <section className="space-y-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-black mb-1">워크스페이스 이름</h3>
                                        <p className="text-sm text-black/40">워크스페이스의 이름을 변경하면 보이는 모든 곳에 즉시 반영됩니다.</p>
                                    </div>
                                    <div className="flex gap-3 max-w-xl">
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="flex-1 px-4 py-2 text-sm text-black bg-stone-50 border border-black/10 rounded-xl focus:border-black/30 focus:outline-none transition-colors"
                                            placeholder="워크스페이스 이름"
                                        />
                                        <button
                                            onClick={handleUpdateWorkspace}
                                            disabled={isUpdating || !name.trim() || name === workspace?.name}
                                            className="px-6 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-black/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                                        >
                                            {isUpdating ? "저장 중..." : "저장"}
                                        </button>
                                    </div>
                                </section>

                                <hr className="border-black/5" />

                                {/* Danger Zone */}
                                {user?.id === workspace?.owner_id && (
                                    <section className="space-y-4">
                                        <div>
                                            <h3 className="text-lg font-bold text-red-600 mb-1">Danger Zone</h3>
                                            <p className="text-sm text-black/40">워크스페이스를 삭제하면 모든 파일, 채팅, 설정이 영구적으로 삭제되며 되돌릴 수 없습니다.</p>
                                        </div>

                                        {!showDeleteConfirm ? (
                                            <button
                                                onClick={() => setShowDeleteConfirm(true)}
                                                className="px-6 py-3 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100 transition-colors border border-red-200"
                                            >
                                                워크스페이스 삭제
                                            </button>
                                        ) : (
                                            <div className="bg-red-50 border border-red-100 rounded-xl p-6 space-y-4 max-w-xl">
                                                <div className="flex gap-3 text-red-800">
                                                    <svg className="w-6 h-6 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                    </svg>
                                                    <div>
                                                        <p className="font-bold">정말로 삭제하시겠습니까?</p>
                                                        <p className="text-sm opacity-80 mt-1">이 작업은 되돌릴 수 없으며, 워크스페이스에 속한 모든 데이터가 제거됩니다.</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-3 pt-2">
                                                    <button
                                                        onClick={handleDeleteWorkspace}
                                                        disabled={isDeleting}
                                                        className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                                                    >
                                                        {isDeleting ? "삭제 중..." : "네, 영구적으로 삭제합니다"}
                                                    </button>
                                                    <button
                                                        onClick={() => setShowDeleteConfirm(false)}
                                                        disabled={isDeleting}
                                                        className="px-4 py-2 bg-white text-black/70 text-sm font-medium rounded-lg hover:bg-black/5 transition-colors border border-black/10"
                                                    >
                                                        취소
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </section>
                                )}
                            </div>
                        ) : activeTab === "roles" ? (
                            <div className="space-y-8 animate-fade-in">
                                {/* Roles Header */}
                                <section className="space-y-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-black mb-1">역할 관리</h3>
                                        <p className="text-sm text-black/40">워크스페이스 멤버들에게 부여할 역할을 생성하고 관리합니다.</p>
                                    </div>

                                    {/* Unified Role Form */}
                                    <div className={`bg-stone-50 border border-black/5 rounded-xl p-5 flex flex-col gap-4 ${editingRoleId ? 'ring-2 ring-black/5 bg-white' : ''}`}>
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-bold text-black/50 uppercase tracking-wider">
                                                {editingRoleId ? "역할 수정" : "새 역할 만들기"}
                                            </p>
                                            {editingRoleId && (
                                                <span className="text-xs text-black/40 font-medium px-2 py-1 bg-black/5 rounded">
                                                    편집 모드
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-col gap-4">
                                            <div className="space-y-2">
                                                <label className="text-xs font-semibold text-black/60">역할 색상</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {PRESET_COLORS.map(c => (
                                                        <button
                                                            key={c.value}
                                                            onClick={() => setFormRoleColor(c.value)}
                                                            className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center ${formRoleColor === c.value ? 'border-black scale-110' : 'border-transparent hover:scale-110'}`}
                                                            style={{ backgroundColor: c.value }}
                                                            title={c.label}
                                                        >
                                                            {formRoleColor === c.value && (
                                                                <svg className="w-4 h-4 text-white drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* 권한 설정 */}
                                            <div className="space-y-3">
                                                <label className="text-xs font-semibold text-black/60">권한 설정</label>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {PERMISSIONS.map(permission => (
                                                        <button
                                                            key={permission.code}
                                                            onClick={() => toggleFormPermission(permission.code)}
                                                            className={`text-left p-3 rounded-xl border transition-all ${formRolePermissions.includes(permission.code)
                                                                ? "bg-black text-white border-black shadow-md ring-2 ring-black/20"
                                                                : "bg-white text-black/60 border-black/5 hover:bg-stone-100 hover:border-black/10"
                                                                }`}
                                                        >
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className="text-sm font-bold">{permission.label}</span>
                                                                {formRolePermissions.includes(permission.code) && (
                                                                    <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                                    </svg>
                                                                )}
                                                            </div>
                                                            <p className={`text-xs ${formRolePermissions.includes(permission.code) ? "text-white/60" : "text-black/40"}`}>
                                                                {permission.description}
                                                            </p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex gap-3">
                                                <input
                                                    type="text"
                                                    value={formRoleName}
                                                    onChange={(e) => setFormRoleName(e.target.value)}
                                                    placeholder="역할 이름 (예: 디자이너, PM)"
                                                    className="flex-1 px-4 py-2 text-sm text-black bg-white border border-black/10 rounded-xl focus:border-black/30 focus:outline-none"
                                                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (editingRoleId ? handleUpdateRole() : handleCreateRole())}
                                                />
                                                {editingRoleId ? (
                                                    <>
                                                        <button
                                                            onClick={handleUpdateRole}
                                                            disabled={!formRoleName.trim() || isSubmittingRole}
                                                            className="px-6 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-black/80 transition-colors disabled:opacity-30 whitespace-nowrap"
                                                        >
                                                            {isSubmittingRole ? "수정 중" : "수정하기"}
                                                        </button>
                                                        <button
                                                            onClick={cancelEditing}
                                                            disabled={isSubmittingRole}
                                                            className="px-6 py-2 bg-stone-200 text-black/60 text-sm font-medium rounded-xl hover:bg-stone-300 transition-colors disabled:opacity-50 whitespace-nowrap"
                                                        >
                                                            취소
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={handleCreateRole}
                                                        disabled={!formRoleName.trim() || isSubmittingRole}
                                                        className="px-6 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-black/80 transition-colors disabled:opacity-30 whitespace-nowrap"
                                                    >
                                                        {isSubmittingRole ? "생성 중" : "추가하기"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <hr className="border-black/5" />

                                {/* Roles List */}
                                <div>
                                    <h4 className="text-sm font-bold text-black mb-3">역할 목록</h4>
                                    <div className="space-y-2">
                                        {isLoadingRoles ? (
                                            <div className="text-center py-12 text-black/40 text-sm">로딩 중...</div>
                                        ) : roles.length === 0 ? (
                                            <div className="text-center py-12 text-black/40 text-sm bg-stone-50 rounded-xl border border-black/5 dashed">
                                                등록된 역할이 없습니다. 위의 폼을 이용해 첫 번째 역할을 만들어보세요!
                                            </div>
                                        ) : (
                                            roles.map(role => (
                                                <div
                                                    key={role.id}
                                                    className={`group flex items-center justify-between p-4 border rounded-xl transition-all ${editingRoleId === role.id ? "bg-black/5 border-black/10 shadow-inner" : "bg-white border-black/5 hover:border-black/20 hover:shadow-sm"}`}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div
                                                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold shadow-sm"
                                                            style={{ backgroundColor: role.color || '#999' }}
                                                        >
                                                            {role.name.charAt(0)}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-base font-medium text-black flex items-center gap-2">
                                                                {role.name}
                                                                <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[10px] uppercase font-bold tracking-wider">
                                                                    {role.permissions?.length || 0} PERMS
                                                                </span>
                                                                {editingRoleId === role.id && (
                                                                    <span className="text-xs text-blue-600 font-bold animate-pulse">
                                                                        수정 중...
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="text-xs text-black/40 line-clamp-1">
                                                                {role.permissions && role.permissions.length > 0
                                                                    ? role.permissions.map(p => PERMISSIONS.find(def => def.code === p.permission_code)?.label).filter(Boolean).join(", ")
                                                                    : "권한 없음"}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className={`flex items-center gap-2 transition-opacity ${editingRoleId === role.id ? "opacity-30 grayscale pointer-events-none" : "opacity-0 group-hover:opacity-100"}`}>
                                                        <button
                                                            onClick={() => startEditingRole(role)}
                                                            className="px-3 py-1.5 text-sm font-medium text-black/60 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                                                        >
                                                            수정
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteRole(role.id)}
                                                            className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                                        >
                                                            삭제
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-8 animate-fade-in">
                                {/* Members List */}
                                <section className="space-y-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-black mb-1">멤버 관리</h3>
                                        <p className="text-sm text-black/40">워크스페이스에 참여 중인 멤버들과 그들의 역할을 관리합니다.</p>
                                    </div>

                                    <div className="space-y-2">
                                        {!workspace?.members || workspace.members.length === 0 ? (
                                            <div className="text-center py-12 text-black/40 text-sm">멤버가 없습니다.</div>
                                        ) : (
                                            workspace.members.map(member => (
                                                <div key={member.id} className="flex items-center justify-between p-4 bg-white border border-black/5 rounded-xl hover:shadow-sm transition-all">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-stone-200 overflow-hidden flex-shrink-0">
                                                            {member.user?.profile_img ? (
                                                                <img src={member.user.profile_img} alt={member.user.nickname} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-stone-500 font-bold">
                                                                    {member.user?.nickname?.charAt(0) || "?"}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-bold text-black">{member.user?.nickname}</span>
                                                                {workspace.owner_id === member.user_id && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">OWNER</span>
                                                                )}
                                                            </div>
                                                            <span className="text-xs text-black/40">{member.user?.email}</span>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        {workspace.owner_id === member.user_id ? (
                                                            <div className="px-3 py-1.5 text-xs font-bold text-black/40 bg-stone-100 rounded-lg">
                                                                변경 불가
                                                            </div>
                                                        ) : (
                                                            <select
                                                                value={member.role_id || ""}
                                                                onChange={(e) => handleUpdateMemberRole(member.user_id, parseInt(e.target.value))}
                                                                className="px-3 py-1.5 text-sm bg-white border border-black/10 rounded-lg focus:outline-none focus:border-black/30 cursor-pointer"
                                                            >
                                                                <option value="" disabled>역할 선택</option>
                                                                {roles.map(role => (
                                                                    <option key={role.id} value={role.id}>
                                                                        {role.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </section>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
