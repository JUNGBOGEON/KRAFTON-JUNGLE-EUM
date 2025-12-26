import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Layout, Loader2 } from 'lucide-react';
import { MiroWhiteboard } from '../whiteboard/MiroWhiteboard';
import { cn } from '../../lib/utils';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { getToken } from '@/lib/video-api';
import CustomVideoConference from './CustomVideoConference';

interface VideoConferenceProps {
    onLeave: () => void;
    toggleChat: () => void;
    isChatOpen: boolean;
    roomName?: string;
    userName?: string;
}

export function VideoConference({ onLeave, toggleChat, isChatOpen, roomName = 'Marketing Strategy Q4', userName = 'Min-su (Me)' }: VideoConferenceProps) {
    const [token, setToken] = useState<string>('');
    const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch Token
    useEffect(() => {
        const fetchToken = async () => {
            try {
                const t = await getToken(roomName, userName);
                setToken(t);
            } catch (err: any) {
                console.error('Failed to get token:', err);
                setError(err.message || 'Failed to connect');
            }
        };

        fetchToken();
    }, [roomName, userName]);

    // Force resize event when toggling whiteboard
    useEffect(() => {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    }, [isWhiteboardOpen]);

    if (error) {
        return (
            <div className="flex-1 bg-slate-950 flex items-center justify-center p-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center">
                    <h2 className="text-xl font-bold text-white mb-2">Connection Failed</h2>
                    <p className="text-slate-400 mb-6">{error}</p>
                    <Button onClick={onLeave} variant="destructive">
                        Go Back
                    </Button>
                </div>
            </div>
        );
    }

    if (!token) {
        return (
            <div className="flex-1 bg-slate-950 flex items-center justify-center text-white">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
                    <p>Connecting to secure room...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 relative bg-slate-950 flex flex-col overflow-hidden text-slate-200 font-sans h-full">

            <LiveKitRoom
                video={true}
                audio={true}
                token={token}
                serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880'}
                data-lk-theme="default"
                style={{ height: '100%' }}
                onDisconnected={onLeave}
                options={{
                    adaptiveStream: true,
                    dynacast: true,
                }}
            >
                {/* Audio Renderer - Critical for hearing others */}
                <RoomAudioRenderer />

                {/* --- 2. Main Area (Video or Whiteboard) --- */}
                {isWhiteboardOpen ? (
                    <div className="flex-1 relative bg-white rounded-2xl overflow-hidden shadow-2xl flex m-4 h-full">
                        <div className="absolute top-4 right-4 z-50">
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setIsWhiteboardOpen(false)}
                            >
                                Close Whiteboard
                            </Button>
                        </div>
                        <MiroWhiteboard isEmbedded onClose={() => setIsWhiteboardOpen(false)} />
                    </div>
                ) : (
                    <CustomVideoConference />
                )}

                {/* --- 3. Floating Controls (Whiteboard Toggle) --- */}
                {!isWhiteboardOpen && (
                    <div className="absolute top-4 left-4 z-50">
                        <Button
                            variant="secondary"
                            className={cn("rounded-full h-10 px-4 gap-2 bg-slate-800/80 backdrop-blur text-white hover:bg-slate-700")}
                            onClick={() => setIsWhiteboardOpen(true)}
                        >
                            <Layout className="h-4 w-4" />
                            <span>Whiteboard</span>
                        </Button>
                    </div>
                )}
            </LiveKitRoom>
        </div>
    );
}