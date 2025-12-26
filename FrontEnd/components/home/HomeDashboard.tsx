import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { 
    Dialog, DialogContent, DialogDescription, DialogFooter, 
    DialogHeader, DialogTitle
} from '../ui/dialog';
import { 
    Users, Plus, Settings, MoreHorizontal, ArrowRight, Folder, X,
    Check, FolderPlus, Bell, Copy, Lock
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DashboardItem, Workspace, WorkspaceFolder } from '../../types/workspace';
import { UserProfile } from '../../types/user';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

const PRESET_BG_IMAGES = [
    "https://images.unsplash.com/photo-1732928605963-e2fc26b1872a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", // Abstract
    "https://images.unsplash.com/photo-1758208974170-3a3037da0c69?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", // Office
    "https://images.unsplash.com/photo-1670834416065-5b4419def835?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", // Geometric
    "https://images.unsplash.com/photo-1595433306946-233f47e4af3a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", // Nature
];

// --- Props ---
interface HomeDashboardProps {
    items: DashboardItem[];
    userProfile: UserProfile | null;
    onUpdateItems: (items: DashboardItem[]) => void;
    onLogout: () => void;
    onEnterWorkspace: (workspace: Workspace) => void;
    // New prop for global profile handling
    onOpenProfile: (user?: UserProfile) => void;
}

const ITEM_TYPE = 'DASHBOARD_ITEM';

