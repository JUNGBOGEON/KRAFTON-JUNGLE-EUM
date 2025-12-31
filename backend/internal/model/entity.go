package model

import (
	"time"
)

// User 사용자
type User struct {
	ID         int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Email      string    `gorm:"type:varchar(255);uniqueIndex;not null" json:"email"`
	Nickname   string    `gorm:"type:varchar(100);not null" json:"nickname"`
	ProfileImg *string   `gorm:"type:text" json:"profile_img,omitempty"`
	Provider   *string   `gorm:"type:varchar(50)" json:"provider,omitempty"`
	ProviderID *string   `gorm:"type:varchar(255)" json:"provider_id,omitempty"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Workspaces   []WorkspaceMember `gorm:"foreignKey:UserID" json:"workspaces,omitempty"`
	Participants []Participant     `gorm:"foreignKey:UserID" json:"participants,omitempty"`
}

func (User) TableName() string {
	return "users"
}

// Workspace 워크스페이스
type Workspace struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Name      string    `gorm:"type:varchar(100);not null" json:"name"`
	OwnerID   int64     `gorm:"not null" json:"owner_id"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Owner          User              `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Members        []WorkspaceMember `gorm:"foreignKey:WorkspaceID" json:"members,omitempty"`
	Roles          []Role            `gorm:"foreignKey:WorkspaceID" json:"roles,omitempty"`
	Meetings       []Meeting         `gorm:"foreignKey:WorkspaceID" json:"meetings,omitempty"`
	CalendarEvents []CalendarEvent   `gorm:"foreignKey:WorkspaceID" json:"calendar_events,omitempty"`
	Files          []WorkspaceFile   `gorm:"foreignKey:WorkspaceID" json:"files,omitempty"`
}

func (Workspace) TableName() string {
	return "workspaces"
}

// Role 역할
type Role struct {
	ID          int64   `gorm:"primaryKey;autoIncrement" json:"id"`
	WorkspaceID int64   `gorm:"not null" json:"workspace_id"`
	Name        string  `gorm:"type:varchar(50);not null" json:"name"`
	Color       *string `gorm:"type:varchar(20)" json:"color,omitempty"`
	IsDefault   bool    `gorm:"default:false" json:"is_default"`

	// Relations
	Workspace   Workspace        `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	Permissions []RolePermission `gorm:"foreignKey:RoleID" json:"permissions,omitempty"`
}

func (Role) TableName() string {
	return "roles"
}

// RolePermission 역할 권한
type RolePermission struct {
	RoleID         int64  `gorm:"primaryKey" json:"role_id"`
	PermissionCode string `gorm:"primaryKey;type:varchar(50);not null" json:"permission_code"`

	// Relations
	Role Role `gorm:"foreignKey:RoleID" json:"role,omitempty"`
}

func (RolePermission) TableName() string {
	return "role_permissions"
}

// WorkspaceMember 워크스페이스 멤버
type WorkspaceMember struct {
	ID          int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	WorkspaceID int64     `gorm:"not null" json:"workspace_id"`
	UserID      int64     `gorm:"not null" json:"user_id"`
	RoleID      *int64    `json:"role_id,omitempty"`
	Status      string    `gorm:"type:varchar(20);default:'ACTIVE'" json:"status"` // PENDING, ACTIVE, LEFT
	JoinedAt    time.Time `gorm:"autoCreateTime" json:"joined_at"`

	// Relations
	Workspace Workspace `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	User      User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Role      *Role     `gorm:"foreignKey:RoleID" json:"role,omitempty"`
}

func (WorkspaceMember) TableName() string {
	return "workspace_members"
}

// Meeting 회의
type Meeting struct {
	ID          int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	WorkspaceID *int64     `json:"workspace_id,omitempty"`
	HostID      int64      `gorm:"not null" json:"host_id"`
	Title       string     `gorm:"type:varchar(200);not null" json:"title"`
	Code        string     `gorm:"type:varchar(100);uniqueIndex;not null" json:"code"`
	Type        string     `gorm:"type:varchar(20);not null" json:"type"` // VIDEO, VOICE_ONLY
	Status      string     `gorm:"type:varchar(20);default:'SCHEDULED'" json:"status"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	EndedAt     *time.Time `json:"ended_at,omitempty"`
	CreatedAt   time.Time  `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Workspace    *Workspace    `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	Host         User          `gorm:"foreignKey:HostID" json:"host,omitempty"`
	Participants []Participant `gorm:"foreignKey:MeetingID" json:"participants,omitempty"`
	Whiteboards  []Whiteboard  `gorm:"foreignKey:MeetingID" json:"whiteboards,omitempty"`
	ChatLogs     []ChatLog     `gorm:"foreignKey:MeetingID" json:"chat_logs,omitempty"`
	VoiceRecords []VoiceRecord `gorm:"foreignKey:MeetingID" json:"voice_records,omitempty"`
}

func (Meeting) TableName() string {
	return "meetings"
}

