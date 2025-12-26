'use client';

import { useRouter } from 'next/navigation';
import { HomeDashboard } from '@/components/home/HomeDashboard';
import { useApp } from '@/providers/AppProvider';

export default function DashboardPage() {
    const router = useRouter();
    const { dashboardItems, setDashboardItems, userProfile, openProfile, handleLogout } = useApp();

    return (
        <HomeDashboard
            items={dashboardItems}
            userProfile={userProfile}
            onUpdateItems={setDashboardItems}
            onLogout={() => {
                handleLogout();
                router.push('/');
            }}
            onEnterWorkspace={(ws) => router.push(`/workspace/${ws.id}`)}
            onOpenProfile={openProfile}
        />
    );
}
