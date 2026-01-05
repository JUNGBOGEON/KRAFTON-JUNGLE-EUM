"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiClient, CalendarEvent, CreateEventRequest } from "../../../lib/api";

interface CalendarSectionProps {
  workspaceId: number;
}

const colorOptions = [
  { value: "bg-blue-500", label: "파랑", text: "text-blue-500", bgLight: "bg-blue-50", border: "border-blue-200" },
  { value: "bg-purple-500", label: "보라", text: "text-purple-500", bgLight: "bg-purple-50", border: "border-purple-200" },
  { value: "bg-green-500", label: "초록", text: "text-green-500", bgLight: "bg-green-50", border: "border-green-200" },
  { value: "bg-amber-500", label: "주황", text: "text-amber-500", bgLight: "bg-amber-50", border: "border-amber-200" },
  { value: "bg-rose-500", label: "빨강", text: "text-rose-500", bgLight: "bg-rose-50", border: "border-rose-200" },
  { value: "bg-cyan-500", label: "청록", text: "text-cyan-500", bgLight: "bg-cyan-50", border: "border-cyan-200" },
];

export default function CalendarSection({ workspaceId }: CalendarSectionProps) {
  const today = useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // New Event Form
  const [newEvent, setNewEvent] = useState({
    title: "",
    description: "",
    startDate: "",
    startTime: "09:00",
    endDate: "",
    endTime: "10:00",
    color: "bg-blue-500",
    isAllDay: false,
  });

  // Trash State
  const [trashedEvents, setTrashedEvents] = useState<CalendarEvent[]>([]);
  const [showTrashModal, setShowTrashModal] = useState(false);

  // --- Data Loading ---
  const loadEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      // 이전 달의 마지막 주 데이터도 가져오기 위해 넉넉하게
      startOfMonth.setDate(startOfMonth.getDate() - 7);

      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      // 다음 달의 첫 주 데이터도 가져오기 위해 넉넉하게
      endOfMonth.setDate(endOfMonth.getDate() + 7);

      const response = await apiClient.getWorkspaceEvents(
        workspaceId,
        startOfMonth.toISOString().split("T")[0],
        endOfMonth.toISOString().split("T")[0]
      );
      setEvents(response.events);
    } catch (error) {
      console.error("Failed to load events:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, currentDate]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // --- Handlers ---
  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEvent(event);
    setShowDetailModal(true);
  };

  const openCreateModal = (date?: Date) => {
    const targetDate = date || selectedDate || today;
    const dateStr = targetDate.toISOString().split("T")[0];
    setNewEvent({
      title: "",
      description: "",
      startDate: dateStr,
      startTime: "09:00",
      endDate: dateStr,
      endTime: "10:00",
      color: "bg-blue-500",
      isAllDay: false,
    });
    setShowCreateModal(true);
  };

  const handleCreateEvent = async () => {
    if (!newEvent.title.trim() || isCreating) return;

    try {
      setIsCreating(true);
      const startAt = new Date(`${newEvent.startDate}T${newEvent.startTime}:00`);
      const endAt = new Date(`${newEvent.endDate}T${newEvent.endTime}:00`);

      const eventData: CreateEventRequest = {
        title: newEvent.title.trim(),
        description: newEvent.description.trim() || undefined,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        is_all_day: newEvent.isAllDay,
        color: newEvent.color,
      };

      const createdEvent = await apiClient.createEvent(workspaceId, eventData);
      setEvents((prev) => [...prev, createdEvent]);
      setShowCreateModal(false);
    } catch (error) {
      console.error("Failed to create event:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteEvent = async (eventId: number) => {
    // Soft Delete Mock: Move to trash state instead of API call
    const eventToDelete = events.find((e) => e.id === eventId);
    if (eventToDelete) {
      setTrashedEvents((prev) => [...prev, { ...eventToDelete, isCompleted: true }]); // isCompleted for tracking? No, just add to trash.
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setShowDetailModal(false);
    }
  };

  const handleRestoreEvent = (event: CalendarEvent) => {
    setEvents((prev) => [...prev, event]);
    setTrashedEvents((prev) => prev.filter((e) => e.id !== event.id));
  };

  const handlePermanentDeleteEvent = async (eventId: number) => {
    if (!confirm("이 일정을 영구적으로 삭제하시겠습니까? 복구할 수 없습니다.")) return;
    try {
      await apiClient.deleteEvent(workspaceId, eventId);
      setTrashedEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (error) {
      console.error("Failed to permanently delete event:", error);
      alert("일정 영구 삭제에 실패했습니다.");
    }
  };

  // --- Rendering Logic (Notion Style) ---
  const weeks = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 달력 시작일 (일요일)
    const start = new Date(firstDay);
    start.setDate(1 - firstDay.getDay());

    // 달력 종료일 (토요일)
    const end = new Date(lastDay);
    if (end.getDay() !== 6) end.setDate(lastDay.getDate() + (6 - lastDay.getDay()));

    const weeksArr = [];
    let currentWeek = [];
    let day = new Date(start);

    while (day <= end) {
      currentWeek.push(new Date(day));
      if (currentWeek.length === 7) {
        weeksArr.push(currentWeek);
        currentWeek = [];
      }
      day.setDate(day.getDate() + 1);
    }
    return weeksArr;
  }, [currentDate]);

  const getEventsForWeek = (weekStart: Date, weekEnd: Date) => {
    // Week 범위 설정 (시간 보정)
    const wStart = new Date(weekStart); wStart.setHours(0, 0, 0, 0);
    const wEnd = new Date(weekEnd); wEnd.setHours(23, 59, 59, 999);

    return events.filter(e => {
      const eStart = new Date(e.start_at);
      const eEnd = new Date(e.end_at);
      return eStart <= wEnd && eEnd >= wStart;
    });
  };

  const getEventsForDate = (date: Date) => {
    return events.filter((event) => {
      const eventStart = new Date(event.start_at);
      const eventEnd = new Date(event.end_at);
      const target = new Date(date);
      target.setHours(0, 0, 0, 0);

      const eStartDay = new Date(eventStart); eStartDay.setHours(0, 0, 0, 0);
      const eEndDay = new Date(eventEnd); eEndDay.setHours(0, 0, 0, 0);

      // 날짜 범위 내에 포함되는지 확인
      return target >= eStartDay && target <= eEndDay;
    });
  };

  // --- Helpers ---
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  // --- UI Components ---
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex bg-white relative">
      {/* Main Calendar Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-black/5 flex items-center justify-between px-6 bg-white z-10">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-black">
              {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
            </h2>
            <div className="flex items-center gap-1 bg-black/5 rounded-lg p-0.5">
              <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-1 hover:bg-white rounded-md transition-all">
                <svg className="w-4 h-4 text-black/60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button onClick={() => { setCurrentDate(new Date()); setSelectedDate(today); }} className="px-2 py-0.5 text-xs font-medium text-black/60 hover:bg-white rounded-md transition-all">
                오늘
              </button>
              <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-1 hover:bg-white rounded-md transition-all">
                <svg className="w-4 h-4 text-black/60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-2 px-3 py-1.5 bg-black text-white rounded-lg text-xs font-medium hover:bg-black/80 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            새 일정
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Weekday Header */}
          <div className="grid grid-cols-7 border-b border-black/5 sticky top-0 bg-white z-10">
            {['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => (
              <div key={day} className={`py-2 text-center text-xs font-medium ${idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-black/50'}`}>
                {day}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="flex-1 min-h-[120px] relative border-b border-black/5">
              {/* Background Grid */}
              <div className="absolute inset-0 grid grid-cols-7">
                {week.map((date, dayIdx) => {
                  const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
                  const isToday = date.toDateString() === today.toDateString();
                  const isCurrentMonth = date.getMonth() === currentDate.getMonth();

                  return (
                    <div
                      key={dayIdx}
                      onClick={() => setSelectedDate(date)}
                      className={`border-r border-black/5 p-2 transition-colors cursor-pointer hover:bg-black/[0.02] ${isSelected ? 'bg-black/[0.03]' : ''}`}
                    >
                      <div className={`text-xs w-6 h-6 flex items-center justify-center rounded-full 
                                        ${isToday ? 'bg-black text-white font-bold' :
                          !isCurrentMonth ? 'text-black/20' :
                            dayIdx === 0 ? 'text-red-500' :
                              dayIdx === 6 ? 'text-blue-500' : 'text-black/70'}`}
                      >
                        {date.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Events Overlay (Notion Style Bars) */}
              <div className="absolute inset-0 top-8 grid grid-cols-7 grid-rows-[repeat(auto-fill,24px)] pointer-events-none px-1">
                {(() => {
                  const wStart = week[0]; wStart.setHours(0, 0, 0, 0);
                  const wEnd = week[6]; wEnd.setHours(23, 59, 59, 999);

                  // 이 주에 표시될 이벤트 필터링
                  const weekEvents = getEventsForWeek(wStart, wEnd);

                  // 정렬 (긴 일정 우선, 시작 빠른 순)
                  weekEvents.sort((a, b) => {
                    const durA = new Date(a.end_at).getTime() - new Date(a.start_at).getTime();
                    const durB = new Date(b.end_at).getTime() - new Date(b.start_at).getTime();
                    if (Math.abs(durA - durB) > 86400000) return durB - durA; // 하루 이상 차이나면 긴거 먼저
                    return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
                  });

                  // Row Packing Algorithm
                  const occupiedRows: number[][] = Array(7).fill(0).map(() => []);

                  return weekEvents.map(event => {
                    const eStart = new Date(event.start_at);
                    const eEnd = new Date(event.end_at);

                    // 이 주에서의 시작/끝 요일 인덱스 계산
                    let startCol = 0;
                    let endCol = 6;

                    if (eStart >= wStart) startCol = eStart.getDay();
                    if (eEnd <= wEnd) endCol = eEnd.getDay();

                    const span = endCol - startCol + 1;

                    // 비어있는 Row 찾기
                    let rowIdx = 0;
                    while (true) {
                      let isRowFree = true;
                      for (let i = startCol; i <= endCol; i++) {
                        if (occupiedRows[i]?.includes(rowIdx)) {
                          isRowFree = false;
                          break;
                        }
                      }
                      if (isRowFree) break;
                      rowIdx++;
                    }

                    // Row 점유 표시
                    for (let i = startCol; i <= endCol; i++) {
                      occupiedRows[i]?.push(rowIdx);
                    }

                    // 하루짜리면서 !isAllDay인 경우 -> 점(Dot)으로 표현 (선택사항)
                    const isSingleDay = span === 1 && !event.is_all_day && eStart.getDate() === eEnd.getDate();

                    // 스타일 설정
                    const colorInfo = colorOptions.find(c => c.value === event.color) || colorOptions[0];

                    return (
                      <div
                        key={`${event.id}-${weekIdx}`}
                        onClick={(e) => handleEventClick(event, e)}
                        className={`pointer-events-auto relative z-10 mb-1 mx-0.5 rounded px-2 flex items-center cursor-pointer hover:opacity-80 transition-opacity truncate shadow-sm 
                                            ${isSingleDay
                            ? `bg-transparent`
                            : `${colorInfo.value} text-white`
                          }`}
                        style={{
                          gridColumnStart: startCol + 1,
                          gridColumnEnd: `span ${span}`,
                          gridRowStart: rowIdx + 1,
                          height: '20px',
                          fontSize: '11px',
                        }}
                      >
                        {isSingleDay ? (
                          <div className="flex items-center gap-1.5 w-full">
                            <div className={`w-1.5 h-1.5 rounded-full ${colorInfo.value}`} />
                            <span className="text-black/70 font-medium truncate">{event.title}</span>
                          </div>
                        ) : (
                          <span className="font-medium truncate leading-none">{event.title}</span>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sidebar Details */}
      <div className="w-80 border-l border-black/5 bg-white flex flex-col">
        <div className="px-6 py-5 border-b border-black/5">
          <h2 className="text-lg font-bold text-black">
            {selectedDate?.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" }) || "날짜 선택"}
          </h2>
          <p className="text-sm text-black/40 mt-0.5">
            {selectedDate ? `${getEventsForDate(selectedDate).length}개의 일정` : "일정을 선택하세요"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 relative">
          {selectedDate && getEventsForDate(selectedDate).length > 0 ? (
            getEventsForDate(selectedDate).map(event => {
              const colorInfo = colorOptions.find(c => c.value === event.color) || colorOptions[0];
              return (
                <div
                  key={event.id}
                  onClick={(e) => handleEventClick(event, e)}
                  className="p-4 rounded-xl bg-black/[0.02] hover:bg-black/[0.04] transition-all cursor-pointer group border border-transparent hover:border-black/5 relative"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-1 self-stretch rounded-full ${colorInfo.value} opacity-60`} />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-black text-sm truncate pr-6">{event.title}</h3>
                      <p className="text-xs text-black/40 mt-1">
                        {event.is_all_day ? "하루 종일" : `${formatTime(event.start_at)} - ${formatTime(event.end_at)}`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEvent(event.id);
                    }}
                    className="absolute top-3 right-3 p-1 rounded-md text-black/20 hover:text-red-500 hover:bg-black/5 opacity-0 group-hover:opacity-100 transition-all"
                    title="삭제"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="text-center py-10">
              <p className="text-sm text-black/30">등록된 일정이 없습니다</p>
              <button onClick={() => openCreateModal()} className="mt-2 text-xs text-black font-medium underline opacity-50 hover:opacity-100">
                새 일정 만들기
              </button>
            </div>
          )}

          {/* Trash Button - Fixed at bottom right of Sidebar list area */}
          <div className="absolute bottom-4 right-4 z-20">
            <button
              onClick={() => setShowTrashModal(true)}
              className="w-10 h-10 bg-black text-white rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center justify-center group relative overflow-hidden"
              title="휴지통"
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform" />
              <svg className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* --- Modals --- */}

      {/* Trash Modal */}
      {showTrashModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowTrashModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-zoom-in" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-black/5 flex justify-between items-center">
              <h3 className="text-lg font-bold text-black flex items-center gap-2">
                <span>휴지통</span>
                <span className="bg-black/5 text-black/50 text-xs px-2 py-0.5 rounded-full">{trashedEvents.length}</span>
              </h3>
              <button onClick={() => setShowTrashModal(false)} className="p-1 rounded-full hover:bg-black/5 transition-colors">
                <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-0 h-[60vh] overflow-y-auto bg-black/[0.02]">
              {trashedEvents.length > 0 ? (
                <div className="p-4 space-y-3">
                  {trashedEvents.map(event => {
                    const colorInfo = colorOptions.find(c => c.value === event.color) || colorOptions[0];
                    return (
                      <div key={event.id} className="bg-white p-4 rounded-xl shadow-sm border border-black/5">
                        <div className="flex items-start gap-3 mb-3">
                          <div className={`w-1 self-stretch rounded-full ${colorInfo.value} opacity-60`} />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-black text-sm truncate">{event.title}</h4>
                            <p className="text-xs text-black/40 mt-1">
                              {event.is_all_day ? "하루 종일" : `${formatTime(event.start_at)} - ${formatTime(event.end_at)}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRestoreEvent(event)}
                            className="flex-1 py-1.5 flex items-center justify-center gap-1.5 bg-black/5 hover:bg-black/10 text-black/70 text-xs font-medium rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                            복구
                          </button>
                          <button
                            onClick={() => handlePermanentDeleteEvent(event.id)}
                            className="flex-1 py-1.5 flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            영구 삭제
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </div>
                  <p className="text-black/40 text-sm">휴지통이 비어있습니다</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Event Detail Modal */}
      {showDetailModal && selectedEvent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDetailModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-zoom-in" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-black/5 flex justify-between items-start">
              <div className="flex-1 pr-4">
                <h3 className="text-lg font-bold text-black leading-tight break-words">{selectedEvent.title}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <div className={`w-2 h-2 rounded-full ${selectedEvent.color || 'bg-blue-500'}`} />
                  <span className="text-xs text-black/50 font-medium">
                    {new Date(selectedEvent.start_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button onClick={() => handleDeleteEvent(selectedEvent.id)} className="text-black/30 hover:text-red-500 transition-colors p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-black/40 uppercase tracking-wider">Time</label>
                <p className="text-sm text-black/80 font-medium">
                  {selectedEvent.is_all_day
                    ? "하루 종일"
                    : `${new Date(selectedEvent.start_at).toLocaleString()} ~ ${new Date(selectedEvent.end_at).toLocaleString()}`
                  }
                </p>
              </div>
              {selectedEvent.description && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-black/40 uppercase tracking-wider">Description</label>
                  <p className="text-sm text-black/70 bg-black/[0.02] p-3 rounded-lg leading-relaxed whitespace-pre-wrap">
                    {selectedEvent.description}
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-black/[0.02] border-t border-black/5 flex justify-end">
              <button onClick={() => setShowDetailModal(false)} className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-all">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-zoom-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
              <h3 className="text-lg font-bold text-black">새 일정 목록 추가</h3>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded-full hover:bg-black/5 transition-colors">
                <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-black/50 mb-1.5">제목</label>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-black/[0.03] rounded-lg focus:bg-white focus:ring-2 focus:ring-black/5 transition-all outline-none"
                  placeholder="제목 입력"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-black/50 mb-1.5">설명</label>
                <textarea
                  value={newEvent.description}
                  onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-black/[0.03] rounded-lg focus:bg-white focus:ring-2 focus:ring-black/5 transition-all outline-none resize-none h-20"
                  placeholder="상세 내용을 입력하세요..."
                />
              </div>

              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="isAllDay"
                  checked={newEvent.isAllDay}
                  onChange={e => setNewEvent({ ...newEvent, isAllDay: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black/20"
                />
                <label htmlFor="isAllDay" className="text-sm font-medium text-black/70 cursor-pointer select-none">하루 종일</label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-black/50 mb-1.5">시작</label>
                  <input
                    type="date"
                    value={newEvent.startDate}
                    onChange={(e) => setNewEvent({ ...newEvent, startDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-black/[0.03] rounded-lg mb-2"
                  />
                  {!newEvent.isAllDay && (
                    <input
                      type="time"
                      value={newEvent.startTime}
                      onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-black/[0.03] rounded-lg"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-black/50 mb-1.5">종료</label>
                  <input
                    type="date"
                    value={newEvent.endDate}
                    onChange={(e) => setNewEvent({ ...newEvent, endDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-black/[0.03] rounded-lg mb-2"
                  />
                  {!newEvent.isAllDay && (
                    <input
                      type="time"
                      value={newEvent.endTime}
                      onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-black/[0.03] rounded-lg"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-black/50 mb-2">색상</label>
                <div className="flex gap-2">
                  {colorOptions.map(c => (
                    <button
                      key={c.value}
                      onClick={() => setNewEvent({ ...newEvent, color: c.value })}
                      className={`w-6 h-6 rounded-full ${c.value} transition-transform hover:scale-110 ${newEvent.color === c.value ? 'ring-2 ring-offset-1 ring-black/30 scale-110' : ''}`}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 pt-2 flex gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-2.5 text-black/60 text-sm font-medium hover:bg-black/5 rounded-lg transition-all"
              >
                취소
              </button>
              <button
                onClick={handleCreateEvent}
                disabled={!newEvent.title.trim() || isCreating}
                className="flex-1 py-2.5 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isCreating ? "저장 중..." : "일정 저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
