package model

import (
	"time"
)

type Poll struct {
	ID        uint         `gorm:"primaryKey" json:"id"`
	MeetingID int64        `gorm:"index" json:"meetingId"` // Room Name or Meeting ID
	Question  string       `gorm:"type:text;not null" json:"question"`
	CreatedAt time.Time    `json:"createdAt"`
	IsActive  bool         `json:"isActive"` // Only on active poll at a time? Or multiple?
	Options   []PollOption `gorm:"foreignKey:PollID" json:"options"`
}

type PollOption struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	PollID    uint   `gorm:"index" json:"pollId"`
	Text      string `gorm:"type:text;not null" json:"text"`
	VoteCount int    `json:"voteCount"`
}

// PollVote tracks who voted to prevent double voting (anonymous to others, but known to system for integrity)
// If we want true anonymity, we might just hash the user ID or just trust the client (not recommended).
// Let's store UserID but only return aggregate counts to frontend.
type PollVote struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	PollID    uint      `gorm:"index" json:"pollId"`
	OptionID  uint      `json:"optionId"`
	UserID    int64     `gorm:"index" json:"userId"` // Who voted
	CreatedAt time.Time `json:"createdAt"`
}
