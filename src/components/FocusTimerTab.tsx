import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Sun,
} from "lucide-react";
import type {
  ActiveStopwatch,
  ScheduleItem,
  StudyGoal,
  StudySession,
} from "../types/dayflow";
import {
  formatDurationKo,
  formatStopwatchClock,
  getTodayStr,
} from "../lib/dateUtils";
import { generateId } from "../lib/storage";
import { StudyAnalyticsPanel } from "./StudyAnalyticsPanel";

interface FocusTimerTabProps {
  stopwatch: ActiveStopwatch;
  onUpdateStopwatch: (next: ActiveStopwatch) => void;
  studyGoals: StudyGoal[];
  studySessions: StudySession[];
  todayPersonalSchedules: ScheduleItem[];
  focusFullscreen: boolean;
  onSetFocusFullscreen: (open: boolean) => void;
  onSaveSession: (session: StudySession, markScheduleId?: string) => void;
  onDeleteSession: (id: string) => void;
  onShowToast: (msg: string) => void;
}

const DEFAULT_DOC_TITLE = "데이플로우 (DayFlow) — 스마트 일정 & 공부 플래너";

export const FocusTimerTab: React.FC<FocusTimerTabProps> = ({
  stopwatch,
  onUpdateStopwatch,
  studyGoals,
  studySessions,
  todayPersonalSchedules,
  focusFullscreen,
  onSetFocusFullscreen,
  onSaveSession,
  onDeleteSession,
  onShowToast,
}) => {
  const [tickNow, setTickNow] = useState<number>(() => Date.now());
  const [customSubject, setCustomSubject] = useState<string>("");
  const [sessionMemo, setSessionMemo] = useState<string>("");
  const [keepScreenAwake, setKeepScreenAwake] = useState<boolean>(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const supportsWakeLock =
    typeof navigator !== "undefined" && "wakeLock" in navigator;

  // Immediate clock tick & instant resync when waking phone screen
  useEffect(() => {
    if (!stopwatch.isRunning) return;
    const syncNow = () => setTickNow(Date.now());
    syncNow();
    const id = window.setInterval(syncNow, 500);
    const onVis = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", syncNow);
    window.addEventListener("focus", syncNow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", syncNow);
      window.removeEventListener("focus", syncNow);
    };
  }, [stopwatch.isRunning]);

  // Optional Screen Wake Lock (keeps screen on during desk study if user turns it on)
  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!supportsWakeLock) return;
    try {
      if (wakeLockRef.current) return;
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // Browser denied or battery saver active
    }
  }, [supportsWakeLock]);

  useEffect(() => {
    if (keepScreenAwake && stopwatch.isRunning) {
      acquireWakeLock();
      const handleVis = () => {
        if (document.visibilityState === "visible") {
          acquireWakeLock();
        }
      };
      document.addEventListener("visibilitychange", handleVis);
      return () => {
        document.removeEventListener("visibilitychange", handleVis);
        releaseWakeLock();
      };
    }
    releaseWakeLock();
    return undefined;
  }, [keepScreenAwake, stopwatch.isRunning, acquireWakeLock, releaseWakeLock]);

  const elapsedSeconds = useMemo(() => {
    if (!stopwatch.isRunning || !stopwatch.startedAtEpoch) {
      return stopwatch.accumulatedSeconds;
    }
    const delta = Math.max(0, Math.floor((tickNow - stopwatch.startedAtEpoch) / 1000));
    return stopwatch.accumulatedSeconds + delta;
  }, [stopwatch, tickNow]);

  const todayStr = getTodayStr();

  const todayTotalSeconds = useMemo(() => {
    const savedToday = studySessions
      .filter((s) => s.date === todayStr)
      .reduce((acc, s) => acc + (s.actualSeconds || s.actualMinutes * 60), 0);
    return savedToday + elapsedSeconds;
  }, [studySessions, todayStr, elapsedSeconds]);

  const activeSubjectLabel = stopwatch.subjectName || customSubject.trim() || "자율 집중 공부";
  const plannedSeconds = Math.max(60, (stopwatch.plannedMinutes || 50) * 60);
  const progressPct = Math.min(100, Math.round((elapsedSeconds / plannedSeconds) * 100));

  useEffect(() => {
    if (stopwatch.isRunning) {
      document.title = `${formatStopwatchClock(elapsedSeconds)} · ${activeSubjectLabel} | 데이플로우`;
    } else {
      document.title = DEFAULT_DOC_TITLE;
    }
    return () => {
      document.title = DEFAULT_DOC_TITLE;
    };
  }, [stopwatch.isRunning, elapsedSeconds, activeSubjectLabel]);

  const handleSelectTarget = (
    subjectId: string,
    subjectName: string,
    plannedMinutes: number,
    scheduleId?: string
  ) => {
    if (stopwatch.isRunning) {
      onShowToast("스톱워치를 먼저 일시정지하거나 저장한 뒤 과목을 변경하세요.");
      return;
    }
    onUpdateStopwatch({
      ...stopwatch,
      subjectId,
      subjectName,
      scheduleId,
      plannedMinutes,
    });
  };

  const handleToggleRun = () => {
    if (stopwatch.isRunning) {
      // Pause
      const now = Date.now();
      const delta = stopwatch.startedAtEpoch
        ? Math.max(0, Math.floor((now - stopwatch.startedAtEpoch) / 1000))
        : 0;
      onUpdateStopwatch({
        ...stopwatch,
        isRunning: false,
        startedAtEpoch: null,
        accumulatedSeconds: stopwatch.accumulatedSeconds + delta,
      });
    } else {
      // Start / Resume
      onUpdateStopwatch({
        ...stopwatch,
        isRunning: true,
        subjectName: stopwatch.subjectName || customSubject.trim() || "자율 집중 공부",
        startedAtEpoch: Date.now(),
      });
    }
  };

  const handleReset = () => {
    onUpdateStopwatch({
      ...stopwatch,
      isRunning: false,
      startedAtEpoch: null,
      accumulatedSeconds: 0,
    });
  };

  const handleSaveRecord = () => {
    const totalSecs = elapsedSeconds;
    if (totalSecs < 10) {
      onShowToast("최소 10초 이상 측정한 뒤 기록할 수 있습니다.");
      return;
    }

    const actualMinutes = Math.max(1, Math.round(totalSecs / 60));
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - totalSecs * 1000);

    const newSession: StudySession = {
      id: generateId("ses"),
      subjectId: stopwatch.subjectId || "adhoc",
      subjectName: activeSubjectLabel,
      scheduleId: stopwatch.scheduleId,
      date: todayStr,
      startedAt: startTime.toISOString(),
      endedAt: endTime.toISOString(),
      plannedMinutes: stopwatch.plannedMinutes || 50,
      actualMinutes,
      actualSeconds: totalSecs,
      memo: sessionMemo.trim() || undefined,
    };

    onSaveSession(newSession, stopwatch.scheduleId);
    setSessionMemo("");
    onUpdateStopwatch({
      isRunning: false,
      subjectId: stopwatch.subjectId,
      subjectName: stopwatch.subjectName,
      scheduleId: undefined,
      plannedMinutes: stopwatch.plannedMinutes,
      startedAtEpoch: null,
      accumulatedSeconds: 0,
    });
    onSetFocusFullscreen(false);
    onShowToast(`${activeSubjectLabel} ${formatDurationKo(actualMinutes)} 기록이 저장되었습니다.`);
  };

  // Fullscreen YPT-style desk focus overlay
  if (focusFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 text-zinc-50 flex flex-col justify-between p-6 pt-safe pb-safe">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-zinc-400">오늘 총 누적 공부</p>
            <p className="text-lg font-bold font-mono-num text-violet-400">
              {formatStopwatchClock(todayTotalSeconds)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {supportsWakeLock && (
              <button
                type="button"
                onClick={() => {
                  const next = !keepScreenAwake;
                  setKeepScreenAwake(next);
                  onShowToast(
                    next
                      ? "화면 꺼짐 방지가 켜졌습니다."
                      : "화면 꺼짐 방지가 꺼졌습니다. 화면을 껐다 켜면 측정 화면이 자동으로 열립니다."
                  );
                }}
                className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  keepScreenAwake
                    ? "border-violet-500 bg-violet-600/20 text-violet-300"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300"
                }`}
              >
                <Sun className="w-4 h-4" />
                <span>{keepScreenAwake ? "화면 유지중" : "화면 유지"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onSetFocusFullscreen(false)}
              className="min-h-[44px] px-4 rounded-xl border border-zinc-800 bg-zinc-900 text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
            >
              <Minimize2 className="w-4 h-4" />
              <span>축소</span>
            </button>
          </div>
        </div>

        <div className="my-auto text-center space-y-5">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-violet-300">{activeSubjectLabel}</p>
            {stopwatch.isRunning && (
              <p className="text-[11px] font-medium text-zinc-400">
                실시간 측정 중 · 화면이 꺼져도 시간은 정확히 누적됩니다
              </p>
            )}
          </div>
          <p className="text-6xl sm:text-8xl font-bold font-mono-num tracking-tight text-white">
            {formatStopwatchClock(elapsedSeconds)}
          </p>
          <div className="max-w-xs mx-auto space-y-1.5">
            <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-zinc-400 tabular-nums">
              목표 세션 {stopwatch.plannedMinutes}분 대비 {progressPct}%
            </p>
          </div>
        </div>

        <div className="max-w-md w-full mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={handleToggleRun}
            className="flex-1 min-h-[52px] rounded-2xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold flex items-center justify-center gap-2"
          >
            {stopwatch.isRunning ? (
              <>
                <Pause className="w-5 h-5" />
                <span>일시정지</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                <span>계속하기</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleSaveRecord}
            disabled={elapsedSeconds < 10}
            className="min-h-[52px] px-5 rounded-2xl border border-zinc-700 bg-zinc-900 text-zinc-100 disabled:opacity-40 text-sm font-semibold flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>기록 저장</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* LEFT / MAIN: YPT Stopwatch Card */}
      <div className="xl:col-span-5 xl:sticky xl:top-20 space-y-5">
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-50 p-6 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-400">오늘 누적 공부 시간</p>
              <p className="mt-0.5 text-2xl font-bold font-mono-num text-violet-400">
                {formatStopwatchClock(todayTotalSeconds)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {supportsWakeLock && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !keepScreenAwake;
                    setKeepScreenAwake(next);
                    onShowToast(
                      next
                        ? "측정 중 화면 꺼짐 방지가 켜졌습니다."
                        : "화면 꺼짐 방지가 꺼졌습니다."
                    );
                  }}
                  className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    keepScreenAwake
                      ? "border-violet-500 bg-violet-600/20 text-violet-300"
                      : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                  }`}
                  title="측정하는 동안 화면이 꺼지지 않도록 유지"
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{keepScreenAwake ? "화면 유지중" : "화면 유지"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onSetFocusFullscreen(true)}
                className="min-h-[40px] px-3.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>집중 전체화면</span>
              </button>
            </div>
          </div>

          {/* Active Subject Selector */}
          <div className="space-y-2">
            <p className="text-xs text-zinc-400">측정 과목 / 스케줄</p>
            <div className="flex flex-wrap gap-2">
              {todayPersonalSchedules
                .filter((s) => !s.completed)
                .map((item) => {
                  const selected = stopwatch.scheduleId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        handleSelectTarget(
                          item.subjectId || item.id,
                          item.title,
                          item.plannedMinutes || 50,
                          item.id
                        )
                      }
                      className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium transition-colors ${
                        selected
                          ? "border-violet-500 bg-violet-600 text-white"
                          : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
                      }`}
                    >
                      {item.title} ({item.startTime})
                    </button>
                  );
                })}

              {studyGoals.map((goal) => {
                const selected = !stopwatch.scheduleId && stopwatch.subjectId === goal.id;
                return (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() =>
                      handleSelectTarget(
                        goal.id,
                        goal.subjectName,
                        goal.defaultSessionMinutes,
                        undefined
                      )
                    }
                    className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium transition-colors ${
                      selected
                        ? "border-violet-500 bg-violet-600 text-white"
                        : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
                    }`}
                  >
                    {goal.subjectName}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={customSubject}
                onChange={(e) => {
                  setCustomSubject(e.target.value);
                  if (!stopwatch.isRunning && !stopwatch.subjectId) {
                    onUpdateStopwatch({
                      ...stopwatch,
                      subjectName: e.target.value,
                    });
                  }
                }}
                placeholder="직접 과목명 입력 (예: 미적분학 복습)"
                className="flex-1 min-h-[40px] rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <select
                value={stopwatch.plannedMinutes}
                onChange={(e) =>
                  onUpdateStopwatch({
                    ...stopwatch,
                    plannedMinutes: Number(e.target.value),
                  })
                }
                aria-label="목표 세션 길이"
                className="min-h-[40px] rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-200 tabular-nums"
              >
                <option value={25}>목표 25분</option>
                <option value={45}>목표 45분</option>
                <option value={50}>목표 50분</option>
                <option value={60}>목표 60분</option>
                <option value={90}>목표 90분</option>
                <option value={120}>목표 120분</option>
              </select>
            </div>
          </div>

          {/* Main Clock Display */}
          <div className="py-4 text-center space-y-3 border-y border-zinc-800/80">
            <p className="text-xs font-semibold text-violet-300">{activeSubjectLabel}</p>
            <p className="text-5xl sm:text-6xl font-bold font-mono-num tracking-tight text-white">
              {formatStopwatchClock(elapsedSeconds)}
            </p>
            <div className="max-w-sm mx-auto space-y-1.5">
              <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-400 tabular-nums">
                목표 {stopwatch.plannedMinutes}분 중 {progressPct}% 진행
              </p>
            </div>
          </div>

          {/* Memo + Action Buttons */}
          <div className="space-y-3">
            <input
              type="text"
              value={sessionMemo}
              onChange={(e) => setSessionMemo(e.target.value)}
              placeholder="공부 한 줄 메모 (예: 4단원 연습문제 15문항 완료)"
              className="w-full min-h-[40px] rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleToggleRun}
                className="flex-1 min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
              >
                {stopwatch.isRunning ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>일시정지</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>{elapsedSeconds > 0 ? "이어하기" : "공부 시작"}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSaveRecord}
                disabled={elapsedSeconds < 10}
                className="min-h-[48px] px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4 text-violet-400" />
                <span>기록 완료</span>
              </button>

              <button
                type="button"
                onClick={handleReset}
                disabled={elapsedSeconds === 0 && !stopwatch.isRunning}
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 disabled:opacity-30"
                aria-label="스톱워치 초기화"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

      </div>

      {/* RIGHT: Daily / Weekly / Monthly Study Analytics & Per-Subject Breakdown */}
      <div className="xl:col-span-7">
        <StudyAnalyticsPanel
          studyGoals={studyGoals}
          studySessions={studySessions}
          liveElapsedSeconds={elapsedSeconds}
          isStopwatchRunning={stopwatch.isRunning}
          onDeleteSession={onDeleteSession}
        />
      </div>
    </div>
  );
};
