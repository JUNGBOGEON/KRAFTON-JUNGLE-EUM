'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { apiClient } from '@/app/lib/api';

import { DrawEvent, ClearEvent, RefetchEvent, CursorEvent, WhiteboardTool } from './types';
import { ZOOM_SETTINGS, GRID_SETTINGS, TOOL_SETTINGS } from './constants';
import { hexToNumber, generatePenCursor, generateEraserCursor } from './utils';
import { useWhiteboardCursors } from './hooks/useWhiteboardCursors';
import { ZoomControls } from './components/ZoomControls';
import { RemoteCursors } from './components/RemoteCursors';
import { WhiteboardToolbar } from './components/WhiteboardToolbar';

export default function WhiteboardCanvas() {
    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const drawingContainerRef = useRef<PIXI.Container | null>(null);
    const currentGraphicsRef = useRef<{
        graphics: PIXI.Graphics;
        color: number;
        width: number;
        isEraser: boolean;
    } | null>(null);

    // Tool State
    const toolRef = useRef<WhiteboardTool>('pen');
    const [activeTool, setActiveTool] = useState<WhiteboardTool>('pen');
    const penSizeRef = useRef(TOOL_SETTINGS.pen.defaultSize);
    const eraserSizeRef = useRef(TOOL_SETTINGS.eraser.defaultSize);
    const penColorRef = useRef(0x000000);
    const smoothnessRef = useRef(TOOL_SETTINGS.smoothness.default);

    const [penSize, setPenSize] = useState(TOOL_SETTINGS.pen.defaultSize);
    const [eraserSize, setEraserSize] = useState(TOOL_SETTINGS.eraser.defaultSize);
    const [penColor, setPenColor] = useState('#000000');
    const [smoothness, setSmoothness] = useState(TOOL_SETTINGS.smoothness.default);

    // View State
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const panOffsetRef = useRef({ x: 0, y: 0 });
    const [scale, setScale] = useState(ZOOM_SETTINGS.default);
    const scaleRef = useRef(ZOOM_SETTINGS.default);

    // History State
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // UI State
    const [isInteracting, setIsInteracting] = useState(false);
    const [isMiddlePanning, setIsMiddlePanning] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const [triggerLoad, setTriggerLoad] = useState(0);

    // LiveKit
    const room = useRoomContext();
    const participants = useParticipants();

    // Cursor Hook - pass tool state for cursor display
    const { remoteCursors, localCursor, broadcastCursor, handleCursorEvent } = useWhiteboardCursors({
        room,
        participantIdentities: participants.filter(p => !p.isLocal).map(p => p.identity),
        toolState: {
            tool: activeTool,
            penColor: penColor,
            isDrawing: isDrawing,
        },
    });

    // Drawing function
    const drawLine = useCallback((x: number, y: number, prevX: number, prevY: number, color: number, width: number) => {
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
    }, []);

    // PIXI initialization
    useEffect(() => {
        if (!containerRef.current) return;
        if (appRef.current) return;

        const updateContainerTransform = () => {
            if (drawingContainerRef.current) {
                drawingContainerRef.current.position.set(panOffsetRef.current.x, panOffsetRef.current.y);
                drawingContainerRef.current.scale.set(scaleRef.current);
            }
        };

        let currentStroke: DrawEvent[] = [];
        let isDrawing = false;
        let isPanning = false;
        let lastPanPoint: { x: number; y: number } | null = null;
        let canvasElement: HTMLCanvasElement | null = null;
        let prevRawPoint: { x: number; y: number } | null = null;
        let prevRenderedPoint: { x: number; y: number } | null = null;

        const getLocalPoint = (clientX: number, clientY: number) => {
            if (!canvasElement) return { x: 0, y: 0 };
            const rect = canvasElement.getBoundingClientRect();
            return {
                x: (clientX - rect.left - panOffsetRef.current.x) / scaleRef.current,
                y: (clientY - rect.top - panOffsetRef.current.y) / scaleRef.current,
            };
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();

            if (e.ctrlKey) {
                const zoomFactor = -e.deltaY * 0.002;
                zoom(zoomFactor, e.clientX, e.clientY);
            } else {
                const panSpeed = 1;
                const dx = -e.deltaX * panSpeed;
                const dy = -e.deltaY * panSpeed;

                panOffsetRef.current = {
                    x: panOffsetRef.current.x + dx,
                    y: panOffsetRef.current.y + dy,
                };
                setPanOffset({ ...panOffsetRef.current });
                updateContainerTransform();
            }
        };

        const onPointerDown = (e: PointerEvent) => {
            if (!canvasElement) return;

            setIsInteracting(true);
            canvasElement.setPointerCapture(e.pointerId);

            if (e.button === 1 || toolRef.current === 'hand') {
                isPanning = true;
                if (e.button === 1) setIsMiddlePanning(true);
                lastPanPoint = { x: e.clientX, y: e.clientY };
                e.preventDefault();
                return;
            }

            isDrawing = true;
            setIsDrawing(true);
            const startPoint = getLocalPoint(e.clientX, e.clientY);
            prevRawPoint = startPoint;
            prevRenderedPoint = startPoint;
            currentStroke = [];
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!canvasElement) return;

            // Broadcast cursor position
            const cursorPoint = getLocalPoint(e.clientX, e.clientY);
            broadcastCursor(cursorPoint.x, cursorPoint.y);

            if (isPanning && lastPanPoint) {
                const dx = e.clientX - lastPanPoint.x;
                const dy = e.clientY - lastPanPoint.y;

                panOffsetRef.current = {
                    x: panOffsetRef.current.x + dx,
                    y: panOffsetRef.current.y + dy,
                };

                setPanOffset({ ...panOffsetRef.current });
                updateContainerTransform();
                lastPanPoint = { x: e.clientX, y: e.clientY };
                return;
            }

            if (!isDrawing || !prevRawPoint || !prevRenderedPoint) return;

            const rawPoint = getLocalPoint(e.clientX, e.clientY);
            const sLevel = smoothnessRef.current;

            const dist = Math.sqrt(
                Math.pow(rawPoint.x - prevRawPoint.x, 2) +
                Math.pow(rawPoint.y - prevRawPoint.y, 2)
            );

            const distThresholdScreen = sLevel === 0 ? 0 : 0.5 + (sLevel * 0.5);
            const threshold = distThresholdScreen / scaleRef.current;

            if (dist < threshold) return;

            let targetPoint = rawPoint;
            if (sLevel > 0) {
                targetPoint = {
                    x: (prevRawPoint.x + rawPoint.x) / 2,
                    y: (prevRawPoint.y + rawPoint.y) / 2,
                };
            }

            const color = toolRef.current === 'eraser' ? 0xffffff : penColorRef.current;
            const baseSize = toolRef.current === 'eraser' ? eraserSizeRef.current : penSizeRef.current;
            const width = baseSize / scaleRef.current;

            drawLine(targetPoint.x, targetPoint.y, prevRenderedPoint.x, prevRenderedPoint.y, color, width);

            const event: DrawEvent = {
                type: 'draw',
                x: targetPoint.x,
                y: targetPoint.y,
                prevX: prevRenderedPoint.x,
                prevY: prevRenderedPoint.y,
                color,
                width,
            };

            if (room) {
                const str = JSON.stringify(event);
                const encoder = new TextEncoder();
                room.localParticipant.publishData(encoder.encode(str), { reliable: true });
            }

            currentStroke.push(event);
            prevRenderedPoint = targetPoint;
            prevRawPoint = rawPoint;
        };

        const onPointerUp = async (e: PointerEvent) => {
            setIsInteracting(false);

            if (canvasElement) {
                canvasElement.releasePointerCapture(e.pointerId);
            }

            if (isPanning) {
                isPanning = false;
                setIsMiddlePanning(false);
                lastPanPoint = null;
                return;
            }

            if (isDrawing && prevRawPoint && prevRenderedPoint) {
                const finalRaw = getLocalPoint(e.clientX, e.clientY);
                const dest = finalRaw;

                const color = toolRef.current === 'eraser' ? 0xffffff : penColorRef.current;
                const baseSize = toolRef.current === 'eraser' ? eraserSizeRef.current : penSizeRef.current;
                const width = baseSize / scaleRef.current;

                drawLine(dest.x, dest.y, prevRenderedPoint.x, prevRenderedPoint.y, color, width);

                const event: DrawEvent = {
                    type: 'draw',
                    x: dest.x,
                    y: dest.y,
                    prevX: prevRenderedPoint.x,
                    prevY: prevRenderedPoint.y,
                    color,
                    width,
                };

                if (room) {
                    const str = JSON.stringify(event);
                    const encoder = new TextEncoder();
                    room.localParticipant.publishData(encoder.encode(str), { reliable: true });
                }
                currentStroke.push(event);
            }

            isDrawing = false;
            setIsDrawing(false);
            prevRawPoint = null;
            prevRenderedPoint = null;
            currentGraphicsRef.current = null;

            if (currentStroke.length > 0) {
                try {
                    const data = await apiClient.handleWhiteboardAction(room.name, { stroke: currentStroke });
                    if (data.success) {
                        setCanUndo(data.canUndo);
                        setCanRedo(data.canRedo);
                    }
                } catch (err) {
                    console.error('Failed to save stroke:', err);
                }
            }
            currentStroke = [];
        };

        let resizeObserver: ResizeObserver | null = null;

        const initPixi = async () => {
            resizeObserver = new ResizeObserver((entries) => {
                if (!appRef.current || !entries[0]) return;
                const { width, height } = entries[0].contentRect;
                appRef.current.renderer.resize(width, height);
                if (appRef.current.stage) {
                    appRef.current.stage.hitArea = appRef.current.screen;
                }
            });
            resizeObserver.observe(containerRef.current!);

            const app = new PIXI.Application();
            await app.init({
                backgroundAlpha: 0,
                resizeTo: containerRef.current!,
                preference: 'webgpu',
                antialias: true,
                autoDensity: true,
                resolution: window.devicePixelRatio || 1,
            });

            if (containerRef.current && !appRef.current) {
                containerRef.current.appendChild(app.canvas);
                appRef.current = app;
                canvasElement = app.canvas;

                const drawingContainer = new PIXI.Container();
                app.stage.addChild(drawingContainer);
                drawingContainerRef.current = drawingContainer;

                canvasElement.addEventListener('pointerdown', onPointerDown);
                canvasElement.addEventListener('pointermove', onPointerMove);
                canvasElement.addEventListener('pointerup', onPointerUp);
                canvasElement.addEventListener('wheel', onWheel, { passive: false });
            }
        };

        initPixi();

        return () => {
            // Clean up ResizeObserver
            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            }

            if (appRef.current) {
                const canvas = appRef.current.canvas;
                if (canvas) {
                    canvas.removeEventListener('pointerdown', onPointerDown);
                    canvas.removeEventListener('pointermove', onPointerMove);
                    canvas.removeEventListener('pointerup', onPointerUp);
                    canvas.removeEventListener('wheel', onWheel);
                }
                appRef.current.destroy(true, { children: true, texture: true });
                appRef.current = null;
            }
        };
    }, [room, broadcastCursor, drawLine]);

    // Data event handler
    useEffect(() => {
        if (!room) return;

        const handleData = (payload: Uint8Array) => {
            try {
                const str = new TextDecoder().decode(payload);
                const event = JSON.parse(str);

                if (event.type === 'draw') {
                    drawLine(event.x, event.y, event.prevX, event.prevY, event.color, event.width);
                } else if (event.type === 'clear') {
                    drawingContainerRef.current?.removeChildren();
                    currentGraphicsRef.current = null;
                    setCanUndo(false);
                    setCanRedo(false);
                    setTriggerLoad(prev => prev + 1);
                } else if (event.type === 'refetch') {
                    setTriggerLoad(prev => prev + 1);
                } else if (event.type === 'cursor') {
                    handleCursorEvent(event as CursorEvent);
                }
            } catch (e) {
                console.error('Failed to parse board data', e);
            }
        };

        room.on(RoomEvent.DataReceived, handleData);
        return () => {
            room.off(RoomEvent.DataReceived, handleData);
        };
    }, [room, drawLine, handleCursorEvent]);

    // Load history
    useEffect(() => {
        if (!room?.name) return;

        const loadHistory = async () => {
            try {
                const data = await apiClient.getWhiteboardHistory(room.name);

                let history = [];
                if (Array.isArray(data)) {
                    history = data;
                } else {
                    history = data.history || [];
                    setCanUndo(data.canUndo ?? false);
                    setCanRedo(data.canRedo ?? false);
                }

                if (drawingContainerRef.current) {
                    drawingContainerRef.current.removeChildren();
                }
                currentGraphicsRef.current = null;

                history.forEach((stroke: DrawEvent[]) => {
                    stroke.forEach(point => {
                        drawLine(point.x, point.y, point.prevX, point.prevY, point.color, point.width);
                    });
                    currentGraphicsRef.current = null;
                });
            } catch (e) {
                console.error('Failed to load history', e);
            }
        };

        loadHistory();
    }, [room?.name, triggerLoad, drawLine]);

    // Actions
    const setTool = useCallback((t: WhiteboardTool) => {
        toolRef.current = t;
        setActiveTool(t);
    }, []);

    const clearBoard = useCallback(() => {
        if (drawingContainerRef.current) {
            drawingContainerRef.current.removeChildren();
            currentGraphicsRef.current = null;
        }
        if (room) {
            const event: ClearEvent = { type: 'clear' };
            const encoder = new TextEncoder();
            room.localParticipant.publishData(encoder.encode(JSON.stringify(event)), { reliable: true });
        }
        apiClient.handleWhiteboardAction(room.name, { type: 'clear' })
            .then(() => {
                setCanUndo(false);
                setCanRedo(false);
            })
            .catch(err => console.error('Failed to clear board:', err));
    }, [room]);

    const performUndo = useCallback(async () => {
        if (!room?.name || !canUndo) return;

        try {
            const data = await apiClient.handleWhiteboardAction(room.name, { type: 'undo' });
            if (data.success) {
                setCanUndo(data.canUndo);
                setCanRedo(data.canRedo);
            }
        } catch (err) {
            console.error('Undo failed:', err);
        }

        const event: RefetchEvent = { type: 'refetch' };
        const encoder = new TextEncoder();
        room.localParticipant.publishData(encoder.encode(JSON.stringify(event)), { reliable: true });
        setTriggerLoad(prev => prev + 1);
    }, [room, canUndo]);

    const performRedo = useCallback(async () => {
        if (!room?.name || !canRedo) return;

        try {
            const data = await apiClient.handleWhiteboardAction(room.name, { type: 'redo' });
            if (data.success) {
                setCanUndo(data.canUndo);
                setCanRedo(data.canRedo);
            }
        } catch (err) {
            console.error('Redo failed:', err);
        }

        const event: RefetchEvent = { type: 'refetch' };
        const encoder = new TextEncoder();
        room.localParticipant.publishData(encoder.encode(JSON.stringify(event)), { reliable: true });
        setTriggerLoad(prev => prev + 1);
    }, [room, canRedo]);

    const zoom = useCallback((factor: number, centerX?: number, centerY?: number) => {
        const oldScale = scaleRef.current;
        const newScale = Math.min(Math.max(ZOOM_SETTINGS.min, oldScale + factor), ZOOM_SETTINGS.max);

        if (newScale === oldScale) return;

        const canvasElement = appRef.current?.canvas;
        if (!canvasElement) return;

        let focusX, focusY;
        const rect = canvasElement.getBoundingClientRect();

        if (centerX !== undefined && centerY !== undefined) {
            focusX = centerX - rect.left;
            focusY = centerY - rect.top;
        } else {
            focusX = rect.width / 2;
            focusY = rect.height / 2;
        }

        const worldX = (focusX - panOffsetRef.current.x) / oldScale;
        const worldY = (focusY - panOffsetRef.current.y) / oldScale;

        const newPanX = focusX - worldX * newScale;
        const newPanY = focusY - worldY * newScale;

        scaleRef.current = newScale;
        panOffsetRef.current = { x: newPanX, y: newPanY };

        setScale(newScale);
        setPanOffset({ x: newPanX, y: newPanY });

        if (drawingContainerRef.current) {
            drawingContainerRef.current.position.set(newPanX, newPanY);
            drawingContainerRef.current.scale.set(newScale);
        }
    }, []);

    const resetZoom = useCallback(() => {
        setScale(ZOOM_SETTINGS.default);
        scaleRef.current = ZOOM_SETTINGS.default;
        if (drawingContainerRef.current) {
            drawingContainerRef.current.scale.set(ZOOM_SETTINGS.default);
        }
        setPanOffset({ x: 0, y: 0 });
        panOffsetRef.current = { x: 0, y: 0 };
        if (drawingContainerRef.current) {
            drawingContainerRef.current.position.set(0, 0);
        }
    }, []);

    const handlePenColorChange = useCallback((hex: string) => {
        setPenColor(hex);
        penColorRef.current = hexToNumber(hex);
    }, []);

    const handlePenSizeChange = useCallback((size: number) => {
        setPenSize(size);
        penSizeRef.current = size;
    }, []);

    const handleEraserSizeChange = useCallback((size: number) => {
        setEraserSize(size);
        eraserSizeRef.current = size;
    }, []);

    const handleSmoothnessChange = useCallback((value: number) => {
        setSmoothness(value);
        smoothnessRef.current = value;
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    zoom(ZOOM_SETTINGS.step);
                } else if (e.key === '-') {
                    e.preventDefault();
                    zoom(-ZOOM_SETTINGS.step);
                } else if (e.key === '0') {
                    e.preventDefault();
                    resetZoom();
                } else if (e.key === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) performRedo();
                    else performUndo();
                } else if (e.key === 'y') {
                    e.preventDefault();
                    performRedo();
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [zoom, resetZoom, performUndo, performRedo]);

    // Cursor style
    const getCursor = useCallback(() => {
        if (isMiddlePanning) return 'grabbing';
        if (activeTool === 'hand' && isInteracting) return 'grabbing';

        switch (activeTool) {
            case 'hand':
                return 'grab';
            case 'pen':
                return generatePenCursor(penSize, penColor);
            case 'eraser':
                return generateEraserCursor(eraserSize);
            default:
                return 'default';
        }
    }, [activeTool, isInteracting, isMiddlePanning, penSize, penColor, eraserSize]);

    return (
        <div
            className="relative w-full h-full bg-[#f9f9f9] touch-none overflow-hidden select-none outline-none"
            style={{ cursor: getCursor() }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {/* Grid Background */}
            <div
                className="absolute inset-0 z-0 pointer-events-none opacity-50"
                style={{
                    backgroundImage: `radial-gradient(${GRID_SETTINGS.dotColor} ${GRID_SETTINGS.dotSize}px, transparent ${GRID_SETTINGS.dotSize}px)`,
                    backgroundSize: `${GRID_SETTINGS.baseSize * scale}px ${GRID_SETTINGS.baseSize * scale}px`,
                    backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
                }}
            />

            {/* Zoom Controls */}
            <ZoomControls
                scale={scale}
                onZoomIn={() => zoom(ZOOM_SETTINGS.step)}
                onZoomOut={() => zoom(-ZOOM_SETTINGS.step)}
                onResetZoom={resetZoom}
            />

            {/* Canvas Container */}
            <div ref={containerRef} className="w-full h-full relative z-10" />

            {/* Toolbar */}
            <WhiteboardToolbar
                activeTool={activeTool}
                penSize={penSize}
                eraserSize={eraserSize}
                penColor={penColor}
                smoothness={smoothness}
                canUndo={canUndo}
                canRedo={canRedo}
                onToolChange={setTool}
                onPenSizeChange={handlePenSizeChange}
                onEraserSizeChange={handleEraserSizeChange}
                onPenColorChange={handlePenColorChange}
                onSmoothnessChange={handleSmoothnessChange}
                onUndo={performUndo}
                onRedo={performRedo}
                onClear={clearBoard}
            />

            {/* Cursors */}
            <RemoteCursors
                cursors={remoteCursors}
                localCursor={localCursor}
                scale={scale}
                panOffset={panOffset}
            />
        </div>
    );
}
