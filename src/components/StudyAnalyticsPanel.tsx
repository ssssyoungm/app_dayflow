import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import type { StudyGoal, StudySession } from "../types/dayflow";
import { colorToHex } from "../lib/colors";
import {
  WEEKDAY_KO,
  addDays,
  formatDurationKo,
  formatKoreanDateFull,
  formatKstClock,
  formatStopwatchClock,
  formatYearMonthKo,
  getKstHour,
  getMonthGridDates,
  getTodayStr,
  getWeekDates,
  getWeekdayIndex,
  parseLocalDate,
  shiftMonthDate,
} from "../lib/dateUtils";

type PeriodMode = "daily" | "weekly" | "monthly";

interface StudyAnalyticsPanelProps {
  studyGoals: StudyGoal[];
  studySessions: StudySession[];
  liveElapsedSeconds: number;
  isStopwatchRunning: boolean;
  isLiveIncludedInTotal: boolean;
  onDeleteSession: (id: string) => void;
}

function isSessionIncludedInTotal(session: StudySession): boolean {
  return session.includeInTotal !== false;
}

const FALLBACK_SUBJECT_HEX = [
  "#7C3AED",
  "#0284C7",
  "#059669",
  "#D97706",
  "#E11D48",
  "#4F46E5",
  "#0D9488",
  "#64748B",
];

function hashSubjectColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return FALLBACK_SUBJECT_HEX[Math.abs(hash) % FALLBACK_SUBJECT_HEX.length];
}

function getSessionSeconds(session: StudySession): number {
  if (typeof session.actualSeconds === "number" && session.actualSeconds > 0) {
    return session.actualSeconds;
  }
  return Math.max(0, Math.round(session.actualMinutes || 0)) * 60;
}

function formatStudySecondsKo(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds));
  if (secs === 0) return "0분";
  if (secs < 60) return `${secs}초`;
  return formatDurationKo(Math.round(secs / 60));
}

function formatCompactDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds));
  if (secs <= 0) return "";
  const mins = Math.round(secs / 60);
  if (mins < 1) return "<1m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function formatIsoClock(iso: string): string {
  return formatKstClock(iso);
}

interface SubjectSummary {
  key: string;
  name: string;
  colorHex: string;
  totalSeconds: number;
  includedSeconds: number;
  sessionCount: number;
  sharePct: number;
  goal?: StudyGoal;
  allTimeRatio: number;
  allTimeCount: number;
  weekMinutes: number;
}

