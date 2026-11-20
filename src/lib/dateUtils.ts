import type { FreeSlot, ScheduleItem } from "../types/dayflow";

export const KST_TIME_ZONE = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export interface KstDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
}

/** Extracts exact Korea Standard Time (Asia/Seoul, UTC+9) date & clock parts */
export function getKstDateParts(date: Date = new Date()): KstDateParts {
  // Korea does not observe DST; UTC+9 is always exact and avoids ICU/browser TZ quirks.
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function formatUtcDateStr(utcDate: Date): string {
  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmdParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return {
    year: Number.isFinite(y) && y > 0 ? y : 2026,
    month: Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1,
    day: Number.isFinite(d) && d >= 1 && d <= 31 ? d : 1,
  };
}

/** Formats any Date instant as YYYY-MM-DD in Korea Standard Time (Asia/Seoul) */
export function toLocalDateStr(date: Date): string {
  const { year, month, day } = getKstDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses YYYY-MM-DD into a local calendar Date (safe for month/day/weekday getters) */
export function parseLocalDate(dateStr: string): Date {
  const { year, month, day } = parseYmdParts(dateStr);
  return new Date(year, month - 1, day);
}

/** Returns 0 (Sun) .. 6 (Sat) for YYYY-MM-DD using timezone-invariant UTC math */
export function getWeekdayIndex(dateStr: string): number {
  const { year, month, day } = parseYmdParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(dateStr: string, delta: number): string {
  const { year, month, day } = parseYmdParts(dateStr);
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return formatUtcDateStr(utc);
}

export function shiftMonthDate(dateStr: string, deltaMonths: number): string {
  const { year, month } = parseYmdParts(dateStr);
  const utc = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return formatUtcDateStr(utc);
}

/** Returns today's YYYY-MM-DD in Korea Standard Time (Asia/Seoul) */
export function getTodayStr(now: Date = new Date()): string {
  return toLocalDateStr(now);
}

/** Returns current hour (0..23) in Korea Standard Time */
export function getKstHour(date: Date = new Date()): number {
  return getKstDateParts(date).hour;
}

/** Returns current minutes since midnight (0..1439) in Korea Standard Time */
export function getKstNowMinutes(date: Date = new Date()): number {
  const { hour, minute } = getKstDateParts(date);
  return hour * 60 + minute;
}

/** Formats an ISO timestamp or Date as HH:mm in Korea Standard Time */
export function formatKstClock(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  const { hour, minute } = getKstDateParts(d);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Converts a KST YYYY-MM-DD and HH:mm pair into an exact UTC epoch timestamp (ms) */
export function kstDateTimeToEpoch(dateStr: string, hhmm: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const { year, month, day } = parseYmdParts(dateStr);
  const totalMinutes = timeToMinutes(hhmm);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0) - KST_OFFSET_MS;
}

/** Returns Monday..Sunday (7 YYYY-MM-DD strings) for the week containing dateStr */
export function getWeekDates(dateStr: string): string[] {
  const { year, month, day } = parseYmdParts(dateStr);
  const baseUtc = new Date(Date.UTC(year, month - 1, day));
  const dow = baseUtc.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  return Array.from({ length: 7 }, (_, i) => {
    const cur = new Date(Date.UTC(year, month - 1, day + diffToMon + i));
    return formatUtcDateStr(cur);
  });
}

/** Returns 42 cells (6 weeks, starting Sunday) for a month calendar grid */
export function getMonthGridDates(
  year: number,
  monthIndex0: number
): Array<{ dateStr: string; inMonth: boolean }> {
  const firstDayUtc = new Date(Date.UTC(year, monthIndex0, 1));
  const startOffset = firstDayUtc.getUTCDay(); // 0=Sun

  const cells: Array<{ dateStr: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const cur = new Date(Date.UTC(year, monthIndex0, 1 - startOffset + i));
    cells.push({
      dateStr: formatUtcDateStr(cur),
      inMonth: cur.getUTCMonth() === monthIndex0,
    });
  }
  return cells;
}

export function formatKoreanDateFull(dateStr: string): string {
  const { month, day } = parseYmdParts(dateStr);
  const wk = WEEKDAY_KO[getWeekdayIndex(dateStr)];
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

/** Finds free intervals (>= minSlotMinutes) on a given date inside [windowStart, windowEnd] in KST */
export function computeFreeSlotsForDate(
  dateStr: string,
  schedules: ScheduleItem[],
  windowStart = "08:00",
  windowEnd = "23:00",
  minSlotMinutes = 25
): FreeSlot[] {
  const startMin = timeToMinutes(windowStart);
  const rawEndMin = timeToMinutes(windowEnd);
  const endMin = rawEndMin === 0 ? 24 * 60 : rawEndMin;
  if (endMin <= startMin) return [];

  const isToday = dateStr === getTodayStr();
  const effectiveStart = isToday
    ? Math.max(startMin, Math.ceil(getKstNowMinutes() / 5) * 5)
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
