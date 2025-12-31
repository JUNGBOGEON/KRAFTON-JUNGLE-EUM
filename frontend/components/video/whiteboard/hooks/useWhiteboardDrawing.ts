'use client';

import { useRef, useCallback, MutableRefObject } from 'react';
import * as PIXI from 'pixi.js';
import { Room } from 'livekit-client';
import { DrawEvent, GraphicsCache, WhiteboardTool } from '../types';
import { apiClient } from '@/app/lib/api';

interface UseWhiteboardDrawingOptions {
    room: Room | undefined;
    drawingContainerRef: MutableRefObject<PIXI.Container | null>;
    toolRef: MutableRefObject<WhiteboardTool>;
    penColorRef: MutableRefObject<number>;
    penSizeRef: MutableRefObject<number>;
    eraserSizeRef: MutableRefObject<number>;
    smoothnessRef: MutableRefObject<number>;
    scaleRef: MutableRefObject<number>;
    panOffsetRef: MutableRefObject<{ x: number; y: number }>;
    onUndoRedoChange: (canUndo: boolean, canRedo: boolean) => void;
    onCursorMove: (x: number, y: number) => void;
}

interface UseWhiteboardDrawingReturn {
    drawLine: (x: number, y: number, prevX: number, prevY: number, color: number, width: number) => void;
    handlePointerDown: (e: PointerEvent, canvas: HTMLCanvasElement) => void;
    handlePointerMove: (e: PointerEvent, canvas: HTMLCanvasElement) => void;
    handlePointerUp: (e: PointerEvent, canvas: HTMLCanvasElement) => void;
    currentGraphicsRef: MutableRefObject<GraphicsCache | null>;
}

