'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { DashboardItem, Workspace } from '@/types/workspace';
import { UserProfile } from '@/types/user';
import { ProfileDialog } from '@/components/dialogs/ProfileDialog';

// Context Types
interface AppContextType {
    // User Profile
    userProfile: UserProfile | null;
    setUserProfile: (profile: UserProfile | null) => void;

    // Dashboard Items (Workspaces/Folders)
    dashboardItems: DashboardItem[];
    setDashboardItems: React.Dispatch<React.SetStateAction<DashboardItem[]>>;

    // Profile Dialog
    openProfile: (targetUser?: UserProfile) => void;

    // Logout
    handleLogout: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Custom hook to use the context
export function useApp() {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
}

// Provider Component
interface AppProviderProps {
    children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
    // User Profile State
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

    // Dashboard Items State
    const [dashboardItems, setDashboardItems] = useState<DashboardItem[]>([
        {
            id: 'ws-1',
            name: 'Global Marketing Team',
            type: 'Team',
            members: 12,
            lastActive: '2 mins ago',
            isFolder: false,
            avatarColor: 'from-indigo-500 to-purple-600'
        },
        {
            id: 'ws-2',
            name: 'My Personal Lab',
            type: 'Personal',
            members: 1,
            lastActive: 'Yesterday',
            isFolder: false,
            avatarColor: 'from-green-400 to-emerald-600'
        },
        {
            id: 'ws-3',
            name: 'Design System',
            type: 'Project',
            members: 5,
            lastActive: '1 hour ago',
            isFolder: false,
            avatarColor: 'from-pink-500 to-rose-600'
        },
    ]);

    // Profile Dialog State
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [viewingProfile, setViewingProfile] = useState<UserProfile | null>(null);
    const [isEditingProfile, setIsEditingProfile] = useState(false);

    const openProfile = (targetUser?: UserProfile) => {
        setViewingProfile(targetUser || null);
        setIsEditingProfile(false);
        setProfileDialogOpen(true);
    };

    const handleLogout = () => {
        setUserProfile(null);
        setProfileDialogOpen(false);
    };

    const value: AppContextType = {
        userProfile,
        setUserProfile,
        dashboardItems,
        setDashboardItems,
        openProfile,
        handleLogout,
    };

    return (
        <AppContext.Provider value={value}>
            {children}

            {/* Global Profile Dialog */}
            <ProfileDialog
                open={profileDialogOpen}
                onOpenChange={setProfileDialogOpen}
                currentUser={userProfile}
                viewingUser={viewingProfile}
                isEditing={isEditingProfile}
                setIsEditing={setIsEditingProfile}
                onUpdateProfile={setUserProfile}
                onLogout={handleLogout}
            />
        </AppContext.Provider>
    );
}
