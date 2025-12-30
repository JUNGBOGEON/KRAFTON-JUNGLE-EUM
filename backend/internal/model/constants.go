package model

// MemberStatus 멤버 상태
type MemberStatus string

const (
	MemberStatusPending MemberStatus = "PENDING"
	MemberStatusActive  MemberStatus = "ACTIVE"
)

// NotificationType 알림 타입
type NotificationType string

const (
	NotificationTypeWorkspaceInvite NotificationType = "WORKSPACE_INVITE"
	NotificationTypeMeetingAlert    NotificationType = "MEETING_ALERT"
	NotificationTypeCommentMention  NotificationType = "COMMENT_MENTION"
)

// String 메서드
func (s MemberStatus) String() string {
	return string(s)
}

func (n NotificationType) String() string {
	return string(n)
}
