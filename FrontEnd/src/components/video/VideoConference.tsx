import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { 
    Mic, MicOff, Video, VideoOff, PhoneOff, 
    MoreVertical, Settings, Volume2, VolumeX, 
    Layout, Grid, Monitor, Languages, Hand, ScreenShare
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MiroWhiteboard } from '../whiteboard/MiroWhiteboard';
import { cn } from '../../lib/utils';

// --- Types & Mock Data ---
interface Participant {
    id: string;
    name: string;
    role: string;
    avatar: string;
    isSpeaking?: boolean;
    isMuted?: boolean;
    hasHandRaised?: boolean;
}

const PARTICIPANTS: Participant[] = [
    { id: 'p1', name: 'James', role: 'Client', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=James', isSpeaking: true },
    { id: 'me', name: 'Min-su (Me)', role: 'PM', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Minsu', isMuted: true },
    { id: 'p2', name: 'Sarah', role: 'Designer', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah' },
    { id: 'p3', name: 'David', role: 'Dev', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=David', hasHandRaised: true },
    { id: 'p4', name: 'Emma', role: 'Marketing', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma' },
];

interface VideoConferenceProps {
    onLeave: () => void;
    toggleChat: () => void;
    isChatOpen: boolean;
}

export function VideoConference({ onLeave, toggleChat, isChatOpen }: VideoConferenceProps) {
    // Layout State
    const [viewMode, setViewMode] = useState<'speaker' | 'listener'>('speaker');
    const [activeSpeakerId, setActiveSpeakerId] = useState('p1'); // James is speaking by default
    const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);

    // Call States
    const [isMyMicOn, setIsMyMicOn] = useState(false);
    const [isMyVideoOn, setIsMyVideoOn] = useState(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [aiProcessing, setAiProcessing] = useState(false);

    // Simulation: AI Text Stream
    const [activeSubtitle, setActiveSubtitle] = useState<{ speakerId: string, text: string } | null>(null);
    
    // Simulate active speaker changes and subtitles
    useEffect(() => {
        // Mock subtitle sequence
        const MOCK_SCRIPT = [
            { id: 'p1', text: "이번 분기 마케팅 성과는 예상보다 15% 높습니다." },
            { id: 'p3', text: "기술적인 이슈는 대부분 해결되었습니다." },
            { id: 'p1', text: "다음 주까지 최종 리포트를 공유하겠습니다." },
            { id: 'p4', text: "디자인 팀에서도 자산을 모두 업데이트했습니다." },
        ];

        let index = 0;
        const interval = setInterval(() => {
            const script = MOCK_SCRIPT[index % MOCK_SCRIPT.length];
            
            // 1. Set Active Speaker
            setActiveSpeakerId(script.id);
            setAiProcessing(true);
            
            // 2. Stream Text Effect
            setActiveSubtitle({ speakerId: script.id, text: script.text });

            // 3. Clear after delay
            setTimeout(() => {
                setAiProcessing(false);
                // Don't clear subtitle immediately for readability
            }, 2500);

            index++;
        }, 4000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex-1 relative bg-slate-950 flex flex-col overflow-hidden text-slate-200 font-sans">
            
            {/* --- 1. Top Control Bar (View Switcher) --- */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex gap-2 p-1 bg-slate-900/90 backdrop-blur rounded-full border border-slate-700 shadow-2xl">
                <Button 
                    size="sm" 
                    variant="ghost"
                    className={cn(
                        "rounded-full px-4 transition-all",
                        viewMode === 'speaker' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"
                    )}
                    onClick={() => setViewMode('speaker')}
                >
                    <Monitor className="h-4 w-4 mr-2" />
                    Speaker View
                </Button>
                <div className="w-px bg-slate-700 my-1" />
                <Button 
                    size="sm" 
                    variant="ghost"
                    className={cn(
                        "rounded-full px-4 transition-all",
                        viewMode === 'listener' ? "bg-green-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"
                    )}
                    onClick={() => setViewMode('listener')}
                >
                    <Grid className="h-4 w-4 mr-2" />
                    Listener View
                </Button>
            </div>

            {/* --- 2. Main Video Area --- */}
            <div className="flex-1 flex p-4 gap-4 overflow-hidden">
                
                {/* Whiteboard / Screen Share Mode Override */}
                {isWhiteboardOpen || isScreenSharing ? (
                     <div className="flex-1 relative bg-white rounded-2xl overflow-hidden shadow-2xl flex">
                        <div className="flex-1 relative flex items-center justify-center bg-slate-900">
                            {isWhiteboardOpen ? (
                                <MiroWhiteboard isEmbedded onClose={() => setIsWhiteboardOpen(false)} />
                            ) : (
                                <div className="text-center">
                                    <Monitor className="w-20 h-20 text-indigo-500 mx-auto mb-4 animate-pulse" />
                                    <h3 className="text-2xl font-bold text-white mb-2">Screen Sharing Active</h3>
                                    <p className="text-slate-400">You are sharing your screen with participants.</p>
                                    <Button 
                                        variant="destructive" 
                                        className="mt-6"
                                        onClick={() => setIsScreenSharing(false)}
                                    >
                                        Stop Sharing
                                    </Button>
                                </div>
                            )}
                        </div>
                        {/* Right Sidebar for Video Thumbnails */}
                        <div className="w-48 bg-slate-900 border-l border-slate-800 flex flex-col p-2 gap-2 overflow-y-auto">
                            {PARTICIPANTS.map(p => (
                                <div key={p.id} className="aspect-video bg-slate-800 rounded-lg overflow-hidden border border-slate-700 relative shrink-0">
                                    <Avatar className="w-full h-full rounded-none">
                                        <AvatarImage src={p.avatar} className="object-cover" />
                                        <AvatarFallback>{p.name[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="absolute bottom-1 left-1 bg-black/60 px-1.5 rounded text-[10px] text-white truncate max-w-[80%]">
                                        {p.name}
                                    </div>
                                    {p.isSpeaking && (
                                        <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                                    )}
                                </div>
                            ))}
                        </div>
                     </div>
                ) : (
                    <>
                        {/* === MODE A: SPEAKER VIEW (Focus on Presentation) === */}
                        {viewMode === 'speaker' && (
                            <div className="flex-1 flex flex-col gap-4 w-full max-w-6xl mx-auto">
                                {/* Main Stage */}
                                <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 relative overflow-hidden shadow-2xl group">
                                    {/* Active Speaker Video */}
                                    <div className="absolute inset-0">
                                        <img 
                                            src={PARTICIPANTS.find(p => p.id === activeSpeakerId)?.avatar} 
                                            className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-1000"
                                            alt="Active Speaker"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
                                    </div>

                                    {/* Speaker Info Overlay */}
                                    <div className="absolute bottom-8 left-8">
                                        <div className="flex items-center gap-3 mb-2">
                                            <h2 className="text-3xl font-bold text-white shadow-black drop-shadow-md">
                                                {PARTICIPANTS.find(p => p.id === activeSpeakerId)?.name}
                                            </h2>
                                            {aiProcessing && (
                                                <Badge className="bg-indigo-500/80 backdrop-blur text-white border-none animate-pulse">
                                                    <Languages className="w-3 h-3 mr-1" /> Speaking
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-slate-300 text-lg">
                                            {PARTICIPANTS.find(p => p.id === activeSpeakerId)?.role}
                                        </p>
                                    </div>

                                    {/* AI Subtitle Overlay (Speaker View: Floating Caption) */}
                                    {activeSubtitle && activeSubtitle.speakerId === activeSpeakerId && (
                                        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-3xl px-8 pointer-events-none">
                                            <motion.div 
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                key={activeSubtitle.text}
                                                className="bg-black/70 backdrop-blur-sm px-6 py-4 rounded-xl text-center shadow-lg mx-auto"
                                            >
                                                <div className="flex items-center justify-center gap-2 mb-1 opacity-70">
                                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                                    <span className="text-[10px] uppercase tracking-widest text-white font-bold">Live Translation (KO → EN)</span>
                                                </div>
                                                <p className="text-xl md:text-2xl text-white font-medium leading-relaxed drop-shadow-md">
                                                    "{activeSubtitle.text}"
                                                </p>
                                            </motion.div>
                                        </div>
                                    )}
                                </div>

                                {/* Thumbnail Strip (Others) */}
                                <div className="h-32 flex gap-4 overflow-x-auto pb-2 px-2 snap-x">
                                    {PARTICIPANTS.filter(p => p.id !== activeSpeakerId).map(p => (
                                        <div 
                                            key={p.id} 
                                            onClick={() => setActiveSpeakerId(p.id)}
                                            className="w-48 bg-slate-800 rounded-xl overflow-hidden border border-slate-700 relative shrink-0 cursor-pointer hover:ring-2 ring-indigo-500 transition-all snap-start group"
                                        >
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <Avatar className="w-16 h-16 group-hover:scale-110 transition-transform">
                                                    <AvatarImage src={p.avatar} />
                                                    <AvatarFallback>{p.name[0]}</AvatarFallback>
                                                </Avatar>
                                            </div>
                                            <div className="absolute bottom-2 left-2 text-sm font-bold text-white shadow-black drop-shadow-md">
                                                {p.name}
                                            </div>
                                            {p.hasHandRaised && (
                                                <div className="absolute top-2 right-2 bg-yellow-500 text-black p-1 rounded-full shadow-lg animate-bounce">
                                                    <Hand className="w-3 h-3" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* === MODE B: LISTENER VIEW (Grid for Engagement) === */}
                        {viewMode === 'listener' && (
                            <div className="flex-1 w-full max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4 auto-rows-fr content-center">
                                {PARTICIPANTS.map(p => (
                                    <div 
                                        key={p.id} 
                                        className={cn(
                                            "relative rounded-2xl overflow-hidden bg-slate-800 border transition-all duration-300 group",
                                            p.isSpeaking ? "border-green-500 ring-4 ring-green-500/20 shadow-xl z-10 scale-[1.02]" : "border-slate-700 hover:border-slate-600"
                                        )}
                                    >
                                        {/* Video Feed Placeholder */}
                                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                                             <Avatar className="w-24 h-24 md:w-32 md:h-32 shadow-2xl">
                                                <AvatarImage src={p.avatar} />
                                                <AvatarFallback>{p.name[0]}</AvatarFallback>
                                            </Avatar>
                                        </div>

                                        {/* Name Label */}
                                        <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur px-3 py-1.5 rounded-lg flex items-center gap-2 max-w-[80%]">
                                            {p.isMuted && <MicOff className="w-3 h-3 text-red-400" />}
                                            <span className="text-white font-medium text-sm truncate">{p.name}</span>
                                        </div>

                                        {/* Interaction Signals */}
                                        {p.hasHandRaised && (
                                            <div className="absolute top-4 left-4 bg-yellow-500 text-slate-900 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg z-20">
                                                <Hand className="w-3 h-3" /> Raised Hand
                                            </div>
                                        )}

                                        {/* AI Subtitle Overlay (Listener View: Tile Embedded) */}
                                        {activeSubtitle && activeSubtitle.speakerId === p.id && (
                                            <motion.div 
                                                initial={{ opacity: 0, scale: 0.95, y: 5 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                key={activeSubtitle.text}
                                                className="absolute bottom-16 left-4 right-4 z-20"
                                            >
                                                <div className="bg-slate-900/90 backdrop-blur border border-slate-700 p-3 rounded-lg shadow-xl relative">
                                                    {/* Speech Bubble Arrow */}
                                                    <div className="absolute -bottom-1.5 left-6 w-3 h-3 bg-slate-900 border-r border-b border-slate-700 rotate-45 transform" />
                                                    
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <Languages className="w-3 h-3 text-indigo-400" />
                                                        <span className="text-[10px] text-indigo-300 font-bold uppercase">Translation</span>
                                                    </div>
                                                    <p className="text-sm text-white leading-snug">
                                                        {activeSubtitle.text}
                                                    </p>
                                                </div>
                                            </motion.div>
                                        )}

                                        {/* Active Speaker Visualizer Overlay */}
                                        {p.isSpeaking && (
                                            <div className="absolute top-4 right-4 flex gap-1 h-4 items-end">
                                                {[1,2,3].map(i => (
                                                    <motion.div 
                                                        key={i}
                                                        animate={{ height: [4, 16, 4] }}
                                                        transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                                                        className="w-1 bg-green-500 rounded-full"
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* --- 3. Bottom Control Bar --- */}
            <div className="h-20 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-6 shrink-0 relative z-50">
                <div className="flex items-center gap-4 w-1/3">
                    <div className="flex flex-col">
                        <span className="text-white font-bold text-sm">Marketing Strategy Q4</span>
                        <span className="text-slate-400 text-xs">02:14:55</span>
                    </div>
                </div>

                <div className="flex items-center gap-3 justify-center w-1/3">
                    <Button 
                        variant={isMyMicOn ? "default" : "destructive"} 
                        size="icon" 
                        className="rounded-full w-12 h-12"
                        onClick={() => setIsMyMicOn(!isMyMicOn)}
                    >
                        {isMyMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    </Button>
                    <Button 
                        variant={isMyVideoOn ? "secondary" : "destructive"} 
                        size="icon" 
                        className="rounded-full w-12 h-12"
                        onClick={() => setIsMyVideoOn(!isMyVideoOn)}
                        title={isMyVideoOn ? "Turn Off Camera (Voice Only)" : "Turn On Camera"}
                    >
                        {isMyVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                    </Button>
                    <Button 
                        variant={isScreenSharing ? "default" : "secondary"}
                        size="icon"
                        className={cn("rounded-full w-12 h-12", isScreenSharing && "bg-green-600 hover:bg-green-700")}
                        onClick={() => {
                            setIsScreenSharing(!isScreenSharing);
                            if (isWhiteboardOpen) setIsWhiteboardOpen(false);
                        }}
                        title="Share Screen"
                    >
                        <ScreenShare className="h-5 w-5" />
                    </Button>
                    <Button 
                        variant={isWhiteboardOpen ? "default" : "secondary"}
                        className={cn("rounded-full h-12 px-6 gap-2", isWhiteboardOpen && "bg-indigo-600 hover:bg-indigo-700")}
                        onClick={() => {
                            setIsWhiteboardOpen(!isWhiteboardOpen);
                            if (isScreenSharing) setIsScreenSharing(false);
                        }}
                    >
                        <Layout className="h-5 w-5" />
                        <span>Whiteboard</span>
                    </Button>
                    <Button variant="secondary" size="icon" className="rounded-full w-12 h-12">
                        <MoreVertical className="h-5 w-5" />
                    </Button>
                </div>

                <div className="flex items-center justify-end gap-3 w-1/3">
                    <Button variant="destructive" className="rounded-full px-6" onClick={onLeave}>
                        <PhoneOff className="w-4 h-4 mr-2" /> Leave
                    </Button>
                </div>
            </div>
        </div>
    );
}