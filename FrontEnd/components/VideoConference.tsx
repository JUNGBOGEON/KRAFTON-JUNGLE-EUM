import React, { useState } from 'react';
import { Button } from './ui/button';
import { Mic, MicOff, Video, VideoOff, Monitor, PhoneOff, MessageSquare, Users, Settings } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

interface VideoConferenceProps {
    onLeave: () => void;
}

export function VideoConference({ onLeave }: VideoConferenceProps) {
    const [micOn, setMicOn] = useState(true);
    const [cameraOn, setCameraOn] = useState(true);
    const [showChat, setShowChat] = useState(true);

    const participants = [
        { id: 1, name: "나 (Host)", isMe: true },
        { id: 2, name: "김철수", isMe: false },
        { id: 3, name: "이영희", isMe: false },
        { id: 4, name: "박지성", isMe: false },
    ];

    return (
        <div className="absolute inset-0 z-40 flex bg-gray-900 text-white">
            {/* Main Video Grid */}
            <div className="flex-1 flex flex-col">
                <div className="flex-1 p-4 grid grid-cols-2 gap-4 auto-rows-fr">
                    {participants.map((p) => (
                        <div key={p.id} className="relative bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center border border-gray-700">
                            {/* Mock Video Placeholder */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Avatar className="h-24 w-24">
                                    <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name}`} />
                                    <AvatarFallback>{p.name[0]}</AvatarFallback>
                                </Avatar>
                            </div>
                            
                            {/* Status Indicators */}
                            <div className="absolute bottom-4 left-4 bg-black/50 px-2 py-1 rounded text-sm flex items-center gap-2">
                                <span>{p.name}</span>
                                {p.isMe && !micOn && <MicOff className="h-3 w-3 text-red-400" />}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Control Bar */}
                <div className="h-20 bg-gray-950 flex items-center justify-center gap-4 px-8 border-t border-gray-800">
                    <Button 
                        variant={micOn ? "secondary" : "destructive"} 
                        size="icon" 
                        className="rounded-full h-12 w-12"
                        onClick={() => setMicOn(!micOn)}
                    >
                        {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    </Button>
                    <Button 
                        variant={cameraOn ? "secondary" : "destructive"} 
                        size="icon" 
                        className="rounded-full h-12 w-12"
                        onClick={() => setCameraOn(!cameraOn)}
                    >
                        {cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                    </Button>
                    <Button 
                        variant="secondary" 
                        size="icon" 
                        className="rounded-full h-12 w-12"
                    >
                        <Monitor className="h-5 w-5" />
                    </Button>
                    <div className="w-px h-8 bg-gray-700 mx-2" />
                    <Button 
                        variant="destructive" 
                        size="lg" 
                        className="rounded-full px-8"
                        onClick={onLeave}
                    >
                        <PhoneOff className="h-5 w-5 mr-2" /> 회의 종료
                    </Button>
                    <div className="flex-1" />
                    <Button 
                        variant={showChat ? "default" : "ghost"} 
                        size="icon"
                        onClick={() => setShowChat(!showChat)}
                    >
                        <MessageSquare className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon">
                        <Users className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon">
                        <Settings className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* Sidebar Chat */}
            {showChat && (
                <div className="w-80 bg-gray-950 border-l border-gray-800 flex flex-col">
                    <div className="p-4 border-b border-gray-800 font-semibold">회의 채팅</div>
                    <ScrollArea className="flex-1 p-4">
                        <div className="space-y-4">
                            <div className="text-sm">
                                <span className="font-bold text-blue-400">김철수</span>
                                <span className="text-gray-400 text-xs ml-2">오전 10:00</span>
                                <p className="mt-1">안녕하세요! 회의 시작하시죠.</p>
                            </div>
                            <div className="text-sm">
                                <span className="font-bold text-green-400">나</span>
                                <span className="text-gray-400 text-xs ml-2">오전 10:01</span>
                                <p className="mt-1">네, 화면 공유하겠습니다.</p>
                            </div>
                        </div>
                    </ScrollArea>
                    <div className="p-4 border-t border-gray-800">
                        <input 
                            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                            placeholder="메시지 보내기..."
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
