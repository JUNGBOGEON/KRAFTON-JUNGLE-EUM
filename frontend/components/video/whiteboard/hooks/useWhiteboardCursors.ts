'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Room } from 'livekit-client';
import { RemoteCursor, CursorEvent, WhiteboardTool } from '../types';
import { CURSOR_SETTINGS } from '../constants';
import { getCursorColor } from '../utils';

interface ToolState {
    tool: WhiteboardTool;
    penColor: string;
    isDrawing: boolean;
}

interface UseWhiteboardCursorsOptions {
    room: Room | undefined;
    participantIdentities: string[];
    toolState: ToolState;
}

export interface LocalCursor {
    x: number;
    y: number;
    participantId: string;
    participantName: string;
    color: string;
    tool: WhiteboardTool;
    penColor?: string;
    isDrawing?: boolean;
}

interface UseWhiteboardCursorsReturn {
    remoteCursors: Map<string, RemoteCursor>;
    localCursor: LocalCursor | null;
    broadcastCursor: (x: number, y: number) => void;
    handleCursorEvent: (event: CursorEvent) => void;
    cursorColor: string;
}

export function useWhiteboardCursors({
    room,
    participantIdentities,
    toolState,
}: UseWhiteboardCursorsOptions): UseWhiteboardCursorsReturn {
    const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
    const [localCursor, setLocalCursor] = useState<LocalCursor | null>(null);
    const lastBroadcastRef = useRef<number>(0);
    const cursorColorRef = useRef<string>('');
    const toolStateRef = useRef<ToolState>(toolState);

    // Keep toolStateRef in sync
    useEffect(() => {
        toolStateRef.current = toolState;
    }, [toolState]);

    // Set cursor color on mount
    useEffect(() => {
        if (room?.localParticipant?.identity) {
            cursorColorRef.current = getCursorColor(room.localParticipant.identity);
        }
    }, [room?.localParticipant?.identity]);

    // Broadcast cursor position (throttled)
    const broadcastCursor = useCallback((x: number, y: number) => {
        if (!room?.localParticipant) return;

        const participantId = room.localParticipant.identity;
        const participantName = room.localParticipant.name || room.localParticipant.identity;
        const color = cursorColorRef.current;
        const { tool, penColor, isDrawing } = toolStateRef.current;

        // Update local cursor immediately (no throttle for local display)
        setLocalCursor({
            x,
            y,
            participantId,
            participantName,
            color,
            tool,
            penColor: tool === 'pen' ? penColor : undefined,
            isDrawing,
        });

        // Throttle broadcasting to other participants
        const now = Date.now();
        if (now - lastBroadcastRef.current < CURSOR_SETTINGS.broadcastThrottleMs) return;
        lastBroadcastRef.current = now;

        const cursorEvent: CursorEvent = {
            type: 'cursor',
            x,
            y,
            participantId,
            participantName,
            color,
            tool,
            penColor: tool === 'pen' ? penColor : undefined,
            isDrawing,
        };

        const encoder = new TextEncoder();
        room.localParticipant.publishData(
            encoder.encode(JSON.stringify(cursorEvent)),
            { reliable: false }
        );
    }, [room]);

    // Handle incoming cursor event
    const handleCursorEvent = useCallback((event: CursorEvent) => {
        if (!room?.localParticipant) return;
        if (event.participantId === room.localParticipant.identity) return;

        setRemoteCursors(prev => {
            const newMap = new Map(prev);
            newMap.set(event.participantId, {
                x: event.x,
                y: event.y,
                participantId: event.participantId,
                participantName: event.participantName,
                color: event.color,
                lastUpdate: Date.now(),
                tool: event.tool || 'pen',
                penColor: event.penColor,
                isDrawing: event.isDrawing,
            });
            return newMap;
        });
    }, [room?.localParticipant]);

    // Clean up stale cursors
    useEffect(() => {
        const cleanupInterval = setInterval(() => {
            const now = Date.now();
            setRemoteCursors(prev => {
                const newMap = new Map(prev);
                let changed = false;
                newMap.forEach((cursor, id) => {
                    if (now - cursor.lastUpdate > CURSOR_SETTINGS.staleTimeoutMs) {
                        newMap.delete(id);
                        changed = true;
                    }
                });
                return changed ? newMap : prev;
            });
        }, CURSOR_SETTINGS.cleanupIntervalMs);

        return () => clearInterval(cleanupInterval);
    }, []);

    // Remove cursor when participant disconnects
    useEffect(() => {
        const remoteIds = new Set(participantIdentities);

        setRemoteCursors(prev => {
            const newMap = new Map(prev);
            let changed = false;
            newMap.forEach((_, id) => {
                if (!remoteIds.has(id)) {
                    newMap.delete(id);
                    changed = true;
                }
            });
            return changed ? newMap : prev;
        });
    }, [participantIdentities]);

    return {
        remoteCursors,
        localCursor,
        broadcastCursor,
        handleCursorEvent,
        cursorColor: cursorColorRef.current,
    };
}