// --- Component ---
export function HomeDashboard({ items, userProfile, onUpdateItems, onLogout, onEnterWorkspace, onOpenProfile }: HomeDashboardProps) {
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    // Workspace Edit State
    const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    
    // Join & Notification States
    const [joinDialogOpen, setJoinDialogOpen] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [notificationsOpen, setNotificationsOpen] = useState(false);

    // Folder Creation/Edit States
    const [folderDialogOpen, setFolderDialogOpen] = useState(false);
    const [activeFolder, setActiveFolder] = useState<WorkspaceFolder | null>(null);
    const [pendingFolderMerge, setPendingFolderMerge] = useState<{ source: Workspace, target: Workspace } | null>(null);
    const [newFolderName, setNewFolderName] = useState('');

    // Workspace Creation States
    const [newWsName, setNewWsName] = useState('');
    const [selectedBg, setSelectedBg] = useState<string | null>(null);
    const [participationType, setParticipationType] = useState<'open' | 'approval'>('open');

    // Derived notifications
    const notifications = React.useMemo(() => {
        const notifs: { wsId: string, wsName: string, req: any }[] = [];
        const scan = (list: DashboardItem[]) => {
            list.forEach(item => {
                if (item.isFolder) {
                    scan(item.items);
                } else {
                    if (item.pendingRequests && item.pendingRequests.length > 0) {
                        item.pendingRequests.forEach(req => {
                            notifs.push({ wsId: item.id, wsName: item.name, req });
                        });
                    }
                }
            });
        };
        scan(items);
        return notifs;
    }, [items]);

    const generateInviteCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

    const handleCreateWorkspace = () => {
        if (!newWsName.trim()) return;
        
        // Random gradient
        const colors = [
            'from-indigo-500 to-purple-600',
            'from-pink-500 to-rose-600', 
            'from-blue-500 to-cyan-600',
            'from-emerald-500 to-teal-600',
            'from-orange-500 to-amber-600'
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        const newWs: Workspace = {
            id: `ws-${Date.now()}`,
            name: newWsName,
            type: participationType === 'open' ? 'Team' : 'Project',
            members: 1, 
            lastActive: 'Just now',
            isFolder: false,
            avatarColor: randomColor,
            backgroundImageUrl: selectedBg || undefined,
            inviteCode: generateInviteCode(),
            participationType,
            pendingRequests: []
        };
        onUpdateItems([...items, newWs]);
        setNewWsName('');
        setSelectedBg(null);
        setIsCreateOpen(false);
        onEnterWorkspace(newWs);
    };

    const handleJoinSubmit = () => {
        const code = joinCode.trim().toUpperCase();
        if (!code) return;

        // Find workspace (recursive search)
        let foundWs: Workspace | null = null;
        const findWs = (list: DashboardItem[]) => {
            for (const item of list) {
                if (item.isFolder) {
                    findWs(item.items);
                } else {
                    if (item.inviteCode === code) foundWs = item;
                }
            }
        };
        findWs(items);

        if (!foundWs) {
            toast.error("유효하지 않은 초대 코드입니다.");
            return;
        }

        if (foundWs.participationType === 'approval') {
             // Simulate request from a guest user
             const newRequest = { userId: `guest-${Date.now()}`, userName: 'Guest User', timestamp: Date.now() };
             const updateWs = (list: DashboardItem[]): DashboardItem[] => {
                 return list.map(item => {
                     if (item.isFolder) return { ...item, items: updateWs(item.items) };
                     if (item.id === foundWs!.id) {
                         return { 
                             ...item, 
                             pendingRequests: [...(item.pendingRequests || []), newRequest] 
                         };
                     }
                     return item;
                 });
             };
             onUpdateItems(updateWs(items));
             toast.success("참가 신청되었습니다.");
             setJoinDialogOpen(false);
             setJoinCode('');
        } else {
             // Join directly
             toast.success(`${foundWs.name} 워크스페이스에 참가했습니다!`);
             onEnterWorkspace(foundWs);
             setJoinDialogOpen(false);
             setJoinCode('');
        }
    };

    const handleAcceptRequest = (wsId: string, req: any) => {
        const updateWs = (list: DashboardItem[]): DashboardItem[] => {
             return list.map(item => {
                 if (item.isFolder) return { ...item, items: updateWs(item.items) };
                 if (item.id === wsId) {
                     return { 
                         ...item, 
                         members: item.members + 1,
                         pendingRequests: (item.pendingRequests || []).filter(r => r.userId !== req.userId)
                     };
                 }
                 return item;
             });
         };
         onUpdateItems(updateWs(items));
         toast.success("수락했습니다.");
    };

    const handleUpdateWorkspaceSettings = (updated: Workspace) => {
        const updateRecursive = (list: DashboardItem[]): DashboardItem[] => {
            return list.map(item => {
                if (item.id === updated.id) return updated;
                if (item.isFolder) {
                     return { ...item, items: updateRecursive(item.items) };
                }
                return item;
            });
        };
        
        onUpdateItems(updateRecursive(items));
        setEditingWorkspace(null);
        setEditDialogOpen(false);
        toast.success("워크스페이�� 설정이 저장되었습니다.");
    };

    const openEditDialog = (ws: Workspace) => {
        setEditingWorkspace(ws);
        setEditDialogOpen(true);
    };

    const handleMerge = (sourceId: string, targetId: string) => {
        const sourceItem = items.find(i => i.id === sourceId);
        const targetItem = items.find(i => i.id === targetId);

        if (!sourceItem || !targetItem) return;

        // Case 1: Workspace dropped on Workspace -> Create Folder
        if (!sourceItem.isFolder && !targetItem.isFolder) {
            setPendingFolderMerge({ source: sourceItem as Workspace, target: targetItem as Workspace });
            setNewFolderName('New Folder');
            setFolderDialogOpen(true);
            return;
        }

        // Case 2: Workspace dropped on Folder -> Add to Folder
        if (!sourceItem.isFolder && targetItem.isFolder) {
            const updatedFolder = {
                ...targetItem,
                items: [...(targetItem as WorkspaceFolder).items, sourceItem as Workspace]
            };
            onUpdateItems(items.map(i => i.id === targetId ? updatedFolder : i).filter(i => i.id !== sourceId));
        }
    };

    const confirmCreateFolder = () => {
        if (!pendingFolderMerge) return;
        
        const newFolder: WorkspaceFolder = {
            id: `folder-${Date.now()}`,
            name: newFolderName || 'New Folder',
            type: 'Folder',
            items: [pendingFolderMerge.target, pendingFolderMerge.source],
            isFolder: true
        };

        onUpdateItems(items.map(i => i.id === pendingFolderMerge.target.id ? newFolder : i).filter(i => i.id !== pendingFolderMerge.source.id));
        setFolderDialogOpen(false);
        setPendingFolderMerge(null);
    };

    const updateFolderName = () => {
        if (!activeFolder) return;
        const updatedFolder = { ...activeFolder, name: newFolderName };
        onUpdateItems(items.map(i => i.id === activeFolder.id ? updatedFolder : i));
        setActiveFolder(updatedFolder);
    };

    const openFolder = (folder: WorkspaceFolder) => {
        setActiveFolder(folder);
        setNewFolderName(folder.name);
        setFolderDialogOpen(true);
    };

    // Remove workspace from folder (move back to root)
    const removeFromFolder = (wsId: string) => {
        if (!activeFolder) return;
        const wsToRemove = activeFolder.items.find(i => i.id === wsId);
        if (!wsToRemove) return;

        const updatedFolderItems = activeFolder.items.filter(i => i.id !== wsId);
        
        const updatedFolder = { ...activeFolder, items: updatedFolderItems };
        
        // Update Items: Replace folder with updated one, append removed ws to root
        let newItems = items.map(i => i.id === activeFolder.id ? updatedFolder : i);
        newItems.push(wsToRemove);

        // If folder has 0 items, remove folder
        if (updatedFolderItems.length === 0) {
            newItems = newItems.filter(i => i.id !== activeFolder.id);
            setFolderDialogOpen(false); // Close dialog if folder is gone
        } else {
            setActiveFolder(updatedFolder);
        }
        
        onUpdateItems(newItems);
    };

    // Move Workspace (Reorder)
    const moveWorkspace = (dragIndex: number, hoverIndex: number) => {
        const draggedItem = items[dragIndex];
        const newItems = [...items];
        newItems.splice(dragIndex, 1);
        newItems.splice(hoverIndex, 0, draggedItem);
        onUpdateItems(newItems);
    };

    // Open Profile (My Profile)
    const openMyProfile = () => {
        onOpenProfile(); // undefined = my profile
    };

    // Open Profile (Other User)
    const openUserProfile = (userName: string) => {
        // Mock data for other user
        const mockUser: UserProfile = {
            id: 'mock-user',
            displayName: userName,
            email: 'user@example.com',
            statusMessage: 'Hello there! I am using ZoomCord.',
            avatarUrl: undefined
        };
        onOpenProfile(mockUser);
    };

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
                
                {/* ① Header (Always Fixed) */}
                <header className="h-16 bg-white border-b flex items-center justify-between px-6 sticky top-0 z-50">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
                            Z
                        </div>
                        <span className="text-lg font-bold text-slate-900 tracking-tight">ZoomCord</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" className="text-slate-500">
                            <Settings className="w-5 h-5" />
                        </Button>
                        <div className="h-8 w-px bg-slate-200" />
                        <div className="flex items-center gap-3">
                            {/* Notifications */}
                            <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" size="icon" className="relative mr-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50">
                                        <Bell className="w-5 h-5" />
                                        {notifications.length > 0 && (
                                            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-0" align="end">
                                    <div className="p-3 border-b bg-slate-50">
                                        <h4 className="font-bold text-sm text-slate-800">Notifications</h4>
                                    </div>
                                    <div className="max-h-[300px] overflow-y-auto">
                                        {notifications.length === 0 ? (
                                            <div className="p-8 text-center text-slate-400 text-sm">
                                                No new notifications
                                            </div>
                                        ) : (
                                            notifications.map((n, idx) => (
                                                <div key={idx} className="p-3 border-b last:border-0 hover:bg-slate-50 transition-colors flex gap-3 items-start">
                                                    <div 
                                                        className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs shrink-0 cursor-pointer hover:ring-2 ring-indigo-200"
                                                        onClick={(e) => { e.stopPropagation(); openUserProfile(n.req.userName); }}
                                                    >
                                                        {n.req.userName.charAt(0)}
                                                    </div>
                                                    <div className="flex-1 space-y-1">
                                                        <p className="text-sm text-slate-700">
                                                            <span className="font-bold cursor-pointer hover:underline" onClick={() => openUserProfile(n.req.userName)}>{n.req.userName}</span> wants to join <span className="font-bold text-indigo-600">{n.wsName}</span>
                                                        </p>
                                                        <div className="flex gap-2 mt-2">
                                                            <Button size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700" onClick={() => handleAcceptRequest(n.wsId, n.req)}>
                                                                Accept
                                                            </Button>
                                                            <Button size="sm" variant="outline" className="h-7 text-xs">
                                                                Ignore
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            
                            <div className="w-px h-8 bg-slate-200 mx-2" />

                            <div className="text-right hidden sm:block">
                                <div className="text-sm font-bold text-slate-900">{userProfile?.displayName || 'User'}</div>
                                <div className="text-xs text-slate-500 truncate max-w-[100px]">{userProfile?.statusMessage || 'No status'}</div>
                            </div>
                            <Avatar className="h-9 w-9 border cursor-pointer hover:ring-2 ring-indigo-100 transition-all" onClick={openMyProfile}>
                                <AvatarImage src={userProfile?.avatarUrl} className="object-cover" />
                                <AvatarFallback>{userProfile?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                            </Avatar>
                        </div>
                    </div>
                </header>

                <main className="flex-1 max-w-6xl mx-auto w-full p-6 md:p-10 flex flex-col gap-10">
                    
                    {/* Quick Actions */}
                    <section>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <QuickActionCard 
                                icon={<Plus className="w-8 h-8 text-white" />} 
                                label="Join Meeting" 
                                subLabel="Join via ID or link"
                                color="bg-indigo-500 hover:bg-indigo-600"
                                onClick={() => setJoinDialogOpen(true)}
                            />
                        </div>
                    </section>

                    {/* Workspace Section */}
                    <section className="flex-1">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-slate-900">Workspaces</h2>
                            <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>
                                <Plus className="w-4 h-4 mr-2" /> Create Workspace
                            </Button>
                        </div>

                        {items.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
                                    <Users className="w-8 h-8" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">아직 워크스페이스가 없습니다</h3>
                                <p className="text-slate-500 mb-6 text-sm">팀을 만들고 협업을 시작해보세요.</p>
                                <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => setIsCreateOpen(true)}>
                                    <Plus className="w-5 h-5 mr-2" /> 워크스페이스 생성
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                                {items.map((item, index) => (
                                    <DraggableItem 
                                        key={item.id} 
                                        index={index}
                                        item={item} 
                                        onEnter={onEnterWorkspace} 
                                        onDrop={handleMerge}
                                        onOpenFolder={openFolder}
                                        moveWorkspace={moveWorkspace}
                                        onEdit={openEditDialog}
                                    />
                                ))}

                                {/* 'Create New' Card */}
                                <div className="p-3 h-full">
                                    <button 
                                        onClick={() => setIsCreateOpen(true)}
                                        className="w-full flex flex-col items-center justify-center h-full min-h-[180px] border-2 border-dashed border-slate-200 rounded-xl hover:border-indigo-400 hover:bg-indigo-50/50 transition-all group"
                                    >
                                        <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:border-indigo-200 shadow-sm mb-3 transition-colors">
                                            <Plus className="w-6 h-6" />
                                        </div>
                                        <span className="font-bold text-slate-600 group-hover:text-indigo-700">Create Workspace</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </main>

                {/* Create Workspace Modal */}
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>워크스페이스 생성</DialogTitle>
                            <DialogDescription>
                                팀이 함께 일할 새로운 공간을 만듭니다.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-6 py-4">
                            {/* Image Selection */}
                            <div className="grid gap-2">
                                <Label className="text-slate-700 font-semibold">커버 이미지 (선택)</Label>
                                <div className="grid grid-cols-5 gap-2">
                                    <button 
                                        onClick={() => setSelectedBg(null)}
                                        className={`h-16 rounded-lg border-2 flex items-center justify-center bg-slate-100 transition-all ${!selectedBg ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}
                                    >
                                        <div className="text-xs font-bold text-slate-500">None</div>
                                    </button>
                                    {PRESET_BG_IMAGES.map((img, idx) => (
                                        <button 
                                            key={idx}
                                            onClick={() => setSelectedBg(img)}
                                            className={`h-16 rounded-lg border-2 relative overflow-hidden transition-all group ${selectedBg === img ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-transparent hover:ring-2 hover:ring-slate-200'}`}
                                        >
                                            <img src={img} className="w-full h-full object-cover" alt="Preset" />
                                            {selectedBg === img && (
                                                <div className="absolute inset-0 bg-indigo-900/40 flex items-center justify-center">
                                                    <Check className="w-5 h-5 text-white" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="name" className="text-slate-700 font-semibold flex justify-between items-center">
                                    <span>워크스페이스 이름 <span className="text-red-500">*</span></span>
                                    <span className="text-xs text-slate-400 font-normal">(최대 20글자)</span>
                                </Label>
                                <Input 
                                    id="name" 
                                    placeholder="예: Design Team" 
                                    value={newWsName}
                                    onChange={(e) => setNewWsName(e.target.value)}
                                    maxLength={20}
                                    className="h-11"
                                    autoFocus
                                />
                            </div>
                            
                            <div className="grid gap-3">
                                <Label className="text-slate-700 font-semibold">참가 설정 <span className="text-red-500">*</span></Label>
                                
                                <div 
                                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${participationType === 'open' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'}`}
                                    onClick={() => setParticipationType('open')}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${participationType === 'open' ? 'border-indigo-600' : 'border-slate-400'}`}>
                                            {participationType === 'open' && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                                        </div>
                                        <span className={`font-bold ${participationType === 'open' ? 'text-indigo-900' : 'text-slate-700'}`}>참가 자유</span>
                                    </div>
                                    <p className="text-xs text-slate-500 pl-6 leading-relaxed">
                                        링크나 코드가 있는 누구나 자유롭게 참가 가능
                                    </p>
                                </div>

                                <div 
                                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${participationType === 'approval' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'}`}
                                    onClick={() => setParticipationType('approval')}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${participationType === 'approval' ? 'border-indigo-600' : 'border-slate-400'}`}>
                                            {participationType === 'approval' && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                                        </div>
                                        <span className={`font-bold ${participationType === 'approval' ? 'text-indigo-900' : 'text-slate-700'}`}>참가 신청</span>
                                    </div>
                                    <p className="text-xs text-slate-500 pl-6 leading-relaxed">
                                        링크나 코드를 가지고 참가를 신청하면 관리자가 이를 확인하고 수락할시 참가 가능
                                    </p>
                                </div>
                            </div>

                            <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded-lg flex items-start gap-2">
                                <span className="shrink-0 mt-0.5">ℹ️</span>
                                단, 생성에 필요한 쿨타임과 횟수는 1시간 최대 1개임.
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>취소</Button>
                            <Button type="submit" onClick={handleCreateWorkspace} className="bg-indigo-600 hover:bg-indigo-700">생성</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Folder / Merge Dialog */}
                <Dialog open={folderDialogOpen} onOpenChange={(open) => {
                    if (!open) {
                        setFolderDialogOpen(false);
                        setPendingFolderMerge(null);
                        setActiveFolder(null);
                    }
                }}>
                    <DialogContent className="sm:max-w-[600px] bg-slate-50">
                        <DialogHeader>
                            <DialogTitle>
                                {pendingFolderMerge ? 'Create New Folder' : 'Folder Settings'}
                            </DialogTitle>
                            <DialogDescription>
                                {pendingFolderMerge ? '새 폴더의 이름을 입력해주세요.' : '폴더 이름과 내용을 관리합니다.'}
                            </DialogDescription>
                        </DialogHeader>
                        
                        <div className="py-4">
                            <Label className="mb-2 block font-semibold text-slate-700">Folder Name</Label>
                            <div className="flex gap-2">
                                <Input 
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    placeholder="Enter folder name..."
                                    className="bg-white"
                                />
                                {!pendingFolderMerge && (
                                    <Button onClick={updateFolderName} variant="outline">Update</Button>
                                )}
                            </div>
                        </div>

                        <div className="mt-4">
                            <Label className="mb-3 block font-semibold text-slate-700">Workspaces in this folder</Label>
                            <div className="grid grid-cols-2 gap-4">
                                {pendingFolderMerge ? (
                                    <>
                                        <WorkspacePreviewCard ws={pendingFolderMerge.target} />
                                        <WorkspacePreviewCard ws={pendingFolderMerge.source} />
                                    </>
                                ) : (
                                    activeFolder?.items.map(ws => (
                                        <WorkspacePreviewCard 
                                            key={ws.id} 
                                            ws={ws} 
                                            onRemove={() => removeFromFolder(ws.id)}
                                            onEnter={() => onEnterWorkspace(ws)}
                                        />
                                    ))
                                )}
                            </div>
                        </div>

                        <DialogFooter className="mt-6">
                            {pendingFolderMerge ? (
                                <>
                                    <Button variant="ghost" onClick={() => setFolderDialogOpen(false)}>Cancel</Button>
                                    <Button onClick={confirmCreateFolder} className="bg-indigo-600 text-white">Create Folder</Button>
                                </>
                            ) : (
                                <Button onClick={() => setFolderDialogOpen(false)}>Close</Button>
                            )}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Join Workspace Dialog */}
                <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
                    <DialogContent className="sm:max-w-[400px]">
                        <DialogHeader>
                            <DialogTitle>Join Meeting / Workspace</DialogTitle>
                            <DialogDescription>
                                Enter the invite code or ID shared with you.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="joinCode">Invite Code</Label>
                                <Input 
                                    id="joinCode" 
                                    placeholder="코드를 입력하세요." 
                                    value={joinCode}
                                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                                    maxLength={10}
                                    className="uppercase font-mono text-center tracking-widest text-lg"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setJoinDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleJoinSubmit} className="bg-indigo-600 hover:bg-indigo-700">
                                Join Now
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <WorkspaceSettingsDialog 
                    open={editDialogOpen} 
                    onOpenChange={setEditDialogOpen} 
                    workspace={editingWorkspace} 
                    onUpdate={handleUpdateWorkspaceSettings}
                />

            </div>
        </DndProvider>
    );
}

// --- Sub Components ---

// Draggable Workspace Item
function DraggableItem({ item, index, onEnter, onDrop, onOpenFolder, moveWorkspace, onEdit }: { 
    item: DashboardItem, 
    index: number,
    onEnter: (ws: Workspace) => void,
    onDrop: (sourceId: string, targetId: string) => void,
    onOpenFolder: (folder: WorkspaceFolder) => void,
    moveWorkspace: (dragIndex: number, hoverIndex: number) => void,
    onEdit: (ws: Workspace) => void
}) {
    const ref = React.useRef<HTMLDivElement>(null);
    const sortTimer = React.useRef<any>(null);
    const [isMergeTarget, setIsMergeTarget] = React.useState(false);

    const [{ isDragging }, drag] = useDrag({
        type: ITEM_TYPE,
        item: () => {
            return { id: item.id, index };
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
    }, [item.id, index]);

    const [{ isOver }, drop] = useDrop({
        accept: ITEM_TYPE,
        collect(monitor) {
            return {
                isOver: monitor.isOver()
            };
        },
        hover(draggedItem: { id: string, index: number }, monitor) {
            if (!ref.current) return;
            const dragIndex = draggedItem.index;
            const hoverIndex = index;

            if (dragIndex === hoverIndex) {
                 setIsMergeTarget(false);
                 return;
            }

            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
            const hoverMiddleX = (hoverBoundingRect.right - hoverBoundingRect.left) / 2;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            const hoverClientY = clientOffset.y - hoverBoundingRect.top;
            const hoverClientX = clientOffset.x - hoverBoundingRect.left;

            const isMergeZone = 
                hoverClientX > hoverMiddleX * 0.5 && hoverClientX < hoverMiddleX * 1.5 &&
                hoverClientY > hoverMiddleY * 0.5 && hoverClientY < hoverMiddleY * 1.5;

            if (isMergeZone) {
                if (sortTimer.current) {
                    clearTimeout(sortTimer.current);
                    sortTimer.current = null;
                }
                setIsMergeTarget(true);
                return;
            }
            
            setIsMergeTarget(false);

            if (!sortTimer.current) {
                sortTimer.current = setTimeout(() => {
                    moveWorkspace(dragIndex, hoverIndex);
                    draggedItem.index = hoverIndex;
                    sortTimer.current = null;
                }, 200); 
            }
        },
        drop(draggedItem: { id: string, index: number }, monitor) {
             if (sortTimer.current) {
                 clearTimeout(sortTimer.current);
                 sortTimer.current = null;
             }
             
             if (draggedItem.id !== item.id) {
                 if (!ref.current) return;
                 const hoverBoundingRect = ref.current?.getBoundingClientRect();
                 const clientOffset = monitor.getClientOffset();
                 if (clientOffset) {
                    const hoverClientY = clientOffset.y - hoverBoundingRect.top;
                    const hoverClientX = clientOffset.x - hoverBoundingRect.left;
                    const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
                    const hoverMiddleX = (hoverBoundingRect.right - hoverBoundingRect.left) / 2;
                    
                    const isMergeZone = 
                        hoverClientX > hoverMiddleX * 0.5 && hoverClientX < hoverMiddleX * 1.5 &&
                        hoverClientY > hoverMiddleY * 0.5 && hoverClientY < hoverMiddleY * 1.5;
                        
                    if (isMergeZone) {
                        onDrop(draggedItem.id, item.id);
                    }
                 }
             }
             setIsMergeTarget(false);
        }
    }, [item.id, index, moveWorkspace, onDrop]);

    React.useEffect(() => {
        if (!isOver) {
            if (sortTimer.current) {
                clearTimeout(sortTimer.current);
                sortTimer.current = null;
            }
            setIsMergeTarget(false);
        }
    }, [isOver]);

    drag(drop(ref));

    if (item.isFolder) {
        return (
            <div ref={ref} className={`p-3 h-full opacity-${isDragging ? '50' : '100'} transition-all`}>
                <div 
                    onClick={() => onOpenFolder(item)}
                    className={`bg-slate-100/80 rounded-2xl p-4 border-2 border-slate-200 h-[180px] cursor-pointer hover:bg-slate-200/50 hover:border-indigo-300 transition-all group relative ${isOver && isMergeTarget ? 'ring-4 ring-indigo-500 ring-offset-2 scale-105 bg-indigo-50' : ''}`}
                >
                    {isOver && isMergeTarget && (
                        <div className="absolute inset-0 z-50 bg-indigo-600/90 flex flex-col items-center justify-center text-white rounded-xl animate-in fade-in duration-200 pointer-events-none">
                            <FolderPlus className="w-10 h-10 mb-2" />
                            <span className="font-bold text-lg">Add to Folder</span>
                        </div>
                    )}

                    <div className="flex items-center gap-2 mb-3">
                        <Folder className="w-5 h-5 text-indigo-500" />
                        <span className="font-bold text-slate-700 truncate">{item.name}</span>
                        <span className="text-xs text-slate-400 bg-white px-2 py-0.5 rounded-full ml-auto">{item.items.length}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 h-[110px] overflow-hidden">
                        {item.items.slice(0, 4).map((subItem) => (
                            <div key={subItem.id} className="bg-white rounded-lg p-2 border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
                                <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${subItem.avatarColor || 'from-indigo-400 to-purple-400'} text-white text-[10px] flex items-center justify-center font-bold mb-1`}>
                                    {subItem.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="text-[9px] text-slate-500 w-full truncate px-1">{subItem.name}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div ref={ref} className={`p-3 h-full opacity-${isDragging ? '50' : '100'} transition-all ${isOver && isMergeTarget ? 'scale-105' : ''}`}>
            <Card 
                className={`group cursor-pointer hover:shadow-lg hover:border-indigo-200 transition-all duration-200 relative overflow-hidden h-full min-h-[180px] ${isOver && isMergeTarget ? 'ring-4 ring-indigo-500 ring-offset-2 border-indigo-500' : ''}`}
                onClick={() => onEnter(item)}
                style={item.backgroundImageUrl ? {
                    backgroundImage: `url(${item.backgroundImageUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                } : undefined}
            >
                {isOver && isMergeTarget && (
                    <div className="absolute inset-0 z-50 bg-indigo-600/90 flex flex-col items-center justify-center text-white rounded-xl animate-in fade-in duration-200 pointer-events-none">
                        <FolderPlus className="w-10 h-10 mb-2" />
                        <span className="font-bold text-lg">Create Folder</span>
                        <span className="text-xs opacity-80 mt-1">Drop to combine</span>
                    </div>
                )}

                {item.backgroundImageUrl && (
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/50 transition-colors z-0" />
                )}

                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                
                <CardHeader className="pb-3 relative z-10">
                    <div className="flex justify-between items-start">
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${item.avatarColor || 'from-indigo-500 to-purple-600'} flex items-center justify-center text-white font-bold text-lg shadow-sm ${item.backgroundImageUrl ? 'shadow-md border border-white/20' : ''}`}>
                            {item.name.charAt(0).toUpperCase()}
                        </div>
                        <Button variant="ghost" size="icon" className={`h-8 w-8 opacity-0 group-hover:opacity-100 ${item.backgroundImageUrl ? 'text-white hover:bg-white/20' : 'text-slate-400'}`} onClick={(e) => { e.stopPropagation(); onEdit(item as Workspace); }}>
                            <MoreHorizontal className="w-4 h-4" />
                        </Button>
                    </div>
                    <CardTitle className={`mt-3 text-lg ${item.backgroundImageUrl ? 'text-white text-shadow-sm' : ''}`}>{item.name}</CardTitle>
                </CardHeader>
                <CardContent className="pb-3 relative z-10">
                    <div className={`flex items-center text-sm gap-4 ${item.backgroundImageUrl ? 'text-slate-200' : 'text-slate-500'}`}>
                        <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" /> {item.members} members
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${item.backgroundImageUrl ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-slate-100'}`}>
                            {item.type}
                        </span>
                        {item.inviteCode && (
                            <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono border ${item.backgroundImageUrl ? 'bg-black/30 text-white/80 border-white/10' : 'bg-slate-100 text-slate-500 border-slate-200'}`} title="Invite Code">
                                #{item.inviteCode}
                            </span>
                        )}
                    </div>
                </CardContent>
                <CardFooter className={`pt-3 border-t flex justify-between items-center text-xs transition-colors relative z-10 ${
                    item.backgroundImageUrl 
                        ? 'bg-black/30 text-slate-300 border-white/10 group-hover:bg-black/40' 
                        : 'bg-slate-50/50 text-slate-400 group-hover:bg-indigo-50/30'
                }`}>
                    <span>Active {item.lastActive}</span>
                    <span className={`font-bold opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity ${item.backgroundImageUrl ? 'text-white' : 'text-indigo-600'}`}>
                        Enter <ArrowRight className="w-3 h-3" />
                    </span>
                </CardFooter>
            </Card>
        </div>
    );
}

// Workspace Preview
function WorkspacePreviewCard({ ws, onRemove, onEnter }: { ws: Workspace, onRemove?: () => void, onEnter?: () => void }) {
    return (
        <div className="relative bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow group">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${ws.avatarColor || 'from-indigo-500 to-purple-600'} flex items-center justify-center text-white font-bold text-lg shrink-0`}>
                {ws.name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden flex-1">
                <div className="font-bold text-sm truncate">{ws.name}</div>
                <div className="text-xs text-slate-500">{ws.type}</div>
            </div>
            
            {onRemove && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    className="absolute -top-2 -right-2 bg-white rounded-full p-1 border border-slate-200 shadow-sm hover:bg-red-50 hover:text-red-500 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <X className="w-3 h-3" />
                </button>
            )}

            {onEnter && (
                 <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 ml-auto" onClick={onEnter}>
                    <ArrowRight className="w-4 h-4" />
                 </Button>
            )}
        </div>
    );
}

// Quick Action Card
function QuickActionCard({ icon, label, subLabel, color, onClick }: any) {
    return (
        <button onClick={onClick} className={`flex flex-col items-start justify-between p-5 rounded-2xl ${color} text-white shadow-lg shadow-indigo-200/50 transition-transform hover:-translate-y-1 h-32 w-full text-left`}>
            <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                {icon}
            </div>
            <div>
                <div className="font-bold text-lg leading-none mb-1">{label}</div>
                <div className="text-xs opacity-80 font-medium">{subLabel}</div>
            </div>
        </button>
    );
}

function WorkspaceSettingsDialog({ 
    open, 
    onOpenChange, 
    workspace, 
    onUpdate
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void, 
    workspace: Workspace | null,
    onUpdate: (ws: Workspace) => void
}) {
    const [name, setName] = React.useState('');
    const [participation, setParticipation] = React.useState<'open' | 'approval'>('open');
    const [selectedBg, setSelectedBg] = React.useState<string | null>(null);
    
    React.useEffect(() => {
        if (workspace) {
            setName(workspace.name);
            setParticipation(workspace.participationType || 'open');
            setSelectedBg(workspace.backgroundImageUrl || null);
        }
    }, [workspace]);

    if (!workspace) return null;

    const handleSave = () => {
        onUpdate({
            ...workspace,
            name,
            participationType: participation,
            backgroundImageUrl: selectedBg || undefined
        });
    };

    const copyInviteLink = () => {
        navigator.clipboard.writeText(`https://zoomcord.app/join/${workspace.inviteCode}`);
        toast.success("Invite link copied to clipboard!");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] h-[600px] flex flex-col p-0 gap-0 overflow-hidden">
                <div className="h-full flex">
                    {/* Sidebar */}
                    <div className="w-48 bg-slate-50 border-r border-slate-100 p-4 space-y-1">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Settings</div>
                        <Tabs defaultValue="general" orientation="vertical" className="w-full h-full flex-col flex">
                            <TabsList className="flex flex-col h-auto bg-transparent gap-1 p-0 justify-start items-stretch">
                                <TabsTrigger value="general" className="justify-start px-3 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">General</TabsTrigger>
                                <TabsTrigger value="members" className="justify-start px-3 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">Members & Invite</TabsTrigger>
                            </TabsList>
                            
                            <div className="mt-auto pt-4 border-t border-slate-200">
                                <div className="text-xs text-slate-500 px-2 pb-2">Workspace ID</div>
                                <div className="bg-white border border-slate-200 rounded px-2 py-1 text-xs font-mono text-slate-600 select-all">
                                    {workspace.id}
                                </div>
                            </div>

                            <TabsContent value="general" className="mt-0 flex-1 p-6 overflow-y-auto absolute left-48 top-0 right-0 bottom-0 bg-white">
                                <DialogHeader className="mb-6">
                                    <DialogTitle>General Settings</DialogTitle>
                                    <DialogDescription>Update your workspace basic info.</DialogDescription>
                                </DialogHeader>
                                
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <Label>Workspace Name</Label>
                                        <Input value={name} onChange={e => setName(e.target.value)} />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Cover Image</Label>
                                        <div className="grid grid-cols-4 gap-2">
                                            <button 
                                                onClick={() => setSelectedBg(null)}
                                                className={`aspect-video rounded-lg border-2 flex items-center justify-center bg-slate-100 text-xs font-bold text-slate-500 ${!selectedBg ? 'border-indigo-600' : 'border-transparent'}`}
                                            >
                                                None
                                            </button>
                                            {PRESET_BG_IMAGES.map((img, idx) => (
                                                <button 
                                                    key={idx}
                                                    onClick={() => setSelectedBg(img)}
                                                    className={`aspect-video rounded-lg border-2 relative overflow-hidden ${selectedBg === img ? 'border-indigo-600' : 'border-transparent'}`}
                                                >
                                                    <img src={img} className="w-full h-full object-cover" />
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Participation</Label>
                                        <div className="flex gap-4">
                                            <label className="flex items-center gap-2 border p-3 rounded-lg flex-1 cursor-pointer has-[:checked]:border-indigo-600 has-[:checked]:bg-indigo-50">
                                                <input type="radio" checked={participation === 'open'} onChange={() => setParticipation('open')} className="accent-indigo-600" />
                                                <div className="text-sm">
                                                    <div className="font-bold">Open</div>
                                                    <div className="text-xs text-slate-500">Anyone can join</div>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-2 border p-3 rounded-lg flex-1 cursor-pointer has-[:checked]:border-indigo-600 has-[:checked]:bg-indigo-50">
                                                <input type="radio" checked={participation === 'approval'} onChange={() => setParticipation('approval')} className="accent-indigo-600" />
                                                <div className="text-sm">
                                                    <div className="font-bold">Approval</div>
                                                    <div className="text-xs text-slate-500">Admin must accept</div>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                    
                                    <div className="pt-4 border-t flex justify-end">
                                        <Button onClick={handleSave} className="bg-indigo-600 text-white">Save Changes</Button>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="members" className="mt-0 flex-1 p-6 overflow-y-auto absolute left-48 top-0 right-0 bottom-0 bg-white">
                                <DialogHeader className="mb-6">
                                    <DialogTitle>Invite People</DialogTitle>
                                    <DialogDescription>Add members to your workspace.</DialogDescription>
                                </DialogHeader>

                                <div className="space-y-6">
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                        <div className="text-sm font-bold text-slate-700 mb-2">Invite Link</div>
                                        <div className="flex gap-2">
                                            <div className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 font-mono truncate">
                                                https://zoomcord.app/join/{workspace.inviteCode || '????'}
                                            </div>
                                            <Button variant="outline" onClick={copyInviteLink}>
                                                <Copy className="w-4 h-4 mr-2" /> Copy
                                            </Button>
                                        </div>
                                        <div className="mt-3 text-xs text-slate-500 flex items-center gap-1">
                                            <Lock className="w-3 h-3" />
                                            Share this link to invite people directly.
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
