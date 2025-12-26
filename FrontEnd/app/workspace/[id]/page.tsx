'use client';

import { useParams, useRouter } from 'next/navigation';
import { useApp } from '@/providers/AppProvider';
import { WorkspaceLayout } from '@/components/WorkspaceLayout';
import { Workspace } from '@/types/workspace';

export default function WorkspacePage() {
    const params = useParams();
    const router = useRouter();
    const { dashboardItems, openProfile } = useApp();

    const workspaceId = params.id as string;

    // Find the workspace from dashboardItems
    const findWorkspace = (id: string): Workspace | null => {
        for (const item of dashboardItems) {
            if (item.isFolder) {
                // Search in folder
                const found = item.items.find(ws => ws.id === id);
                if (found) return found;
            } else {
                if (item.id === id) return item;
            }
        }
        return null;
    };

    const workspace = findWorkspace(workspaceId);

    if (!workspace) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-slate-900 mb-4">워크스페이스를 찾을 수 없습니다</h1>
                    <button
                        onClick={() => router.push('/dashboard')}
                        className="text-indigo-600 hover:underline"
                    >
                        대시보드로 돌아가기
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen font-sans text-slate-900 bg-slate-50">
            <WorkspaceLayout
                workspaceName={workspace.name}
                activeWorkspaceId={workspace.id}
                dashboardItems={dashboardItems}
                onSwitchWorkspace={(ws) => router.push(`/workspace/${ws.id}`)}
                onLogout={() => router.push('/dashboard')}
                onOpenProfile={openProfile}
            />
        </div>
    );
}
