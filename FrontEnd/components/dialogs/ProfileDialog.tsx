import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Dialog, DialogContent } from '../ui/dialog';
import { Camera, X, Mail, Edit2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { UserProfile } from '../../types/user';

interface ProfileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentUser: UserProfile | null;
    viewingUser: UserProfile | null;
    isEditing: boolean;
    setIsEditing: (edit: boolean) => void;
    onUpdateProfile: (p: UserProfile) => void;
    onLogout: () => void;
}

export function ProfileDialog({ 
    open, 
    onOpenChange, 
    currentUser, 
    viewingUser, 
    isEditing, 
    setIsEditing,
    onUpdateProfile,
    onLogout
}: ProfileDialogProps) {
    // Determine who we are showing
    // If viewingUser is null, it means we are viewing "My Profile" (currentUser)
    // If viewingUser.id === currentUser.id, it is also "My Profile"
    const isMe = !viewingUser || (currentUser && viewingUser.id === currentUser.id);
    const profileToShow = viewingUser || currentUser;

    // Form State for editing
    const [name, setName] = useState('');
    const [status, setStatus] = useState('');
    const [avatar, setAvatar] = useState<string | undefined>(undefined);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initialize form when opening/switching modes
    useEffect(() => {
        if (open && profileToShow) {
            setName(profileToShow.displayName);
            setStatus(profileToShow.statusMessage || '');
            setAvatar(profileToShow.avatarUrl);
        }
    }, [open, profileToShow, isEditing]);

    const handleSave = () => {
        if (currentUser) {
            onUpdateProfile({
                ...currentUser,
                displayName: name,
                statusMessage: status,
                avatarUrl: avatar
            });
            setIsEditing(false);
            toast.success("Profile updated!");
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setAvatar(url);
        }
    };

    if (!profileToShow) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden bg-white gap-0" aria-describedby={undefined}>
                {/* Header with Close Button */}
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                    <h3 className="font-bold text-center flex-1 ml-8">{isEditing ? '프로필 편집' : '프로필'}</h3>
                    <button onClick={() => onOpenChange(false)} className="text-slate-500 hover:text-slate-900">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-6 flex flex-col items-center">
                    {/* Avatar */}
                    <div className="flex flex-col items-center gap-3 mb-6">
                        <Avatar className="w-24 h-24 border border-slate-200">
                            <AvatarImage src={isEditing ? avatar : profileToShow.avatarUrl} className="object-cover" />
                            <AvatarFallback className="text-2xl bg-slate-100 text-slate-300">
                                {profileToShow.displayName.charAt(0)}
                            </AvatarFallback>
                        </Avatar>
                        
                        {isEditing && (
                            <>
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
                            </>
                        )}
                    </div>

                    {isEditing ? (
                        <div className="w-full space-y-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-bold text-slate-500 uppercase">이름</Label>
                                <Input value={name} onChange={e => setName(e.target.value)} className="bg-slate-50" />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-bold text-slate-500 uppercase">소개</Label>
                                <Input value={status} onChange={e => setStatus(e.target.value)} placeholder="소개" className="bg-slate-50" />
                            </div>
                            
                            <div className="flex gap-2 pt-4">
                                <Button variant="ghost" className="flex-1" onClick={() => setIsEditing(false)}>취소</Button>
                                <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={handleSave}>완료</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center w-full">
                            <h2 className="text-xl font-bold text-slate-900">{profileToShow.displayName}</h2>
                            <p className="text-slate-500 text-sm mt-1 mb-6">{profileToShow.statusMessage || "소개가 없습니다."}</p>
                            
                            {/* Email / Info */}
                            <div className="w-full bg-slate-50 rounded-lg p-3 flex items-center gap-3 mb-6">
                                <div className="text-left flex-1 overflow-hidden">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Email</div>
                                    <div className="text-sm text-slate-700 truncate font-medium">{profileToShow.email}</div>
                                </div>
                            </div>

                            {isMe ? (
                                <div className="flex gap-3">
                                    <Button variant="outline" className="flex-1 font-semibold border-slate-300" onClick={() => setIsEditing(true)}>
                                        프로필 편집
                                    </Button>
                                    <Button variant="outline" size="icon" onClick={onLogout} title="Logout" className="border-slate-300">
                                        <LogOut className="w-4 h-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div>
                                    <Button className="w-full bg-indigo-600 hover:bg-indigo-700 font-semibold">
                                        메시지 보내기
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
