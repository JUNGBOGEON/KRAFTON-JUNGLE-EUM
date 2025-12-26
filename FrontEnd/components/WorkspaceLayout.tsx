import React, { useState } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { 
    Hash, Plus, Mic, Settings, LogOut, 
    Video, PenTool, Volume2, ChevronDown, UserPlus,
    MessageSquare, Bell, Search, Phone, Folder, Lock,
    Calendar, HardDrive
} from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

// Feature Components
import { TranslationChat } from './chat/TranslationChat';
import { MiroWhiteboard } from './whiteboard/MiroWhiteboard';
import { VideoConference } from './video/VideoConference';
import { VoiceSettings } from './settings/VoiceSettings';
import { CalendarChannel } from './calendar/CalendarChannel';
import { StorageChannel } from './storage/StorageChannel';
import { DashboardItem, Workspace, WorkspaceFolder } from '../types/workspace';
import { UserProfile } from '../types/user';
import { CreateChannelDialog } from './dialogs/CreateChannelDialog';
import { ChannelSettingsDialog } from './dialogs/ChannelSettingsDialog';

// --- Types & Mock Data ---
type ChannelType = 'text' | 'voice' | 'meeting' | 'announcement' | 'calendar' | 'storage';

interface Channel {
    id: string;
    name: string;
    type: ChannelType;
    unread?: number;
    isPrivate?: boolean;
}

const CHANNELS: Channel[] = [
    { id: 'c1', name: 'announcements', type: 'announcement', unread: 0 },
    { id: 'c2', name: 'general', type: 'text', unread: 0 },
    { id: 'c3', name: 'design-team', type: 'text', unread: 2 },
    { id: 'cal1', name: 'Team Calendar', type: 'calendar' },
    { id: 'sto1', name: 'Project Drive', type: 'storage' },
    { id: 'v1', name: 'Water Cooler', type: 'voice' },
    { id: 'm1', name: 'Project Sync', type: 'meeting' },
];

