import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Hash, Volume2, Lock, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

type ChannelType = 'text' | 'voice' | 'meeting' | 'announcement';

interface Channel {
    id: string;
    name: string;
    type: ChannelType;
    isPrivate?: boolean;
}

interface ChannelSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    channel: Channel | null;
    onUpdate: (id: string, updates: Partial<Channel>) => void;
    onDelete: (id: string) => void;
}

export function ChannelSettingsDialog({ 
    open, 
    onOpenChange, 
    channel,
    onUpdate,
    onDelete
}: ChannelSettingsDialogProps) {
    const [name, setName] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');

    useEffect(() => {
        if (channel) {
            setName(channel.name);
            setIsPrivate(!!channel.isPrivate);
        }
    }, [channel, open]);

    if (!channel) return null;

    const handleSave = () => {
        if (!name.trim()) return;
        
        let finalName = name;
        if (channel.type === 'text') {
            finalName = name.toLowerCase().replace(/\s+/g, '-');
        }

        onUpdate(channel.id, {
            name: finalName,
            isPrivate
        });
        toast.success("채널 설정이 저장되었습니다.");
        onOpenChange(false);
    };

    const handleDelete = () => {
        if (confirm(`정말 ${channel.name} 채널을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
            onDelete(channel.id);
            onOpenChange(false);
            toast.success("채널이 삭제되었습니다.");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] h-[500px] flex flex-col p-0 gap-0 overflow-hidden bg-white" aria-describedby={undefined}>
                <div className="h-full flex">
                    {/* Sidebar */}
                    <div className="w-48 bg-slate-50 border-r border-slate-100 p-3 space-y-1">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-2 mt-2">
                            {channel.type === 'text' ? 'TEXT CHANNELS' : 'VOICE CHANNELS'}
                        </div>
                        <div className="flex items-center gap-2 px-2 mb-4 font-bold text-slate-700 truncate">
                            {channel.type === 'text' ? <Hash className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-slate-400" />}
                            <span className="truncate">{channel.name}</span>
                        </div>

                        <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="w-full flex-col flex">
                            <TabsList className="flex flex-col h-auto bg-transparent gap-1 p-0 justify-start items-stretch">
                                <TabsTrigger 
                                    value="overview" 
                                    className="justify-start px-3 py-1.5 text-sm data-[state=active]:bg-slate-200 data-[state=active]:text-slate-900 text-slate-600 font-medium rounded-md"
                                >
                                    일반
                                </TabsTrigger>
                                <TabsTrigger 
                                    value="permissions" 
                                    className="justify-start px-3 py-1.5 text-sm data-[state=active]:bg-slate-200 data-[state=active]:text-slate-900 text-slate-600 font-medium rounded-md"
                                >
                                    권한
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        
                        <div className="mt-auto pt-4">
                            <button 
                                onClick={handleDelete}
                                className="w-full text-left px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50 rounded-md flex items-center justify-between group"
                            >
                                채널 삭제
                                <Trash2 className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-8 overflow-y-auto">
                        <Tabs value={activeTab} className="w-full">
                            <TabsContent value="overview" className="mt-0 space-y-6">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 mb-1">채널 개요</h2>
                                    <p className="text-sm text-slate-500">기본적인 채널 설정을 관리합니다.</p>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs font-bold text-slate-500 uppercase">채널 이름</Label>
                                    <Input 
                                        value={name} 
                                        onChange={(e) => setName(e.target.value)} 
                                        maxLength={20}
                                        className="font-medium"
                                    />
                                    {channel.type === 'text' && (
                                        <p className="text-[11px] text-slate-400">공백은 자동으로 하이픈(-)으로 변경됩니다.</p>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="permissions" className="mt-0 space-y-6">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 mb-1">권한 설정</h2>
                                    <p className="text-sm text-slate-500">누가 이 채널을 보고 참여할 수 있는지 제어합니다.</p>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex gap-3">
                                            <div className="mt-1">
                                                <Lock className="w-5 h-5 text-slate-600" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900">비공개 채널</h3>
                                                <p className="text-sm text-slate-500 mt-1 max-w-[280px]">
                                                    비공개 채널을 활성화하면 초대된 멤버와 관리자만 이 채널을 볼 수 있습니다.
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div 
                                            className={`w-12 h-7 rounded-full relative transition-colors cursor-pointer ${isPrivate ? 'bg-green-500' : 'bg-slate-200'}`}
                                            onClick={() => setIsPrivate(!isPrivate)}
                                        >
                                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${isPrivate ? 'left-6' : 'left-1'}`} />
                                        </div>
                                    </div>
                                    
                                    {isPrivate && (
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex gap-3 items-start mt-4">
                                            <AlertCircle className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                                            <div className="text-sm text-slate-600">
                                                현재 이 채널은 <strong>비공개</strong> 상태입니다. 멤버 관리 탭에서 특정 사용자를 추가할 수 있습니다 (현재 구현 중).
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </TabsContent>
                        </Tabs>

                        <div className="absolute bottom-0 right-0 left-48 p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                             <Button variant="ghost" onClick={() => onOpenChange(false)}>취소</Button>
                             <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={handleSave}>변경사항 저장</Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
