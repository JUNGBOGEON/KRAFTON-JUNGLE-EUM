import React, { useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Clock, AlignLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';

interface Event {
    id: string;
    date: Date;
    title: string;
    description?: string;
    author: {
        name: string;
        avatar?: string;
    };
    time: string;
}

const MOCK_EVENTS: Event[] = [
    {
        id: '1',
        date: new Date(),
        title: "Q4 마케팅 전략 회의",
        description: "이번 분기 주요 KPI 점검 및 예산 배정 논의",
        time: "14:00",
        author: { name: "Kim Min-su" }
    },
    {
        id: '2',
        date: addDays(new Date(), 2),
        title: "디자인 시안 리뷰",
        time: "11:00",
        author: { name: "Sarah" }
    }
];

export function CalendarChannel() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState<Event[]>(MOCK_EVENTS);
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [isAddEventOpen, setIsAddEventOpen] = useState(false);
    
    // New Event State
    const [newEventTitle, setNewEventTitle] = useState('');
    const [newEventTime, setNewEventTime] = useState('10:00');
    const [newEventDesc, setNewEventDesc] = useState('');

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

    const handlePrevWeek = () => setCurrentDate(addDays(currentDate, -7));
    const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));

    const handleAddEvent = () => {
        if (!newEventTitle.trim()) return;

        const newEvent: Event = {
            id: Date.now().toString(),
            date: selectedDate,
            title: newEventTitle,
            time: newEventTime,
            description: newEventDesc,
            author: { name: "Me" } // Mock current user
        };

        setEvents([...events, newEvent]);
        setIsAddEventOpen(false);
        setNewEventTitle('');
        setNewEventDesc('');
    };

    const selectedDateEvents = events.filter(e => isSameDay(e.date, selectedDate));

    return (
        <div className="flex-1 h-full bg-slate-50 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="h-16 border-b bg-white flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        {format(currentDate, 'yyyy년 M월', { locale: ko })}
                    </h2>
                    <div className="flex bg-slate-100 rounded-lg p-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrevWeek}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentDate(new Date())}>
                            <span className="text-xs font-bold">오늘</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNextWeek}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
                
                <Dialog open={isAddEventOpen} onOpenChange={setIsAddEventOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                            <Plus className="w-4 h-4" /> 일정 추가
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>새 일정 만들기</DialogTitle>
                            <DialogDescription>
                                선택한 날짜에 새로운 일정을 추가합니다.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>제목</Label>
                                <Input 
                                    placeholder="일정 제목을 입력하세요" 
                                    value={newEventTitle}
                                    onChange={(e) => setNewEventTitle(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>시간</Label>
                                <Input 
                                    type="time" 
                                    value={newEventTime}
                                    onChange={(e) => setNewEventTime(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>메모 (선택)</Label>
                                <Textarea 
                                    placeholder="간단한 메모를 남겨주세요" 
                                    value={newEventDesc}
                                    onChange={(e) => setNewEventDesc(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setIsAddEventOpen(false)}>취소</Button>
                            <Button onClick={handleAddEvent}>저장</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Calendar Grid (Weekly View) */}
            <div className="grid grid-cols-7 border-b bg-white">
                {weekDays.map((day, i) => {
                    const isSelected = isSameDay(day, selectedDate);
                    const dayEvents = events.filter(e => isSameDay(e.date, day));
                    
                    return (
                        <div 
                            key={i} 
                            onClick={() => setSelectedDate(day)}
                            className={`
                                min-h-[120px] border-r last:border-r-0 p-3 cursor-pointer transition-colors hover:bg-slate-50 relative
                                ${isSelected ? 'bg-indigo-50/50' : ''}
                            `}
                        >
                            <div className="flex flex-col items-center mb-2">
                                <span className="text-xs text-slate-500 uppercase font-semibold mb-1">
                                    {format(day, 'EEE', { locale: ko })}
                                </span>
                                <div className={`
                                    w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold
                                    ${isToday(day) ? 'bg-indigo-600 text-white' : 'text-slate-700'}
                                    ${isSelected && !isToday(day) ? 'ring-2 ring-indigo-400' : ''}
                                `}>
                                    {format(day, 'd')}
                                </div>
                            </div>
                            
                            <div className="space-y-1">
                                {dayEvents.map(event => (
                                    <div key={event.id} className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded truncate font-medium">
                                        {event.time} {event.title}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Selected Date Detail View */}
            <div className="flex-1 bg-slate-50 p-6 overflow-hidden flex flex-col">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-indigo-600" />
                    {format(selectedDate, 'M월 d일 EEEE', { locale: ko })} 일정
                </h3>

                <ScrollArea className="flex-1">
                    {selectedDateEvents.length === 0 ? (
                        <div className="h-40 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                            <Clock className="w-8 h-8 mb-2 opacity-50" />
                            <p>등록된 일정이 없습니다.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {selectedDateEvents.map(event => (
                                <Card key={event.id} className="hover:shadow-md transition-shadow">
                                    <CardContent className="p-4 flex gap-4 items-start">
                                        <div className="w-16 shrink-0 pt-1">
                                            <span className="text-lg font-bold text-slate-700 block leading-none">{event.time}</span>
                                            <span className="text-xs text-slate-400">PM</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between">
                                                <h4 className="font-bold text-slate-900 text-lg mb-1">{event.title}</h4>
                                                <Avatar className="w-6 h-6">
                                                    <AvatarFallback>{event.author.name[0]}</AvatarFallback>
                                                </Avatar>
                                            </div>
                                            {event.description && (
                                                <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-600 mt-2 flex gap-2">
                                                    <AlignLeft className="w-4 h-4 shrink-0 mt-0.5 opacity-50" />
                                                    {event.description}
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>
        </div>
    );
}
