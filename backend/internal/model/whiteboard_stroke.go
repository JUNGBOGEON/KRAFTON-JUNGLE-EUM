package model

import (
	"time"
)

// WhiteboardStroke 화이트보드 획 데이터
type WhiteboardStroke struct {
	ID         int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	MeetingID  int64      `gorm:"not null;index:idx_meeting_created" json:"meeting_id"`
	UserID     int64      `gorm:"not null" json:"user_id"`
	StrokeData string     `gorm:"type:jsonb;not null" json:"stroke_data"` // JSON array of points
	Layer      int        `gorm:"default:0" json:"layer"`
	IsDeleted  bool       `gorm:"default:false;index" json:"is_deleted"`
	DeletedAt  *time.Time `json:"deleted_at,omitempty"`
	CreatedAt  time.Time  `gorm:"autoCreateTime;index:idx_meeting_created" json:"created_at"`

	// Relations
	Meeting Meeting `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
	User    User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (WhiteboardStroke) TableName() string {
	return "whiteboard_strokes"
}
