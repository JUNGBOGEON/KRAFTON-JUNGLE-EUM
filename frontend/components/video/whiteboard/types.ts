// Whiteboard Event Types
export interface DrawEvent {
    type: 'draw';
    x: number;
    y: number;
    prevX: number;
    prevY: number;
    color: number;
    width: number;
}

export interface ClearEvent {
    type: 'clear';
}

export interface RefetchEvent {
    type: 'refetch';
}

export interface CursorEvent {
    type: 'cursor';
    x: number;
    y: number;
    participantId: string;
    participantName: string;
    color: string;
    // Tool state
    tool: WhiteboardTool;
    penColor?: string;  // Only when tool is 'pen'
    isDrawing?: boolean;  // Currently drawing/erasing
}

export type WhiteboardEvent = DrawEvent | ClearEvent | RefetchEvent | CursorEvent;

// Remote Cursor State
export interface RemoteCursor {
    x: number;
    y: number;
    participantId: string;
    participantName: string;
    color: string;
    lastUpdate: number;
    // Tool state
    tool: WhiteboardTool;
    penColor?: string;
    isDrawing?: boolean;
}

// Tool Types
export type WhiteboardTool = 'pen' | 'eraser' | 'hand';

// Graphics Cache for PIXI
export interface GraphicsCache {
    graphics: import('pixi.js').Graphics;
    color: number;
    width: number;
    isEraser: boolean;
}

// Whiteboard State
export interface WhiteboardState {
    activeTool: WhiteboardTool;
    penSize: number;
    eraserSize: number;
    penColor: string;
    smoothness: number;
    scale: number;
    panOffset: { x: number; y: number };
    canUndo: boolean;
    canRedo: boolean;
}

// Whiteboard Actions
export interface WhiteboardActions {
    setTool: (tool: WhiteboardTool) => void;
    setPenSize: (size: number) => void;
    setEraserSize: (size: number) => void;
    setPenColor: (color: string) => void;
    setSmoothness: (smoothness: number) => void;
    zoom: (factor: number, centerX?: number, centerY?: number) => void;
    resetZoom: () => void;
    clearBoard: () => void;
    performUndo: () => void;
    performRedo: () => void;
}