export function useWhiteboardDrawing({
    room,
    drawingContainerRef,
    toolRef,
    penColorRef,
    penSizeRef,
    eraserSizeRef,
    smoothnessRef,
    scaleRef,
    panOffsetRef,
    onUndoRedoChange,
    onCursorMove,
}: UseWhiteboardDrawingOptions): UseWhiteboardDrawingReturn {
    const currentGraphicsRef = useRef<GraphicsCache | null>(null);
    const isDrawingRef = useRef(false);
    const currentStrokeRef = useRef<DrawEvent[]>([]);
    const prevRawPointRef = useRef<{ x: number; y: number } | null>(null);
    const prevRenderedPointRef = useRef<{ x: number; y: number } | null>(null);

    const getLocalPoint = useCallback((clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left - panOffsetRef.current.x) / scaleRef.current,
            y: (clientY - rect.top - panOffsetRef.current.y) / scaleRef.current,
        };
    }, [panOffsetRef, scaleRef]);

    const drawLine = useCallback((
        x: number,
        y: number,
        prevX: number,
        prevY: number,
        color: number,
        width: number
    ) => {
        if (!drawingContainerRef.current) return;

        const isEraser = color === 0xffffff;

        let graphics: PIXI.Graphics;
        const sameProp = currentGraphicsRef.current &&
            currentGraphicsRef.current.color === color &&
            currentGraphicsRef.current.width === width &&
            currentGraphicsRef.current.isEraser === isEraser;

        if (sameProp && currentGraphicsRef.current) {
            graphics = currentGraphicsRef.current.graphics;
        } else {
            graphics = new PIXI.Graphics();
            if (isEraser) {
                graphics.blendMode = 'erase';
            }
            drawingContainerRef.current.addChild(graphics);

            currentGraphicsRef.current = {
                graphics,
                color,
                width,
                isEraser,
            };
        }

        graphics.moveTo(prevX, prevY);
        graphics.lineTo(x, y);
        graphics.stroke({ width, color, cap: 'round', join: 'round' });
    }, [drawingContainerRef]);

    const broadcastDrawEvent = useCallback((event: DrawEvent) => {
        if (room) {
            const str = JSON.stringify(event);
            const encoder = new TextEncoder();
            room.localParticipant.publishData(encoder.encode(str), { reliable: true });
        }
    }, [room]);

    const handlePointerDown = useCallback((e: PointerEvent, canvas: HTMLCanvasElement) => {
        if (toolRef.current === 'hand' || e.button === 1) return;

        canvas.setPointerCapture(e.pointerId);
        isDrawingRef.current = true;

        const startPoint = getLocalPoint(e.clientX, e.clientY, canvas);
        prevRawPointRef.current = startPoint;
        prevRenderedPointRef.current = startPoint;
        currentStrokeRef.current = [];
    }, [getLocalPoint, toolRef]);

    const handlePointerMove = useCallback((e: PointerEvent, canvas: HTMLCanvasElement) => {
        // Always broadcast cursor position
        const cursorPoint = getLocalPoint(e.clientX, e.clientY, canvas);
        onCursorMove(cursorPoint.x, cursorPoint.y);

        if (!isDrawingRef.current || !prevRawPointRef.current || !prevRenderedPointRef.current) return;

        const rawPoint = getLocalPoint(e.clientX, e.clientY, canvas);
        const sLevel = smoothnessRef.current;

        const dist = Math.sqrt(
            Math.pow(rawPoint.x - prevRawPointRef.current.x, 2) +
            Math.pow(rawPoint.y - prevRawPointRef.current.y, 2)
        );

        const distThresholdScreen = sLevel === 0 ? 0 : 0.5 + (sLevel * 0.5);
        const threshold = distThresholdScreen / scaleRef.current;

        if (dist < threshold) return;

        let targetPoint = rawPoint;
        if (sLevel > 0) {
            targetPoint = {
                x: (prevRawPointRef.current.x + rawPoint.x) / 2,
                y: (prevRawPointRef.current.y + rawPoint.y) / 2,
            };
        }

        const color = toolRef.current === 'eraser' ? 0xffffff : penColorRef.current;
        const baseSize = toolRef.current === 'eraser' ? eraserSizeRef.current : penSizeRef.current;
        const width = baseSize / scaleRef.current;

        drawLine(targetPoint.x, targetPoint.y, prevRenderedPointRef.current.x, prevRenderedPointRef.current.y, color, width);

        const event: DrawEvent = {
            type: 'draw',
            x: targetPoint.x,
            y: targetPoint.y,
            prevX: prevRenderedPointRef.current.x,
            prevY: prevRenderedPointRef.current.y,
            color,
            width,
        };

        broadcastDrawEvent(event);
        currentStrokeRef.current.push(event);

        prevRenderedPointRef.current = targetPoint;
        prevRawPointRef.current = rawPoint;
    }, [getLocalPoint, toolRef, penColorRef, penSizeRef, eraserSizeRef, smoothnessRef, scaleRef, drawLine, broadcastDrawEvent, onCursorMove]);

    const handlePointerUp = useCallback(async (e: PointerEvent, canvas: HTMLCanvasElement) => {
        canvas.releasePointerCapture(e.pointerId);

        if (isDrawingRef.current && prevRenderedPointRef.current) {
            const finalPoint = getLocalPoint(e.clientX, e.clientY, canvas);
            const color = toolRef.current === 'eraser' ? 0xffffff : penColorRef.current;
            const baseSize = toolRef.current === 'eraser' ? eraserSizeRef.current : penSizeRef.current;
            const width = baseSize / scaleRef.current;

            drawLine(finalPoint.x, finalPoint.y, prevRenderedPointRef.current.x, prevRenderedPointRef.current.y, color, width);

            const event: DrawEvent = {
                type: 'draw',
                x: finalPoint.x,
                y: finalPoint.y,
                prevX: prevRenderedPointRef.current.x,
                prevY: prevRenderedPointRef.current.y,
                color,
                width,
            };

            broadcastDrawEvent(event);
            currentStrokeRef.current.push(event);
        }

        isDrawingRef.current = false;
        prevRawPointRef.current = null;
        prevRenderedPointRef.current = null;
        currentGraphicsRef.current = null;

        // Save stroke to server
        if (currentStrokeRef.current.length > 0 && room?.name) {
            try {
                const data = await apiClient.handleWhiteboardAction(room.name, { stroke: currentStrokeRef.current });
                if (data.success) {
                    onUndoRedoChange(data.canUndo, data.canRedo);
                }
            } catch (err) {
                console.error('Failed to save stroke:', err);
            }
        }
        currentStrokeRef.current = [];
    }, [getLocalPoint, toolRef, penColorRef, penSizeRef, eraserSizeRef, scaleRef, drawLine, broadcastDrawEvent, room, onUndoRedoChange]);

    return {
        drawLine,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        currentGraphicsRef,
    };
}
