export interface Workspace {
    id: string;
    name: string;
    type: 'Team' | 'Personal' | 'Class' | 'Project';
    members: number;
    lastActive: string;
    isFolder?: false;
    avatarColor?: string; // For persistent color
    backgroundImageUrl?: string; // For customized card background
    inviteCode?: string; // Unique ID for joining
    participationType?: 'open' | 'approval';
    pendingRequests?: { userId: string, userName: string, timestamp: number }[];
}

export interface WorkspaceFolder {
    id: string;
    name: string;
    type: 'Folder';
    items: Workspace[];
    isFolder: true;
}

export type DashboardItem = Workspace | WorkspaceFolder;
