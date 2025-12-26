import React from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Clock, CheckCircle2, MessageSquare, X } from 'lucide-react';
import { Button } from '../ui/button';

interface CatchUpSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CatchUpSidebar({ isOpen, onClose }: CatchUpSidebarProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 bottom-20 w-80 bg-white border-l shadow-xl z-30 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b flex items-center justify-between bg-indigo-50">
        <div className="flex items-center gap-2 text-indigo-700">
          <Clock className="h-4 w-4" />
          <h3 className="font-bold text-sm">AI Catch-up 요약</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">현재 논의 주제</h4>
            <div className="p-3 bg-indigo-100/50 rounded-lg border border-indigo-200 text-sm font-medium text-indigo-900">
              📌 Q4 마케팅 예산 증액 여부 및 채널 선정
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">주요 결정 사항 (타임라인)</h4>
            
            <div className="relative pl-4 border-l-2 border-gray-100 space-y-6">
              {[
                { time: "10:05", title: "회의 시작", content: "참석자 전원 입장 및 아젠다 공유" },
                { time: "10:15", title: "예산안 검토", content: "기존 예산 대비 15% 부족함 확인", highlight: true },
                { time: "10:28", title: "채널 분석", content: "인스타그램 효율 저하, 유튜브 숏츠 강화 필요성 제기" },
                { time: "10:42", title: "중간 합의", content: "유튜브 예산 2배 증액 잠정 합의", highlight: true },
              ].map((item, i) => (
                <div key={i} className="relative">
                  <div className={`absolute -left-[21px] top-0 w-3 h-3 rounded-full border-2 border-white ${item.highlight ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                  <span className="text-xs text-gray-400 font-mono mb-1 block">{item.time}</span>
                  <h5 className={`text-sm font-bold ${item.highlight ? 'text-indigo-700' : 'text-gray-700'}`}>{item.title}</h5>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{item.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-gray-50">
        <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={onClose}>
          <CheckCircle2 className="h-4 w-4 mr-2" />
          확인했습니다, 회의 참여하기
        </Button>
      </div>
    </div>
  );
}
