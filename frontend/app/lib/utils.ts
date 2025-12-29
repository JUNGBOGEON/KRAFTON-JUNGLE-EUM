import { WorkspaceMember } from './api';
import { MemberStatus } from './constants';

/**
 * ACTIVE 멤버만 필터링
 */
export function filterActiveMembers(members: WorkspaceMember[]): WorkspaceMember[] {
    return members.filter(m => m.status === MemberStatus.ACTIVE || !m.status);
}

/**
 * PENDING 멤버만 필터링
 */
export function filterPendingMembers(members: WorkspaceMember[]): WorkspaceMember[] {
    return members.filter(m => m.status === MemberStatus.PENDING);
}

/**
 * LEFT 멤버만 필터링
 */
export function filterLeftMembers(members: WorkspaceMember[]): WorkspaceMember[] {
    return members.filter(m => m.status === MemberStatus.LEFT);
}
