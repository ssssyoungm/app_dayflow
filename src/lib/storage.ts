import type {
  ActiveStopwatch,
  AppSettings,
  DayFlowBackupPayload,
  ScheduleItem,
  StudyGoal,
  StudySession,
} from "../types/dayflow";

const DB_NAME = "dayflow_idb_v1";
const DB_VERSION = 1;
const STORE_NAME = "kv_store";
const LS_FALLBACK_KEY = "dayflow_state_snapshot_v1";
const STOPWATCH_LS_KEY = "dayflow_active_stopwatch_v1";

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: "auto",
  studyWindowStart: "08:00",
  studyWindowEnd: "23:00",
  notificationsEnabled: false,
  customSubTypes: [],
};

function normalizeSettings(raw?: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const uniqueSubTypes = Array.isArray(merged.customSubTypes)
    ? Array.from(
        new Set(
          merged.customSubTypes
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        )
      )
    : [];
  return {
    ...merged,
    customSubTypes: uniqueSubTypes,
  };
}

export const DEFAULT_STOPWATCH: ActiveStopwatch = {
  isRunning: false,
  subjectId: "",
  subjectName: "",
  plannedMinutes: 50,
  startedAtEpoch: null,
  accumulatedSeconds: 0,
};

export interface DayFlowStateData {
  schedules: ScheduleItem[];
  studyGoals: StudyGoal[];
  studySessions: StudySession[];
  settings: AppSettings;
}

export const EMPTY_STATE: DayFlowStateData = {
  schedules: [],
  studyGoals: [],
  studySessions: [],
  settings: DEFAULT_SETTINGS,
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet<T>(key: string, val: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(val, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadDayFlowState(): Promise<DayFlowStateData> {
  try {
    const fromIdb = await idbGet<DayFlowStateData>("app_state");
    if (fromIdb) {
      return {
        schedules: Array.isArray(fromIdb.schedules) ? fromIdb.schedules : [],
        studyGoals: Array.isArray(fromIdb.studyGoals) ? fromIdb.studyGoals : [],
        studySessions: Array.isArray(fromIdb.studySessions) ? fromIdb.studySessions : [],
        settings: normalizeSettings(fromIdb.settings),
      };
    }
  } catch {
    // Fallback to localStorage below
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DayFlowStateData>;
      return {
        schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
        studyGoals: Array.isArray(parsed.studyGoals) ? parsed.studyGoals : [],
        studySessions: Array.isArray(parsed.studySessions) ? parsed.studySessions : [],
        settings: normalizeSettings(parsed.settings),
      };
    }
  } catch {
    // Ignore corrupt localStorage
  }

  return EMPTY_STATE;
}

export async function saveDayFlowState(state: DayFlowStateData): Promise<void> {
  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(state));
  } catch {
    // Quota error ignored if IndexedDB succeeds
  }
  try {
    await idbSet("app_state", state);
  } catch {
    // IndexedDB unavailable (e.g. private browsing fallback uses localStorage)
  }
}

export function loadActiveStopwatch(): ActiveStopwatch {
  try {
    const raw = localStorage.getItem(STOPWATCH_LS_KEY);
    if (!raw) return DEFAULT_STOPWATCH;
    return { ...DEFAULT_STOPWATCH, ...(JSON.parse(raw) as Partial<ActiveStopwatch>) };
  } catch {
    return DEFAULT_STOPWATCH;
  }
}

export function saveActiveStopwatch(sw: ActiveStopwatch): void {
  try {
    localStorage.setItem(STOPWATCH_LS_KEY, JSON.stringify(sw));
  } catch {
    // ignore
  }
}

export function createBackupJson(state: DayFlowStateData): string {
  const payload: DayFlowBackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    schedules: state.schedules,
    studyGoals: state.studyGoals,
    studySessions: state.studySessions,
    settings: state.settings,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBackupJson(rawText: string): DayFlowStateData {
  const parsed = JSON.parse(rawText) as Partial<DayFlowBackupPayload>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.schedules)) {
    throw new Error("올바른 DayFlow JSON 백업 파일이 아닙니다.");
  }
  return {
    schedules: parsed.schedules,
    studyGoals: Array.isArray(parsed.studyGoals) ? parsed.studyGoals : [],
    studySessions: Array.isArray(parsed.studySessions) ? parsed.studySessions : [],
    settings: normalizeSettings(parsed.settings),
  };
}

export function generateId(prefix = "df"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
