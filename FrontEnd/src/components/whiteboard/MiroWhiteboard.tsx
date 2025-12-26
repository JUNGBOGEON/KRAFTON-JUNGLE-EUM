import React, { useState, useRef, useEffect, WheelEvent } from 'react';
import { 
    MousePointer2, Hand, Type, StickyNote, Square, 
    Circle, Minus, Undo2, Redo2, ZoomIn, ZoomOut, 
    Mic, MicOff, PhoneOff, Users, MoreHorizontal, PenTool,
    Video, VideoOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

// --- Types ---
type ToolType = 'select' | 'hand' | 'pen' | 'sticky' | 'shape-rect' | 'shape-circle' | 'text';

interface CanvasElement {
    id: string;
    type: ToolType;
    x: number;
    y: number;
    width?: number;
    height?: number;
    content?: string;
    color?: string;
    points?: { x: number, y: number }[]; // For pen
}

interface CursorPosition {
    userId: string;
    name: string;
    color: string;
    x: number;
    y: number;
}

interface MiroWhiteboardProps {
    onClose?: () => void;
    isEmbedded?: boolean; // If true, hides meeting controls (mic, cam, end)
}

// --- Component ---
export function MiroWhiteboard({ onClose, isEmbedded = false }: MiroWhiteboardProps) {
    // 1. Canvas State (Infinite Pan/Zoom)
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    
    // 2. Tools & Content
    const [activeTool, setActiveTool] = useState<ToolType>('select');
    const [elements, setElements] = useState<CanvasElement[]>([]);
    const [drawingPath, setDrawingPath] = useState<{ x: number, y: number }[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // 3. Collaboration State (Mock)
    const [cursors, setCursors] = useState<CursorPosition[]>([
        { userId: 'u2', name: 'James', color: '#ef4444', x: 200, y: 300 },
        { userId: 'u3', name: 'Sarah', color: '#22c55e', x: 400, y: 150 },
    ]);
    const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
    const [micOn, setMicOn] = useState(true);
    const [cameraOn, setCameraOn] = useState(false); // New: Camera State

    const containerRef = useRef<HTMLDivElement>(null);

    // --- Mock Data Init ---
    useEffect(() => {
        // Initial "Idea Board" content
        setElements([
            { id: '1', type: 'sticky', x: 100, y: 100, content: 'Q4 Strategy', color: '#fef3c7' }, // Yellow
            { id: '2', type: 'shape-rect', x: 300, y: 100, width: 250, height: 180, color: '#e0e7ff' }, // Blue rect
            { id: '3', type: 'text', x: 320, y: 120, content: 'Main Goals:', color: '#000' },
            { id: '4', type: 'text', x: 320, y: 160, content: '- Growth 20%', color: '#000' },
            { id: '5', type: 'text', x: 320, y: 200, content: '- New Markets', color: '#000' },
            { id: '6', type: 'sticky', x: 100, y: 300, content: 'Budget?', color: '#dcfce7' }, // Green
        ]);

        // Simulate Active Speakers & Moving Cursors
        const interval = setInterval(() => {
            setActiveSpeakers(Math.random() > 0.5 ? ['u2'] : ['u2', 'u3']);
            setCursors(prev => prev.map(c => ({
                ...c,
                x: c.x + (Math.random() - 0.5) * 20,
                y: c.y + (Math.random() - 0.5) * 20,
            })));
        }, 1000);
        return () => clearInterval(interval);
    }, []);


    // --- Interaction Handlers ---

    // Zoom Logic
    const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const zoomSensitivity = 0.001;
            const delta = -e.deltaY * zoomSensitivity;
            const newScale = Math.min(Math.max(0.1, scale + delta), 4);
            setScale(newScale);
        } else {
            setOffset(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
        }
    };

    // Pan Logic (Space bar + Drag or Middle Click)
    const handleMouseDown = (e: React.MouseEvent) => {
        if (activeTool === 'hand' || e.button === 1) {
            setIsPanning(true);
        } else if (activeTool === 'sticky') {
             const rect = containerRef.current!.getBoundingClientRect();
             const x = (e.clientX - rect.left - offset.x) / scale;
             const y = (e.clientY - rect.top - offset.y) / scale;
             setElements(prev => [...prev, {
                 id: Date.now().toString(),
                 type: 'sticky',
                 x: x - 50, // center
                 y: y - 50,
                 content: 'New Idea',
                 color: '#fef3c7'
             }]);
             setActiveTool('select');
        } else if (activeTool === 'pen') {
            const rect = containerRef.current!.getBoundingClientRect();
            const x = (e.clientX - rect.left - offset.x) / scale;
            const y = (e.clientY - rect.top - offset.y) / scale;
            setDrawingPath([{ x, y }]);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setOffset(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
        } else if (drawingPath.length > 0) {
             const rect = containerRef.current!.getBoundingClientRect();
             const x = (e.clientX - rect.left - offset.x) / scale;
             const y = (e.clientY - rect.top - offset.y) / scale;
             setDrawingPath(prev => [...prev, { x, y }]);
        }
    };

    const handleMouseUp = () => {
        setIsPanning(false);
        if (drawingPath.length > 0) {
            setElements(prev => [...prev, {
                id: Date.now().toString(),
                type: 'pen',
                x: 0, y: 0, 
                points: drawingPath,
                color: '#000'
            }]);
            setDrawingPath([]);
        }
    };

    return (
        <div className="fixed inset-0 z-40 bg-slate-50 overflow-hidden flex flex-col font-sans">
            
            {/* --- 1. Top Bar: Title & Participants --- */}
            {!isEmbedded && (
                <div className="absolute top-0 left-0 right-0 h-16 pointer-events-none flex items-center justify-between px-6 z-50">
                    <div className="pointer-events-auto bg-white/90 backdrop-blur shadow-sm border border-slate-200 rounded-lg px-4 py-2 flex items-center gap-3">
                        <div className="font-bold text-slate-800">Q4 Strategy Workshop</div>
                        <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">Interactive Board</span>
                    </div>

                    <div className="pointer-events-auto flex items-center gap-2">
                        {/* Participant Avatars */}
                        <div className="flex -space-x-2 mr-4">
                            {['u2', 'u3', 'me'].map((uid) => {
                                const isSpeaking = activeSpeakers.includes(uid) || (uid === 'me' && false);
                                return (
                                    <div key={uid} className="relative group">
                                        <Avatar className={`border-2 border-white w-10 h-10 transition-transform ${isSpeaking ? 'ring-2 ring-green-500 scale-110 z-10' : 'z-0'}`}>
                                            <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${uid}`} />
                                            <AvatarFallback>{uid}</AvatarFallback>
                                        </Avatar>
                                        {isSpeaking && (
                                            <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500 border border-white"></span>
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                            <div className="w-10 h-10 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-xs font-bold text-slate-500">
                                +2
                            </div>
                        </div>
                        <Button variant="outline" size="sm" className="bg-white/90 backdrop-blur">
                            <Users className="h-4 w-4 mr-2" /> Share
                        </Button>
                    </div>
                </div>
            )}

            {/* --- 2. Left Toolbar --- */}
            <div className="absolute top-1/2 -translate-y-1/2 left-4 z-50 flex flex-col gap-2 bg-white shadow-xl border border-slate-200 rounded-lg p-2">
                {[
                    { id: 'select', icon: MousePointer2, label: 'Select (V)' },
                    { id: 'hand', icon: Hand, label: 'Pan (H)' },
                    { id: 'pen', icon: PenTool, label: 'Pen (P)' },
                    { id: 'sticky', icon: StickyNote, label: 'Sticky Note (S)' },
                    { id: 'shape-rect', icon: Square, label: 'Shape (R)' },
                    { id: 'text', icon: Type, label: 'Text (T)' },
                ].map((tool) => (
                    <Tooltip key={tool.id}>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setActiveTool(tool.id as ToolType)}
                                className={`p-2.5 rounded-lg transition-all ${
                                    activeTool === tool.id 
                                        ? 'bg-indigo-100 text-indigo-700' 
                                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                                }`}
                            >
                                <tool.icon className="w-5 h-5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            <p>{tool.label}</p>
                        </TooltipContent>
                    </Tooltip>
                ))}
                <div className="h-px bg-slate-200 my-1" />
                <button className="p-2.5 text-slate-400 hover:text-slate-900 rounded-lg"><Undo2 className="w-5 h-5" /></button>
                <button className="p-2.5 text-slate-400 hover:text-slate-900 rounded-lg"><Redo2 className="w-5 h-5" /></button>
            </div>

            {/* --- 3. The Infinite Canvas --- */}
            <div 
                ref={containerRef}
                className={`flex-1 relative bg-slate-50 overflow-hidden ${activeTool === 'hand' || isPanning ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {/* Grid Pattern Background */}
                <div 
                    className="absolute inset-0 pointer-events-none opacity-20"
                    style={{
                        backgroundImage: 'radial-gradient(#64748b 1px, transparent 1px)',
                        backgroundSize: `${20 * scale}px ${20 * scale}px`,
                        backgroundPosition: `${offset.x}px ${offset.y}px`
                    }}
                />

                {/* Transform Container */}
                <div 
                    className="absolute inset-0 origin-top-left will-change-transform"
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    }}
                >
                    {elements.map(el => {
                        if (el.type === 'sticky') {
                            return (
                                <div 
                                    key={el.id}
                                    className="absolute p-4 shadow-lg flex items-center justify-center text-center font-handwriting leading-tight transition-shadow hover:shadow-xl cursor-pointer"
                                    style={{
                                        left: el.x, top: el.y, width: 140, height: 140,
                                        backgroundColor: el.color,
                                        fontSize: 16,
                                    }}
                                    onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); }}
                                >
                                    {el.content}
                                    {selectedId === el.id && <div className="absolute inset-0 border-2 border-indigo-500 pointer-events-none" />}
                                </div>
                            );
                        }
                        if (el.type === 'shape-rect') {
                            return (
                                <div 
                                    key={el.id}
                                    className="absolute border-2 border-slate-300 rounded-lg flex items-center justify-center shadow-sm"
                                    style={{
                                        left: el.x, top: el.y, width: el.width, height: el.height,
                                        backgroundColor: el.color,
                                    }}
                                >
                                </div>
                            );
                        }
                        if (el.type === 'text') {
                             return (
                                <div 
                                    key={el.id}
                                    className="absolute text-2xl font-bold text-slate-800 whitespace-nowrap"
                                    style={{ left: el.x, top: el.y }}
                                >
                                    {el.content}
                                </div>
                            );
                        }
                        if (el.type === 'pen' && el.points) {
                             const pathData = `M ${el.points.map(p => `${p.x} ${p.y}`).join(' L ')}`;
                             return (
                                <svg key={el.id} className="absolute overflow-visible top-0 left-0 pointer-events-none">
                                    <path d={pathData} stroke={el.color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                             );
                        }
                        return null;
                    })}

                    {drawingPath.length > 0 && (
                        <svg className="absolute overflow-visible top-0 left-0 pointer-events-none z-50">
                            <path 
                                d={`M ${drawingPath.map(p => `${p.x} ${p.y}`).join(' L ')}`} 
                                stroke="#000" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" 
                            />
                        </svg>
                    )}

                    {cursors.map(cursor => (
                        <div 
                            key={cursor.userId}
                            className="absolute pointer-events-none transition-all duration-300 ease-linear z-[60]"
                            style={{ left: cursor.x, top: cursor.y }}
                        >
                            <MousePointer2 className="w-5 h-5 fill-current" style={{ color: cursor.color }} />
                            <div 
                                className="ml-4 -mt-2 px-2 py-0.5 rounded text-[10px] font-bold text-white shadow-sm whitespace-nowrap"
                                style={{ backgroundColor: cursor.color }}
                            >
                                {cursor.name}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* --- 4. Bottom Floating Bar (Meeting Controls) --- */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50">
                
                {/* Zoom Controls (Always Show) */}
                <div className="bg-white/90 backdrop-blur shadow-lg border border-slate-200 rounded-full px-4 py-2 flex items-center gap-4">
                    <button className="hover:text-indigo-600" onClick={() => setScale(s => Math.max(0.1, s - 0.1))}><ZoomOut className="w-4 h-4" /></button>
                    <span className="text-xs font-mono w-12 text-center">{Math.round(scale * 100)}%</span>
                    <button className="hover:text-indigo-600" onClick={() => setScale(s => Math.min(4, s + 0.1))}><ZoomIn className="w-4 h-4" /></button>
                </div>

                {/* Meeting Controls - ONLY Show if NOT embedded (Standalone Mode) */}
                {!isEmbedded && (
                    <div className="bg-slate-900/90 backdrop-blur shadow-2xl border border-slate-700 rounded-full px-6 py-3 flex items-center gap-6 text-white">
                        <button 
                            className={`rounded-full p-2 transition-colors ${micOn ? 'bg-slate-700 hover:bg-slate-600' : 'bg-red-500 hover:bg-red-600'}`}
                            onClick={() => setMicOn(!micOn)}
                        >
                            {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                        </button>

                        <button 
                            className={`rounded-full p-2 transition-colors ${cameraOn ? 'bg-slate-700 hover:bg-slate-600' : 'bg-red-500 hover:bg-red-600'}`}
                            onClick={() => setCameraOn(!cameraOn)}
                        >
                            {cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                        </button>
                        
                        <div className="flex flex-col items-center w-32 border-l border-r border-slate-700 mx-2 px-2">
                            <span className="text-xs text-green-400 font-bold animate-pulse">● Live</span>
                            <span className="text-[10px] text-slate-400">01:24:30</span>
                        </div>

                        <button 
                            className="rounded-full p-2 bg-red-600 hover:bg-red-700"
                            onClick={onClose}
                        >
                            <PhoneOff className="w-5 h-5" />
                        </button>
                    </div>
                )}
                
                {/* Minimap Toggle (Always Show) */}
                <div className="bg-white/90 backdrop-blur shadow-lg border border-slate-200 rounded-full p-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500">
                        <div className="w-4 h-4 border border-current bg-slate-200" />
                    </Button>
                </div>
            </div>

            {/* Video PIP (If Camera On AND Standalone) */}
            {cameraOn && !isEmbedded && (
                <motion.div 
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="absolute bottom-32 right-8 w-48 aspect-video bg-slate-800 rounded-lg shadow-2xl overflow-hidden border border-slate-600 z-50"
                >
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Avatar className="h-16 w-16">
                            <AvatarImage src="" />
                            <AvatarFallback>Me</AvatarFallback>
                        </Avatar>
                    </div>
                    <div className="absolute bottom-2 left-2 text-[10px] text-white bg-black/50 px-2 rounded">
                        Me
                    </div>
                </motion.div>
            )}
        </div>
    );
}
