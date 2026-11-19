import type { FreeSlot, ScheduleItem } from "../types/dayflow";

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(dateStr: string, delta: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + delta);
  return toLocalDateStr(d);
}

export function getTodayStr(): string {
  return toLocalDateStr(new Date());
}

/** Returns Monday..Sunday (7 YYYY-MM-DD strings) for the week containing dateStr */
export function getWeekDates(dateStr: string): string[] {
  const d = parseLocalDate(dateStr);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  return Array.from({ length: 7 }, (_, i) => {
    const cur = new Date(mon);
    cur.setDate(mon.getDate() + i);
    return toLocalDateStr(cur);
  });
}

/** Returns 42 cells (6 weeks, starting Sunday) for a month calendar grid */
export function getMonthGridDates(year: number, monthIndex0: number): Array<{ dateStr: string; inMonth: boolean }> {
  const firstDay = new Date(year, monthIndex0, 1);
  const startOffset = firstDay.getDay(); // 0=Sun
  const startDate = new Date(year, monthIndex0, 1 - startOffset);

  const cells: Array<{ dateStr: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const cur = new Date(startDate);
    cur.setDate(startDate.getDate() + i);
    cells.push({
      dateStr: toLocalDateStr(cur),
      inMonth: cur.getMonth() === monthIndex0,
    });
  }
  return cells;
}

export function formatKoreanDateFull(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const wk = WEEKDAY_KO[d.getDay()];
  return `${month}월 ${day}일 (${wk})`;
}

export function formatYearMonthKo(year: number, monthIndex0: number): string {
  return `${year}년 ${monthIndex0 + 1}월`;
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatDurationKo(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export function formatStopwatchClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return [hrs, mins, secs].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Finds free intervals (>= minSlotMinutes) on a given date inside [windowStart, windowEnd] */
export function computeFreeSlotsForDate(
  dateStr: string,
  schedules: ScheduleItem[],
  windowStart = "08:00",
  windowEnd = "23:00",
  minSlotMinutes = 25
): FreeSlot[] {
  const startMin = timeToMinutes(windowStart);
  const endMin = timeToMinutes(windowEnd);
  if (endMin <= startMin) return [];

  const now = new Date();
  const isToday = dateStr === getTodayStr();
  const effectiveStart = isToday
    ? Math.max(startMin, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5)
    : startMin;

  if (effectiveStart >= endMin) return [];

  const busy = schedules
    .filter((s) => s.date === dateStr && !s.isAllDay)
    .map((s) => ({
      start: Math.max(effectiveStart, timeToMinutes(s.startTime)),
      end: Math.min(endMin, timeToMinutes(s.endTime)),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of busy) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }

  const free: FreeSlot[] = [];
  let cursor = effectiveStart;
  for (const b of merged) {
    if (b.start - cursor >= minSlotMinutes) {
      free.push({
        date: dateStr,
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(b.start),
        durationMinutes: b.start - cursor,
      });
    }
    cursor = Math.max(cursor, b.end);
  }
  if (endMin - cursor >= minSlotMinutes) {
    free.push({
      date: dateStr,
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(endMin),
      durationMinutes: endMin - cursor,
    });
  }
  return free;
}
