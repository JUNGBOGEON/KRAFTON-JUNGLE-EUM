import { useAuth } from "../lib/auth-context";
import { Workspace } from "../lib/api";

export function usePermission(workspace: Workspace | null, permissionCode: string) {
    const { user } = useAuth();

    if (!workspace || !user) return false;

    // Owner always has permission
    if (workspace.owner_id === user.id) return true;

    const member = workspace.members?.find(m => m.user_id === user.id);
    if (!member) return false;

    // Active check
    if (member.status !== 'ACTIVE') return false;

    return member.role?.permissions?.includes(permissionCode) ?? false;
}
