"use client";

import { useEffect, useRef, useCallback, useState } from "react";

const WS_BASE_URL = process.env.NEXT_PUBLIC_CHAT_WS_URL || 'ws://localhost:8080';

export interface VoiceParticipant {
    identity: string;
    name: string;
    channelId?: string;
    profileImg?: string;
    joinedAt?: number;
}

interface ParticipantJoinPayload {
    channelId: string;
    identity: string;
    name: string;
    profileImg?: string;
}

interface ParticipantLeavePayload {
    channelId: string;
    identity: string;
}

interface ConnectedPayload {
    participants: Record<string, VoiceParticipant[]>;
}

interface VoiceParticipantsWSMessage {
    type: "connected" | "join" | "leave" | "ping" | "pong" | "error";
    payload?: ConnectedPayload | ParticipantJoinPayload | ParticipantLeavePayload;
}

interface UseVoiceParticipantsWebSocketOptions {
    workspaceId: number;
    onParticipantJoin?: (channelId: string, participant: VoiceParticipant) => void;
    onParticipantLeave?: (channelId: string, identity: string) => void;
    onParticipantsInit?: (participants: Record<string, VoiceParticipant[]>) => void;
    enabled?: boolean;
}

export function useVoiceParticipantsWebSocket({
    workspaceId,
    onParticipantJoin,
    onParticipantLeave,
    onParticipantsInit,
    enabled = true,
}: UseVoiceParticipantsWebSocketOptions) {
    const wsRef = useRef<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef(true);

    // 콜백 refs (최신 값 유지)
    const onParticipantJoinRef = useRef(onParticipantJoin);
    const onParticipantLeaveRef = useRef(onParticipantLeave);
    const onParticipantsInitRef = useRef(onParticipantsInit);

    useEffect(() => {
        onParticipantJoinRef.current = onParticipantJoin;
        onParticipantLeaveRef.current = onParticipantLeave;
        onParticipantsInitRef.current = onParticipantsInit;
    }, [onParticipantJoin, onParticipantLeave, onParticipantsInit]);

    const connect = useCallback(() => {
        if (!enabled || !workspaceId) return;

        // 이미 연결중이거나 연결된 상태면 무시
        if (wsRef.current?.readyState === WebSocket.CONNECTING ||
            wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        const ws = new WebSocket(`${WS_BASE_URL}/ws/voice-participants/${workspaceId}`);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!isMountedRef.current) return;
            console.log("Voice Participants WebSocket connected");
            setIsConnected(true);

            // 30초마다 ping 전송 (연결 유지)
            pingIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "ping" }));
                }
            }, 30000);
        };

        ws.onmessage = (event) => {
            if (!isMountedRef.current) return;

            try {
                const data: VoiceParticipantsWSMessage = JSON.parse(event.data);

                switch (data.type) {
                    case "connected":
                        // 초기 참가자 목록 수신
                        if (data.payload && onParticipantsInitRef.current) {
                            const payload = data.payload as ConnectedPayload;
                            onParticipantsInitRef.current(payload.participants);
                        }
                        break;

                    case "join":
                        // 참가자 입장
                        if (data.payload && onParticipantJoinRef.current) {
                            const payload = data.payload as ParticipantJoinPayload;
                            onParticipantJoinRef.current(payload.channelId, {
                                identity: payload.identity,
                                name: payload.name,
                                profileImg: payload.profileImg,
                                channelId: payload.channelId,
                            });
                        }
                        break;

                    case "leave":
                        // 참가자 퇴장
                        if (data.payload && onParticipantLeaveRef.current) {
                            const payload = data.payload as ParticipantLeavePayload;
                            onParticipantLeaveRef.current(payload.channelId, payload.identity);
                        }
                        break;

                    case "pong":
                        // ping 응답 (무시)
                        break;
                }
            } catch (e) {
                console.error("Failed to parse voice participants WebSocket message:", e);
            }
        };

        ws.onclose = () => {
            if (!isMountedRef.current) return;
            setIsConnected(false);

            // ping interval 정리
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }

            // 재연결 시도 (3초 후)
            if (enabled && isMountedRef.current) {
                reconnectTimeoutRef.current = setTimeout(connect, 3000);
            }
        };

        ws.onerror = () => {
            // 연결 실패는 onclose에서 처리되므로 여기서는 무시
        };
    }, [enabled, workspaceId]);

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setIsConnected(false);
    }, []);

    // 참가자 입장 알림 전송
    const sendJoin = useCallback((channelId: string, identity: string, name: string, profileImg?: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "join",
                payload: { channelId, identity, name, profileImg },
            }));
        }
    }, []);

    // 참가자 퇴장 알림 전송
    const sendLeave = useCallback((channelId: string, identity: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "leave",
                payload: { channelId, identity },
            }));
        }
    }, []);

    useEffect(() => {
        isMountedRef.current = true;

        if (enabled) {
            connect();
        } else {
            disconnect();
        }

        return () => {
            isMountedRef.current = false;
            disconnect();
        };
    }, [enabled, connect, disconnect]);

    return { isConnected, sendJoin, sendLeave, reconnect: connect };
}
