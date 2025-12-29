package model

import (
	"time"
)

// Notification 알림
type Notification struct {
	ID          int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	ReceiverID  int64     `gorm:"not null" json:"receiver_id"`
	SenderID    *int64    `json:"sender_id,omitempty"`                   // 시스템 알림이면 NULL
	Type        string    `gorm:"type:varchar(50);not null" json:"type"` // WORKSPACE_INVITE, MEETING_ALERT, COMMENT_MENTION
	Content     string    `gorm:"type:text;not null" json:"content"`
	IsRead      bool      `gorm:"default:false" json:"is_read"`
	RelatedType *string   `gorm:"type:varchar(50)" json:"related_type,omitempty"` // WORKSPACE, MEETING
	RelatedID   *int64    `json:"related_id,omitempty"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Receiver User  `gorm:"foreignKey:ReceiverID" json:"receiver,omitempty"`
	Sender   *User `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
}

func (Notification) TableName() string {
	return "notifications"
}
