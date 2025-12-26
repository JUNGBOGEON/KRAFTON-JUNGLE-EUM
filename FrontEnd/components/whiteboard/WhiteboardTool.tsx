import React, { useRef, useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { PenTool, Square, Type, Eraser, Wand2, BrainCircuit, X, StickyNote } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface WhiteboardToolProps {
    onClose: () => void;
}

interface CanvasElement {
    id: string;
    type: 'path' | 'ui-mockup' | 'note';
    x?: number;
    y?: number;
    points?: { x: number; y: number }[];
    content?: string;
    color?: string;
}

export function WhiteboardTool({ onClose }: WhiteboardToolProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [tool, setTool] = useState<'pen' | 'magic' | 'note'>('pen');
    const [elements, setElements] = useState<CanvasElement[]>([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
    const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

    // Initial random note for "Idea Expansion" demo
    useEffect(() => {
        setElements([
            { id: 'initial-note', type: 'note', x: 200, y: 200, content: '여름 휴가 이벤트', color: '#fef3c7' }
        ]);
    }, []);

    // Draw existing paths on canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw saved paths
        elements.forEach(el => {
            if (el.type === 'path' && el.points) {
                ctx.beginPath();
                ctx.strokeStyle = el.color || '#000';
                ctx.lineWidth = 2;
                if (el.points.length > 0) {
                    ctx.moveTo(el.points[0].x, el.points[0].y);
                    el.points.forEach(p => ctx.lineTo(p.x, p.y));
                }
                ctx.stroke();
            }
        });

        // Draw current path
        if (currentPath.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = tool === 'magic' ? '#818cf8' : '#000'; // Indigo for magic pen
            ctx.lineWidth = tool === 'magic' ? 4 : 2;
            if (tool === 'magic') {
                ctx.shadowColor = '#6366f1';
                ctx.shadowBlur = 10;
            } else {
                ctx.shadowBlur = 0;
            }
            
            ctx.moveTo(currentPath[0].x, currentPath[0].y);
            currentPath.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
            ctx.shadowBlur = 0; // reset
        }
    }, [elements, currentPath, tool]);

    // Handle resizing
    useEffect(() => {
        const handleResize = () => {
             if (canvasRef.current) {
                 canvasRef.current.width = window.innerWidth;
                 canvasRef.current.height = window.innerHeight;
             }
        };
        window.addEventListener('resize', handleResize);
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const startDrawing = (e: React.MouseEvent) => {
        if (tool === 'note') return;
        setIsDrawing(true);
        const rect = canvasRef.current!.getBoundingClientRect();
        setCurrentPath([{ x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    };

    const draw = (e: React.MouseEvent) => {
        if (!isDrawing) return;
        const rect = canvasRef.current!.getBoundingClientRect();
        setCurrentPath(prev => [...prev, { x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        setIsDrawing(false);

        if (tool === 'magic') {
            // MAGIC LOGIC: Transform drawing into UI Mockup
            // We use the center of the drawing as the position
            const centerX = currentPath.reduce((sum, p) => sum + p.x, 0) / currentPath.length;
            const centerY = currentPath.reduce((sum, p) => sum + p.y, 0) / currentPath.length;
            
            const newId = Date.now().toString();
            // Add slight delay for "Processing" effect
            setTimeout(() => {
                setElements(prev => [...prev, {
                    id: newId,
                    type: 'ui-mockup',
                    x: centerX - 100, // Center the mock image (width 200)
                    y: centerY - 75,
                }]);
            }, 500);
            setCurrentPath([]); // Clear the stroke
        } else {
            // Normal pen
            setElements(prev => [...prev, {
                id: Date.now().toString(),
                type: 'path',
                points: currentPath,
                color: '#000'
            }]);
            setCurrentPath([]);
        }
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        if (tool === 'note') {
            const rect = canvasRef.current!.getBoundingClientRect();
            setElements(prev => [...prev, {
                id: Date.now().toString(),
                type: 'note',
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                content: 'New Idea',
                color: '#fef3c7'
            }]);
            setTool('pen'); // Reset to pen after placing
        } else {
            // Deselect logic could go here
            setSelectedElementId(null);
        }
    };

    const expandIdea = (parentId: string) => {
        const parent = elements.find(el => el.id === parentId);
        if (!parent || !parent.x || !parent.y) return;

        const newNotes: CanvasElement[] = [
            { id: Date.now() + '1', type: 'note', x: parent.x - 150, y: parent.y + 120, content: '얼리버드 할인', color: '#dcfce7' }, // green
            { id: Date.now() + '2', type: 'note', x: parent.x, y: parent.y + 150, content: 'SNS 해시태그', color: '#dbeafe' }, // blue
            { id: Date.now() + '3', type: 'note', x: parent.x + 150, y: parent.y + 120, content: '친구 추천 보상', color: '#f3e8ff' }, // purple
        ];

        setElements(prev => [...prev, ...newNotes]);
        setSelectedElementId(null); // Close menu
    };

    return (
        <div className="absolute inset-0 z-50 bg-white overflow-hidden flex flex-col">
            {/* Toolbar */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white shadow-lg border rounded-full px-6 py-3 flex gap-4 z-10">
                 <Button 
                    variant={tool === 'pen' ? "default" : "ghost"} size="icon" 
                    onClick={() => setTool('pen')} title="일반 펜"
                >
                    <PenTool className="h-5 w-5" />
                </Button>
                <Button 
                    variant={tool === 'magic' ? "default" : "ghost"} size="icon" 
                    className={tool === 'magic' ? "bg-indigo-600 hover:bg-indigo-700" : "text-indigo-600 hover:bg-indigo-50"}
                    onClick={() => setTool('magic')} title="AI 매직 펜"
                >
                    <Wand2 className="h-5 w-5" />
                </Button>
                <div className="w-px h-6 bg-gray-200" />
                <Button 
                    variant={tool === 'note' ? "default" : "ghost"} size="icon" 
                    onClick={() => setTool('note')} title="포스트잇"
                >
                    <StickyNote className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose} className="ml-4 text-red-500 hover:bg-red-50">
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {/* Canvas Area */}
            <div className="relative flex-1 bg-gray-50 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
                <canvas
                    ref={canvasRef}
                    className={`absolute inset-0 w-full h-full touch-none ${tool === 'pen' || tool === 'magic' ? 'cursor-crosshair' : 'cursor-default'}`}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onClick={handleCanvasClick}
                />
                
                {/* Render HTML elements (Notes & Images) on top of canvas */}
                {elements.map(el => {
                    if (el.type === 'ui-mockup') {
                        return (
                            <motion.div
                                key={el.id}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="absolute bg-white border-2 border-indigo-200 rounded-lg shadow-xl overflow-hidden w-[200px] pointer-events-none select-none"
                                style={{ left: el.x, top: el.y }}
                            >
                                <div className="bg-indigo-50 p-2 border-b border-indigo-100 flex items-center justify-between">
                                    <span className="text-[10px] text-indigo-800 font-bold">Login Page</span>
                                    <div className="flex gap-1"><div className="w-2 h-2 rounded-full bg-red-400"/><div className="w-2 h-2 rounded-full bg-yellow-400"/></div>
                                </div>
                                <div className="p-4 space-y-2">
                                    <div className="h-2 w-1/3 bg-gray-200 rounded"/>
                                    <div className="h-8 bg-gray-100 rounded border border-gray-200"/>
                                    <div className="h-8 bg-gray-100 rounded border border-gray-200"/>
                                    <div className="h-8 bg-indigo-500 rounded text-white text-xs flex items-center justify-center">Login</div>
                                </div>
                                <div className="absolute inset-0 bg-white/20 animate-pulse pointer-events-none"/> {/* Sparkle effect finish */}
                            </motion.div>
                        );
                    }
                    if (el.type === 'note') {
                        return (
                            <motion.div
                                key={el.id}
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="absolute w-40 h-40 shadow-md p-4 flex flex-col cursor-pointer hover:shadow-lg transition-shadow"
                                style={{ left: el.x, top: el.y, backgroundColor: el.color }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedElementId(el.id);
                                }}
                            >
                                <textarea 
                                    className="w-full h-full bg-transparent resize-none border-none focus:ring-0 text-sm font-handwriting"
                                    defaultValue={el.content}
                                />
                                
                                {/* Context Menu for Note */}
                                <AnimatePresence>
                                {selectedElementId === el.id && (
                                    <motion.div 
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="absolute -top-12 left-1/2 -translate-x-1/2 bg-white shadow-xl border rounded-lg p-1 flex gap-1 z-20"
                                    >
                                        <Button 
                                            variant="ghost" size="icon" className="h-8 w-8 hover:bg-indigo-50 hover:text-indigo-600"
                                            onClick={(e) => { e.stopPropagation(); expandIdea(el.id); }}
                                        >
                                            <BrainCircuit className="h-5 w-5" />
                                        </Button>
                                        <div className="w-px h-6 bg-gray-200 my-auto"/>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 text-red-500">
                                            <Eraser className="h-4 w-4" />
                                        </Button>
                                    </motion.div>
                                )}
                                </AnimatePresence>
                            </motion.div>
                        );
                    }
                    return null;
                })}
            </div>
            
            {/* Guide Text */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm backdrop-blur-sm pointer-events-none">
                {tool === 'magic' ? "✨ 매직 펜 모드: 사각형을 그려보세요!" : "빈 곳을 클릭하여 메모를 추가하거나, 펜으로 그리세요."}
            </div>
        </div>
    );
}
