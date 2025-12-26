import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Hash, Volume2, Lock, Calendar, HardDrive, AlertCircle } from 'lucide-react';

type ChannelType = 'text' | 'voice' | 'meeting' | 'announcement' | 'calendar' | 'storage';

interface CreateChannelDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (name: string, type: ChannelType, isPrivate: boolean) => void;
    defaultType?: ChannelType;
    existingChannels?: { type: string }[];
}

export function CreateChannelDialog({ 
    open, 
    onOpenChange, 
    onSubmit, 
    defaultType = 'text',
    existingChannels = []
}: CreateChannelDialogProps) {
    const [channelName, setChannelName] = useState('');
    const [channelType, setChannelType] = useState<ChannelType>(defaultType);
    const [isPrivate, setIsPrivate] = useState(false);

    // Check storage limit
    const storageCount = existingChannels.filter(c => c.type === 'storage').length;
    const isStorageLimitReached = storageCount >= 2;

    // Reset form when dialog opens
    useEffect(() => {
        if (open) {
            setChannelName('');
            setChannelType(defaultType);
            setIsPrivate(false);
        }
    }, [open, defaultType]);

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let value = e.target.value;
        // Text/Calendar/Storage style formatting (lowercase, no spaces usually preferred but lenient for custom types)
        if (['text', 'calendar', 'storage'].includes(channelType)) {
            value = value.toLowerCase().replace(/\s+/g, '-');
        }
        setChannelName(value);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!channelName.trim()) return;
        
        // Prevent submission if limit reached for storage
        if (channelType === 'storage' && isStorageLimitReached) return;

        onSubmit(channelName, channelType, isPrivate);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[440px] bg-white p-0 gap-0 overflow-hidden">
                <DialogHeader className="p-6 pb-4">
                    <DialogTitle className="text-xl font-bold text-slate-900">채널 만들기</DialogTitle>
                    <DialogDescription className="hidden">
                        새로운 채널을 생성하고 설정을 구성합니다.
                    </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleSubmit}>
                    <div className="px-6 space-y-6">
                        {/* Channel Type Selection */}
                        <div className="space-y-3">
                            <Label className="text-xs font-bold text-slate-500 uppercase">채널 유형</Label>
                            
                            <div className="grid grid-cols-1 gap-2">
                                {/* Text */}
                                <div 
                                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                                        channelType === 'text' 
                                        ? 'bg-slate-100 border-indigo-500' 
                                        : 'hover:bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                    onClick={() => setChannelType('text')}
                                >
                                    <Hash className="w-5 h-5 text-slate-500" />
                                    <div className="flex-1">
                                        <div className="font-bold text-slate-900 text-sm">텍스트</div>
                                        <div className="text-xs text-slate-500">메시지, 이미지 등을 전송합니다.</div>
                                    </div>
                                    <RadioIndicator selected={channelType === 'text'} />
                                </div>

                                {/* Voice */}
                                <div 
                                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                                        channelType === 'voice' 
                                        ? 'bg-slate-100 border-indigo-500' 
                                        : 'hover:bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                    onClick={() => setChannelType('voice')}
                                >
                                    <Volume2 className="w-5 h-5 text-slate-500" />
                                    <div className="flex-1">
                                        <div className="font-bold text-slate-900 text-sm">음성</div>
                                        <div className="text-xs text-slate-500">음성, 화상, 화면 공유를 합니다.</div>
                                    </div>
                                    <RadioIndicator selected={channelType === 'voice'} />
                                </div>

                                {/* Calendar */}
                                <div 
                                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                                        channelType === 'calendar' 
                                        ? 'bg-slate-100 border-indigo-500' 
                                        : 'hover:bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                    onClick={() => setChannelType('calendar')}
                                >
                                    <Calendar className="w-5 h-5 text-slate-500" />
                                    <div className="flex-1">
                                        <div className="font-bold text-slate-900 text-sm">캘린더</div>
                                        <div className="text-xs text-slate-500">일정을 조율하고 확인합니다.</div>
                                    </div>
                                    <RadioIndicator selected={channelType === 'calendar'} />
                                </div>

                                {/* Storage */}
                                <div 
                                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                                        channelType === 'storage' 
                                        ? 'bg-slate-100 border-indigo-500' 
                                        : isStorageLimitReached 
                                            ? 'opacity-50 cursor-not-allowed border-transparent bg-slate-50'
                                            : 'hover:bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                    onClick={() => !isStorageLimitReached && setChannelType('storage')}
                                >
                                    <HardDrive className="w-5 h-5 text-slate-500" />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-900 text-sm">저장소</span>
                                            {isStorageLimitReached && (
                                                <span className="text-[10px] text-red-500 font-bold border border-red-200 bg-red-50 px-1 rounded">MAX 2</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500">자료를 보관하고 AI로 요약합��다.</div>
                                    </div>
                                    <RadioIndicator selected={channelType === 'storage'} />
                                </div>
                            </div>
                        </div>

                        {/* Channel Name Input */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-slate-500 uppercase">채널 이름</Label>
                            <div className="relative">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                    {getIcon(channelType)}
                                </div>
                                <Input 
                                    value={channelName}
                                    onChange={handleNameChange}
                                    placeholder="새로운-채널" 
                                    className="pl-9 bg-slate-100 border-none focus-visible:ring-indigo-500"
                                    maxLength={20}
                                    autoFocus
                                />
                            </div>
                            {['text', 'calendar', 'storage'].includes(channelType) && (
                                <p className="text-[11px] text-slate-400">
                                    공백은 자동으로 하이픈(-)으로 변경됩니다.
                                </p>
                            )}
                        </div>

                        {/* Private Channel Toggle */}
                        <div className="flex items-center justify-between py-2 cursor-pointer" onClick={() => setIsPrivate(!isPrivate)}>
                            <div className="flex items-center gap-2">
                                <Lock className="w-4 h-4 text-slate-500" />
                                <div>
                                    <div className="font-bold text-sm text-slate-700">비공개 채널</div>
                                    <div className="text-[11px] text-slate-500">초대된 멤버만 볼 수 있습니다.</div>
                                </div>
                            </div>
                            <div className={`w-10 h-6 rounded-full relative transition-colors ${isPrivate ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${isPrivate ? 'left-5' : 'left-1'}`} />
                            </div>
                        </div>

                        {isStorageLimitReached && channelType === 'storage' && (
                            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-xs font-medium">
                                <AlertCircle className="w-4 h-4" />
                                저장소 채널은 워크스페이스당 최대 2개까지만 생성 가능합니다.
                            </div>
                        )}
                    </div>

                    <DialogFooter className="p-6 bg-slate-50 mt-4">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="font-medium text-slate-600 hover:text-slate-900 hover:bg-transparent hover:underline">
                            취소
                        </Button>
                        <Button 
                            type="submit" 
                            disabled={!channelName.trim() || (channelType === 'storage' && isStorageLimitReached)} 
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                        >
                            채널 만들기
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function RadioIndicator({ selected }: { selected: boolean }) {
    return (
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-indigo-600' : 'border-slate-300'}`}>
            {selected && <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />}
        </div>
    );
}

function getIcon(type: ChannelType) {
    switch (type) {
        case 'text': return <Hash className="w-4 h-4" />;
        case 'voice': return <Volume2 className="w-4 h-4" />;
        case 'calendar': return <Calendar className="w-4 h-4" />;
        case 'storage': return <HardDrive className="w-4 h-4" />;
        default: return <Hash className="w-4 h-4" />;
    }
}
