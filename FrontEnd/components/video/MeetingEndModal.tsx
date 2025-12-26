import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { CheckCircle2, Calendar, LayoutDashboard, Loader2 } from 'lucide-react';
import { Separator } from '../ui/separator';

interface MeetingEndModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MeetingEndModal({ isOpen, onClose }: MeetingEndModalProps) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      // Simulate AI processing time
      const timer = setTimeout(() => {
        setLoading(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-12 w-12 text-indigo-500 animate-spin" />
            <h3 className="text-lg font-semibold animate-pulse">AI가 회의 내용을 정리하고 있습니다...</h3>
            <p className="text-sm text-muted-foreground">음성 데이터를 텍스트로 변환하고 주요 안건을 추출 중입니다.</p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <span className="bg-indigo-100 text-indigo-600 p-1 rounded">✨ AI 요약 완료</span>
                Q4 마케팅 전략 회의
              </DialogTitle>
              <DialogDescription>
                2023년 12월 18일 오전 10:00 - 11:30 (90분)
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              {/* Summary Section */}
              <div className="bg-slate-50 p-4 rounded-lg border">
                <h4 className="font-semibold mb-2 text-sm text-slate-900">📝 3줄 요약</h4>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                  <li>내년도 마케팅 예산을 전년 대비 <strong>15% 증액</strong>하기로 결정했습니다.</li>
                  <li>주요 타겟층을 2030 세대에서 <strong>3040 전문직</strong>으로 확장합니다.</li>
                  <li>SNS 광고 비중을 줄이고 <strong>인플루언서 협업</strong>을 강화하기로 합의했습니다.</li>
                </ul>
              </div>

              {/* Action Items Section */}
              <div>
                <h4 className="font-semibold mb-3 text-sm text-slate-900">✅ Action Items</h4>
                <div className="space-y-2">
                  {[
                    { text: "디자인 시안 공유 (마감: 내일)", owner: "김철수" },
                    { text: "예산안 엑셀 시트 정리", owner: "이영희" },
                    { text: "인플루언서 리스트업", owner: "박지성" }
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-white border rounded-md shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                        <span className="text-sm">{item.text}</span>
                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">@{item.owner}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-indigo-600">
                          <Calendar className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-blue-600">
                          <LayoutDashboard className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="sm:justify-between items-center">
              <span className="text-xs text-muted-foreground">자동으로 노션/지라에 연동하시겠습니까?</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>닫기</Button>
                <Button className="bg-indigo-600 hover:bg-indigo-700">저장 및 공유</Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
