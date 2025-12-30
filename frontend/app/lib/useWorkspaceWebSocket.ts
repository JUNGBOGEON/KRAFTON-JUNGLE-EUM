import { useEffect, useCallback, useRef } from 'react';

// 쿠키에서 값 추출하는 헬퍼 함수
function getCookie(name: string): string | null {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
        return parts.pop()?.split(';').shift() || null;
    }
    return null;
}

interface WorkspaceMemberJoinedEvent {
    type: 'workspace_member_joined';
    content: string;
    related_id: number;
    sender: {
        id: number;
        nickname: string;
        email: string;
        profile_img?: string;
    };
}

interface UseWorkspaceWebSocketOptions {
    workspaceId: number;
    onMemberJoined?: (event: WorkspaceMemberJoinedEvent) => void;
    enabled?: boolean;
}

export function useWorkspaceWebSocket({
    workspaceId,
    onMemberJoined,
    enabled = true,
}: UseWorkspaceWebSocketOptions) {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    const connect = useCallback(() => {
        if (!enabled || !workspaceId) return;

        try {
            // 쿠키에서 access_token 가져오기
            console.log('🍪 All cookies:', document.cookie);
            const token = getCookie('access_token');
            console.log('🔑 Extracted token:', token ? 'Found' : 'Not found');

            // WebSocket 연결 (토큰을 쿼리 파라미터로 전달)
            const wsUrl = token
                ? `ws://localhost:8080/ws/notifications?token=${encodeURIComponent(token)}`
                : 'ws://localhost:8080/ws/notifications';

            console.log('🔌 Connecting to WebSocket...', token ? wsUrl.replace(/token=[^&]+/, 'token=***') : wsUrl);
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('✅ WebSocket connected for workspace:', workspaceId);
            };

            ws.onmessage = (event) => {
                console.log('📨 WebSocket raw message:', event.data);

                try {
                    const message = JSON.parse(event.data);
                    console.log('📦 Parsed message:', message);

                    // 백엔드는 {type: "notification", payload: {...}} 형식으로 보냄
                    if (message.type === 'notification' && message.payload) {
                        const data = message.payload;
                        console.log('🎯 Notification payload:', data);

                        // workspace_member_joined 이벤트 처리
                        if (
                            data.type === 'workspace_member_joined' &&
                            data.related_id === workspaceId &&
                            onMemberJoined
                        ) {
                            console.log('🎉 New member joined:', data);
                            onMemberJoined(data);
                        }
                    }
                } catch (error) {
                    console.error('WebSocket message parse error:', error);
                }
            };

            ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };

            ws.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                wsRef.current = null;

                // 3초 후 재연결 시도
                if (enabled) {
                    reconnectTimeoutRef.current = setTimeout(() => {
                        console.log('🔄 Attempting to reconnect...');
                        connect();
                    }, 3000);
                }
            };
        } catch (error) {
            console.error('WebSocket connection error:', error);
        }
    }, [workspaceId, onMemberJoined, enabled]);

    useEffect(() => {
        connect();

        // Cleanup
        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connect]);

    return {
        isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    };
}
