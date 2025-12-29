"use client";

import { useState } from "react";

interface Event {
  id: number;
  title: string;
  date: Date;
  startTime: string;
  endTime: string;
  color: string;
  attendees: string[];
}

const today = new Date();

const mockEvents: Event[] = [
  {
    id: 1,
    title: "스프린트 계획 회의",
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    startTime: "10:00",
    endTime: "11:00",
    color: "bg-blue-500",
    attendees: ["김철수", "이영희", "박민수"],
  },
  {
    id: 2,
    title: "디자인 리뷰",
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    startTime: "14:00",
    endTime: "15:00",
    color: "bg-purple-500",
    attendees: ["정수진", "최동훈"],
  },
  {
    id: 3,
    title: "주간 스탠드업",
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
    startTime: "09:00",
    endTime: "09:30",
    color: "bg-green-500",
    attendees: ["전체"],
  },
  {
    id: 4,
    title: "클라이언트 미팅",
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2),
    startTime: "15:00",
    endTime: "16:30",
    color: "bg-amber-500",
    attendees: ["김철수", "이영희"],
  },
  {
    id: 5,
    title: "코드 리뷰",
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 4),
    startTime: "11:00",
    endTime: "12:00",
    color: "bg-rose-500",
    attendees: ["박민수", "최동훈"],
  },
];

export default function CalendarSection() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [view, setView] = useState<"month" | "week">("month");

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    const days: (Date | null)[] = [];

    // Add empty slots for days before the first day of the month
    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  const getEventsForDate = (date: Date) => {
    return mockEvents.filter(
      (event) =>
        event.date.getFullYear() === date.getFullYear() &&
        event.date.getMonth() === date.getMonth() &&
        event.date.getDate() === date.getDate()
    );
  };

  const formatMonth = (date: Date) => {
    return date.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(today);
  };

  const isToday = (date: Date) => {
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const isSelected = (date: Date) => {
    return (
      selectedDate &&
      date.getFullYear() === selectedDate.getFullYear() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getDate() === selectedDate.getDate()
    );
  };

  const days = getDaysInMonth(currentDate);
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  return (
    <div className="h-full flex">
      {/* Calendar */}
      <div className="flex-1 flex flex-col border-r border-black/5">
        {/* Header */}
        <div className="px-8 py-5 border-b border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-black">{formatMonth(currentDate)}</h1>
            <button
              onClick={goToToday}
              className="px-3 py-1.5 text-sm text-black/60 hover:text-black hover:bg-black/5 rounded-lg transition-colors"
            >
              오늘
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-black/[0.03] rounded-lg p-1 mr-4">
              <button
                onClick={() => setView("month")}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  view === "month"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/50 hover:text-black/70"
                }`}
              >
                월
              </button>
              <button
                onClick={() => setView("week")}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  view === "week"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/50 hover:text-black/70"
                }`}
              >
                주
              </button>
            </div>
            <button
              onClick={prevMonth}
              className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={nextMonth}
              className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 p-6 overflow-y-auto">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 mb-2">
            {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => (
              <div
                key={day}
                className={`text-center text-sm font-medium py-2 ${
                  index === 0 ? "text-red-400" : index === 6 ? "text-blue-400" : "text-black/40"
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="aspect-square" />;
              }

              const events = getEventsForDate(date);
              const dayOfWeek = date.getDay();

              return (
                <button
                  key={date.toISOString()}
                  onClick={() => setSelectedDate(date)}
                  className={`aspect-square p-1 rounded-xl transition-all relative ${
                    isSelected(date)
                      ? "bg-black text-white"
                      : isToday(date)
                      ? "bg-black/5"
                      : "hover:bg-black/[0.03]"
                  }`}
                >
                  <span
                    className={`text-sm font-medium ${
                      isSelected(date)
                        ? "text-white"
                        : dayOfWeek === 0
                        ? "text-red-400"
                        : dayOfWeek === 6
                        ? "text-blue-400"
                        : "text-black"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {events.length > 0 && (
                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                      {events.slice(0, 3).map((event) => (
                        <div
                          key={event.id}
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected(date) ? "bg-white/60" : event.color
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Event Details Sidebar */}
      <div className="w-96 flex flex-col">
        <div className="px-6 py-5 border-b border-black/5">
          <h2 className="text-lg font-semibold text-black">
            {selectedDate
              ? selectedDate.toLocaleDateString("ko-KR", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })
              : "날짜를 선택하세요"}
          </h2>
          <p className="text-sm text-black/40 mt-0.5">
            {selectedEvents.length > 0
              ? `${selectedEvents.length}개의 일정`
              : "일정 없음"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {selectedEvents.length > 0 ? (
            <div className="space-y-3">
              {selectedEvents.map((event) => (
                <div
                  key={event.id}
                  className="p-4 rounded-xl bg-black/[0.02] hover:bg-black/[0.04] transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-1 h-full min-h-[60px] rounded-full ${event.color}`} />
                    <div className="flex-1">
                      <h3 className="font-medium text-black">{event.title}</h3>
                      <p className="text-sm text-black/50 mt-1">
                        {event.startTime} - {event.endTime}
                      </p>
                      <div className="flex items-center gap-1 mt-3">
                        <div className="flex -space-x-1">
                          {event.attendees.slice(0, 3).map((attendee, i) => (
                            <div
                              key={i}
                              className="w-6 h-6 rounded-full bg-black/10 border-2 border-white flex items-center justify-center text-[10px] font-medium text-black/50"
                            >
                              {attendee.charAt(0)}
                            </div>
                          ))}
                        </div>
                        <span className="text-xs text-black/40 ml-1">
                          {event.attendees.length > 3
                            ? `+${event.attendees.length - 3}명`
                            : event.attendees.join(", ")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-black/5 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm text-black/40 mb-4">이 날짜에 일정이 없습니다</p>
              <button className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-colors flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                일정 추가
              </button>
            </div>
          )}
        </div>

        {/* Quick Add */}
        <div className="p-4 border-t border-black/5">
          <button className="w-full py-3 border-2 border-dashed border-black/10 rounded-xl text-black/40 hover:border-black/20 hover:text-black/60 transition-colors flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">새 일정 만들기</span>
          </button>
        </div>
      </div>
    </div>
  );
}
