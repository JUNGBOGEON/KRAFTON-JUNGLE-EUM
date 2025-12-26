import React, { useState } from 'react';
import { FileText, Image as ImageIcon, Video, MoreVertical, Sparkles, Download, Clock, HardDrive, ArrowLeft, X, Play } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Badge } from '../ui/badge';

interface StorageFile {
    id: string;
    name: string;
    type: 'image' | 'video' | 'document' | 'code';
    size: string;
    date: string;
    author: string;
    summary?: string; // Mock AI Summary content
    content?: string; // Mock File Content or URL for media
    url?: string; // Specific URL for media files
}

const MOCK_FILES: StorageFile[] = [
    {
        id: '1',
        name: 'Q4_Marketing_Plan.pdf',
        type: 'document',
        size: '2.4 MB',
        date: '2025-10-24',
        author: 'Kim Min-su',
        summary: "이 문서는 2025년 4분기 마케팅 전략을 다룹니다. 주요 목표는 사용자 유입 15% 증가와 전환율 5% 개선입니다. 핵심 채널로는 소셜 미디어 광고 확장과 인플루언서 마케팅이 선정되었습니다. 예산은 지난 분기 대비 10% 증액되었으며, 특히 영상 콘텐츠 제작에 집중 투자될 예정입니다.",
        content: `
# 2025년 4분기 마케팅 전략 보고서

## 1. 개요
본 문서는 2025년 4분기(10월~12월) 동안 진행될 마케팅 캠페인의 전략적 방향성과 세부 실행 계획을 기술합니다.

## 2. 주요 목표
- **사용자 유입**: 전 분기 대비 15% 증가 (목표치: 월 50만 MAU)
- **전환율**: 가입 전환율 5% 개선 (현재 2.3% -> 목표 2.45%)
- **브랜드 인지도**: 주요 타겟층 내 인지도 10% 상승

## 3. 핵심 전략
### 3.1 소셜 미디어 광고 확장
- 인스타그램 및 틱톡 숏폼 콘텐츠 강화
- 타겟 오디언스 세분화 (2030 직장인 / 대학생)

### 3.2 인플루언서 마케팅
- 테크 및 라이프스타일 분야 마이크로 인플루언서 20명 섭외
- 제품 실제 사용 후기 중심의 바이럴 마케팅
        `
    },
    {
        id: '2',
        name: 'Brand_Walkthrough.mp4',
        type: 'video',
        size: '128 MB',
        date: '2025-10-26',
        author: 'David',
        url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    },
    {
        id: '3',
        name: 'Office_View.jpg',
        type: 'image',
        size: '4.1 MB',
        date: '2025-10-25',
        author: 'Sarah',
        url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80'
    },
    {
        id: '4',
        name: 'backend_api_v1.ts',
        type: 'code',
        size: '12 KB',
        date: '2025-10-26',
        author: 'David',
        content: `
import express from 'express';
import { Router } from 'express';

const router = Router();

// GET /api/v1/users
router.get('/users', async (req, res) => {
    try {
        const users = await db.user.findMany();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
        `
    },
    {
        id: '5',
        name: 'Meeting_Notes.txt',
        type: 'document',
        size: '15 KB',
        date: '2025-10-27',
        author: 'Kim Min-su',
        summary: "10월 정기 회의록입니다.",
        content: `
[10월 정기 팀 회의록]

일시: 2025년 10월 27일 14:00
참석자: 김민수, Sarah, David

1. 주요 안건
- 신규 기능 배포 일정 논의
- 마케팅 예산 확정
- 다음 달 워크샵 장소 선정
        `
    }
];

