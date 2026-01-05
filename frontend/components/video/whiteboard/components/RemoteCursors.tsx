'use client';

import { memo } from 'react';
import { RemoteCursor, WhiteboardTool } from '../types';
import { worldToScreen } from '../utils';
import { LocalCursor } from '../hooks/useWhiteboardCursors';

interface CursorsProps {
    cursors: Map<string, RemoteCursor>;
    localCursor: LocalCursor | null;
    scale: number;
    panOffset: { x: number; y: number };
}

interface CursorItemProps {
    x: number;
    y: number;
    color: string;
    name: string;
    isLocal?: boolean;
    scale: number;
    panOffset: { x: number; y: number };
    tool: WhiteboardTool;
    penColor?: string;
    isDrawing?: boolean;
}

// Tool icon components
function PenIcon({ color }: { color: string }) {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function EraserIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
                d="M19 20H5M18 9l-6-6-9 9a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0L18 9z"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function HandIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
                d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function MagicPenIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
                d="M21.64 3.64l-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72zM14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function CursorVisual({ color, name, tool, penColor, isDrawing, isLocal, showArrow = true }: {
    color: string;
    name: string;
    tool: WhiteboardTool;
    penColor?: string;
    isDrawing?: boolean;
    isLocal?: boolean;
    showArrow?: boolean;
}) {
    return (
        <>
            {/* Cursor Arrow SVG */}
            {showArrow && (
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="drop-shadow-md"
                >
                    <path
                        d="M5.65376 3.54639C5.10764 3.07987 4.27906 3.52968 4.33765 4.24087L5.6469 20.1293C5.70985 20.8954 6.62952 21.2376 7.1747 20.6834L10.4723 17.3858L13.894 22.3122C14.1962 22.7468 14.8014 22.8441 15.2207 22.5211L17.2008 21.0141C17.6049 20.7025 17.6837 20.1191 17.3779 19.7091L13.8946 14.6997L18.5529 13.4569C19.2763 13.264 19.4572 12.3395 18.8672 11.8807L5.65376 3.54639Z"
                        fill={color}
                        stroke="white"
                        strokeWidth="1.5"
                    />
                </svg>
            )}

            {/* Name Badge with Tool Indicator */}
            <div
                className={`absolute left-5 flex items-center gap-1.5 px-2 py-1 rounded-full text-white text-xs font-medium whitespace-nowrap shadow-lg ${showArrow ? 'top-4' : 'bottom-4'}`}
                style={{ backgroundColor: color }}
            >
                {/* Tool Icon */}
                <span className="flex items-center justify-center">
                    {tool === 'pen' && <PenIcon color={penColor || 'white'} />}
                    {tool === 'eraser' && <EraserIcon />}
                    {tool === 'hand' && <HandIcon />}
                    {tool === 'magic-pen' && <MagicPenIcon />}
                </span>

                {/* Pen color indicator */}
                {tool === 'pen' && penColor && (
                    <span
                        className="w-2.5 h-2.5 rounded-full border border-white/50"
                        style={{ backgroundColor: penColor }}
                    />
                )}

                {/* Name */}
                <span className="max-w-[80px] truncate">
                    {name}
                </span>

                {isLocal && (
                    <span className="opacity-70">(나)</span>
                )}

                {/* Drawing indicator */}
                {isDrawing && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                )}
            </div>
        </>
    );
}

function CursorItem({ x, y, color, name, isLocal, scale, panOffset, tool, penColor, isDrawing }: CursorItemProps) {
    const { x: screenX, y: screenY } = worldToScreen(x, y, panOffset, scale);

    return (
        <div
            className="absolute pointer-events-none z-30 transition-all duration-75 ease-out"
            style={{
                left: screenX,
                top: screenY,
                transform: 'translate(-2px, -2px)',
            }}
        >
            <CursorVisual
                color={color}
                name={name}
                tool={tool}
                penColor={penColor}
                isDrawing={isDrawing}
                isLocal={isLocal}
            />
        </div>
    );
}

function CursorsComponent({ cursors, localCursor, scale, panOffset }: CursorsProps) {
    return (
        <>
            {/* Remote Cursors */}
            {Array.from(cursors.values()).map((cursor) => (
                <CursorItem
                    key={cursor.participantId}
                    x={cursor.x}
                    y={cursor.y}
                    color={cursor.color}
                    name={cursor.participantName}
                    scale={scale}
                    panOffset={panOffset}
                    tool={cursor.tool}
                    penColor={cursor.penColor}
                    isDrawing={cursor.isDrawing}
                />
            ))}

            {/* Local Cursor */}
            {localCursor && (
                <CursorItem
                    x={localCursor.x}
                    y={localCursor.y}
                    color={localCursor.color}
                    name={localCursor.participantName}
                    isLocal
                    scale={scale}
                    panOffset={panOffset}
                    tool={localCursor.tool}
                    penColor={localCursor.penColor}
                    isDrawing={localCursor.isDrawing}
                />
            )}
        </>
    );
}

export const RemoteCursors = memo(CursorsComponent);
