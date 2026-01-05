package constants

// Message processing constants
const (
	MaxMessageLength     = 65000 // Maximum characters for a single message
	MessageLengthWarning = 60000 // Warn users when approaching limit
)

// WebSocket configuration
const (
	WSReadBufferSize  = 4096
	WSWriteBufferSize = 4096
	WSPingInterval    = 30000 // milliseconds
)

// DM Feature constants
const (
	UnreadFetchDelay = 500 // milliseconds - delay before refetching unread counts
)
