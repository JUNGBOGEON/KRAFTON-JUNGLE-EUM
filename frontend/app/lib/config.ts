export const APP_CONFIG = {
    // Notification polling interval in milliseconds
    NOTIFICATION_POLL_INTERVAL: 5000, // 5 seconds

    // Search debounce delay in milliseconds
    SEARCH_DEBOUNCE_DELAY: 300, // 300ms

    // Workspace name validation
    WORKSPACE_NAME_MIN_LENGTH: 2,
    WORKSPACE_NAME_MAX_LENGTH: 100,
} as const;