const MEMBERS = [
    { id: 'm1', name: 'Kim Min-su', role: 'Owner', status: 'online', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Minsu' },
    { id: 'm2', name: 'Sarah Lee', role: 'Admin', status: 'busy', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah' },
    { id: 'm3', name: 'James Chen', role: 'Member', status: 'online', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=James' },
    { id: 'm4', name: 'Designer Han', role: 'Member', status: 'offline', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Han' },
];

interface WorkspaceLayoutProps {
    onLogout: () => void;
    workspaceName?: string;
    activeWorkspaceId?: string;
    dashboardItems?: DashboardItem[];
    onSwitchWorkspace?: (workspace: Workspace) => void;
    // New prop for global profile handling
    onOpenProfile: (user?: UserProfile) => void;
}

export function WorkspaceLayout({ 
    onLogout, 
    workspaceName = "Q4 Marketing", 
    activeWorkspaceId, 
    dashboardItems = [], 
    onSwitchWorkspace,
    onOpenProfile
}: WorkspaceLayoutProps) {
    const [channels, setChannels] = useState<Channel[]>(CHANNELS);
    const [currentChannel, setCurrentChannel] = useState<Channel>(channels[1]); // Default: general
    const [isInMeeting, setIsInMeeting] = useState(false);
    const [showWhiteboard, setShowWhiteboard] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [isChatOpenInMeeting, setIsChatOpenInMeeting] = useState(true);

    // Create Channel State
    const [createChannelOpen, setCreateChannelOpen] = useState(false);
    const [createChannelType, setCreateChannelType] = useState<ChannelType>('text');

    // Channel Settings State
    const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);
    const [channelSettingsOpen, setChannelSettingsOpen] = useState(false);

    // Mock User Profile (Current User) - In a real app this would come from props or context
    const [userProfile, setUserProfile] = useState<UserProfile>({
        id: 'me',
        displayName: 'Kim Min-su',
        statusMessage: 'Working remotely',
        avatarUrl: MEMBERS[0].avatar,
        email: 'minsu@example.com'
    });

    const handleChannelClick = (channel: Channel) => {
        setCurrentChannel(channel);
        if (channel.unread) {
            setChannels(prev => prev.map(c => 
                c.id === channel.id ? { ...c, unread: 0 } : c
            ));
        }
    };

    const handleOpenCreateChannel = (type: ChannelType) => {
        setCreateChannelType(type);
        setCreateChannelOpen(true);
    };

    const handleCreateChannel = (name: string, type: ChannelType, isPrivate: boolean) => {
        const newChannel: Channel = {
            id: `new-${Date.now()}`,
            name,
            type,
            unread: 0,
            isPrivate
        };
        setChannels(prev => [...prev, newChannel]);
        // Optionally switch to new channel immediately
        if (['text', 'announcement', 'calendar', 'storage'].includes(type)) {
            setCurrentChannel(newChannel);
        }
    };

    const handleOpenChannelSettings = (e: React.MouseEvent, channel: Channel) => {
        e.stopPropagation();
        setSettingsChannel(channel);
        setChannelSettingsOpen(true);
    };

    const handleUpdateChannel = (id: string, updates: Partial<Channel>) => {
        setChannels(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
        // If current channel updated, update it as well
        if (currentChannel.id === id) {
            setCurrentChannel(prev => ({ ...prev, ...updates }));
        }
    };

    const handleDeleteChannel = (id: string) => {
        setChannels(prev => prev.filter(c => c.id !== id));
        if (currentChannel.id === id) {
            // Switch to a safe default
            const remaining = channels.filter(c => c.id !== id && c.type === 'text');
            if (remaining.length > 0) setCurrentChannel(remaining[0]);
        }
    };

    // Open Profile Dialog (My Profile)
    const openMyProfile = () => {
        onOpenProfile(); // undefined = my profile
    };

    // Open Profile Dialog (Other User)
    const openUserProfile = (userName: string) => {
        // Mock finding user from MEMBERS
        const member = MEMBERS.find(m => m.name === userName);
        
        if (member && member.name === userProfile.displayName) {
             openMyProfile();
             return;
        }

        // Construct a UserProfile object from the member data
        const targetProfile: UserProfile = {
            id: member ? member.id : 'unknown',
            displayName: userName,
            email: member ? `${member.name.toLowerCase().replace(' ', '.')}@example.com` : 'user@example.com',
            statusMessage: member ? 'Hello there! I am using ZoomCord.' : 'User not found.',
            avatarUrl: member?.avatar
        };
        
        onOpenProfile(targetProfile);
    };

    // Determine navigation context (Root vs Folder)
    const activeFolder = dashboardItems.find(item => 
        item.isFolder && (item as any).items?.some((ws: any) => ws.id === activeWorkspaceId)
    ) as WorkspaceFolder | undefined;
    
    // If folder active: show folder items. If root active: show ONLY that root item.
    const visibleItems = activeFolder 
        ? activeFolder.items 
        : dashboardItems.filter(item => item.id === activeWorkspaceId);

    if (showSettings) {
        return <VoiceSettings onBack={() => setShowSettings(false)} />;
    }

    // --- Meeting Mode ---
    if (isInMeeting) {
        return (
            <div className="flex h-screen w-full relative bg-slate-950">
                <VideoConference 
                    onLeave={() => setIsInMeeting(false)} 
                    toggleChat={() => setIsChatOpenInMeeting(!isChatOpenInMeeting)}
                    isChatOpen={isChatOpenInMeeting}
                />
                
                {/* Slide-in Chat during Meeting */}
                <div 
                    className={`bg-white border-l transition-all duration-300 ease-in-out absolute right-0 top-0 bottom-0 z-20 ${
                        isChatOpenInMeeting ? 'w-96 translate-x-0 shadow-2xl' : 'w-0 translate-x-full overflow-hidden'
                    }`}
                >
                    {isChatOpenInMeeting && <TranslationChat onOpenProfile={openUserProfile} />}
                </div>
            </div>
        );
    }

    // --- Standard Workspace Mode ---
    return (
        <TooltipProvider>
            <div className="flex h-screen bg-white overflow-hidden font-sans">
                
                {/* ⓪ Workspace Navigation (Discord Style) */}
                <nav className="w-[72px] bg-[#1E1F22] flex flex-col items-center py-3 gap-2 z-30 shrink-0 overflow-y-auto no-scrollbar">
                    {/* Home / Back to Dashboard */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div 
                                onClick={onLogout}
                                className="w-12 h-12 bg-[#313338] hover:bg-indigo-500 text-white rounded-[24px] hover:rounded-[16px] transition-all duration-200 cursor-pointer flex items-center justify-center group"
                            >
                                <img src={userProfile.avatarUrl || MEMBERS[0].avatar} className="w-7 h-7 rounded-full" alt="Home" />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="right">Dashboard</TooltipContent>
                    </Tooltip>

                    <div className="w-8 h-[2px] bg-[#35373C] rounded-full my-1" />

                    {/* Workspace List */}
                    {visibleItems.map((item) => {
                        if ((item as any).isFolder) {
                            const folder = item as WorkspaceFolder;
                            return (
                                <WorkspaceFolderItem 
                                    key={folder.id} 
                                    folder={folder} 
                                    activeWorkspaceId={activeWorkspaceId}
                                    onSwitch={onSwitchWorkspace}
                                />
                            );
                        } else {
                            return (
                                <WorkspaceNavItem 
                                    key={item.id} 
                                    item={item} 
                                    isActive={item.id === activeWorkspaceId}
                                    onClick={() => onSwitchWorkspace?.(item)}
                                />
                            );
                        }
                    })}

                    <div className="w-8 h-[2px] bg-[#35373C] rounded-full my-1" />
                    
                    {/* Add Button */}
                    <div className="w-12 h-12 bg-[#313338] hover:bg-green-600 text-green-500 hover:text-white rounded-[24px] hover:rounded-[16px] transition-all duration-200 cursor-pointer flex items-center justify-center group">
                        <Plus className="w-6 h-6 transition-colors" />
                    </div>
                </nav>

                {/* ① Sidebar (Channel List) */}
                <aside className="w-[240px] bg-[#2B2D31] text-[#949BA4] flex flex-col shrink-0 relative z-20 rounded-tl-xl my-0 ml-0 overflow-hidden">
                    {/* Sidebar Header */}
                    <div className="h-12 px-4 flex items-center justify-between border-b border-[#1F2023] hover:bg-[#35373C] transition-colors cursor-pointer group shadow-sm">
                        <span className="font-bold text-white truncate">{workspaceName}</span>
                        <ChevronDown className="w-4 h-4 text-[#949BA4] group-hover:text-white" />
                    </div>

                    <ScrollArea className="flex-1 px-2 py-4">
                        {/* Text Channels */}
                        <div className="mb-6">
                            <div className="px-2 mb-1 flex items-center justify-between group">
                                <span className="text-xs font-bold uppercase tracking-wider text-[#949BA4] group-hover:text-[#DBDEE1] transition-colors">Text Channels</span>
                                <Plus 
                                    className="w-4 h-4 cursor-pointer text-[#949BA4] hover:text-[#DBDEE1]" 
                                    onClick={() => handleOpenCreateChannel('text')}
                                />
                            </div>
                            {channels.filter(c => ['text', 'announcement'].includes(c.type)).map(channel => (
                                <ChannelItem 
                                    key={channel.id} 
                                    channel={channel} 
                                    isActive={currentChannel.id === channel.id}
                                    onClick={() => handleChannelClick(channel)}
                                    onSettings={(e) => handleOpenChannelSettings(e, channel)}
                                />
                            ))}
                        </div>

                        {/* Calendar & Storage */}
                        <div className="mb-6">
                            <div className="px-2 mb-1 flex items-center justify-between group">
                                <span className="text-xs font-bold uppercase tracking-wider text-[#949BA4] group-hover:text-[#DBDEE1] transition-colors">Workspace</span>
                                <Plus 
                                    className="w-4 h-4 cursor-pointer text-[#949BA4] hover:text-[#DBDEE1]" 
                                    onClick={() => handleOpenCreateChannel('calendar')}
                                />
                            </div>
                            {channels.filter(c => ['calendar', 'storage'].includes(c.type)).map(channel => (
                                <ChannelItem 
                                    key={channel.id} 
                                    channel={channel} 
                                    isActive={currentChannel.id === channel.id}
                                    onClick={() => handleChannelClick(channel)}
                                    onSettings={(e) => handleOpenChannelSettings(e, channel)}
                                />
                            ))}
                        </div>

                        {/* Voice / Meeting Channels */}
                        <div className="mb-6">
                            <div className="px-2 mb-1 flex items-center justify-between group">
                                <span className="text-xs font-bold uppercase tracking-wider text-[#949BA4] group-hover:text-[#DBDEE1] transition-colors">Voice & Meetings</span>
                                <Plus 
                                    className="w-4 h-4 cursor-pointer text-[#949BA4] hover:text-[#DBDEE1]" 
                                    onClick={() => handleOpenCreateChannel('voice')}
                                />
                            </div>
                            {channels.filter(c => ['voice', 'meeting'].includes(c.type)).map(channel => (
                                <ChannelItem 
                                    key={channel.id} 
                                    channel={channel} 
                                    isActive={false} // Voice channels trigger meeting mode, don't stay "active" in sidebar
                                    onClick={() => setIsInMeeting(true)}
                                    onSettings={(e) => handleOpenChannelSettings(e, channel)}
                                />
                            ))}
                        </div>
                    </ScrollArea>

                    {/* User Control Panel */}
                    <div className="h-[52px] bg-[#232428] flex items-center px-2 gap-2">
                        <Avatar className="w-8 h-8 transition-opacity relative group cursor-pointer hover:opacity-90" onClick={openMyProfile}>
                            <AvatarImage src={userProfile.avatarUrl} />
                            <AvatarFallback>{userProfile.displayName.charAt(0)}</AvatarFallback>
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#232428]" />
                        </Avatar>
                        <div className="flex-1 overflow-hidden cursor-pointer" onClick={openMyProfile}>
                            <div className="text-sm font-bold text-white truncate leading-tight hover:underline">{userProfile.displayName}</div>
                            <div className="text-xs text-[#949BA4] truncate leading-tight">Online</div>
                        </div>
                        <div className="flex items-center">
                            <Button variant="ghost" size="icon" className="w-8 h-8 text-[#949BA4] hover:text-white hover:bg-[#35373C]">
                                <Mic className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="w-8 h-8 text-[#949BA4] hover:text-white hover:bg-[#35373C]" onClick={() => setShowSettings(true)}>
                                <Settings className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </aside>

                {/* ② Main Content */}
                <main className="flex-1 flex flex-col min-w-0 bg-white relative">
                    {/* Render Content Based on Channel Type */}
                    {currentChannel.type === 'calendar' ? (
                        <CalendarChannel />
                    ) : currentChannel.type === 'storage' ? (
                        <StorageChannel />
                    ) : (
                        <>
                            {/* Standard Header for Text/Voice */}
                            <div className="h-12 px-4 border-b flex items-center justify-between shrink-0 shadow-sm z-10">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <ChannelIcon channel={currentChannel} className="w-5 h-5 text-slate-400 shrink-0" />
                                    <span className="font-bold text-slate-900 truncate">{currentChannel.name}</span>
                                    <span className="hidden md:inline-block text-sm text-slate-400 truncate border-l ml-2 pl-2">
                                        {currentChannel.isPrivate ? 'Private Channel' : 'Topic: Q4 Marketing Strategy Discussion'}
                                    </span>
                                </div>
                                
                                {/* Header Actions */}
                                <div className="flex items-center gap-3 shrink-0">
                                    <Button 
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-sm"
                                        size="sm"
                                        onClick={() => setIsInMeeting(true)}
                                    >
                                        <Video className="w-4 h-4" />
                                        <span className="hidden sm:inline">Start Meeting</span>
                                    </Button>

                                    <div className="h-6 w-px bg-slate-200 hidden sm:block" />

                                    <div className="flex items-center text-slate-400 gap-1">
                                         <Button variant="ghost" size="icon" className="w-8 h-8 hover:text-indigo-600">
                                            <Phone className="w-4 h-4" />
                                         </Button>
                                         <Button variant="ghost" size="icon" className="w-8 h-8 hover:text-indigo-600">
                                            <Search className="w-4 h-4" />
                                         </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Chat Area */}
                            <div className="flex-1 relative overflow-hidden">
                                <TranslationChat onOpenProfile={openUserProfile} />
                            </div>
                        </>
                    )}
                    
                    {/* Whiteboard Overlay */}
                    {showWhiteboard && (
                        <MiroWhiteboard onClose={() => setShowWhiteboard(false)} />
                    )}
                </main>

                {/* ③ Right Panel (Member List) */}
                <aside className="w-60 bg-[#F2F3F5] flex flex-col shrink-0 hidden lg:flex border-l">
                    <div className="h-12 px-4 flex items-center font-bold text-xs text-[#5C5E66] tracking-wide uppercase">
                        MEMBERS — {MEMBERS.length}
                    </div>
                    <ScrollArea className="flex-1 p-3">
                        {/* Role Groups */}
                        {['Owner', 'Admin', 'Member'].map(role => {
                            const roleMembers = MEMBERS.filter(m => m.role === role);
                            if (roleMembers.length === 0) return null;
                            return (
                                <div key={role} className="mb-6">
                                    <h4 className="text-xs font-bold text-[#949BA4] uppercase mb-2 px-2">{role}</h4>
                                    {roleMembers.map(member => (
                                        <div 
                                            key={member.id} 
                                            className="flex items-center gap-3 p-2 rounded-md hover:bg-[#E3E5E8] cursor-pointer transition-colors group opacity-90 hover:opacity-100"
                                            onClick={() => openUserProfile(member.name)}
                                        >
                                            <div className="relative">
                                                <Avatar className="w-8 h-8">
                                                    <AvatarImage src={member.avatar} />
                                                    <AvatarFallback>{member.name[0]}</AvatarFallback>
                                                </Avatar>
                                                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#F2F3F5] ${
                                                    member.status === 'online' ? 'bg-green-500' : 
                                                    member.status === 'busy' ? 'bg-red-500' : 'bg-slate-400'
                                                }`} />
                                            </div>
                                            <div className="overflow-hidden">
                                                <div className="text-sm font-medium text-[#313338] truncate">{member.name}</div>
                                                <div className="text-[10px] text-[#5C5E66] truncate">{member.status}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </ScrollArea>
                    
                    <div className="p-3 border-t bg-[#EBEDEF]">
                         <Button variant="outline" className="w-full justify-start text-[#5C5E66] border-[#D8D8D8] hover:bg-white bg-white">
                            <UserPlus className="w-4 h-4 mr-2" /> Invite People
                         </Button>
                    </div>
                </aside>

                <CreateChannelDialog 
                    open={createChannelOpen}
                    onOpenChange={setCreateChannelOpen}
                    onSubmit={handleCreateChannel}
                    defaultType={createChannelType}
                    existingChannels={channels}
                />

                <ChannelSettingsDialog 
                    open={channelSettingsOpen}
                    onOpenChange={setChannelSettingsOpen}
                    channel={settingsChannel}
                    onUpdate={handleUpdateChannel}
                    onDelete={handleDeleteChannel}
                />
            </div>
        </TooltipProvider>
    );
}

// --- Helper Components ---

function ChannelIcon({ channel, className }: { channel: Channel, className?: string }) {
    if (channel.type === 'announcement') return <Bell className={className} />;
    if (channel.isPrivate) return <Lock className={className} />;
    
    switch (channel.type) {
        case 'text': return <Hash className={className} />;
        case 'voice': return <Volume2 className={className} />;
        case 'meeting': return <Video className={className} />;
        case 'calendar': return <Calendar className={className} />;
        case 'storage': return <HardDrive className={className} />;
        default: return <Hash className={className} />;
    }
}

function ChannelItem({ channel, isActive, onClick, onSettings }: { 
    channel: Channel, 
    isActive: boolean, 
    onClick: () => void,
    onSettings: (e: React.MouseEvent) => void 
}) {
    return (
        <div
            onClick={onClick}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md mb-0.5 text-[15px] transition-all group relative cursor-pointer ${
                isActive 
                ? 'bg-[#404249] text-white font-medium' 
                : 'hover:bg-[#35373C] hover:text-[#DBDEE1]'
            }`}
        >
            <ChannelIcon channel={channel} className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-[#949BA4]'}`} />
            
            <span className="truncate flex-1">{channel.name}</span>
            
            {/* Settings Icon (Visible on hover) */}
            <div 
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-white text-[#949BA4]"
                onClick={onSettings}
            >
                <Settings className="w-3.5 h-3.5" />
            </div>

            {channel.unread ? (
                <div className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold ml-1">
                    {channel.unread}
                </div>
            ) : null}
        </div>
    );
}

// ... (Existing WorkspaceFolderItem and WorkspaceNavItem components remain unchanged)
function WorkspaceNavItem({ item, isActive, onClick, isSmall }: { item: Workspace, isActive: boolean, onClick: () => void, isSmall?: boolean }) {
    const sizeClasses = isSmall ? "w-10 h-10 text-xs" : "w-12 h-12 text-lg";
    
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className="relative flex items-center group w-full justify-center">
                    {/* Active Indicator Pits */}
                    {!isSmall && (
                        <div className={`absolute left-0 w-[4px] bg-white rounded-r-full transition-all duration-200 ${
                            isActive ? 'h-[40px]' : 'h-[8px] opacity-0 group-hover:opacity-100 group-hover:h-[20px]'
                        }`} />
                    )}
                    {isSmall && isActive && (
                         <div className="absolute left-[-4px] w-[4px] h-[20px] bg-white rounded-r-full" />
                    )}
                    
                    <button 
                        onClick={onClick}
                        className={`${sizeClasses} flex items-center justify-center rounded-[24px] transition-all duration-200 overflow-hidden ${
                            isActive 
                            ? 'bg-indigo-600 rounded-[16px] text-white' 
                            : 'bg-[#313338] hover:bg-indigo-500 text-white hover:rounded-[16px]'
                        }`}
                    >
                        <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${item.avatarColor || 'from-indigo-500 to-purple-600'} font-bold`}>
                            {item.name.charAt(0).toUpperCase()}
                        </div>
                    </button>
                </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-black text-white border-none font-semibold">
                {item.name}
            </TooltipContent>
        </Tooltip>
    );
}

function WorkspaceFolderItem({ folder, activeWorkspaceId, onSwitch }: { folder: WorkspaceFolder, activeWorkspaceId?: string, onSwitch?: (ws: Workspace) => void }) {
    // Always rendered as an open container (Discord style expanded folder)
    return (
        <div className="flex flex-col items-center gap-2">
             {/* Render Items */}
             {folder.items.map(ws => (
                 <WorkspaceNavItem 
                    key={ws.id}
                    item={ws}
                    isActive={ws.id === activeWorkspaceId}
                    onClick={() => onSwitch?.(ws)}
                 />
             ))}
        </div>
    );
}
