import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Plus,
  Settings,
  Sparkles,
  Timer,
} from "lucide-react";
import type {
  ActiveStopwatch,
  AppSettings,
  ColorCardId,
  ScheduleItem,
  StudyGoal,
  StudySession,
} from "./types/dayflow";
import {
  DEFAULT_STOPWATCH,
  EMPTY_STATE,
  type DayFlowStateData,
  loadActiveStopwatch,
  loadDayFlowState,
  saveActiveStopwatch,
  saveDayFlowState,
} from "./lib/storage";
import { getTodayStr } from "./lib/dateUtils";
import {
  findDueReminders,
  fireReminderNotification,
  formatReminderBody,
  getReminderKey,
  syncScheduledPushReminders,
} from "./lib/notifications";
import { useTheme } from "./hooks/useTheme";
import { PlannerView } from "./components/PlannerView";
import { ScheduleModal } from "./components/ScheduleModal";
import { AITimetableTab } from "./components/AITimetableTab";
import { FocusTimerTab } from "./components/FocusTimerTab";
import { SettingsTab } from "./components/SettingsTab";
import { PWAInstallButton } from "./components/PWAInstallButton";
import { OfflineIndicator } from "./components/OfflineIndicator";

type AppTab = "planner" | "ai" | "timer" | "settings";

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<DayFlowStateData>(EMPTY_STATE);
  const [stopwatch, setStopwatch] = useState<ActiveStopwatch>(() => loadActiveStopwatch());
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    loadActiveStopwatch().isRunning ? "timer" : "planner"
  );
  const [timerFullscreen, setTimerFullscreen] = useState<boolean>(
    () => loadActiveStopwatch().isRunning
  );
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayStr());

  // Schedule Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string>(() => getTodayStr());
  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null);

  // Toast message
  const [toastMsg, setToastMsg] = useState<string>("");
  const toastTimerRef = useRef<number | null>(null);
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const stopwatchRunningRef = useRef<boolean>(stopwatch.isRunning);
  const wasHiddenRef = useRef<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg("");
    }, 3400);
  }, []);

  // Load persisted IndexedDB / localStorage state
  useEffect(() => {
    let mounted = true;
    loadDayFlowState().then((loaded) => {
      if (mounted) {
        setState(loaded);
        setHydrated(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Persist state changes
  useEffect(() => {
    if (!hydrated) return;
    saveDayFlowState(state);
  }, [state, hydrated]);

  // Persist active stopwatch changes
  useEffect(() => {
    stopwatchRunningRef.current = stopwatch.isRunning;
    saveActiveStopwatch(stopwatch);
  }, [stopwatch]);

  // When phone screen wakes up or PWA returns from background while measuring,
  // immediately display the live study stopwatch focus screen.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
        return;
      }
      if (document.visibilityState === "visible" && wasHiddenRef.current) {
        wasHiddenRef.current = false;
        if (stopwatchRunningRef.current) {
          setActiveTab("timer");
          setTimerFullscreen(true);
        }
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && stopwatchRunningRef.current) {
        setActiveTab("timer");
        setTimerFullscreen(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  // Auto 06:00~18:00 Light / 18:00~06:00 Dark theme hook
  const { isDark, isAutoDaytime } = useTheme(state.settings.themeMode);

  // Check scheduled reminders (foreground fallback) & sync to Web Push backend (background banner delivery)
  useEffect(() => {
    if (!hydrated) return;
    const checkReminders = () => {
      const due = findDueReminders(state.schedules, notifiedKeysRef.current);
      for (const item of due) {
        const key = getReminderKey(item);
        notifiedKeysRef.current.add(key);
        const desc = formatReminderBody(item);
        fireReminderNotification(`데이플로우 · ${item.title}`, desc, `dayflow-${key}`);
        showToast(`알림: ${item.title} (${desc})`);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkReminders();
        syncScheduledPushReminders(state.schedules).catch(() => {});
      }
    };
    checkReminders();
    syncScheduledPushReminders(state.schedules).catch(() => {});
    const timer = window.setInterval(checkReminders, 10_000);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hydrated, state.schedules, showToast]);

  const handleOpenNewSchedule = (defaultDate = selectedDate) => {
    setEditingItem(null);
    setModalDate(defaultDate);
    setModalOpen(true);
  };

  const handleOpenEditSchedule = (item: ScheduleItem) => {
    setEditingItem(item);
    setModalDate(item.date);
    setModalOpen(true);
  };

  const handleSaveSchedule = (item: ScheduleItem) => {
    setState((prev) => {
      const exists = prev.schedules.some((s) => s.id === item.id);
      return {
        ...prev,
        schedules: exists
          ? prev.schedules.map((s) => (s.id === item.id ? item : s))
          : [...prev.schedules, item],
      };
    });
    showToast(editingItem ? "일정이 수정되었습니다." : "새 일정이 등록되었습니다.");
  };

  const handleDeleteSchedule = (id: string) => {
    setState((prev) => ({
      ...prev,
      schedules: prev.schedules.filter((s) => s.id !== id),
    }));
    showToast("일정이 삭제되었습니다.");
  };

  const handleToggleComplete = (id: string) => {
    setState((prev) => ({
      ...prev,
      schedules: prev.schedules.map((s) =>
        s.id === id ? { ...s, completed: !s.completed, updatedAt: new Date().toISOString() } : s
      ),
    }));
  };

  const handleAddSchedulesBatch = (items: ScheduleItem[]) => {
    setState((prev) => ({
      ...prev,
      schedules: [...prev.schedules, ...items],
    }));
  };

  const handleAddStudyGoal = (goal: StudyGoal) => {
    setState((prev) => ({
      ...prev,
      studyGoals: [...prev.studyGoals, goal],
    }));
  };

  const handleDeleteStudyGoal = (id: string) => {
    setState((prev) => ({
      ...prev,
      studyGoals: prev.studyGoals.filter((g) => g.id !== id),
    }));
  };

  const handleUpdateStudyGoalColor = (id: string, color: ColorCardId) => {
    setState((prev) => ({
      ...prev,
      studyGoals: prev.studyGoals.map((g) => (g.id === id ? { ...g, color } : g)),
      schedules: prev.schedules.map((s) =>
        s.subjectId === id ? { ...s, color, updatedAt: new Date().toISOString() } : s
      ),
    }));
  };

  const handleStartStopwatchForItem = (item: ScheduleItem) => {
    if (stopwatch.isRunning) {
      showToast("이미 스톱워치가 실행 중입니다. 타이머 탭에서 확인하세요.");
      setActiveTab("timer");
      return;
    }
    setStopwatch({
      isRunning: true,
      subjectId: item.subjectId || item.id,
      subjectName: item.title,
      scheduleId: item.id,
      plannedMinutes: item.plannedMinutes || 50,
      startedAtEpoch: Date.now(),
      accumulatedSeconds: 0,
    });
    setActiveTab("timer");
    showToast(`"${item.title}" 실시간 스톱워치를 시작했습니다.`);
  };

  const handleSaveSession = (session: StudySession, markScheduleId?: string) => {
    setState((prev) => ({
      ...prev,
      studySessions: [session, ...prev.studySessions],
      schedules: markScheduleId
        ? prev.schedules.map((s) =>
            s.id === markScheduleId
              ? { ...s, completed: true, updatedAt: new Date().toISOString() }
              : s
          )
        : prev.schedules,
    }));
  };

  const handleUpdateSession = (updated: StudySession) => {
    setState((prev) => ({
      ...prev,
      studySessions: prev.studySessions.map((s) =>
        s.id === updated.id ? updated : s
      ),
    }));
    showToast(`${updated.subjectName} 공부 기록이 수정되었습니다.`);
  };

  const handleDeleteSession = (id: string) => {
    setState((prev) => ({
      ...prev,
      studySessions: prev.studySessions.filter((s) => s.id !== id),
    }));
    showToast("공부 기록이 삭제되었습니다.");
  };

  const handleUpdateSettings = (patch: Partial<AppSettings>) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  };

  const handleAddCustomSubType = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setState((prev) => {
      const current = prev.settings.customSubTypes || [];
      if (current.includes(trimmed)) return prev;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          customSubTypes: [...current, trimmed],
        },
      };
    });
  };

  const handleDeleteCustomSubType = (label: string) => {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        customSubTypes: (prev.settings.customSubTypes || []).filter((item) => item !== label),
      },
    }));
  };

  const handleRestoreBackup = (data: DayFlowStateData, mode: "replace" | "merge") => {
    if (mode === "replace") {
      setState(data);
      return;
    }
    setState((prev) => {
      const existingSchIds = new Set(prev.schedules.map((s) => s.id));
      const existingGoalIds = new Set(prev.studyGoals.map((g) => g.id));
      const existingSesIds = new Set(prev.studySessions.map((s) => s.id));
      const mergedSubTypes = Array.from(
        new Set([
          ...(prev.settings.customSubTypes || []),
          ...(data.settings.customSubTypes || []),
        ])
      );

      return {
        schedules: [
          ...prev.schedules,
          ...data.schedules.filter((s) => !existingSchIds.has(s.id)),
        ],
        studyGoals: [
          ...prev.studyGoals,
          ...data.studyGoals.filter((g) => !existingGoalIds.has(g.id)),
        ],
        studySessions: [
          ...prev.studySessions,
          ...data.studySessions.filter((s) => !existingSesIds.has(s.id)),
        ],
        settings: {
          ...prev.settings,
          customSubTypes: mergedSubTypes,
        },
      };
    });
  };

  const handleResetAllData = () => {
    setState(EMPTY_STATE);
    setStopwatch(DEFAULT_STOPWATCH);
  };

  const todayPersonalSchedules = useMemo(() => {
    const today = getTodayStr();
    return state.schedules.filter((s) => s.date === today && s.category === "personal");
  }, [state.schedules]);

  const navItems: Array<{ id: AppTab; label: string; icon: React.ReactNode }> = [
    { id: "planner", label: "플래너", icon: <CalendarDays className="w-5 h-5" /> },
    { id: "ai", label: "AI 시간표", icon: <Sparkles className="w-5 h-5" /> },
    { id: "timer", label: "타이머", icon: <Timer className="w-5 h-5" /> },
    { id: "settings", label: "설정", icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-200">
      {/* Top Bar: Clean 3-zone contract on desktop, compact <= 54px on mobile */}
      <header className="sticky top-0 z-30 pt-safe bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-13 lg:h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab("planner")}
            className="text-base lg:text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50 whitespace-nowrap shrink-0"
          >
            데이플로우
          </button>

          {/* Zone 2: Desktop Single-Line Nav Links */}
          <nav className="hidden lg:flex items-center gap-7" aria-label="주 메뉴">
            {navItems.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-2 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? "border-violet-600 text-violet-600 dark:text-violet-400 font-semibold"
                      : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  {tab.label}
                  {tab.id === "timer" && stopwatch.isRunning ? " (측정중)" : ""}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action (+ PWA Install button when not installed) */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton variant="compact" />
            </div>
            <button
              type="button"
              onClick={() => handleOpenNewSchedule(selectedDate)}
              className="min-h-[38px] lg:min-h-[40px] px-3.5 lg:px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs lg:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>일정 등록</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-10">
        {!hydrated ? (
          <div className="py-20 text-center text-sm text-zinc-500 dark:text-zinc-400">
            기기 내 일정을 불러오는 중...
          </div>
        ) : (
          <>
            {activeTab === "planner" && (
              <PlannerView
                schedules={state.schedules}
                settings={state.settings}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onAddSchedule={handleOpenNewSchedule}
                onEditSchedule={handleOpenEditSchedule}
                onToggleComplete={handleToggleComplete}
                onStartStopwatchForItem={handleStartStopwatchForItem}
                onOpenAITimetable={() => setActiveTab("ai")}
                onShowToast={showToast}
              />
            )}

            {activeTab === "ai" && (
              <AITimetableTab
                schedules={state.schedules}
                studyGoals={state.studyGoals}
                studySessions={state.studySessions}
                settings={state.settings}
                selectedDate={selectedDate}
                onAddSchedulesBatch={handleAddSchedulesBatch}
                onAddStudyGoal={handleAddStudyGoal}
                onUpdateStudyGoalColor={handleUpdateStudyGoalColor}
                onDeleteStudyGoal={handleDeleteStudyGoal}
                onShowToast={showToast}
              />
            )}

            {activeTab === "timer" && (
              <FocusTimerTab
                stopwatch={stopwatch}
                onUpdateStopwatch={setStopwatch}
                studyGoals={state.studyGoals}
                studySessions={state.studySessions}
                todayPersonalSchedules={todayPersonalSchedules}
                focusFullscreen={timerFullscreen}
                onSetFocusFullscreen={setTimerFullscreen}
                onSaveSession={handleSaveSession}
                onUpdateSession={handleUpdateSession}
                onDeleteSession={handleDeleteSession}
                onShowToast={showToast}
              />
            )}

            {activeTab === "settings" && (
              <SettingsTab
                state={state}
                isDark={isDark}
                isAutoDaytime={isAutoDaytime}
                onUpdateSettings={handleUpdateSettings}
                onImportIcsSchedules={handleAddSchedulesBatch}
                onRestoreBackup={handleRestoreBackup}
                onResetAllData={handleResetAllData}
                onShowToast={showToast}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Tab Bar (Thumb Zone) */}
      <nav
        aria-label="하단 내비게이션"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 pb-safe"
      >
        <div className="grid grid-cols-4 h-15 items-center">
          {navItems.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active
                    ? "text-violet-600 dark:text-violet-400"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                {tab.icon}
                <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                  {tab.label}
                  {tab.id === "timer" && stopwatch.isRunning ? " ●" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Schedule Create / Edit Modal */}
      <ScheduleModal
        isOpen={modalOpen}
        initialDate={modalDate}
        editingItem={editingItem}
        studyGoals={state.studyGoals}
        customSubTypes={state.settings.customSubTypes || []}
        onAddCustomSubType={handleAddCustomSubType}
        onDeleteCustomSubType={handleDeleteCustomSubType}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveSchedule}
        onDelete={handleDeleteSchedule}
        onNotifyPermissionHint={() =>
          showToast("브라우저 알림 권한이 차단되어 있어 인앱 알림 및 .ics VALARM만 저장됩니다.")
        }
      />

      {/* Offline Status Banner */}
      <OfflineIndicator />

      {/* Toast Notification */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 right-4 left-4 sm:left-auto sm:max-w-sm z-50 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-3 text-xs font-semibold shadow-xl"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
