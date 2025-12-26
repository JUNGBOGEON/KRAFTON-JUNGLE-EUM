import React, { useState, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Camera, User } from 'lucide-react';
import { UserProfile } from '../../types/user';

interface ProfileSetupProps {
    initialEmail?: string;
    onComplete: (profile: UserProfile) => void;
}

export function ProfileSetup({ initialEmail = "user@example.com", onComplete }: ProfileSetupProps) {
    const [displayName, setDisplayName] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setAvatarUrl(url);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!displayName.trim()) return;

        onComplete({
            id: `user-${Date.now()}`,
            displayName,
            statusMessage,
            avatarUrl,
            email: initialEmail
        });
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
            <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-8">
                <div className="text-center space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">프로필 생성</h1>
                    <p className="text-sm text-slate-500">ZoomCord에서 사용할 프로필을 설정하세요.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Avatar Upload (Instagram Style) */}
                    <div className="flex flex-col items-center gap-3">
                        <div 
                            className="relative group cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Avatar className="w-24 h-24 border border-slate-200">
                                <AvatarImage src={avatarUrl} className="object-cover" />
                                <AvatarFallback className="bg-slate-50 text-slate-300">
                                    <User className="w-12 h-12" />
                                </AvatarFallback>
                            </Avatar>
                        </div>
                        <Button 
                            type="button" 
                            variant="link" 
                            className="text-indigo-600 font-semibold h-auto p-0 text-sm hover:text-indigo-700"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            프로필 사진 변경
                        </Button>
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            accept="image/*"
                            onChange={handleFileChange}
                        />
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="displayName" className="text-xs font-bold text-slate-500 uppercase">이름</Label>
                            <Input 
                                id="displayName"
                                placeholder="이름" 
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                className="bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                                maxLength={20}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="status" className="text-xs font-bold text-slate-500 uppercase">소개</Label>
                            <Input 
                                id="status"
                                placeholder="소개" 
                                value={statusMessage}
                                onChange={(e) => setStatusMessage(e.target.value)}
                                className="bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                                maxLength={50}
                            />
                        </div>
                    </div>

                    <Button 
                        type="submit" 
                        className="w-full bg-indigo-600 hover:bg-indigo-700 transition-all font-semibold"
                        disabled={!displayName.trim()}
                    >
                        완료
                    </Button>
                </form>
            </div>
        </div>
    );
}