export const StudyAnalyticsPanel: React.FC<StudyAnalyticsPanelProps> = ({
  studyGoals,
  studySessions,
  liveElapsedSeconds,
  isStopwatchRunning,
  isLiveIncludedInTotal,
  onDeleteSession,
}) => {
  const [todayStr, setTodayStr] = useState<string>(() => getTodayStr());
  const [periodMode, setPeriodMode] = useState<PeriodMode>("daily");
  const [anchorDate, setAnchorDate] = useState<string>(() => getTodayStr());
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<string | null>(null);
  const [selectedDayInWeek, setSelectedDayInWeek] = useState<string | null>(null);

  useEffect(() => {
    const syncKstToday = () => {
      const nextToday = getTodayStr();
      setTodayStr((prevToday) => {
        if (prevToday !== nextToday) {
          setAnchorDate((prevAnchor) => (prevAnchor === prevToday ? nextToday : prevAnchor));
        }
        return nextToday;
      });
    };
    const id = window.setInterval(syncKstToday, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") syncKstToday();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const goalsById = useMemo(() => {
    const map = new Map<string, StudyGoal>();
    for (const g of studyGoals) map.set(g.id, g);
    return map;
  }, [studyGoals]);

  const goalsByName = useMemo(() => {
    const map = new Map<string, StudyGoal>();
    for (const g of studyGoals) map.set(g.subjectName.trim(), g);
    return map;
  }, [studyGoals]);

  const resolveSubjectMeta = useMemo(() => {
    return (session: StudySession) => {
      const trimmedName = (session.subjectName || "").trim() || "자율 집중 공부";
      const matchedGoal =
        goalsById.get(session.subjectId) || goalsByName.get(trimmedName);
      if (matchedGoal) {
        return {
          key: `goal:${matchedGoal.id}`,
          name: matchedGoal.subjectName,
          colorHex: colorToHex(matchedGoal.color),
          goal: matchedGoal,
        };
      }
      return {
        key: `name:${trimmedName}`,
        name: trimmedName,
        colorHex: hashSubjectColor(trimmedName),
        goal: undefined,
      };
    };
  }, [goalsById, goalsByName]);

  // Date range metadata for current periodMode + anchorDate
  const anchorParsed = useMemo(() => parseLocalDate(anchorDate), [anchorDate]);
  const anchorYear = anchorParsed.getFullYear();
  const anchorMonth0 = anchorParsed.getMonth();
  const anchorMonthPrefix = useMemo(
    () => `${anchorYear}-${String(anchorMonth0 + 1).padStart(2, "0")}`,
    [anchorYear, anchorMonth0]
  );

  const weekDates = useMemo(() => getWeekDates(anchorDate), [anchorDate]);
  const weekDatesSet = useMemo(() => new Set(weekDates), [weekDates]);
  const currentWeekSet = useMemo(() => new Set(getWeekDates(todayStr)), [todayStr]);

  const monthGridCells = useMemo(() => {
    const cells = getMonthGridDates(anchorYear, anchorMonth0);
    // Trim trailing 6th week row if completely outside current month
    const lastRow = cells.slice(35);
    if (lastRow.every((c) => !c.inMonth)) {
      return cells.slice(0, 35);
    }
    return cells;
  }, [anchorYear, anchorMonth0]);

  const isViewingPresentPeriod = useMemo(() => {
    if (periodMode === "daily") return anchorDate === todayStr;
    if (periodMode === "weekly") return weekDatesSet.has(todayStr);
    return todayStr.startsWith(anchorMonthPrefix);
  }, [periodMode, anchorDate, todayStr, weekDatesSet, anchorMonthPrefix]);

  const periodLabel = useMemo(() => {
    if (periodMode === "daily") {
      return formatKoreanDateFull(anchorDate);
    }
    if (periodMode === "weekly") {
      const start = parseLocalDate(weekDates[0]);
      const end = parseLocalDate(weekDates[6]);
      return `${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${end.getMonth() + 1}월 ${end.getDate()}일`;
    }
    return formatYearMonthKo(anchorYear, anchorMonth0);
  }, [periodMode, anchorDate, weekDates, anchorYear, anchorMonth0]);

  const presentPeriodLabel =
    periodMode === "daily" ? "오늘" : periodMode === "weekly" ? "이번 주" : "이번 달";

  // Sessions inside the active period (all records)
  const periodSessions = useMemo(() => {
    return studySessions.filter((s) => {
      if (periodMode === "daily") return s.date === anchorDate;
      if (periodMode === "weekly") return weekDatesSet.has(s.date);
      return s.date.startsWith(anchorMonthPrefix);
    });
  }, [studySessions, periodMode, anchorDate, weekDatesSet, anchorMonthPrefix]);

  // Sessions counted toward "총 공부 시간"
  const includedPeriodSessions = useMemo(
    () => periodSessions.filter(isSessionIncludedInTotal),
    [periodSessions]
  );

  // Sessions scoped to selectedDayInWeek (only applies when user taps a bar in Weekly view)
  const scopedSessions = useMemo(() => {
    if (periodMode === "weekly" && selectedDayInWeek) {
      return periodSessions.filter((s) => s.date === selectedDayInWeek);
    }
    return periodSessions;
  }, [periodMode, selectedDayInWeek, periodSessions]);

  const totalPeriodSeconds = useMemo(
    () => includedPeriodSessions.reduce((acc, s) => acc + getSessionSeconds(s), 0),
    [includedPeriodSessions]
  );

  const excludedPeriodSeconds = useMemo(
    () =>
      periodSessions
        .filter((s) => !isSessionIncludedInTotal(s))
        .reduce((acc, s) => acc + getSessionSeconds(s), 0),
    [periodSessions]
  );

  const activeStudyDaysCount = useMemo(() => {
    const days = new Set<string>();
    for (const s of includedPeriodSessions) {
      if (getSessionSeconds(s) > 0) days.add(s.date);
    }
    return days.size;
  }, [includedPeriodSessions]);

  const dailyAverageSeconds = useMemo(() => {
    if (activeStudyDaysCount === 0) return 0;
    return Math.round(totalPeriodSeconds / activeStudyDaysCount);
  }, [totalPeriodSeconds, activeStudyDaysCount]);

  // Precompute all-time calibration ratio & current-week minutes for StudyGoals
  const goalStatsMap = useMemo(() => {
    const map = new Map<
      string,
      { ratio: number; count: number; weekMinutes: number }
    >();
    for (const g of studyGoals) {
      const matched = studySessions.filter(
        (s) => s.subjectId === g.id || s.subjectName.trim() === g.subjectName.trim()
      );
      const plannedSum = matched.reduce(
        (acc, s) => acc + Math.max(1, s.plannedMinutes || 1),
        0
      );
      const actualSum = matched.reduce(
        (acc, s) => acc + Math.max(1, Math.round(getSessionSeconds(s) / 60)),
        0
      );
      const weekMinutes = matched
        .filter((s) => currentWeekSet.has(s.date))
        .reduce((acc, s) => acc + Math.round(getSessionSeconds(s) / 60), 0);

      map.set(g.id, {
        ratio: matched.length > 0 && plannedSum > 0 ? actualSum / plannedSum : 1.0,
        count: matched.length,
        weekMinutes,
      });
    }
    return map;
  }, [studyGoals, studySessions, currentWeekSet]);

  // Per-subject breakdown for the active scope (includes ALL studied subjects + unstudied StudyGoals)
  const subjectSummaries = useMemo<SubjectSummary[]>(() => {
    const accMap = new Map<
      string,
      {
        key: string;
        name: string;
        colorHex: string;
        totalSeconds: number;
        includedSeconds: number;
        sessionCount: number;
        goal?: StudyGoal;
      }
    >();

    for (const session of scopedSessions) {
      const meta = resolveSubjectMeta(session);
      const secs = getSessionSeconds(session);
      const incSecs = isSessionIncludedInTotal(session) ? secs : 0;
      const existing = accMap.get(meta.key);
      if (existing) {
        existing.totalSeconds += secs;
        existing.includedSeconds += incSecs;
        existing.sessionCount += 1;
      } else {
        accMap.set(meta.key, {
          key: meta.key,
          name: meta.name,
          colorHex: meta.colorHex,
          totalSeconds: secs,
          includedSeconds: incSecs,
          sessionCount: 1,
          goal: meta.goal,
        });
      }
    }

    // Ensure configured studyGoals also appear (with 0분 if not studied yet in this period)
    for (const goal of studyGoals) {
      const key = `goal:${goal.id}`;
      if (!accMap.has(key)) {
        accMap.set(key, {
          key,
          name: goal.subjectName,
          colorHex: colorToHex(goal.color),
          totalSeconds: 0,
          includedSeconds: 0,
          sessionCount: 0,
          goal,
        });
      }
    }

    const includedScopeTotal = scopedSessions
      .filter(isSessionIncludedInTotal)
      .reduce((acc, s) => acc + getSessionSeconds(s), 0);

    return Array.from(accMap.values())
      .map((item) => {
        const gStats = item.goal ? goalStatsMap.get(item.goal.id) : undefined;
        return {
          ...item,
          sharePct:
            includedScopeTotal > 0 && item.includedSeconds > 0
              ? Math.round((item.includedSeconds / includedScopeTotal) * 100)
              : 0,
          allTimeRatio: gStats?.ratio ?? 1.0,
          allTimeCount: gStats?.count ?? item.sessionCount,
          weekMinutes: gStats?.weekMinutes ?? 0,
        };
      })
      .sort((a, b) => {
        if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
        return a.name.localeCompare(b.name, "ko");
      });
  }, [scopedSessions, studyGoals, resolveSubjectMeta, goalStatsMap]);

  const studiedSubjects = useMemo(
    () => subjectSummaries.filter((s) => s.totalSeconds > 0),
    [subjectSummaries]
  );

  const includedSubjects = useMemo(
    () => subjectSummaries.filter((s) => s.includedSeconds > 0),
    [subjectSummaries]
  );

  const maxSubjectSeconds = useMemo(
    () => Math.max(1, ...subjectSummaries.map((s) => s.totalSeconds)),
    [subjectSummaries]
  );

  // Daily time-of-day distribution (4 blocks: 새벽/오전/오후/저녁) — 총 공부 시간 포함 기록 기준
  const dailyTimeBlocks = useMemo(() => {
    if (periodMode !== "daily") return [];
    const buckets = [
      { id: "dawn", label: "새벽", range: "00-06시", seconds: 0 },
      { id: "morning", label: "오전", range: "06-12시", seconds: 0 },
      { id: "afternoon", label: "오후", range: "12-18시", seconds: 0 },
      { id: "evening", label: "저녁", range: "18-24시", seconds: 0 },
    ];
    for (const s of includedPeriodSessions) {
      const start = new Date(s.startedAt);
      const hour = Number.isNaN(start.getTime()) ? 12 : getKstHour(start);
      const idx = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
      buckets[idx].seconds += getSessionSeconds(s);
    }
    const maxSecs = Math.max(1, ...buckets.map((b) => b.seconds));
    return buckets.map((b) => ({
      ...b,
      heightPct: b.seconds > 0 ? Math.max(14, Math.round((b.seconds / maxSecs) * 100)) : 0,
    }));
  }, [periodMode, includedPeriodSessions]);

  // Weekly 7-day stacked bars by subject color — 총 공부 시간 포함 기록 기준
  const weeklyChartDays = useMemo(() => {
    if (periodMode !== "weekly") return [];
    const perDay = weekDates.map((dateStr) => {
      const daySessions = includedPeriodSessions.filter((s) => s.date === dateStr);
      const bySubj = new Map<string, { key: string; colorHex: string; seconds: number }>();
      let totalSeconds = 0;
      for (const s of daySessions) {
        const meta = resolveSubjectMeta(s);
        const secs = getSessionSeconds(s);
        totalSeconds += secs;
        const cur = bySubj.get(meta.key);
        if (cur) {
          cur.seconds += secs;
        } else {
          bySubj.set(meta.key, { key: meta.key, colorHex: meta.colorHex, seconds: secs });
        }
      }
      const d = parseLocalDate(dateStr);
      return {
        dateStr,
        dayNum: d.getDate(),
        weekdayLabel: WEEKDAY_KO[getWeekdayIndex(dateStr)],
        isToday: dateStr === todayStr,
        totalSeconds,
        segments: Array.from(bySubj.values()).sort((a, b) => b.seconds - a.seconds),
      };
    });

    const maxDaySeconds = Math.max(1, ...perDay.map((d) => d.totalSeconds));
    return perDay.map((d) => ({
      ...d,
      heightPct:
        d.totalSeconds > 0 ? Math.max(10, Math.round((d.totalSeconds / maxDaySeconds) * 100)) : 0,
    }));
  }, [periodMode, weekDates, includedPeriodSessions, resolveSubjectMeta, todayStr]);

  // Monthly calendar map — 총 공부 시간 포함 기록 기준
  const monthlyDayMap = useMemo(() => {
    if (periodMode !== "monthly") return new Map<string, { totalSeconds: number; colors: string[] }>();
    const map = new Map<string, { totalSeconds: number; colorTotals: Map<string, number> }>();
    for (const s of includedPeriodSessions) {
      const meta = resolveSubjectMeta(s);
      const secs = getSessionSeconds(s);
      let entry = map.get(s.date);
      if (!entry) {
        entry = { totalSeconds: 0, colorTotals: new Map() };
        map.set(s.date, entry);
      }
      entry.totalSeconds += secs;
      entry.colorTotals.set(
        meta.colorHex,
        (entry.colorTotals.get(meta.colorHex) || 0) + secs
      );
    }
    const result = new Map<string, { totalSeconds: number; colors: string[] }>();
    for (const [dateStr, val] of map.entries()) {
      const colors = Array.from(val.colorTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hex]) => hex);
      result.set(dateStr, { totalSeconds: val.totalSeconds, colors });
    }
    return result;
  }, [periodMode, includedPeriodSessions, resolveSubjectMeta]);

  const monthlyMaxSeconds = useMemo(() => {
    let max = 0;
    for (const val of monthlyDayMap.values()) {
      if (val.totalSeconds > max) max = val.totalSeconds;
    }
    return max;
  }, [monthlyDayMap]);

  // Filtered session history list
  const visibleSessions = useMemo(() => {
    const list = selectedSubjectKey
      ? scopedSessions.filter((s) => resolveSubjectMeta(s).key === selectedSubjectKey)
      : scopedSessions;
    return [...list].sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return (b.startedAt || "").localeCompare(a.startedAt || "");
    });
  }, [scopedSessions, selectedSubjectKey, resolveSubjectMeta]);

  const selectedSubjectName = useMemo(() => {
    if (!selectedSubjectKey) return null;
    return subjectSummaries.find((s) => s.key === selectedSubjectKey)?.name || null;
  }, [selectedSubjectKey, subjectSummaries]);

  const handleModeChange = (nextMode: PeriodMode) => {
    const freshToday = getTodayStr();
    setTodayStr(freshToday);
    setAnchorDate(freshToday);
    setPeriodMode(nextMode);
    setSelectedDayInWeek(null);
    setSelectedSubjectKey(null);
  };

  const handleShiftPeriod = (delta: -1 | 1) => {
    setSelectedDayInWeek(null);
    setSelectedSubjectKey(null);
    if (periodMode === "daily") {
      setAnchorDate((prev) => addDays(prev, delta));
    } else if (periodMode === "weekly") {
      setAnchorDate((prev) => addDays(prev, delta * 7));
    } else {
      setAnchorDate((prev) => shiftMonthDate(prev, delta));
    }
  };

  const handleSelectMonthDate = (dateStr: string) => {
    setAnchorDate(dateStr);
    setPeriodMode("daily");
    setSelectedDayInWeek(null);
    setSelectedSubjectKey(null);
  };

  const getHeatmapClass = (seconds: number, inMonth: boolean): string => {
    if (!inMonth) return "bg-transparent text-zinc-300 dark:text-zinc-700";
    if (seconds <= 0) {
      return "bg-zinc-50 dark:bg-zinc-900/60 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/80";
    }
    const ratio = monthlyMaxSeconds > 0 ? seconds / monthlyMaxSeconds : 0;
    if (ratio >= 0.75 || seconds >= 3 * 3600) {
      return "bg-violet-600 text-white hover:bg-violet-700";
    }
    if (ratio >= 0.45 || seconds >= 90 * 60) {
      return "bg-violet-500/80 text-white hover:bg-violet-500";
    }
    if (ratio >= 0.2 || seconds >= 30 * 60) {
      return "bg-violet-200 dark:bg-violet-900/70 text-violet-950 dark:text-violet-100 hover:bg-violet-300/80 dark:hover:bg-violet-800/80";
    }
    return "bg-violet-100 dark:bg-violet-950/60 text-violet-900 dark:text-violet-200 hover:bg-violet-200/70 dark:hover:bg-violet-900/70";
  };

  return (
    <div className="space-y-5">
      {/* MAIN ANALYTICS CARD: 일간 / 주간 / 월간 + 과목별 공부 시간 */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-5">
        {/* Top Row: Title + Period Segmented Control */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              공부 시간 리포트
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              일간·주간·월간 누적과 과목별 집중 비중을 한눈에 확인하세요.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="공부 기록 기간 선택"
            className="inline-flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/90"
          >
            {(
              [
                { id: "daily", label: "일간" },
                { id: "weekly", label: "주간" },
                { id: "monthly", label: "월간" },
              ] as const
            ).map((tab) => {
              const active = periodMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleModeChange(tab.id)}
                  className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? "bg-white dark:bg-zinc-950 text-violet-700 dark:text-violet-300 shadow-xs"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Period Date Navigator */}
        <div className="flex items-center justify-between gap-2 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => handleShiftPeriod(-1)}
            aria-label="이전 기간"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums truncate">
              {periodLabel}
            </span>
            {isViewingPresentPeriod && (
              <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 whitespace-nowrap shrink-0">
                · {presentPeriodLabel}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleShiftPeriod(1)}
            aria-label="다음 기간"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Hero Period Total Metric */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {periodMode === "daily"
                ? isViewingPresentPeriod
                  ? "오늘 총 공부 시간"
                  : "선택한 날 총 공부 시간"
                : periodMode === "weekly"
                  ? isViewingPresentPeriod
                    ? "이번 주 총 공부 시간"
                    : "선택한 주 총 공부 시간"
                  : isViewingPresentPeriod
                    ? "이번 달 총 공부 시간"
                    : "선택한 달 총 공부 시간"}
            </p>
            <div className="mt-1 flex items-baseline gap-2.5">
              <p className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 tabular-nums">
                {formatStudySecondsKo(totalPeriodSeconds)}
              </p>
              <span className="text-xs font-mono-num text-zinc-400 dark:text-zinc-500">
                {formatStopwatchClock(totalPeriodSeconds)}
              </span>
            </div>
          </div>

          <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{periodSessions.length}회 측정</span>
            <span aria-hidden="true">·</span>
            {periodMode === "daily" ? (
              <span>과목 {studiedSubjects.length}개</span>
            ) : (
              <>
                <span>공부한 날 {activeStudyDaysCount}일</span>
                <span aria-hidden="true">·</span>
                <span>일평균 {formatStudySecondsKo(dailyAverageSeconds)}</span>
              </>
            )}
            {excludedPeriodSeconds > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>총합 제외 {formatStudySecondsKo(excludedPeriodSeconds)}</span>
              </>
            )}
            {isViewingPresentPeriod && liveElapsedSeconds > 0 && isLiveIncludedInTotal && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-violet-600 dark:text-violet-400">
                  {isStopwatchRunning ? "측정 중" : "미저장"} +
                  {formatStopwatchClock(liveElapsedSeconds)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* PERIOD VISUALIZATION: Daily Time Blocks / Weekly Stacked Bars / Monthly Calendar Heatmap */}
        {periodMode === "daily" && (
          <div className="pt-1 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                시간대별 집중 분포
              </span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                저장된 기록 기준
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {dailyTimeBlocks.map((block) => (
                <div
                  key={block.id}
                  className="rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-100 dark:border-zinc-800/80 px-2.5 py-3 flex flex-col items-center gap-2"
                >
                  <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums min-h-[16px]">
                    {block.seconds > 0 ? formatCompactDuration(block.seconds) : "-"}
                  </span>
                  <div className="h-14 w-full max-w-[28px] rounded-lg bg-zinc-200/70 dark:bg-zinc-800 flex items-end overflow-hidden">
                    {block.heightPct > 0 && (
                      <div
                        className="w-full rounded-t-md bg-violet-600 dark:bg-violet-500 transition-all"
                        style={{ height: `${block.heightPct}%` }}
                      />
                    )}
                  </div>
                  <div className="text-center leading-tight">
                    <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      {block.label}
                    </p>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                      {block.range}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {periodMode === "weekly" && (
          <div className="pt-1 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                요일별 공부 시간 (과목 색상 누적)
              </span>
              {selectedDayInWeek ? (
                <button
                  type="button"
                  onClick={() => setSelectedDayInWeek(null)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap"
                >
                  <span>{formatKoreanDateFull(selectedDayInWeek)} 선택됨 · 전체 보기</span>
                  <X className="w-3 h-3" />
                </button>
              ) : (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  막대를 탭해 일별 필터
                </span>
              )}
            </div>

            <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5 pt-1">
              {weeklyChartDays.map((day) => {
                const isSelected = selectedDayInWeek === day.dateStr;
                const dimmed = selectedDayInWeek !== null && !isSelected;
                return (
                  <button
                    key={day.dateStr}
                    type="button"
                    onClick={() =>
                      setSelectedDayInWeek((prev) =>
                        prev === day.dateStr ? null : day.dateStr
                      )
                    }
                    className={`rounded-xl py-2 px-1 flex flex-col items-center gap-1.5 transition-colors border ${
                      isSelected
                        ? "border-violet-500 bg-violet-50/70 dark:bg-violet-950/40"
                        : day.isToday
                          ? "border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900"
                          : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    } ${dimmed ? "opacity-45" : ""}`}
                  >
                    <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 tabular-nums min-h-[14px]">
                      {day.totalSeconds > 0
                        ? formatCompactDuration(day.totalSeconds)
                        : ""}
                    </span>

                    <div className="h-24 w-5 sm:w-7 rounded-lg bg-zinc-100 dark:bg-zinc-800/90 flex flex-col justify-end overflow-hidden">
                      {day.totalSeconds > 0 && (
                        <div
                          className="w-full flex flex-col-reverse overflow-hidden rounded-t-md"
                          style={{ height: `${day.heightPct}%` }}
                        >
                          {day.segments.map((seg) => {
                            const segPct = Math.max(
                              8,
                              (seg.seconds / day.totalSeconds) * 100
                            );
                            return (
                              <div
                                key={seg.key}
                                style={{
                                  height: `${segPct}%`,
                                  backgroundColor: seg.colorHex,
                                }}
                                className="w-full"
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="text-center leading-tight">
                      <p
                        className={`text-[11px] font-semibold ${
                          day.isToday
                            ? "text-violet-700 dark:text-violet-300"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {day.weekdayLabel}
                      </p>
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {day.dayNum}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {periodMode === "monthly" && (
          <div className="pt-1 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                월간 공부 달력
              </span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                날짜를 탭하면 일간 상세로 이동
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAY_KO.map((wk, idx) => (
                <div
                  key={wk}
                  className={`py-1 text-[11px] font-semibold ${
                    idx === 0
                      ? "text-rose-500 dark:text-rose-400"
                      : idx === 6
                        ? "text-sky-600 dark:text-sky-400"
                        : "text-zinc-400 dark:text-zinc-500"
                  }`}
                >
                  {wk}
                </div>
              ))}

              {monthGridCells.map((cell) => {
                const info = monthlyDayMap.get(cell.dateStr);
                const secs = info?.totalSeconds || 0;
                const isToday = cell.dateStr === todayStr;
                const dayNum = parseLocalDate(cell.dateStr).getDate();

                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    disabled={!cell.inMonth}
                    onClick={() => handleSelectMonthDate(cell.dateStr)}
                    className={`min-h-[48px] rounded-xl p-1 flex flex-col items-center justify-between transition-colors ${getHeatmapClass(
                      secs,
                      cell.inMonth
                    )} ${
                      isToday && cell.inMonth
                        ? "ring-2 ring-violet-600 dark:ring-violet-400 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900"
                        : ""
                    } disabled:pointer-events-none`}
                  >
                    <span className="text-[11px] font-semibold tabular-nums leading-none">
                      {dayNum}
                    </span>
                    <span className="text-[10px] font-medium tabular-nums leading-none min-h-[11px]">
                      {cell.inMonth && secs > 0 ? formatCompactDuration(secs) : ""}
                    </span>
                    <div className="flex items-center justify-center gap-0.5 min-h-[4px]">
                      {cell.inMonth &&
                        info?.colors.map((hex, i) => (
                          <span
                            key={`${cell.dateStr}-${i}`}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* PER-SUBJECT INTUITIVE BREAKDOWN */}
        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                과목별 공부 시간
                {periodMode === "weekly" && selectedDayInWeek
                  ? ` · ${formatKoreanDateFull(selectedDayInWeek)}`
                  : ""}
              </h4>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                과목을 탭하면 아래 측정 기록을 해당 과목만 모아볼 수 있습니다.
              </p>
            </div>
            {selectedSubjectKey && (
              <button
                type="button"
                onClick={() => setSelectedSubjectKey(null)}
                className="min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/60 hover:bg-violet-100 dark:hover:bg-violet-900/60 whitespace-nowrap shrink-0"
              >
                필터 해제
              </button>
            )}
          </div>

          {/* Stacked Proportion Bar (총 공부 시간 포함 과목 기준) */}
          {includedSubjects.length > 0 && (
            <div className="space-y-1.5">
              <div className="h-3 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex gap-0.5">
                {includedSubjects.map((subj) => (
                  <button
                    key={subj.key}
                    type="button"
                    onClick={() =>
                      setSelectedSubjectKey((prev) =>
                        prev === subj.key ? null : subj.key
                      )
                    }
                    title={`${subj.name}: ${formatStudySecondsKo(subj.includedSeconds)} (${subj.sharePct}%)`}
                    className={`h-full transition-opacity ${
                      selectedSubjectKey && selectedSubjectKey !== subj.key
                        ? "opacity-30"
                        : "opacity-100"
                    }`}
                    style={{
                      width: `${Math.max(4, subj.sharePct)}%`,
                      backgroundColor: subj.colorHex,
                    }}
                    aria-label={`${subj.name} ${subj.sharePct}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                {includedSubjects.slice(0, 5).map((subj) => (
                  <span key={subj.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: subj.colorHex }}
                    />
                    <span className="truncate max-w-[110px]">{subj.name}</span>
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      {subj.sharePct}%
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Subject List Rows */}
          {subjectSummaries.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              이 기간에 기록된 과목 공부 시간이 없습니다.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {subjectSummaries.map((subj) => {
                const isSelected = selectedSubjectKey === subj.key;
                const isFullyExcluded =
                  (subj.totalSeconds > 0 && subj.includedSeconds === 0) ||
                  (subj.totalSeconds === 0 && subj.goal?.includeInTotal === false);
                const isPartiallyExcluded =
                  subj.includedSeconds > 0 && subj.includedSeconds < subj.totalSeconds;
                const barWidthPct =
                  subj.totalSeconds > 0
                    ? Math.max(6, Math.round((subj.totalSeconds / maxSubjectSeconds) * 100))
                    : 0;
                const avgMinutes =
                  subj.sessionCount > 0
                    ? Math.max(1, Math.round(subj.totalSeconds / 60 / subj.sessionCount))
                    : 0;
                const goalWeeklyPct = subj.goal
                  ? Math.min(
                      100,
                      Math.round(
                        (subj.weekMinutes / Math.max(1, subj.goal.weeklyTargetMinutes)) *
                          100
                      )
                    )
                  : null;
                const nextRecommendedBlock = subj.goal
                  ? Math.max(
                      25,
                      Math.min(
                        120,
                        Math.round(subj.goal.defaultSessionMinutes * subj.allTimeRatio)
                      )
                    )
                  : null;

                return (
                  <button
                    key={subj.key}
                    type="button"
                    onClick={() =>
                      setSelectedSubjectKey((prev) =>
                        prev === subj.key ? null : subj.key
                      )
                    }
                    className={`w-full text-left py-3 px-2.5 -mx-2.5 rounded-xl transition-colors space-y-2 ${
                      isSelected
                        ? "bg-violet-50/70 dark:bg-violet-950/35"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    } ${subj.totalSeconds === 0 ? "opacity-65" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: subj.colorHex }}
                        />
                        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                          {subj.name}
                        </span>
                        {isSelected && (
                          <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 whitespace-nowrap shrink-0">
                            · 선택됨
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline gap-2 shrink-0 tabular-nums">
                        <span className="text-sm font-bold text-zinc-950 dark:text-zinc-50">
                          {formatStudySecondsKo(subj.totalSeconds)}
                        </span>
                        {isFullyExcluded ? (
                          <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                            총합 제외
                          </span>
                        ) : (
                          subj.totalSeconds > 0 && (
                            <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 w-9 text-right">
                              {subj.sharePct}%
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    {/* Visual Subject Time Bar */}
                    <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      {barWidthPct > 0 && (
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${barWidthPct}%`,
                            backgroundColor: subj.colorHex,
                            opacity: isFullyExcluded ? 0.55 : 1,
                          }}
                        />
                      )}
                    </div>

                    {/* Clean Unboxed Metadata Line */}
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                      <span>
                        {subj.sessionCount > 0
                          ? `${subj.sessionCount}회 측정 · 회당 평균 ${formatDurationKo(avgMinutes)}`
                          : "이 기간 측정 기록 없음"}
                        {isPartiallyExcluded
                          ? ` · 총합 반영 ${formatStudySecondsKo(subj.includedSeconds)}`
                          : ""}
                      </span>
                      {subj.goal && (
                        <span>
                          주간 목표 {formatDurationKo(subj.weekMinutes)} /{" "}
                          {formatDurationKo(subj.goal.weeklyTargetMinutes)} ({goalWeeklyPct}%)
                          {subj.allTimeCount > 0 && nextRecommendedBlock
                            ? ` · 추천 보정 ${subj.allTimeRatio.toFixed(2)}x (${nextRecommendedBlock}분)`
                            : ""}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* FILTERED PERIOD STUDY LOGS */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {periodMode === "daily"
              ? "일간 측정 기록"
              : periodMode === "weekly"
                ? "주간 측정 기록"
                : "월간 측정 기록"}
            {selectedSubjectName ? ` · ${selectedSubjectName}` : ""}
            {" · "}
            <span className="font-normal text-zinc-500 dark:text-zinc-400 tabular-nums">
              {visibleSessions.length}건
            </span>
          </h3>

          {(selectedSubjectKey || selectedDayInWeek) && (
            <button
              type="button"
              onClick={() => {
                setSelectedSubjectKey(null);
                setSelectedDayInWeek(null);
              }}
              className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap"
            >
              전체 기록 보기
            </button>
          )}
        </div>

        {visibleSessions.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 py-5 text-center">
            {studySessions.length === 0
              ? "아직 저장된 공부 측정 기록이 없습니다. 스톱워치로 첫 공부 시간을 측정해 보세요."
              : "선택한 기간과 조건에 해당하는 공부 기록이 없습니다."}
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {visibleSessions.map((s) => {
              const meta = resolveSubjectMeta(s);
              const secs = getSessionSeconds(s);
              const startClock = formatIsoClock(s.startedAt);
              const endClock = formatIsoClock(s.endedAt);
              const timeRange =
                startClock && endClock ? `${startClock}~${endClock}` : "";
              const ratio = (s.actualMinutes / Math.max(1, s.plannedMinutes)).toFixed(2);

              return (
                <div
                  key={s.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                      style={{ backgroundColor: meta.colorHex }}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {meta.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {periodMode !== "daily" ? `${s.date} · ` : ""}
                        {timeRange ? `${timeRange} · ` : ""}
                        계획 {formatDurationKo(s.plannedMinutes)} ({ratio}x)
                        {!isSessionIncludedInTotal(s) ? " · 총합 제외" : ""}
                        {s.memo ? ` · ${s.memo}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 tabular-nums whitespace-nowrap">
                      {formatStudySecondsKo(secs)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(s.id)}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                      aria-label="기록 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
