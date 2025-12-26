import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Mic, Play, Square, CheckCircle2, Wand2, Volume2, Globe } from 'lucide-react';
import { Progress } from '../ui/progress';

interface VoiceSettingsProps {
    onBack: () => void;
}

export function VoiceSettings({ onBack }: VoiceSettingsProps) {
    const [step, setStep] = useState<'initial' | 'recording' | 'processing' | 'completed'>('initial');
    const [progress, setProgress] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [voiceType, setVoiceType] = useState<'clone' | 'preset'>('clone');

    // Simulate Recording -> Processing
    const startRecording = () => {
        setStep('recording');
        setProgress(0);
        // Simulate 3 seconds recording
        let p = 0;
        const interval = setInterval(() => {
            p += 5;
            if (p >= 100) {
                clearInterval(interval);
                setStep('processing');
            }
            setProgress(p);
        }, 150);
    };

    // Simulate Processing
    useEffect(() => {
        if (step === 'processing') {
            const timer = setTimeout(() => {
                setStep('completed');
            }, 2500);
            return () => clearTimeout(timer);
        }
    }, [step]);

    const togglePreview = () => {
        setIsPlaying(!isPlaying);
        if (!isPlaying) {
            setTimeout(() => setIsPlaying(false), 3000); // 3s demo clip
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4">
            <Button variant="ghost" onClick={onBack} className="mb-4">← 돌아가기</Button>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Left: Options */}
                <div className="md:col-span-1 space-y-4">
                    <h2 className="text-xl font-bold mb-4">AI 보이스 프로필</h2>
                    
                    <div 
                        className={`p-4 border rounded-xl cursor-pointer transition-all ${voiceType === 'clone' ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'hover:bg-slate-50'}`}
                        onClick={() => setVoiceType('clone')}
                    >
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
                                <Mic className="h-5 w-5" />
                            </div>
                            <span className="font-bold text-indigo-900">내 목소리 클론</span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            내 목소리의 톤과 억양을 유지한 채 언어만 변경합니다. 가장 자연스럽고 신뢰감을 줍니다.
                        </p>
                    </div>

                    <div 
                        className={`p-4 border rounded-xl cursor-pointer transition-all ${voiceType === 'preset' ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'hover:bg-slate-50'}`}
                        onClick={() => setVoiceType('preset')}
                    >
                         <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                                <Volume2 className="h-5 w-5" />
                            </div>
                            <span className="font-bold text-slate-900">기본 성우 선택</span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            전문 성우의 목소리를 사용합니다. 남성/여성/중성 톤을 선택할 수 있습니다.
                        </p>
                    </div>
                </div>

                {/* Right: Action Area */}
                <div className="md:col-span-2">
                    <Card className="h-full flex flex-col justify-center border-slate-200 shadow-lg">
                        <CardHeader className="text-center">
                            <CardTitle>Voice Cloning Setup</CardTitle>
                            <CardDescription>
                                아래 문장을 한국어로 읽어주세요. 10초 정도면 충분합니다.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center justify-center space-y-8 py-8">
                            
                            {/* Script */}
                            <div className="bg-slate-100 p-6 rounded-2xl text-center max-w-md">
                                <p className="text-lg font-medium text-slate-800 break-keep">
                                    "안녕하세요, 만나서 반갑습니다. 오늘 회의에서는 지난 분기 성과와 다음 분기 목표에 대해 논의하고자 합니다."
                                </p>
                            </div>

                            {/* Interaction Area */}
                            <div className="w-full max-w-xs flex flex-col items-center gap-4">
                                {step === 'initial' && (
                                    <Button 
                                        size="lg" 
                                        className="rounded-full w-16 h-16 bg-red-500 hover:bg-red-600 shadow-xl"
                                        onClick={startRecording}
                                    >
                                        <Mic className="h-8 w-8" />
                                    </Button>
                                )}

                                {step === 'recording' && (
                                    <div className="w-full space-y-2">
                                        <div className="flex items-center justify-between text-xs text-red-500 font-bold animate-pulse">
                                            <span>● Recording...</span>
                                            <span>00:0{Math.floor(progress / 10)} / 00:10</span>
                                        </div>
                                        <Progress value={progress} className="h-2 bg-slate-100" indicatorColor="bg-red-500" />
                                        <div className="flex justify-center mt-4">
                                            <Button variant="outline" size="icon" className="rounded-full border-red-200 text-red-500">
                                                <Square className="h-4 w-4 fill-current" />
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {step === 'processing' && (
                                    <div className="text-center space-y-3">
                                        <div className="relative w-16 h-16 mx-auto">
                                            <Wand2 className="h-8 w-8 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-600 animate-pulse" />
                                            <div className="absolute inset-0 border-4 border-indigo-100 rounded-full animate-spin border-t-indigo-600" />
                                        </div>
                                        <p className="text-sm font-medium text-indigo-600">AI가 목소리 특징을 분석 중입니다...</p>
                                    </div>
                                )}

                                {step === 'completed' && (
                                    <div className="w-full space-y-4 animate-in zoom-in-50">
                                        <div className="flex items-center justify-center gap-2 text-green-600 font-bold bg-green-50 py-2 rounded-lg">
                                            <CheckCircle2 className="h-5 w-5" />
                                            <span>분석 완료!</span>
                                        </div>
                                        
                                        <div className="space-y-3 pt-4 border-t">
                                            <div className="flex items-center justify-between px-2">
                                                <span className="text-sm font-medium text-slate-600 flex items-center gap-2">
                                                    <Globe className="h-4 w-4" /> 영어로 변환된 내 목소리
                                                </span>
                                            </div>
                                            <Button 
                                                className={`w-full h-12 text-lg gap-2 ${isPlaying ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                                onClick={togglePreview}
                                            >
                                                {isPlaying ? <Square className="fill-current h-5 w-5" /> : <Play className="fill-current h-5 w-5" />}
                                                {isPlaying ? '재생 중...' : '미리 듣기'}
                                            </Button>
                                            <p className="text-xs text-center text-slate-400">
                                                * 실제 회의에서는 1~2초의 지연 후 이 목소리로 송출됩니다.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
