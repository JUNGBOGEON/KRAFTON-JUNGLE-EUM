'use client';

import { memo, useState } from 'react';
import { WhiteboardTool } from '../types';
import { PEN_COLORS, TOOL_SETTINGS } from '../constants';

interface WhiteboardToolbarProps {
    activeTool: WhiteboardTool;
    penSize: number;
    eraserSize: number;
    penColor: string;
    smoothness: number;
    canUndo: boolean;
    canRedo: boolean;
    onToolChange: (tool: WhiteboardTool) => void;
    onPenSizeChange: (size: number) => void;
    onEraserSizeChange: (size: number) => void;
    onPenColorChange: (color: string) => void;
    onSmoothnessChange: (smoothness: number) => void;
    onUndo: () => void;
    onRedo: () => void;
    onClear: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
}

function WhiteboardToolbarComponent({
    activeTool,
    penSize,
    eraserSize,
    penColor,
    smoothness,
    canUndo,
    canRedo,
    onToolChange,
    onPenSizeChange,
    onEraserSizeChange,
    onPenColorChange,
    onSmoothnessChange,
    onUndo,
    onRedo,
    onClear,
    onMouseEnter,
    onMouseLeave,
}: WhiteboardToolbarProps) {
    const [isToolbarOpen, setIsToolbarOpen] = useState(false);
    const [showToolSettings, setShowToolSettings] = useState(false);

    const handleToolClick = (tool: WhiteboardTool) => {
        if (tool === 'pen' || tool === 'eraser') {
            if (activeTool === tool) {
                setShowToolSettings(!showToolSettings);
            } else {
                onToolChange(tool);
                setShowToolSettings(true);
            }
        } else {
            onToolChange(tool);
            setShowToolSettings(false);
        }
    };

    return (
        <div
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className={`absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col items-center z-50 transition-all duration-500 ease-in-out cursor-none [&_*]:cursor-none ${isToolbarOpen ? 'translate-y-[-20px]' : 'translate-y-[calc(100%-32px)]'
                }`}
        >
            {/* Toggle Button */}
            <button
                onClick={() => setIsToolbarOpen(!isToolbarOpen)}
                className="w-16 h-10 flex items-center justify-center bg-white/70 backdrop-blur-xl shadow-2xl rounded-t-[1.5rem] border border-stone-200 border-b-0 text-stone-400 hover:text-stone-900 transition-all group"
                title={isToolbarOpen ? 'Close Toolbar' : 'Open Toolbar'}
            >
                <svg
                    className={`w-6 h-6 transform transition-transform duration-500 ${isToolbarOpen ? 'rotate-180' : ''
                        } group-hover:scale-110`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                </svg>
            </button>

            {/* Toolbar & Settings Panel */}
            <div className="flex flex-col items-center gap-4 p-4 pt-0 bg-transparent">
                {/* Tool Settings Popup */}
                {showToolSettings && (
                    <div className="bg-white/90 backdrop-blur-2xl rounded-[2rem] shadow-2xl p-6 border border-white/50 flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-4 mb-4 w-80 ring-1 ring-black/[0.03]">
                        {/* Size */}
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-stone-500 w-12 uppercase tracking-tight">
                                크기
                            </span>
                            <div className="flex-1 flex items-center gap-3">
                                <input
                                    type="range"
                                    min={activeTool === 'pen' ? TOOL_SETTINGS.pen.minSize : TOOL_SETTINGS.eraser.minSize}
                                    max={activeTool === 'pen' ? TOOL_SETTINGS.pen.maxSize : TOOL_SETTINGS.eraser.maxSize}
                                    value={activeTool === 'pen' ? penSize : eraserSize}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (activeTool === 'pen') {
                                            onPenSizeChange(val);
                                        } else {
                                            onEraserSizeChange(val);
                                        }
                                    }}
                                    className="flex-1 accent-stone-900 h-1.5 bg-stone-100 rounded-lg appearance-none cursor-pointer"
                                />
                                <span className="text-xs font-bold text-stone-900 w-8 text-right">
                                    {activeTool === 'pen' ? penSize : eraserSize}
                                </span>
                            </div>
                        </div>

                        {/* Smoothness (only for pen) */}
                        {activeTool === 'pen' && (
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-stone-500 w-12 uppercase tracking-tight">
                                    부드럽게
                                </span>
                                <div className="flex-1 flex items-center gap-3">
                                    <input
                                        type="range"
                                        min={TOOL_SETTINGS.smoothness.min}
                                        max={TOOL_SETTINGS.smoothness.max}
                                        value={smoothness}
                                        onChange={(e) => onSmoothnessChange(parseInt(e.target.value))}
                                        className="flex-1 accent-stone-900 h-1.5 bg-stone-100 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <span className="text-xs font-bold text-stone-900 w-8 text-right">
                                        {smoothness}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Color Picker (only for pen) */}
                        {activeTool === 'pen' && (
                            <>
                                <div className="grid grid-cols-7 gap-1.5 pt-4 border-t border-stone-100">
                                    {PEN_COLORS.map((c) => (
                                        <button
                                            key={c}
                                            onClick={() => onPenColorChange(c)}
                                            className={`w-7 h-7 rounded-full border transition-transform hover:scale-110 ${penColor === c
                                                ? 'ring-2 ring-offset-2 ring-stone-900 border-transparent'
                                                : 'border-stone-200'
                                                }`}
                                            style={{ backgroundColor: c }}
                                            title={c}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
                                    <div
                                        className="w-10 h-10 rounded-xl border border-stone-200 shadow-sm"
                                        style={{ backgroundColor: penColor }}
                                    />
                                    <div className="flex-1 flex items-center bg-stone-50 rounded-xl px-3 border border-stone-200 h-10">
                                        <span className="text-stone-400 font-medium mr-1">#</span>
                                        <input
                                            type="text"
                                            value={penColor.replace('#', '')}
                                            readOnly // Disable manual input
                                            className="w-full bg-transparent border-none text-sm font-bold text-stone-900 focus:ring-0 uppercase p-0 cursor-default"
                                            placeholder="000000"
                                        />
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="color"
                                            value={penColor}
                                            onChange={(e) => onPenColorChange(e.target.value)}
                                            className="w-10 h-10 opacity-0 absolute inset-0 cursor-pointer"
                                        />
                                        <button className="w-10 h-10 flex items-center justify-center bg-stone-100 rounded-xl hover:bg-stone-200 text-stone-600 transition-colors">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Toolbar */}
                <div className="bg-white/80 backdrop-blur-2xl shadow-2xl rounded-full px-4 py-3 flex items-center gap-2 border border-white/50 ring-1 ring-black/[0.03]">
                    {/* Undo */}
                    <button
                        onClick={onUndo}
                        disabled={!canUndo}
                        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${!canUndo
                            ? 'text-stone-300 cursor-not-allowed'
                            : 'hover:bg-stone-50 text-stone-600 hover:text-stone-900 hover:scale-110'
                            }`}
                        title="Undo (Ctrl+Z)"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                            />
                        </svg>
                    </button>

                    {/* Redo */}
                    <button
                        onClick={onRedo}
                        disabled={!canRedo}
                        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${!canRedo
                            ? 'text-stone-300 cursor-not-allowed'
                            : 'hover:bg-stone-50 text-stone-600 hover:text-stone-900 hover:scale-110'
                            }`}
                        title="Redo (Ctrl+Y)"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
                            />
                        </svg>
                    </button>

                    <div className="w-px h-8 bg-black/[0.05] mx-1" />

                    {/* Hand */}
                    <button
                        onClick={() => handleToolClick('hand')}
                        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${activeTool === 'hand'
                            ? 'bg-black text-white shadow-xl scale-110'
                            : 'hover:bg-stone-50 text-stone-500 hover:text-stone-900 hover:scale-110'
                            }`}
                        title="Pan"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"
                            />
                        </svg>
                    </button>

                    {/* Pen */}
                    <button
                        onClick={() => handleToolClick('pen')}
                        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${activeTool === 'pen'
                            ? 'bg-black text-white shadow-xl scale-110'
                            : 'hover:bg-stone-50 text-stone-500 hover:text-stone-900 hover:scale-110'
                            }`}
                        title="Pen"
                    >
                        <div className="relative">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2.5}
                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                />
                            </svg>
                            <div
                                className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white"
                                style={{ backgroundColor: penColor }}
                            />
                        </div>
                    </button>

                    {/* Eraser */}
                    <button
                        onClick={() => handleToolClick('eraser')}
                        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${activeTool === 'eraser'
                            ? 'bg-black text-white shadow-xl scale-110'
                            : 'hover:bg-stone-50 text-stone-500 hover:text-stone-900 hover:scale-110'
                            }`}
                        title="Eraser"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                            />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 8l-6 6" />
                        </svg>
                    </button>

                    <div className="w-px h-8 bg-black/[0.05] mx-1" />

                    {/* Clear */}
                    <button
                        onClick={onClear}
                        className="w-12 h-12 flex items-center justify-center bg-red-50/50 hover:bg-red-500 text-red-500 hover:text-white rounded-full transition-all hover:scale-110 shadow-sm"
                        title="Clear All"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}

export const WhiteboardToolbar = memo(WhiteboardToolbarComponent);
