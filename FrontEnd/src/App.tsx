import React, { useState } from 'react';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { LandingPage } from './components/landing/LandingPage';
import { HomeDashboard } from './components/home/HomeDashboard';
import { LanguageSetup } from './components/onboarding/LanguageSetup';
import { ProfileSetup } from './components/onboarding/ProfileSetup';
import { ProfileDialog } from './components/dialogs/ProfileDialog';
import { DashboardItem, Workspace } from './types/workspace';
import { UserProfile } from './types/user';

type AppState = 'landing' | 'profile-setup' | 'language-setup' | 'dashboard';

export default function App() {
  const [appState, setAppState] = useState<AppState>('landing');
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  // Lifted state for workspaces/folders Persistence
  const [dashboardItems, setDashboardItems] = useState<DashboardItem[]>([
      { id: 'ws-1', name: 'Global Marketing Team', type: 'Team', members: 12, lastActive: '2 mins ago', isFolder: false, avatarColor: 'from-indigo-500 to-purple-600' },
      { id: 'ws-2', name: 'My Personal Lab', type: 'Personal', members: 1, lastActive: 'Yesterday', isFolder: false, avatarColor: 'from-green-400 to-emerald-600' },
      { id: 'ws-3', name: 'Design System', type: 'Project', members: 5, lastActive: '1 hour ago', isFolder: false, avatarColor: 'from-pink-500 to-rose-600' },
  ]);

  // Global Profile Dialog State
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<UserProfile | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const handleOpenProfile = (targetUser?: UserProfile) => {
      // If targetUser is provided, view that user.
      // If undefined, view "My Profile" (null viewingProfile)
      setViewingProfile(targetUser || null);
      setIsEditingProfile(false);
      setProfileDialogOpen(true);
  };

  const handleLogout = () => {
    setAppState('landing');
    setActiveWorkspace(null);
    setUserProfile(null);
    setProfileDialogOpen(false);
  };

  // 1. Landing Page (Includes Login Popup)
  if (appState === 'landing') {
      return (
          <LandingPage 
            onStart={() => {}} // Deprecated: Logic moved inside LandingPage
            onLogin={() => setAppState('profile-setup')}
          />
      );
  }

  // 2. Profile Setup
  if (appState === 'profile-setup') {
      return (
          <ProfileSetup
            onComplete={(profile) => {
                setUserProfile(profile);
                setAppState('language-setup');
            }}
          />
      );
  }

  // 3. Language Setup
  if (appState === 'language-setup') {
      return (
          <LanguageSetup 
            onComplete={(lang) => {
                // Here you would save the language preference
                console.log('Language preference saved:', lang);
                setAppState('dashboard');
            }} 
          />
      );
  }

  return (
    <>
      {activeWorkspace ? (
          // 4. Workspace View
          <div className="min-h-screen font-sans text-slate-900 bg-slate-50">
             <WorkspaceLayout 
                workspaceName={activeWorkspace.name}
                activeWorkspaceId={activeWorkspace.id}
                dashboardItems={dashboardItems}
                onSwitchWorkspace={(ws) => setActiveWorkspace(ws)}
                onLogout={() => setActiveWorkspace(null)} 
                onOpenProfile={handleOpenProfile}
             />
          </div>
      ) : (
          // 5. Home Dashboard
          <HomeDashboard 
            items={dashboardItems}
            userProfile={userProfile}
            onUpdateItems={setDashboardItems}
            onLogout={handleLogout}
            onEnterWorkspace={(ws) => setActiveWorkspace(ws)}
            onOpenProfile={handleOpenProfile}
          />
      )}

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
    </>
  );
}
