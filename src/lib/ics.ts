import type { ScheduleItem } from "../types/dayflow";
import { CATEGORY_LABELS, PRIORITY_LABELS, formatSubTypeLabel } from "./colors";
import { KST_TIME_ZONE, addDays, getKstDateParts } from "./dateUtils";
import { generateId } from "./storage";

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function formatIcsDateTimeLocal(dateStr: string, timeStr: string): string {
  const cleanDate = dateStr.replace(/-/g, "");
  const cleanTime = timeStr.replace(/:/g, "").padEnd(4, "0") + "00";
  return `${cleanDate}T${cleanTime}`;
}

function formatIcsDateOnly(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

function formatUtcStamp(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

export function exportSchedulesToIcs(items: ScheduleItem[], calendarName = "데이플로우 (DayFlow)"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DayFlow//Mobile Study Planner//KO",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-TIMEZONE:${KST_TIME_ZONE}`,
    "CALSCALE:GREGORIAN",
  ];

  for (const item of items) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.id}@dayflow.app`);
    lines.push(`DTSTAMP:${formatUtcStamp(item.updatedAt)}`);

    if (item.isAllDay) {
      const start = formatIcsDateOnly(item.date);
      const end = formatIcsDateOnly(addDays(item.date, 1));
      lines.push(`DTSTART;VALUE=DATE:${start}`);
      lines.push(`DTEND;VALUE=DATE:${end}`);
    } else {
      lines.push(`DTSTART:${formatIcsDateTimeLocal(item.date, item.startTime)}`);
      lines.push(`DTEND:${formatIcsDateTimeLocal(item.date, item.endTime)}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(item.title)}`);
    const subTypeLabel = formatSubTypeLabel(item.subType);
    const metaDesc = [
      `구분: ${CATEGORY_LABELS[item.category]}${subTypeLabel ? ` (${subTypeLabel})` : ""}`,
      `우선순위: ${PRIORITY_LABELS[item.priority]}`,
      item.dueDate ? `마감일: ${item.dueDate}` : "",
      item.memo ? `메모: ${item.memo}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    lines.push(`DESCRIPTION:${escapeIcsText(metaDesc)}`);
    lines.push(
      `CATEGORIES:${subTypeLabel ? `${CATEGORY_LABELS[item.category]},${subTypeLabel}` : CATEGORY_LABELS[item.category]}`
    );
    lines.push(`PRIORITY:${item.priority === "high" ? 1 : item.priority === "medium" ? 5 : 9}`);

    if (item.notifyEnabled) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeIcsText(item.title)} 알림`);
      lines.push(`TRIGGER:-PT${Math.max(0, item.notifyMinutesBefore)}M`);
      lines.push("END:VALARM");
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function parseIcsDateValue(raw: string): { date: string; time: string; isAllDay: boolean } | null {
  const clean = raw.trim();
  const dateOnlyMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(clean);
  if (dateOnlyMatch) {
    return {
      date: `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`,
      time: "09:00",
      isAllDay: true,
    };
  }
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(clean);
  if (dtMatch) {
    if (dtMatch[7] === "Z") {
      const utc = new Date(
        Date.UTC(
          Number(dtMatch[1]),
          Number(dtMatch[2]) - 1,
          Number(dtMatch[3]),
          Number(dtMatch[4]),
          Number(dtMatch[5])
        )
      );
      const kst = getKstDateParts(utc);
      const y = kst.year;
      const m = String(kst.month).padStart(2, "0");
      const d = String(kst.day).padStart(2, "0");
      const hh = String(kst.hour).padStart(2, "0");
      const mm = String(kst.minute).padStart(2, "0");
      return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}`, isAllDay: false };
    }
    return {
      date: `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`,
      time: `${dtMatch[4]}:${dtMatch[5]}`,
      isAllDay: false,
    };
  }
  return null;
}

export function importSchedulesFromIcs(icsText: string): ScheduleItem[] {
  // Unfold RFC 5545 folded lines
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const imported: ScheduleItem[] = [];
  let inEvent = false;
  let inAlarm = false;
  let current: Record<string, string> = {};
  let hasAlarm = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      inAlarm = false;
      current = {};
      hasAlarm = false;
      continue;
    }
    if (trimmed === "BEGIN:VALARM") {
      inAlarm = true;
      hasAlarm = true;
      continue;
    }
    if (trimmed === "END:VALARM") {
      inAlarm = false;
      continue;
    }
    if (trimmed === "END:VEVENT") {
      inEvent = false;
      const start = parseIcsDateValue(current.DTSTART || "");
      if (start && current.SUMMARY) {
        const end = parseIcsDateValue(current.DTEND || "");
        const nowIso = new Date().toISOString();
        const cats = (current.CATEGORIES || "").toLowerCase();
        const isPersonal = cats.includes("개인") || cats.includes("공부") || cats.includes("personal") || cats.includes("study");
        const prioNum = Number(current.PRIORITY || 5);
        const priority = prioNum > 0 && prioNum <= 3 ? "high" : prioNum >= 7 ? "low" : "medium";

        const rawCatParts = (current.CATEGORIES || "")
          .split(",")
          .map((p) => unescapeIcsText(p).trim())
          .filter(Boolean);
        const importedSubType = rawCatParts.length >= 2 ? rawCatParts[1] : "";

        imported.push({
          id: generateId("ics"),
          title: unescapeIcsText(current.SUMMARY),
          category: isPersonal ? "personal" : "fixed",
          subType: importedSubType,
          priority,
          date: start.date,
          startTime: start.time,
          endTime: end && !end.isAllDay ? end.time : start.isAllDay ? "10:00" : "23:59",
          isAllDay: start.isAllDay,
          notifyEnabled: hasAlarm,
          notifyMinutesBefore: 10,
          color: isPersonal ? "violet" : "indigo",
          memo: current.DESCRIPTION ? unescapeIcsText(current.DESCRIPTION) : "",
          completed: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      continue;
    }

    if (inEvent && !inAlarm) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const keyPart = trimmed.slice(0, colonIdx).split(";")[0].toUpperCase();
        const val = trimmed.slice(colonIdx + 1);
        current[keyPart] = val;
      }
    }
  }

  return imported;
}

export function downloadTextFile(filename: string, content: string, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
