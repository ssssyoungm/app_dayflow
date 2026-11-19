import React, { useMemo, useState } from "react";
import {
  Bell,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Play,
  Plus,
} from "lucide-react";
import type { AppSettings, ScheduleCategory, ScheduleItem } from "../types/dayflow";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  SUBTYPE_LABELS,
  resolveColorTheme,
} from "../lib/colors";
import {
  WEEKDAY_KO,
  addDays,
  computeFreeSlotsForDate,
  formatDurationKo,
  formatKoreanDateFull,
  formatYearMonthKo,
  getMonthGridDates,
  getTodayStr,
  getWeekDates,
  parseLocalDate,
  timeToMinutes,
} from "../lib/dateUtils";
import { downloadTextFile, exportSchedulesToIcs } from "../lib/ics";

export type PlannerMode = "daily" | "weekly" | "monthly";
export type CategoryFilter = "all" | ScheduleCategory;

interface PlannerViewProps {
  schedules: ScheduleItem[];
  settings: AppSettings;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onAddSchedule: (defaultDate: string) => void;
  onEditSchedule: (item: ScheduleItem) => void;
  onToggleComplete: (id: string) => void;
  onStartStopwatchForItem: (item: ScheduleItem) => void;
  onOpenAITimetable: () => void;
  onShowToast: (msg: string) => void;
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  schedules,
  settings,
  selectedDate,
  onSelectDate,
  onAddSchedule,
  onEditSchedule,
  onToggleComplete,
  onStartStopwatchForItem,
  onOpenAITimetable,
  onShowToast,
}) => {
  const [plannerMode, setPlannerMode] = useState<PlannerMode>("daily");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const todayStr = getTodayStr();
  const parsedSel = parseLocalDate(selectedDate);
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number }>({
    year: parsedSel.getFullYear(),
    month: parsedSel.getMonth(),
  });

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  const sortByTime = (a: ScheduleItem, b: ScheduleItem) => {
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  };

  // Daily schedules (shows BOTH fixed and personal unless filtered)
  const dailySchedules = useMemo(() => {
    return schedules
      .filter((s) => s.date === selectedDate || s.dueDate === selectedDate)
      .filter((s) => (categoryFilter === "all" ? true : s.category === categoryFilter))
      .sort(sortByTime);
  }, [schedules, selectedDate, categoryFilter]);

  const dailyFixed = useMemo(
    () => dailySchedules.filter((s) => s.category === "fixed"),
    [dailySchedules]
  );
  const dailyPersonal = useMemo(
    () => dailySchedules.filter((s) => s.category === "personal"),
    [dailySchedules]
  );

  const dailyFreeSlots = useMemo(
    () =>
      computeFreeSlotsForDate(
        selectedDate,
        schedules,
        settings.studyWindowStart,
        settings.studyWindowEnd
      ),
    [selectedDate, schedules, settings.studyWindowStart, settings.studyWindowEnd]
  );

  // Weekly schedules map (shows BOTH fixed and personal)
  const weeklyMap = useMemo(() => {
    const map: Record<string, ScheduleItem[]> = {};
    for (const d of weekDates) {
      map[d] = schedules
        .filter((s) => s.date === d || s.dueDate === d)
        .filter((s) => (categoryFilter === "all" ? true : s.category === categoryFilter))
        .sort(sortByTime);
    }
    return map;
  }, [schedules, weekDates, categoryFilter]);

  // Monthly calendar grid & strict filter:
  // ONLY Fixed schedules with priority === 'high' OR dueDate === cellDate
  const monthGrid = useMemo(
    () => getMonthGridDates(monthCursor.year, monthCursor.month),
    [monthCursor]
  );

  const monthlyFilteredMap = useMemo(() => {
    const map: Record<string, ScheduleItem[]> = {};
    for (const cell of monthGrid) {
      const items = schedules
        .filter((s) => {
          if (s.category !== "fixed") return false;
          const isDueThatDay = s.dueDate === cell.dateStr;
          const isHighPriorityThatDay = s.priority === "high" && s.date === cell.dateStr;
          return isDueThatDay || isHighPriorityThatDay;
        })
        .sort(sortByTime);
      if (items.length > 0) {
        map[cell.dateStr] = items;
      }
    }
    return map;
  }, [schedules, monthGrid]);

  const selectedMonthDayItems = monthlyFilteredMap[selectedDate] || [];

  const handleShiftPeriod = (direction: -1 | 1) => {
    if (plannerMode === "daily") {
      const next = addDays(selectedDate, direction);
      onSelectDate(next);
      const d = parseLocalDate(next);
      setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
    } else if (plannerMode === "weekly") {
      const next = addDays(selectedDate, direction * 7);
      onSelectDate(next);
      const d = parseLocalDate(next);
      setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
    } else {
      const nextDate = new Date(monthCursor.year, monthCursor.month + direction, 1);
      setMonthCursor({ year: nextDate.getFullYear(), month: nextDate.getMonth() });
    }
  };

  const handleJumpToday = () => {
    const t = getTodayStr();
    onSelectDate(t);
    const d = parseLocalDate(t);
    setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const handleExportVisibleIcs = () => {
    const itemsToExport =
      plannerMode === "daily"
        ? dailySchedules
        : plannerMode === "weekly"
        ? weekDates.flatMap((d) => weeklyMap[d] || [])
        : Object.values(monthlyFilteredMap).flat();

    if (itemsToExport.length === 0) {
      if (schedules.length > 0) {
        const ics = exportSchedulesToIcs(schedules, "데이플로우_전체일정");
        downloadTextFile(`dayflow_all_${selectedDate}.ics`, ics, "text/calendar;charset=utf-8");
        onShowToast(`현재 화면에 일정이 없어 전체 ${schedules.length}건의 일정을 .ics로 내보냈습니다.`);
      } else {
        onShowToast("내보낼 일정이 없습니다. 먼저 일정을 등록해 주세요.");
      }
      return;
    }
    const ics = exportSchedulesToIcs(itemsToExport, `DayFlow_${plannerMode}`);
    downloadTextFile(`dayflow_${plannerMode}_${selectedDate}.ics`, ics, "text/calendar;charset=utf-8");
    onShowToast(`${itemsToExport.length}건의 일정을 .ics 파일로 내보냈습니다.`);
  };

  const renderScheduleCard = (item: ScheduleItem) => {
    const theme = resolveColorTheme(item.color);
    const isDueToday = item.dueDate === selectedDate && item.date !== selectedDate;

    return (
      <div
        key={`${item.id}-${isDueToday ? "due" : "main"}`}
        className={`group rounded-2xl border p-3.5 transition-colors ${theme.cardClass} ${
          item.completed ? "opacity-60" : ""
        }`}
        style={theme.cardStyle}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggleComplete(item.id)}
            aria-label={item.completed ? "완료 해제" : "완료 표시"}
            className={`mt-0.5 min-h-[24px] min-w-[24px] h-6 w-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
              item.completed
                ? "bg-violet-600 border-violet-600 text-white"
                : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 hover:border-violet-500"
            }`}
          >
            {item.completed && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
          </button>

          <button
            type="button"
            onClick={() => onEditSchedule(item)}
            className="flex-1 min-w-0 text-left"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${theme.dotClass}`}
                style={theme.dotStyle}
              />
              <p
                className={`text-sm font-semibold truncate ${
                  item.completed
                    ? "line-through text-zinc-500 dark:text-zinc-400"
                    : "text-zinc-900 dark:text-zinc-50"
                }`}
              >
                {item.title}
              </p>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
              <span className={`font-medium ${theme.accentTextClass}`} style={theme.accentStyle}>
                {CATEGORY_LABELS[item.category]}
              </span>
              <span aria-hidden="true">·</span>
              <span>{SUBTYPE_LABELS[item.subType]}</span>
              <span aria-hidden="true">·</span>
              <span>
                {item.isAllDay ? "종일" : `${item.startTime}–${item.endTime}`}
              </span>
              {item.priority === "high" && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    우선순위 {PRIORITY_LABELS[item.priority]}
                  </span>
                </>
              )}
              {item.dueDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {item.dueDate === selectedDate ? "오늘 마감" : `마감 ${item.dueDate.slice(5)}`}
                  </span>
                </>
              )}
              {item.notifyEnabled && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-0.5">
                    <Bell className="w-3 h-3" />
                    알림
                  </span>
                </>
              )}
            </div>

            {item.memo && (
              <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                {item.memo}
              </p>
            )}
          </button>

          {item.category === "personal" && !item.completed && (
            <button
              type="button"
              onClick={() => onStartStopwatchForItem(item)}
              className="min-h-[38px] px-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors whitespace-nowrap"
              title="열품타 스톱워치로 바로 측정 시작"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>측정</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Toolbar: Planner 3-Mode Segmented Switch + Period Nav */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="플래너 보기 전환"
          className="grid grid-cols-3 sm:inline-flex p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800"
        >
          {(
            [
              { id: "daily", label: "일간" },
              { id: "weekly", label: "주간" },
              { id: "monthly", label: "월간" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={plannerMode === tab.id}
              type="button"
              onClick={() => setPlannerMode(tab.id)}
              className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                plannerMode === tab.id
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleShiftPeriod(-1)}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              aria-label="이전 기간"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleJumpToday}
              className="min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap"
            >
              오늘
            </button>
            <button
              type="button"
              onClick={() => handleShiftPeriod(1)}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              aria-label="다음 기간"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportVisibleIcs}
            className="min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1.5 whitespace-nowrap"
            title="현재 보기 일정 .ics 파일 내보내기"
          >
            <Download className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            <span>.ics 내보내기</span>
          </button>
        </div>
      </div>

      {/* Category Filter Bar (Daily & Weekly only — Monthly has strict Fixed High/Due rule) */}
      {plannerMode !== "monthly" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
            {plannerMode === "daily"
              ? formatKoreanDateFull(selectedDate)
              : `${formatKoreanDateFull(weekDates[0])} – ${formatKoreanDateFull(weekDates[6])}`}
          </h2>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800">
            {(
              [
                { id: "all", label: "전체" },
                { id: "fixed", label: "고정 일정" },
                { id: "personal", label: "개인 스케줄" },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCategoryFilter(f.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  categoryFilter === f.id
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
            {formatYearMonthKo(monthCursor.year, monthCursor.month)}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            월간 플래너는 우선순위 <span className="font-semibold text-zinc-700 dark:text-zinc-200">높음</span> 또는{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">당일 마감</span> 고정 일정만 표시합니다
          </p>
        </div>
      )}

      {/* ================= DAILY VIEW ================= */}
      {plannerMode === "daily" && (
        <div className="space-y-5">
          {/* Horizontal 7-Day Date Scroller */}
          <div className="grid grid-cols-7 gap-1.5">
            {weekDates.map((dStr) => {
              const d = parseLocalDate(dStr);
              const isSelected = dStr === selectedDate;
              const isToday = dStr === todayStr;
              const count = schedules.filter((s) => s.date === dStr || s.dueDate === dStr).length;
              return (
                <button
                  key={dStr}
                  type="button"
                  onClick={() => onSelectDate(dStr)}
                  className={`min-h-[60px] flex flex-col items-center justify-center rounded-2xl border py-2 transition-colors ${
                    isSelected
                      ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                      : isToday
                      ? "border-violet-300 dark:border-violet-700 bg-violet-50/60 dark:bg-violet-950/30 text-zinc-900 dark:text-zinc-100"
                      : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                  }`}
                >
                  <span
                    className={`text-[11px] font-medium ${
                      isSelected ? "text-violet-100" : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {WEEKDAY_KO[d.getDay()]}
                  </span>
                  <span className="mt-0.5 text-sm font-bold tabular-nums">{d.getDate()}</span>
                  <span
                    className={`mt-1 h-1 w-4 rounded-full ${
                      count > 0
                        ? isSelected
                          ? "bg-white"
                          : "bg-violet-500"
                        : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Empty State or Separated Sections */}
          {dailySchedules.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-7 text-center">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {formatKoreanDateFull(selectedDate)}에 등록된 일정이 없습니다
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                고정 일정(과제·시험·수업)이나 개인 공부 스케줄을 추가하거나 시간표 사진을 AI로 불러오세요.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onAddSchedule(selectedDate)}
                  className="min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>일정 직접 등록</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenAITimetable}
                  className="min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1.5"
                >
                  <CalendarPlus className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  <span>AI 시간표 인식 · 추천</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {/* Fixed Schedules Column */}
              {(categoryFilter === "all" || categoryFilter === "fixed") && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      고정 일정 · <span className="font-normal text-zinc-500 dark:text-zinc-400 tabular-nums">{dailyFixed.length}건</span>
                    </h3>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">과제 · 학과 행사 · 시험 · 수업</span>
                  </div>
                  {dailyFixed.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-5 text-xs text-zinc-500 dark:text-zinc-400 text-center">
                      오늘 고정 일정이 없습니다
                    </div>
                  ) : (
                    <div className="space-y-2.5">{dailyFixed.map(renderScheduleCard)}</div>
                  )}
                </section>
              )}

              {/* Personal Schedules Column */}
              {(categoryFilter === "all" || categoryFilter === "personal") && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      개인 스케줄 · <span className="font-normal text-zinc-500 dark:text-zinc-400 tabular-nums">{dailyPersonal.length}건</span>
                    </h3>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">과목 공부 · 개인 루틴</span>
                  </div>
                  {dailyPersonal.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-5 text-xs text-zinc-500 dark:text-zinc-400 text-center">
                      오늘 개인 공부 스케줄이 없습니다
                    </div>
                  ) : (
                    <div className="space-y-2.5">{dailyPersonal.map(renderScheduleCard)}</div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* Free Time Windows Summary Strip */}
          {dailyFreeSlots.length > 0 && (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                  <span>오늘 남은 빈 시간대 ({dailyFreeSlots.length}구간)</span>
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {dailyFreeSlots
                    .slice(0, 3)
                    .map((s) => `${s.startTime}–${s.endTime} (${formatDurationKo(s.durationMinutes)})`)
                    .join(" · ")}
                  {dailyFreeSlots.length > 3 ? ` 외 ${dailyFreeSlots.length - 3}구간` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenAITimetable}
                className="min-h-[40px] px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                빈 시간대 공부 추천
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================= WEEKLY VIEW ================= */}
      {plannerMode === "weekly" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
          {weekDates.map((dStr) => {
            const d = parseLocalDate(dStr);
            const items = weeklyMap[dStr] || [];
            const isToday = dStr === todayStr;
            const isSelected = dStr === selectedDate;
            return (
              <div
                key={dStr}
                className={`rounded-2xl border p-3 flex flex-col min-h-[170px] ${
                  isSelected
                    ? "border-violet-500 bg-violet-50/30 dark:bg-violet-950/20"
                    : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70"
                }`}
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-200/70 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectDate(dStr);
                      setPlannerMode("daily");
                    }}
                    className="text-left group"
                  >
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 tabular-nums">
                      {d.getMonth() + 1}/{d.getDate()} ({WEEKDAY_KO[d.getDay()]})
                    </span>
                    {isToday && (
                      <span className="ml-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                        오늘
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddSchedule(dStr)}
                    className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-violet-600"
                    aria-label={`${dStr} 일정 추가`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {items.length === 0 ? (
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 py-4 text-center my-auto">
                    일정 없음
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {items.map((item) => {
                      const theme = resolveColorTheme(item.color);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onEditSchedule(item)}
                          className={`w-full text-left rounded-xl border px-2.5 py-2 transition-colors ${theme.cardClass} ${
                            item.completed ? "opacity-55 line-through" : ""
                          }`}
                          style={theme.cardStyle}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${theme.dotClass}`}
                              style={theme.dotStyle}
                            />
                            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                              {item.title}
                            </p>
                          </div>
                          <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums truncate">
                            {item.category === "fixed" ? "고정" : "개인"} ·{" "}
                            {item.isAllDay ? "종일" : item.startTime}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MONTHLY VIEW (STRICT FILTER) ================= */}
      {plannerMode === "monthly" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 overflow-hidden">
            {/* Weekday header */}
            <div className="grid grid-cols-7 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60">
              {WEEKDAY_KO.map((wk, idx) => (
                <div
                  key={wk}
                  className={`py-2.5 text-center text-xs font-semibold ${
                    idx === 0
                      ? "text-rose-600 dark:text-rose-400"
                      : idx === 6
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {wk}
                </div>
              ))}
            </div>

            {/* 42 Calendar Cells */}
            <div className="grid grid-cols-7">
              {monthGrid.map((cell) => {
                const d = parseLocalDate(cell.dateStr);
                const items = monthlyFilteredMap[cell.dateStr] || [];
                const isSelected = cell.dateStr === selectedDate;
                const isToday = cell.dateStr === todayStr;

                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    onClick={() => onSelectDate(cell.dateStr)}
                    className={`min-h-[76px] sm:min-h-[96px] p-1.5 sm:p-2 border-b border-r border-zinc-100 dark:border-zinc-800/80 text-left flex flex-col transition-colors ${
                      isSelected
                        ? "bg-violet-50/70 dark:bg-violet-950/35 ring-1 ring-inset ring-violet-500"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    } ${!cell.inMonth ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-xs font-semibold tabular-nums w-6 h-6 flex items-center justify-center rounded-lg ${
                          isToday
                            ? "bg-violet-600 text-white"
                            : "text-zinc-800 dark:text-zinc-200"
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      {items.length > 0 && (
                        <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 tabular-nums sm:hidden">
                          {items.length}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 space-y-1 w-full hidden sm:block">
                      {items.slice(0, 2).map((item) => {
                        const theme = resolveColorTheme(item.color);
                        return (
                          <div
                            key={item.id}
                            className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium truncate ${theme.cardClass} text-zinc-900 dark:text-zinc-100`}
                            style={theme.cardStyle}
                          >
                            {item.dueDate === cell.dateStr ? `[마감] ${item.title}` : item.title}
                          </div>
                        );
                      })}
                      {items.length > 2 && (
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 pl-1 tabular-nums">
                          +{items.length - 2}건
                        </p>
                      )}
                    </div>

                    {/* Mobile compact dot indicator */}
                    {items.length > 0 && (
                      <div className="mt-auto flex items-center gap-1 sm:hidden pt-1">
                        {items.slice(0, 3).map((item) => {
                          const dotTheme = resolveColorTheme(item.color);
                          return (
                            <span
                              key={item.id}
                              className={`w-1.5 h-1.5 rounded-full ${dotTheme.dotClass}`}
                              style={dotTheme.dotStyle}
                            />
                          );
                        })}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Day Monthly Details */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {formatKoreanDateFull(selectedDate)} 중요 고정 일정
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  개인 스케줄과 일반 일정은 일간·주간 플래너에서 확인할 수 있습니다
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlannerMode("daily")}
                className="min-h-[38px] px-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                일간 플래너 보기
              </button>
            </div>

            {selectedMonthDayItems.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 py-3">
                이 날짜에는 우선순위 높음 또는 당일 마감 고정 일정이 없습니다.
              </p>
            ) : (
              <div className="space-y-2">{selectedMonthDayItems.map(renderScheduleCard)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
