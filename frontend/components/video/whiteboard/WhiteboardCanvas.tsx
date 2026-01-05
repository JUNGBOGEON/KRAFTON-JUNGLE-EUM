'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { apiClient } from '@/app/lib/api';

import { DrawEvent, ClearEvent, RefetchEvent, CursorEvent, WhiteboardTool } from './types';
import { ZOOM_SETTINGS, GRID_SETTINGS, TOOL_SETTINGS } from './constants';
import { hexToNumber, generatePenCursor, generateEraserCursor, simplifyPoints, Point, getStrokePoints } from './utils';
import { useWhiteboardCursors } from './hooks/useWhiteboardCursors';
import { ZoomControls } from './components/ZoomControls';
import { RemoteCursors, CursorVisual } from './components/RemoteCursors'; // Import CursorVisual
import { WhiteboardToolbar } from './components/WhiteboardToolbar';

import { OneEuroFilter } from './oneEuroFilter'; // Import Filter

export default function WhiteboardCanvas() {
    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const localCursorRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const drawingContainerRef = useRef<PIXI.Container | null>(null);
    const currentGraphicsRef = useRef<{
        graphics: PIXI.Graphics;
        color: number;
        width: number;
        tool: WhiteboardTool; // Changed from isEraser to tool
    } | null>(null);

    // FIX: Lock processing to prevent double-save race conditions
    // Removed isProcessingRef to fix data loss bug. Using Capture-and-Clear strategy instead.

    // Filters for Jitter Reduction (Phase 2)
    // minCutoff=1.0 (Hz), beta=0.23 (Response Speed)
    // TUNING: Aggressive Beta (0.05 -> 0.23) to ELIMINATE lag/squaring on fast circles.
    // Normalized minCutoff (0.7 -> 1.0) for standard stationary stability.
    const filterX = useRef(new OneEuroFilter(1.0, 0.23));
    const filterY = useRef(new OneEuroFilter(1.0, 0.23));

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
    const [isReady, setIsReady] = useState(false);
    const [isHoveringToolbar, setIsHoveringToolbar] = useState(false); // Track toolbar hover
    const room = useRoomContext();
    const participants = useParticipants();

    // Cursor Hook - pass tool state for cursor display
    const { remoteCursors, broadcastCursor, handleCursorEvent, cursorColor } = useWhiteboardCursors({ // Destructure cursorColor, remove localCursor
        room,
        participantIdentities: participants.filter(p => !p.isLocal).map(p => p.identity),
        toolState: {
            tool: activeTool,
            penColor: penColor,
            isDrawing: isDrawing,
        },
    });

    // Smoothing Helper: Quadratic Bezier Interpolation
    const drawSmoothStroke = (graphics: PIXI.Graphics, points: { x: number, y: number }[], width: number, color: number, isMagic: boolean = false) => {
        if (points.length === 0) return;

        // Build Path
        const buildPath = () => {
            // FIX: Don't smooth simple polygons (Rectangles/Triangles have < 10 points)
            // If we smooth a 5-point rectangle, it becomes a blob.
            if (points.length < 10) {
                graphics.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    graphics.lineTo(points[i].x, points[i].y);
                }
            } else {
                graphics.moveTo(points[0].x, points[0].y);
                // Draw curves between midpoints
                for (let i = 1; i < points.length - 1; i++) {
                    const p1 = points[i];
                    const p2 = points[i + 1];
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    graphics.quadraticCurveTo(p1.x, p1.y, midX, midY);
                }
                // Connect to last point
                const last = points[points.length - 1];
                graphics.lineTo(last.x, last.y);
            }
        };

        if (isMagic) {
            // Draw Halo (Thick, semitransparent)
            // User Request: Maintain effect even when thick.
            // Strategy: Use multiplier (x3) instead of fixed offset to scale effect with thickness.
            graphics.setStrokeStyle({
                width: width * 3, // Proportional scaling
                color: color,
                alpha: 0.15,
                cap: 'round',
                join: 'round'
            });
            buildPath();
            graphics.stroke();

            // Draw Core (Normal)
            graphics.setStrokeStyle({
                width,
                color,
                alpha: 1,
                cap: 'round',
                join: 'round'
            });
            buildPath(); // Rebuild path for second stroke
            graphics.stroke();
        } else {
            graphics.setStrokeStyle({
                width,
                color,
                alpha: 1,
                cap: 'round',
                join: 'round'
            });
            buildPath();
            graphics.stroke();
        }
    };

    // Drawing function (Legacy/Remote wrapper)
    const drawLine = useCallback((x: number, y: number, prevX: number, prevY: number, color: number, width: number) => {
        // NOTE: This single-segment (prev->curr) drawLine is only for legacy/remote stream fallback.
        // It cannot smooth effectively because it only knows 2 points. 
        // Real smoothing happens in onPointerMove (local) and loadHistory/batch (arrays).
        if (!drawingContainerRef.current) return;

        const isEraser = color === 0xffffff;
        // Legacy drawer doesn't support Magic Pen styles yet (or we infer from context?)
        // For now, treat as pen.

        let graphics: PIXI.Graphics;
        const sameProp = currentGraphicsRef.current &&
            currentGraphicsRef.current.color === color &&
            currentGraphicsRef.current.width === width &&
            ((isEraser && currentGraphicsRef.current.tool === 'eraser') || (!isEraser && currentGraphicsRef.current.tool !== 'eraser'));

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
                tool: isEraser ? 'eraser' : 'pen',
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

            // Fix: Blur any active inputs (like color picker) when touching canvas
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }

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

            // Phase 2: Input Stabilization - Reset Filters
            filterX.current.reset();
            filterY.current.reset();
            // Prime the filter with initial value
            filterX.current.filter(startPoint.x, Date.now());
            filterY.current.filter(startPoint.y, Date.now());

            prevRawPoint = startPoint;
            prevRenderedPoint = startPoint;
            currentStroke = [];
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!canvasElement) return;

            // Broadcast cursor position (networking)
            const cursorPoint = getLocalPoint(e.clientX, e.clientY);
            broadcastCursor(cursorPoint.x, cursorPoint.y);

            // Update local cursor visual immediately (performance)
            if (localCursorRef.current) {
                // Ensure the cursor follows the mouse pointer relative to the viewport/container
                // Assuming containerRef has relative positioning and matches window/parent
                // But e.clientX is viewport relative. We need position relative to containerRef.
                const rect = containerRef.current!.getBoundingClientRect();
                const localX = e.clientX - rect.left;
                const localY = e.clientY - rect.top;
                localCursorRef.current.style.transform = `translate(${localX}px, ${localY}px)`;
            }

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

            // Phase 2: Input Stabilization (One Euro Filter)
            // DYNAMIC TUNING based on "Natural" (sLevel: 0~10) slider
            // RE-TUNED: Constrained range to prevent "Angularity/Squaring" at max level.
            // 0 (Fast/Raw): beta=0.8, cutoff=1.5 (Almost raw input)
            // 10 (Natural/Smooth): beta=0.1, cutoff=0.5 (Stabilized but responsive enough to avoid squares)
            const sLevel = smoothnessRef.current; // 0 ~ 10

            // Linear Interpolation
            // Beta: 0.8 -> 0.1
            const newBeta = 0.8 - (sLevel / 10) * (0.8 - 0.1);
            // Cutoff: 1.5 -> 0.5
            const newCutoff = 1.5 - (sLevel / 10) * (1.5 - 0.5);

            // Apply params
            if (filterX.current && filterY.current) {
                filterX.current.beta = newBeta;
                filterX.current.minCutoff = newCutoff;
                filterY.current.beta = newBeta;
                filterY.current.minCutoff = newCutoff;
            }

            const now = Date.now();
            const stabilizedX = filterX.current.filter(rawPoint.x, now);
            const stabilizedY = filterY.current.filter(rawPoint.y, now);

            // Use stabilized point for rendering
            const targetPoint = { x: stabilizedX, y: stabilizedY };

            /* Legacy mid-point logic removed */

            const color = toolRef.current === 'eraser' ? 0xffffff : penColorRef.current;
            const baseSize = toolRef.current === 'eraser' ? eraserSizeRef.current : penSizeRef.current;
            const width = baseSize / scaleRef.current;

            // **NEW: Polygon Rendering for Active Stroke**
            if (!drawingContainerRef.current) return;

            // 1. Add new point to stroke data
            // We need to store the points to regenerate the polygon
            const event: DrawEvent = {
                type: 'draw',
                x: targetPoint.x,
                y: targetPoint.y,
                prevX: prevRenderedPoint.x,
                prevY: prevRenderedPoint.y,
                color,
                width,
            };
            currentStroke.push(event);

            // 2. Prepare Graphics
            let graphics: PIXI.Graphics;
            if (currentGraphicsRef.current) {
                graphics = currentGraphicsRef.current.graphics;
            } else {
                graphics = new PIXI.Graphics();
                if (toolRef.current === 'eraser') {
                    graphics.blendMode = 'erase';
                }
                drawingContainerRef.current.addChild(graphics);
                currentGraphicsRef.current = {
                    graphics,
                    color,
                    width,
                    tool: toolRef.current
                };
            }

            // 3. Clear and Redraw Polygon / Polyline
            graphics.clear();

            const isEraser = toolRef.current === 'eraser';

            if (isEraser) {
                // ERASER: Use Polyline (Simple Stroke) for stability
                if (currentStroke.length > 0) {
                    graphics.setStrokeStyle({
                        width: width,
                        color: color,
                        alpha: 1,
                        cap: 'round',
                        join: 'round'
                    });

                    graphics.moveTo(currentStroke[0].x, currentStroke[0].y);
                    for (let i = 1; i < currentStroke.length; i++) {
                        graphics.lineTo(currentStroke[i].x, currentStroke[i].y);
                    }
                    graphics.stroke();
                }
            } else {
                // Use Smooth Bezier Polyline
                if (currentStroke.length > 0) {
                    // Extract points
                    const points = currentStroke.map(p => ({ x: p.x, y: p.y }));
                    drawSmoothStroke(graphics, points, width, color, toolRef.current === 'magic-pen');
                }
            }

            // 4. Batching for Remote (Legacy Segment)
            if (room) {
                pointBufferRef.current.push(event);
            }

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

                // Phase 2: Stabilize final point
                const now = Date.now();
                const stabilizedX = filterX.current.filter(finalRaw.x, now);
                const stabilizedY = filterY.current.filter(finalRaw.y, now);

                let dest = { x: stabilizedX, y: stabilizedY };

                // Handle single click (dot) - if no movement occurred, offset slightly to force render
                if (currentStroke.length === 0 && dest.x === prevRenderedPoint.x && dest.y === prevRenderedPoint.y) {
                    dest = { x: dest.x + 0.1, y: dest.y };
                }

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
                    // Batching: Push to buffer
                    pointBufferRef.current.push(event);
                }
                currentStroke.push(event);
            }

            // Capture graphics reference BEFORE clearing state
            const activeGraphics = currentGraphicsRef.current;

            isDrawing = false;
            setIsDrawing(false);
            prevRawPoint = null;
            prevRenderedPoint = null;
            currentGraphicsRef.current = null;

            // FIX: Capture and Clear immediately to prevent Race Conditions without blocking data
            const strokeToProcess = [...currentStroke];
            currentStroke = [];

            if (strokeToProcess.length > 0) {
                try {
                    let eventsToSend = strokeToProcess;
                    const isMagic = toolRef.current === 'magic-pen';

                    if (isMagic) {
                        // **MAGIC PEN LOGIC: "Guess or Die"**
                        const abortMagic = () => {
                            if (activeGraphics) activeGraphics.graphics.clear();
                            // NO NEED TO CLEAR currentStroke here (it's local now)
                        };

                        // 1. Too short? Vanish.
                        if (strokeToProcess.length <= 10) {
                            abortMagic();
                            return;
                        }

                        // 1.5. Too small? Vanish (Prevent "Water Droplet" / Noise)
                        const minX = Math.min(...strokeToProcess.map(p => p.x));
                        const maxX = Math.max(...strokeToProcess.map(p => p.x));
                        const minY = Math.min(...strokeToProcess.map(p => p.y));
                        const maxY = Math.max(...strokeToProcess.map(p => p.y));

                        // Increased threshold to 50px to aggressively filter "Ghost/Bounce" strokes
                        if ((maxX - minX < 50) && (maxY - minY < 50)) {
                            console.log('[Magic Pen] Stroke too small (<50px). Vanishing.');
                            abortMagic();
                            return;
                        }

                        // 2. Detect Shape
                        const points = strokeToProcess.map(p => ({ x: p.x, y: p.y }));
                        const { detectShape } = await import('./shapeRecognition');
                        const result = detectShape(points);

                        // 3. Not recognized? Vanish.
                        if (result.type === 'none' || !result.correctedPoints) {
                            console.log('[Magic Pen] Unrecognized shape. Vanishing.');
                            abortMagic();
                            return;
                        }

                        // 4. Success! Transform and Redraw.
                        console.log(`[Shape Recognition] Detected ${result.type} (Score: ${result.score.toFixed(2)})`);

                        // A. Clear the "Halo" (Rough stroke)
                        if (activeGraphics) activeGraphics.graphics.clear();

                        // B. Prepare Events for History/Server
                        const newEvents: DrawEvent[] = [];
                        const color = strokeToProcess[0].color;
                        const width = strokeToProcess[0].width;
                        const corrected = result.correctedPoints;

                        for (let i = 0; i < corrected.length; i++) {
                            const prev = i === 0 ? corrected[0] : corrected[i - 1];
                            newEvents.push({
                                type: 'draw',
                                x: corrected[i].x,
                                y: corrected[i].y,
                                prevX: prev.x,
                                prevY: prev.y,
                                color,
                                width
                            });
                        }
                        eventsToSend = newEvents;

                        // C. Draw Clean Shape Locally (Immediate Feedback)
                        if (activeGraphics) {
                            const g = activeGraphics.graphics;
                            g.setStrokeStyle({
                                width,
                                color,
                                alpha: 1,
                                cap: 'round',
                                join: 'round'
                            });
                            g.moveTo(corrected[0].x, corrected[0].y);
                            for (let i = 1; i < corrected.length; i++) {
                                g.lineTo(corrected[i].x, corrected[i].y);
                            }
                            g.stroke();
                        }

                    } else {
                        // **NORMAL PEN LOGIC**
                        // Apply Douglas-Peucker Simplification for optimization
                        const originalEvents = strokeToProcess;

                        if (originalEvents.length > 2) {
                            const points: Point[] = [
                                { x: originalEvents[0].prevX, y: originalEvents[0].prevY },
                                ...originalEvents.map(e => ({ x: e.x, y: e.y }))
                            ];
                            // TUNING: 0.01 tolerance for high fidelity with decent compression
                            const tolerance = 0.01;
                            const simplifiedPoints = simplifyPoints(points, tolerance);

                            if (simplifiedPoints.length >= 2) {
                                const newEvents: DrawEvent[] = [];
                                const color = originalEvents[0].color;
                                const width = originalEvents[0].width;

                                for (let i = 1; i < simplifiedPoints.length; i++) {
                                    newEvents.push({
                                        type: 'draw',
                                        x: simplifiedPoints[i].x,
                                        y: simplifiedPoints[i].y,
                                        prevX: simplifiedPoints[i - 1].x,
                                        prevY: simplifiedPoints[i - 1].y,
                                        color,
                                        width
                                    });
                                }
                                eventsToSend = newEvents;
                            }
                        }
                    }

                    const data = await apiClient.handleWhiteboardAction(room.name, { stroke: eventsToSend });
                    if (data.success) {
                        setCanUndo(data.canUndo);
                        setCanRedo(data.canRedo);
                    }
                } catch (err) {
                    console.error('Failed to save stroke:', err);
                }
            }
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
                canvasElement.addEventListener('pointerleave', onPointerUp); // Safety: Stop drawing if mouse leaves
                canvasElement.addEventListener('wheel', onWheel, { passive: false });

                setIsReady(true);
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
                    canvas.removeEventListener('pointerleave', onPointerUp);
                    canvas.removeEventListener('wheel', onWheel);
                }
                appRef.current.destroy(true, { children: true, texture: true });
                appRef.current = null;
            }
        };
    }, [room, broadcastCursor, drawLine]);

    // Batching logic: Flush buffer every 50ms
    const pointBufferRef = useRef<DrawEvent[]>([]);

    useEffect(() => {
        if (!room) return;

        const interval = setInterval(() => {
            if (pointBufferRef.current.length > 0) {
                const batchEvent = {
                    type: 'draw_batch',
                    points: pointBufferRef.current,
                };

                const str = JSON.stringify(batchEvent);
                const encoder = new TextEncoder();
                // Use unreliable for frequent updates if acceptable, but reliable is safer for drawing order
                room.localParticipant.publishData(encoder.encode(str), { reliable: true });

                pointBufferRef.current = [];
            }
        }, 50); // 20fps cap

        return () => clearInterval(interval);
    }, [room]);

    // Data event handler
    useEffect(() => {
        if (!room) return;

        const handleData = (payload: Uint8Array) => {
            try {
                const str = new TextDecoder().decode(payload);
                const event = JSON.parse(str);

                if (event.type === 'draw') {
                    // Legacy support or fallback
                    drawLine(event.x, event.y, event.prevX, event.prevY, event.color, event.width);
                } else if (event.type === 'draw_batch') {
                    // Handle batch event
                    const points = event.points as DrawEvent[];
                    points.forEach(p => {
                        drawLine(p.x, p.y, p.prevX, p.prevY, p.color, p.width);
                    });
                } else if (event.type === 'clear') {
                    drawingContainerRef.current?.removeChildren();
                    currentGraphicsRef.current = null;
                    setCanUndo(false);
                    setCanRedo(false);
                    // setTriggerLoad(prev => prev + 1); // Removed to prevent race condition showing old data
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
        if (!room?.name || !isReady) return;

        const loadHistory = async () => {
            try {
                const data = await apiClient.getWhiteboardHistory(room.name);
                console.log('[Whiteboard] Loaded history data:', data);

                let history = [];
                if (Array.isArray(data)) {
                    history = data;
                } else {
                    history = data.history || [];
                    setCanUndo(data.canUndo ?? false);
                    setCanRedo(data.canRedo ?? false);
                }
                console.log('[Whiteboard] Parsed history:', history);

                if (drawingContainerRef.current) {
                    drawingContainerRef.current.removeChildren();
                }
                currentGraphicsRef.current = null;

                history.forEach((stroke: DrawEvent[]) => {
                    if (stroke.length === 0) return;

                    const firstPoint = stroke[0];
                    const color = firstPoint.color;
                    const width = firstPoint.width;
                    const isEraser = color === 0xffffff;

                    const graphics = new PIXI.Graphics();
                    if (isEraser) {
                        graphics.blendMode = 'erase';
                    }

                    if (isEraser || true) { // FORCE ALL TOOLS TO USE POLYLINE
                        // Polyline with Smoothing
                        const points = stroke.map(p => ({ x: p.x, y: p.y }));
                        drawSmoothStroke(graphics, points, width, color);
                    }

                    if (drawingContainerRef.current) {
                        drawingContainerRef.current.addChild(graphics);
                    }
                });
            } catch (e) {
                console.error('Failed to load history', e);
            }
        };

        loadHistory();
    }, [room?.name, triggerLoad, drawLine, isReady]);

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

    // Cursor Update Effect
    useEffect(() => {
        if (!containerRef.current) return;

        if (activeTool === 'magic-pen') {
            // Custom Magic Wand Cursor (SVG Data URI)
            const wandCursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>') 2 2, auto`;
            containerRef.current.style.cursor = wandCursor;
        } else if (activeTool === 'eraser') {
            // Scaled size for cursor
            const cursorCss = generateEraserCursor(eraserSize * scale);
            containerRef.current.style.cursor = cursorCss;
        } else if (activeTool === 'pen') {
            // Scaled size for cursor
            const cursorCss = generatePenCursor(penSize * scale, penColor);
            containerRef.current.style.cursor = cursorCss;
        } else if (activeTool === 'hand') {
            containerRef.current.style.cursor = isInteracting ? 'grabbing' : 'grab';
        } else {
            containerRef.current.style.cursor = 'default';
        }
    }, [activeTool, penSize, eraserSize, penColor, scale, isInteracting]);

    // Initial load
    useEffect(() => {
        if (!containerRef.current) return;
        // Trigger initial cursor update
    }, []);

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

    const handleGlobalPointerMove = (e: React.PointerEvent) => {
        // Broadcast cursor position (networking)
        // Note: we might want to throttle this or check bounds if needed, but for now simple
        // relaying coordinates relative to the container is fine.
        if (localCursorRef.current && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const localX = e.clientX - rect.left;
            const localY = e.clientY - rect.top;

            // Visual update
            localCursorRef.current.style.transform = `translate(${localX}px, ${localY}px)`;

            // Network broadcast (if needed here, or keep it in canvas interaction)
            // We can duplicate the network broadcast logic here to show cursor even over UI
            // But be careful about coordinate systems if 'containerRef' is the canvas container
            // We should ensure getLocalPoint logic is consistent.
            // For now, let's just update the VISUAL first as requested.
        }
    };

    return (
        <div
            className="relative w-full h-full bg-[#f9f9f9] touch-none overflow-hidden select-none outline-none" // select-none added
            style={{
                cursor: getCursor(),
                userSelect: 'none', // Force disable selection
                WebkitUserSelect: 'none',
            }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerMove={handleGlobalPointerMove} // Track mouse globally in this container
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
                onMouseEnter={() => setIsHoveringToolbar(true)}
                onMouseLeave={() => setIsHoveringToolbar(false)}
            />

            {/* Cursors */}
            <RemoteCursors
                cursors={remoteCursors}
                localCursor={null} // Local cursor is handled separately for performance
                scale={scale}
                panOffset={panOffset}
            />

            {/* Local Cursor (Unmanaged Ref for performance) */}
            <div
                ref={localCursorRef}
                className="absolute pointer-events-none z-[60] transition-none will-change-transform top-0 left-0" // top-0 left-0 required for translate
                style={{
                    display: 'block', // Always show
                }}
            >
                {/* Only render if we have a participant identity */}
                {room?.localParticipant && (
                    <CursorVisual
                        color={cursorColor}
                        name={room.localParticipant.name || room.localParticipant.identity}
                        tool={activeTool}
                        penColor={activeTool === 'pen' ? penColor : undefined}
                        isDrawing={isDrawing}
                        isLocal={true}
                        showArrow={isHoveringToolbar} // Show arrow ONLY if hovering toolbar (since activeTool is always pen/eraser/hand)
                    />
                )}
            </div>
        </div>
    );
}
