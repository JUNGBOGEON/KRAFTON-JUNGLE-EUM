package model

import (
	"time"
)

// WhiteboardSnapshot 화이트보드 획 묶음 (청킹) 데이터
type WhiteboardSnapshot struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	MeetingID int64     `gorm:"not null;index:idx_snapshot_meeting" json:"meeting_id"`
	Data      string    `gorm:"type:jsonb;not null" json:"data"` // aggregated strokes data
	StartID   int64     `json:"start_id"`                        // First stroke ID in this chunk
	EndID     int64     `json:"end_id"`                          // Last stroke ID in this chunk
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Meeting Meeting `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
}

func (WhiteboardSnapshot) TableName() string {
	return "whiteboard_snapshots"
}