// Participant 회의 참가자
type Participant struct {
	ID        int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	MeetingID int64      `gorm:"not null" json:"meeting_id"`
	UserID    *int64     `json:"user_id,omitempty"`                     // 비회원 허용
	Role      string     `gorm:"type:varchar(20);not null" json:"role"` // HOST, PRESENTER, GUEST
	JoinedAt  time.Time  `gorm:"autoCreateTime" json:"joined_at"`
	LeftAt    *time.Time `json:"left_at,omitempty"`

	// Relations
	Meeting Meeting `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
	User    *User   `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (Participant) TableName() string {
	return "participants"
}

// Whiteboard 화이트보드
type Whiteboard struct {
	ID          int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	MeetingID   *int64    `json:"meeting_id,omitempty"`
	WorkspaceID int64     `gorm:"not null" json:"workspace_id"`
	Data        *string   `gorm:"type:jsonb" json:"data,omitempty"` // JSONB
	RedoData    *string   `gorm:"type:jsonb" json:"redo_data,omitempty"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relations
	Meeting   *Meeting  `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
	Workspace Workspace `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
}

func (Whiteboard) TableName() string {
	return "whiteboards"
}

// ChatLog 채팅 로그
type ChatLog struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	MeetingID int64     `gorm:"not null" json:"meeting_id"`
	SenderID  *int64    `json:"sender_id,omitempty"`
	Message   *string   `gorm:"type:text" json:"message,omitempty"`
	Type      string    `gorm:"type:varchar(20);default:'TEXT'" json:"type"` // TEXT, SYSTEM
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Meeting Meeting `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
	Sender  *User   `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
}

func (ChatLog) TableName() string {
	return "chat_logs"
}

// VoiceRecord 음성 기록 (STT 결과)
type VoiceRecord struct {
	ID            int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	MeetingID     int64     `gorm:"not null;index" json:"meeting_id"`
	SpeakerID     *int64    `json:"speaker_id,omitempty"`
	SpeakerName   string    `gorm:"type:varchar(100)" json:"speaker_name"`
	Original      string    `gorm:"type:text;not null" json:"original"`       // STT 원본 텍스트
	Translated    *string   `gorm:"type:text" json:"translated,omitempty"`    // 번역된 텍스트 (있는 경우)
	TargetLang    *string   `gorm:"type:varchar(10)" json:"target_lang,omitempty"` // 번역 대상 언어
	CreatedAt     time.Time `gorm:"autoCreateTime;index" json:"created_at"`

	// Relations
	Meeting Meeting `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
	Speaker *User   `gorm:"foreignKey:SpeakerID" json:"speaker,omitempty"`
}

func (VoiceRecord) TableName() string {
	return "voice_records"
}

// CalendarEvent 캘린더 이벤트
type CalendarEvent struct {
	ID              int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	WorkspaceID     int64     `gorm:"not null" json:"workspace_id"`
	CreatorID       *int64    `json:"creator_id,omitempty"`
	Title           string    `gorm:"type:varchar(255);not null" json:"title"`
	Description     *string   `gorm:"type:text" json:"description,omitempty"`
	StartAt         time.Time `gorm:"not null" json:"start_at"`
	EndAt           time.Time `gorm:"not null" json:"end_at"`
	IsAllDay        bool      `gorm:"default:false" json:"is_all_day"`
	LinkedMeetingID *int64    `json:"linked_meeting_id,omitempty"`
	Color           *string   `gorm:"type:varchar(20)" json:"color,omitempty"`
	CreatedAt       time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Workspace     Workspace       `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	Creator       *User           `gorm:"foreignKey:CreatorID" json:"creator,omitempty"`
	LinkedMeeting *Meeting        `gorm:"foreignKey:LinkedMeetingID" json:"linked_meeting,omitempty"`
	Attendees     []EventAttendee `gorm:"foreignKey:EventID" json:"attendees,omitempty"`
}

func (CalendarEvent) TableName() string {
	return "calendar_events"
}

// EventAttendee 일정 참여자
type EventAttendee struct {
	EventID   int64     `gorm:"primaryKey" json:"event_id"`
	UserID    int64     `gorm:"primaryKey" json:"user_id"`
	Status    string    `gorm:"type:varchar(20);default:'PENDING'" json:"status"` // PENDING, ACCEPTED, DECLINED
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Event CalendarEvent `gorm:"foreignKey:EventID" json:"event,omitempty"`
	User  User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (EventAttendee) TableName() string {
	return "event_attendees"
}

// WorkspaceFile 워크스페이스 파일/폴더
type WorkspaceFile struct {
	ID               int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	WorkspaceID      int64     `gorm:"not null" json:"workspace_id"`
	UploaderID       *int64    `json:"uploader_id,omitempty"`
	ParentFolderID   *int64    `json:"parent_folder_id,omitempty"`
	Name             string    `gorm:"type:varchar(255);not null" json:"name"`
	Type             string    `gorm:"type:varchar(20);not null" json:"type"` // FILE, FOLDER
	FileURL          *string   `gorm:"type:text" json:"file_url,omitempty"`
	FileSize         *int64    `json:"file_size,omitempty"`
	MimeType         *string   `gorm:"type:varchar(100)" json:"mime_type,omitempty"`
	S3Key            *string   `gorm:"type:varchar(500)" json:"s3_key,omitempty"` // AWS S3 객체 키
	RelatedMeetingID *int64    `json:"related_meeting_id,omitempty"`
	CreatedAt        time.Time `gorm:"autoCreateTime" json:"created_at"`

	// Relations
	Workspace      Workspace       `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	Uploader       *User           `gorm:"foreignKey:UploaderID" json:"uploader,omitempty"`
	ParentFolder   *WorkspaceFile  `gorm:"foreignKey:ParentFolderID" json:"parent_folder,omitempty"`
	Children       []WorkspaceFile `gorm:"foreignKey:ParentFolderID" json:"children,omitempty"`
	RelatedMeeting *Meeting        `gorm:"foreignKey:RelatedMeetingID" json:"related_meeting,omitempty"`
}

func (WorkspaceFile) TableName() string {
	return "workspace_files"
}
