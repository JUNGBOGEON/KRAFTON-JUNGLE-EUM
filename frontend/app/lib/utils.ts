import { WorkspaceMember } from './api';

/**
 * ACTIVE 상태의 멤버만 필터링
 */
export function filterActiveMembers(members: WorkspaceMember[]): WorkspaceMember[] {
    return members.filter(m => m.status === 'ACTIVE');
}
