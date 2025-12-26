import React, { useState } from 'react';
import { FileText, Image as ImageIcon, Video, MoreVertical, Sparkles, Download, Clock, HardDrive } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Badge } from '../ui/badge';

interface StorageFile {
    id: string;
    name: string;
    type: 'image' | 'video' | 'document';
    size: string;
    date: string;
    author: string;
    summary?: string; // Mock AI Summary content
}

const MOCK_FILES: StorageFile[] = [
    {
        id: '1',
        name: 'Q4_Marketing_Plan.pdf',
        type: 'document',
        size: '2.4 MB',
        date: '2025-10-24',
        author: 'Kim Min-su',
        summary: "이 문서는 2025년 4분기 마케팅 전략을 다룹니다. 주요 목표는 사용자 유입 15% 증가와 전환율 5% 개선입니다. 핵심 채널로는 소셜 미디어 광고 확장과 인플루언서 마케팅이 선정되었습니다. 예산은 지난 분기 대비 10% 증액되었으며, 특히 영상 콘텐츠 제작에 집중 투자될 예정입니다."
    },
    {
        id: '2',
        name: 'Brand_Assets_v2.png',
        type: 'image',
        size: '4.1 MB',
        date: '2025-10-25',
        author: 'Sarah'
    },
    {
        id: '3',
        name: 'Demo_Walkthrough.mp4',
        type: 'video',
        size: '128 MB',
        date: '2025-10-26',
        author: 'David'
    },
    {
        id: '4',
        name: 'Meeting_Notes_Oct.docx',
        type: 'document',
        size: '15 KB',
        date: '2025-10-27',
        author: 'Kim Min-su',
        summary: "10월 정기 회의록입니다. 주요 안건으로 신규 기능 배포 일정 조정이 논의되었습니다. 백엔드 팀의 리소스 부족으로 인해 2주 연기가 결정되었으며, 프론트엔드 팀은 그 기간 동안 UI 폴리싱 작업을 진행하기로 했습니다."
    }
];

export function StorageChannel() {
    const [files, setFiles] = useState<StorageFile[]>(MOCK_FILES);
    const [selectedSummary, setSelectedSummary] = useState<{ name: string, content: string } | null>(null);
    const [isSummaryOpen, setIsSummaryOpen] = useState(false);
    const [isSummarizing, setIsSummarizing] = useState(false);

    const handleSummarize = (file: StorageFile) => {
        if (!file.summary) return; // Only summarize docs
        
        setIsSummarizing(true);
        // Simulate AI delay
        setTimeout(() => {
            setSelectedSummary({ name: file.name, content: file.summary! });
            setIsSummarizing(false);
            setIsSummaryOpen(true);
        }, 1500);
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'image': return <ImageIcon className="w-6 h-6 text-purple-500" />;
            case 'video': return <Video className="w-6 h-6 text-red-500" />;
            case 'document': return <FileText className="w-6 h-6 text-blue-500" />;
            default: return <FileText className="w-6 h-6 text-slate-500" />;
        }
    };

    return (
        <div className="flex-1 h-full bg-slate-50 flex flex-col">
            {/* Header */}
            <div className="h-16 border-b bg-white flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                        <HardDrive className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">프로젝트 저장소</h2>
                        <p className="text-xs text-slate-500">문서, 이미지, 영상을 보관하고 AI로 요약합니다.</p>
                    </div>
                </div>
                
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white">
                    파일 업로드
                </Button>
            </div>

            {/* File List */}
            <ScrollArea className="flex-1 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {files.map((file) => (
                        <div key={file.id} className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-lg hover:border-indigo-200 transition-all cursor-pointer relative">
                            {/* File Type Icon / Preview Placeholder */}
                            <div className="aspect-video bg-slate-100 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden">
                                {file.type === 'image' ? (
                                    <div className="w-full h-full bg-slate-200 flex items-center justify-center text-slate-400">Image Preview</div>
                                ) : (
                                    getIcon(file.type)
                                )}
                                
                                {file.type === 'document' && (
                                    <Button 
                                        size="sm" 
                                        className="absolute bottom-2 right-2 bg-indigo-600/90 hover:bg-indigo-700 text-white text-xs h-7 px-2 gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => { e.stopPropagation(); handleSummarize(file); }}
                                        disabled={isSummarizing}
                                    >
                                        <Sparkles className="w-3 h-3" />
                                        {isSummarizing ? '요약 중...' : 'AI 요약'}
                                    </Button>
                                )}
                            </div>

                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="font-bold text-slate-800 truncate text-sm mb-1">{file.name}</h3>
                                    <div className="flex items-center gap-2 text-xs text-slate-400">
                                        <span>{file.size}</span>
                                        <span>•</span>
                                        <span>{file.author}</span>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 text-slate-400">
                                    <MoreVertical className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            {/* AI Summary Dialog */}
            <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-indigo-700">
                            <Sparkles className="w-5 h-5" />
                            AI 문서 요약
                        </DialogTitle>
                        <DialogDescription>
                            {selectedSummary?.name}의 핵심 내용입니다.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 text-sm leading-relaxed text-slate-700">
                        {selectedSummary?.content}
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button onClick={() => setIsSummaryOpen(false)}>닫기</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
