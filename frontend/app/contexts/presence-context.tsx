"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Notification } from "../lib/api";
import { useAuth } from "../lib/auth-context";

const WS_BASE_URL = process.env.NEXT_PUBLIC_CHAT_WS_URL || 'ws://localhost:8080';

export interface PresenceData {
    user_id: number;
    status: string;
    last_heartbeat: number;
    custom_status_text?: string;
    custom_status_emoji?: string;
}

interface PresenceContextType {
    presenceMap: Record<number, PresenceData>;
    isConnected: boolean;
    updateStatus: (status: string) => void;
    updateCustomStatus: (text: string, emoji: string) => void;
    subscribePresence: (userIds: number[]) => void;
    notifications: Notification[];
    latestNotification: Notification | null;
}

const PresenceContext = createContext<PresenceContextType | undefined>(undefined);

const IDLE_THRESHOLD = 5 * 60 * 1000; // 5분
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

export function PresenceProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [presenceMap, setPresenceMap] = useState<Record<number, PresenceData>>({});
    const [isConnected, setIsConnected] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [latestNotification, setLatestNotification] = useState<Notification | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const subscribedUserIdsRef = useRef<Set<number>>(new Set());

    const subscribePresence = useCallback((userIds: number[]) => {
        userIds.forEach(id => subscribedUserIdsRef.current.add(id));

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "subscribe_presence",
                payload: { user_ids: userIds }
            }));
        }
    }, []);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.CONNECTING || wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        const ws = new WebSocket(`${WS_BASE_URL}/ws/notifications`);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("Global Notification/Presence WebSocket connected");
            setIsConnected(true);

            // Heartbeat
            pingIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "heartbeat" }));
                }
            }, HEARTBEAT_INTERVAL);

            // Re-subscribe if needed
            if (subscribedUserIdsRef.current.size > 0) {
                const ids = Array.from(subscribedUserIdsRef.current);
                ws.send(JSON.stringify({
                    type: "subscribe_presence",
                    payload: { user_ids: ids }
                }));
            }
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === "presence_update") {
                    const data = msg.payload as PresenceData;
                    setPresenceMap(prev => ({
                        ...prev,
                        [data.user_id]: data
                    }));
                } else if (msg.type === "presence_state_sync") {
                    const syncData = msg.payload as Record<string, PresenceData>;
                    setPresenceMap(prev => ({
                        ...prev,
                        ...syncData
                    }));
                } else if (msg.type === "notification") {
                    const notif = msg.payload as Notification;
                    setNotifications(prev => [notif, ...prev]);
                    setLatestNotification(notif);
                }
            } catch (e) {
                console.error("WS Message Parse Error", e);
            }
        };

        ws.onclose = () => {
            console.log("Global WS disconnected");
            setIsConnected(false);
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };
    }, []);

    const updateStatus = useCallback((status: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "change_status",
                payload: { status }
            }));
        }
    }, []);

    const updateCustomStatus = useCallback((text: string, emoji: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "change_status_message",
                payload: { text, emoji }
            }));

            // Optimistic Update (UI 즉시 반영)
            if (user) {
                setPresenceMap(prev => ({
                    ...prev,
                    [user.id]: {
                        ...prev[user.id],
                        user_id: user.id,
                        status: prev[user.id]?.status || "online",
                        last_heartbeat: Date.now(),
                        custom_status_text: text,
                        custom_status_emoji: emoji
                    }
                }));
            }
        }
    }, [user]);

    useEffect(() => {
        connect();
        return () => {
            if (wsRef.current) wsRef.current.close();
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        };
    }, [connect]);


    // Auto-Idle Detection Logic
    useEffect(() => {
        if (!user) return;

        let idleTimer: NodeJS.Timeout;
        let isIdle = false;

        const resetIdleTimer = () => {
            if (isIdle) {
                // Return to online if was idle (simple logic)
                updateStatus("online");
                isIdle = false;
            }

            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                updateStatus("idle");
                isIdle = true;
            }, IDLE_THRESHOLD);
        };

        resetIdleTimer();

        window.addEventListener("mousemove", resetIdleTimer);
        window.addEventListener("keydown", resetIdleTimer);
        window.addEventListener("click", resetIdleTimer);
        window.addEventListener("scroll", resetIdleTimer);

        return () => {
            clearTimeout(idleTimer);
            window.removeEventListener("mousemove", resetIdleTimer);
            window.removeEventListener("keydown", resetIdleTimer);
            window.removeEventListener("click", resetIdleTimer);
            window.removeEventListener("scroll", resetIdleTimer);
        };
    }, [user, updateStatus]);

    return (
        <PresenceContext.Provider value={{
            presenceMap,
            isConnected,
            updateStatus,
            updateCustomStatus,
            subscribePresence,
            notifications,
            latestNotification
        }}>
            {children}
        </PresenceContext.Provider>
    );
}

export function usePresence() {
    const context = useContext(PresenceContext);
    if (context === undefined) {
        throw new Error("usePresence must be used within a PresenceProvider");
    }
    return context;
}