export function StorageChannel() {
    const [files, setFiles] = useState<StorageFile[]>(MOCK_FILES);
    const [selectedSummary, setSelectedSummary] = useState<{ name: string, content: string } | null>(null);
    const [isSummaryOpen, setIsSummaryOpen] = useState(false);
    const [isSummarizing, setIsSummarizing] = useState(false);

    // File Viewer State
    const [viewingFile, setViewingFile] = useState<StorageFile | null>(null);

    const handleSummarize = (file: StorageFile) => {
        if (!file.summary) return; // Only summarize docs with summary

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
            case 'code': return <FileText className="w-6 h-6 text-green-500" />;
            default: return <FileText className="w-6 h-6 text-slate-500" />;
        }
    };

    // If Viewing a File
    if (viewingFile) {
        return (
            <div className="flex-1 h-full bg-white flex flex-col">
                {/* File Viewer Header */}
                <div className="h-14 border-b flex items-center justify-between px-4 shrink-0 bg-white shadow-sm z-10">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <Button variant="ghost" size="icon" onClick={() => setViewingFile(null)} className="shrink-0 -ml-2">
                            <ArrowLeft className="w-5 h-5 text-slate-500" />
                        </Button>
                        <div className="flex items-center gap-2 overflow-hidden">
                            {getIcon(viewingFile.type)}
                            <h2 className="text-lg font-bold text-slate-800 truncate">{viewingFile.name}</h2>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-2 hidden sm:flex">
                            <Download className="w-4 h-4" /> 다운로드
                        </Button>
                        {viewingFile.summary && (
                            <Button
                                variant="default"
                                size="sm"
                                className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                                onClick={() => handleSummarize(viewingFile)}
                            >
                                <Sparkles className="w-4 h-4" /> AI 요약
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => setViewingFile(null)} className="shrink-0 sm:hidden">
                            <X className="w-5 h-5 text-slate-500" />
                        </Button>
                    </div>
                </div>

                {/* File Content Area */}
                <ScrollArea className="flex-1 bg-slate-950/5 p-0 sm:p-6 flex flex-col items-center justify-center">
                    <div className="w-full h-full flex items-center justify-center p-4">
                        {viewingFile.type === 'image' && viewingFile.url ? (
                            <div className="max-w-4xl max-h-[80vh] w-full bg-white rounded-lg shadow-lg overflow-hidden flex items-center justify-center">
                                <img
                                    src={viewingFile.url}
                                    alt={viewingFile.name}
                                    className="max-w-full max-h-[80vh] object-contain"
                                />
                            </div>
                        ) : viewingFile.type === 'video' && viewingFile.url ? (
                            <div className="max-w-4xl w-full bg-black rounded-lg shadow-lg overflow-hidden aspect-video">
                                <video
                                    controls
                                    className="w-full h-full"
                                    src={viewingFile.url}
                                >
                                    Your browser does not support the video tag.
                                </video>
                            </div>
                        ) : viewingFile.type === 'code' ? (
                            <div className="max-w-3xl w-full bg-[#1E1E1E] rounded-lg shadow-lg overflow-hidden border border-slate-700 mx-auto">
                                <div className="bg-[#2D2D2D] px-4 py-2 text-xs text-slate-400 border-b border-slate-700 font-mono">
                                    {viewingFile.name}
                                </div>
                                <ScrollArea className="h-[600px]">
                                    <pre className="p-4 font-mono text-sm text-blue-300">
                                        <code>{viewingFile.content}</code>
                                    </pre>
                                </ScrollArea>
                            </div>
                        ) : (
                            <div className="max-w-3xl w-full bg-white min-h-[600px] shadow-sm border border-slate-200 rounded-xl p-8 sm:p-12 mx-auto">
                                <div className="prose prose-slate max-w-none whitespace-pre-line text-slate-700 leading-relaxed font-serif">
                                    {viewingFile.content}
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                {/* AI Summary Dialog (Reused) */}
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

    // Default File List View
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
                        <p className="text-xs text-slate-500">문서, 이미지, 코드를 보관하고 열람합니다.</p>
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
                        <div
                            key={file.id}
                            onClick={() => setViewingFile(file)}
                            className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-lg hover:border-indigo-200 transition-all cursor-pointer relative"
                        >
                            {/* File Type Icon / Preview Placeholder */}
                            <div className="aspect-video bg-slate-100 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden">
                                {file.type === 'image' && file.url ? (
                                    <img src={file.url} alt={file.name} className="w-full h-full object-cover" />
                                ) : file.type === 'video' ? (
                                    <div className="w-full h-full bg-slate-900 flex items-center justify-center relative group-hover:bg-slate-800 transition-colors">
                                        <Video className="w-10 h-10 text-slate-500 group-hover:text-white transition-colors" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">
                                                <Play className="w-5 h-5 text-white fill-white ml-1" />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    getIcon(file.type)
                                )}

                                {file.summary && (
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

            {/* AI Summary Dialog (Reused) */}
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
