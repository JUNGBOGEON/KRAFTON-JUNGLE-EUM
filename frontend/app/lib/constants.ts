// Member Status Constants
export const MemberStatus = {
    PENDING: 'PENDING',
    ACTIVE: 'ACTIVE',
    LEFT: 'LEFT',
} as const;

export type MemberStatusType = typeof MemberStatus[keyof typeof MemberStatus];

// Notification Type Constants
export const NotificationType = {
    WORKSPACE_INVITE: 'WORKSPACE_INVITE',
    MEETING_ALERT: 'MEETING_ALERT',
    COMMENT_MENTION: 'COMMENT_MENTION',
} as const;

export type NotificationTypeType = typeof NotificationType[keyof typeof NotificationType];
