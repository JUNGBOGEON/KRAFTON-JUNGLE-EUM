'use client';

import { memo } from 'react';
import { ZOOM_SETTINGS } from '../constants';

interface ZoomControlsProps {
    scale: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onResetZoom: () => void;
}

function ZoomControlsComponent({
    scale,
    onZoomIn,
    onZoomOut,
    onResetZoom,
}: ZoomControlsProps) {
    return (
        <div className="absolute top-8 left-8 flex items-center gap-3 z-40">
            <div className="flex items-center bg-white/70 backdrop-blur-xl rounded-full shadow-2xl border border-white/50 p-1">
                {/* Zoom Out (-) */}
                <button
                    onClick={onZoomOut}
                    disabled={scale <= ZOOM_SETTINGS.min}
                    className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${scale <= ZOOM_SETTINGS.min
                            ? 'opacity-[0.2] cursor-not-allowed'
                            : 'hover:bg-stone-50 text-stone-600 hover:text-stone-900 hover:scale-110 active:scale-95'
                        }`}
                    title="Zoom Out (Ctrl -)"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                    </svg>
                </button>

                <div className="px-2">
                    <button
                        onClick={onResetZoom}
                        className="text-xs font-black text-stone-900 bg-stone-100/50 px-2 py-1 rounded-full border border-black/[0.03] hover:bg-stone-100 transition-colors"
                        title="Reset Zoom (Ctrl 0)"
                    >
                        {Math.round(scale * 100)}%
                    </button>
                </div>

                {/* Zoom In (+) */}
                <button
                    onClick={onZoomIn}
                    disabled={scale >= ZOOM_SETTINGS.max}
                    className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${scale >= ZOOM_SETTINGS.max
                            ? 'opacity-[0.2] cursor-not-allowed'
                            : 'hover:bg-stone-50 text-stone-600 hover:text-stone-900 hover:scale-110 active:scale-95'
                        }`}
                    title="Zoom In (Ctrl +)"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                </button>
            </div>
        </div>
    );
}

export const ZoomControls = memo(ZoomControlsComponent);
