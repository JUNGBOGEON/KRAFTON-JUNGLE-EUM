import React, { useRef, useState, useEffect } from 'react';
import { Button } from './ui/button';
import { PenTool, Square, Type, Eraser, Download, Undo, Redo, X } from 'lucide-react';

interface WhiteboardProps {
    onClose: () => void;
}

export function WhiteboardTool({ onClose }: WhiteboardProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tool, setTool] = useState<'pen' | 'rect' | 'text' | 'eraser'>('pen');
    const [color, setColor] = useState('#000000');
    const [lineWidth, setLineWidth] = useState(2);
    const [actions, setActions] = useState<ImageData[]>([]);
    
    // Initialize canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        canvas.width = window.innerWidth * 0.8; // 80% of screen width
        canvas.height = window.innerHeight * 0.8;
        
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        saveState();
    }, []);

    const saveState = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        setActions(prev => [...prev.slice(-10), ctx.getImageData(0, 0, canvas.width, canvas.height)]);
    };

    const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        setIsDrawing(true);
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
        ctx.lineWidth = tool === 'eraser' ? 20 : lineWidth;
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (tool === 'pen' || tool === 'eraser') {
            ctx.lineTo(x, y);
            ctx.stroke();
        }
        // Rectangle preview logic could go here but skipping for simplicity
    };

    const stopDrawing = () => {
        if (isDrawing) {
            setIsDrawing(false);
            saveState();
        }
    };

    const addText = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const text = prompt("텍스트를 입력하세요:", "여기에 입력");
        if (text) {
            ctx.font = "20px Arial";
            ctx.fillStyle = color;
            ctx.fillText(text, 100, 100); // Fixed position for demo
            saveState();
        }
    };

    const drawRect = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(150, 150, 200, 100); // Fixed rect for demo
        saveState();
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="relative bg-white rounded-lg overflow-hidden shadow-2xl flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <div className="flex gap-2">
                        <Button 
                            variant={tool === 'pen' ? "default" : "outline"} 
                            size="icon" 
                            onClick={() => setTool('pen')}
                        >
                            <PenTool className="h-4 w-4" />
                        </Button>
                        <Button 
                            variant={tool === 'rect' ? "default" : "outline"} 
                            size="icon" 
                            onClick={() => { setTool('rect'); drawRect(); }}
                        >
                            <Square className="h-4 w-4" />
                        </Button>
                        <Button 
                            variant={tool === 'text' ? "default" : "outline"} 
                            size="icon" 
                            onClick={() => { setTool('text'); addText(); }}
                        >
                            <Type className="h-4 w-4" />
                        </Button>
                        <Button 
                            variant={tool === 'eraser' ? "default" : "outline"} 
                            size="icon" 
                            onClick={() => setTool('eraser')}
                        >
                            <Eraser className="h-4 w-4" />
                        </Button>
                    </div>
                    
                    <div className="flex gap-2 items-center">
                        <input 
                            type="color" 
                            value={color} 
                            onChange={(e) => setColor(e.target.value)}
                            className="w-8 h-8 rounded cursor-pointer border-none"
                        />
                        <div className="w-[1px] h-6 bg-gray-300 mx-2" />
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </div>
                
                <div className="relative bg-gray-100 p-4 overflow-auto">
                    <canvas 
                        ref={canvasRef}
                        className="bg-white shadow-sm cursor-crosshair touch-none"
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                    />
                </div>
            </div>
        </div>
    );
}
