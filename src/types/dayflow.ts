export type ThemeMode = "auto" | "light" | "dark";

export type ScheduleCategory = "fixed" | "personal";

export type FixedSubType = "assignment" | "event" | "exam" | "class";
export type PersonalSubType = "study" | "routine";
export type ScheduleSubType = FixedSubType | PersonalSubType;

export type PriorityLevel = "high" | "medium" | "low";

export type ColorCardId =
  | "violet"
  | "indigo"
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "slate";

export interface ScheduleItem {
  id: string;
  title: string;
  category: ScheduleCategory;
  subType: ScheduleSubType;
  priority: PriorityLevel;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isAllDay: boolean;
  dueDate?: string; // YYYY-MM-DD optional deadline (마감일)
  notifyEnabled: boolean;
  notifyMinutesBefore: number; // 0, 10, 30, 60
  color: ColorCardId;
  memo: string;
  completed: boolean;
  subjectId?: string;
  plannedMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyGoal {
  id: string;
  subjectName: string;
  weeklyTargetMinutes: number;
  defaultSessionMinutes: number;
  color: ColorCardId;
  priority: PriorityLevel;
  createdAt: string;
}

export interface StudySession {
  id: string;
  subjectId: string;
  subjectName: string;
  scheduleId?: string;
  date: string; // YYYY-MM-DD
  startedAt: string; // ISO
  endedAt: string; // ISO
  plannedMinutes: number;
  actualMinutes: number;
  actualSeconds: number;
  memo?: string;
}

export interface ActiveStopwatch {
  isRunning: boolean;
  subjectId: string;
  subjectName: string;
  scheduleId?: string;
  plannedMinutes: number;
  startedAtEpoch: number | null; // Date.now() when started/resumed
  accumulatedSeconds: number;
}

export interface AppSettings {
  themeMode: ThemeMode;
  studyWindowStart: string; // HH:mm e.g. "08:00"
  studyWindowEnd: string; // HH:mm e.g. "23:00"
  notificationsEnabled: boolean;
}

export interface DayFlowBackupPayload {
  version: number;
  exportedAt: string;
  schedules: ScheduleItem[];
  studyGoals: StudyGoal[];
  studySessions: StudySession[];
  settings: AppSettings;
}

export interface ParsedTimetableBlock {
  title: string;
  category: ScheduleCategory;
  subType: ScheduleSubType;
  dayOfWeek: number | null; // 0=Sun..6=Sat
  specificDate: string | null; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  priority: PriorityLevel;
  memo: string;
  color?: ColorCardId;
}

export interface FreeSlot {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface AIStudyRecommendation {
  subjectId: string;
  subjectName: string;
  date: string;
  startTime: string;
  endTime: string;
  plannedMinutes: number;
  reason: string;
}
