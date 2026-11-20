import React, { useRef, useState } from "react";
import {
  Bell,
  Calendar,
  Download,
  Moon,
  RotateCcw,
  Sun,
  SunMoon,
  Upload,
} from "lucide-react";
import type { AppSettings, ScheduleItem, ThemeMode } from "../types/dayflow";
import type { DayFlowStateData } from "../lib/storage";
import { createBackupJson, parseBackupJson } from "../lib/storage";
import { downloadTextFile, exportSchedulesToIcs, importSchedulesFromIcs } from "../lib/ics";
import {
  ensurePushSubscription,
  fireReminderNotification,
  requestWebNotificationPermission,
  syncScheduledPushReminders,
} from "../lib/notifications";
import { getTodayStr } from "../lib/dateUtils";
import { PWAInstallButton } from "./PWAInstallButton";

interface SettingsTabProps {
  state: DayFlowStateData;
  isDark: boolean;
  isAutoDaytime: boolean;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onImportIcsSchedules: (items: ScheduleItem[]) => void;
  onRestoreBackup: (data: DayFlowStateData, mode: "replace" | "merge") => void;
  onResetAllData: () => void;
  onShowToast: (msg: string) => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  state,
  isDark,
  isAutoDaytime,
  onUpdateSettings,
  onImportIcsSchedules,
  onRestoreBackup,
  onResetAllData,
  onShowToast,
}) => {
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const icsInputRef = useRef<HTMLInputElement>(null);
  const [restoreMode, setRestoreMode] = useState<"replace" | "merge">("replace");
  const [confirmReset, setConfirmReset] = useState(false);

  const notifPermission =
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported";

  const handleRequestNotifications = async () => {
    const perm = await requestWebNotificationPermission();
    if (perm === "granted") {
      onUpdateSettings({ notificationsEnabled: true });
      await ensurePushSubscription();
      await syncScheduledPushReminders(state.schedules);
      fireReminderNotification("데이플로우 알림 활성화", "일정 시작 전 상단 배너 알림을 받을 수 있습니다.");
      onShowToast("웹 알림이 활성화되었습니다.");
    } else if (perm === "denied") {
      onShowToast("브라우저 설정에서 알림 권한이 차단되어 있습니다.");
    } else {
      onShowToast("아이폰에서는 Safari 공유 → 홈 화면에 추가한 앱에서 알림을 허용해 주세요.");
    }
  };

  const handleExportJson = () => {
    const json = createBackupJson(state);
    downloadTextFile(`dayflow_backup_${getTodayStr()}.json`, json, "application/json;charset=utf-8");
    onShowToast("JSON 백업 파일을 다운로드했습니다.");
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof reader.result !== "string") throw new Error("파일 읽기 실패");
        const parsed = parseBackupJson(reader.result);
        onRestoreBackup(parsed, restoreMode);
        onShowToast(
          restoreMode === "replace"
            ? `백업 복원 완료 (일정 ${parsed.schedules.length}건)`
            : `백업 병합 완료 (일정 ${parsed.schedules.length}건)`
        );
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : "올바른 JSON 백업 파일이 아닙니다.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleExportAllIcs = () => {
    if (state.schedules.length === 0) {
      onShowToast("내보낼 일정이 없습니다.");
      return;
    }
    const ics = exportSchedulesToIcs(state.schedules, "데이플로우 (DayFlow)");
    downloadTextFile(`dayflow_all_${getTodayStr()}.ics`, ics, "text/calendar;charset=utf-8");
    onShowToast(`${state.schedules.length}건의 일정을 .ics 파일로 내보냈습니다.`);
  };

  const handleImportIcs = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof reader.result !== "string") throw new Error("파일 읽기 실패");
        const parsed = importSchedulesFromIcs(reader.result);
        if (parsed.length === 0) {
          onShowToast(".ics 파일에서 가져올 수 있는 일정(VEVENT)을 찾지 못했습니다.");
          return;
        }
        onImportIcsSchedules(parsed);
        onShowToast(`.ics 파일에서 ${parsed.length}건의 일정을 가져왔습니다.`);
      } catch {
        onShowToast(".ics 파일 파싱 중 오류가 발생했습니다.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const themeOptions: Array<{
    id: ThemeMode;
    title: string;
    desc: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "auto",
      title: "자동 전환",
      desc: "오전 6시~오후 6시 화이트 · 오후 6시~새벽 6시 다크",
      icon: <SunMoon className="w-4 h-4" />,
    },
    {
      id: "light",
      title: "항상 화이트",
      desc: "시간대와 무관하게 밝은 화이트 배경 유지",
      icon: <Sun className="w-4 h-4" />,
    },
    {
      id: "dark",
      title: "항상 다크",
      desc: "시간대와 무관하게 어두운 다크 배경 유지",
      icon: <Moon className="w-4 h-4" />,
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* LEFT COLUMN: Theme, Study Window, iOS PWA */}
      <div className="space-y-6">
        {/* Theme Mode */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                화면 테마 설정
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                현재 적용 중: {isDark ? "다크 테마" : "화이트 테마"}{" "}
                {state.settings.themeMode === "auto" &&
                  `(${isAutoDaytime ? "주간 06:00~18:00" : "야간 18:00~06:00"})`}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {themeOptions.map((opt) => {
              const active = state.settings.themeMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdateSettings({ themeMode: opt.id })}
                  className={`w-full min-h-[56px] rounded-xl border px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors ${
                    active
                      ? "border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-zinc-900 dark:text-zinc-50"
                      : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`p-2 rounded-lg ${
                        active
                          ? "bg-violet-600 text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      }`}
                    >
                      {opt.icon}
                    </span>
                    <div>
                      <p className="text-xs font-bold">{opt.title}</p>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{opt.desc}</p>
                    </div>
                  </div>
                  {active && (
                    <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 shrink-0">
                      선택됨
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Preferred Study Hours */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              AI 공부 추천 가능 시간대
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              빈 시간대를 탐색할 때 이 시간 범위 안에서만 공부 스케줄을 추천합니다.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                시작 시각
              </label>
              <input
                type="time"
                value={state.settings.studyWindowStart}
                onChange={(e) => onUpdateSettings({ studyWindowStart: e.target.value })}
                className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                마감 시각
              </label>
              <input
                type="time"
                value={state.settings.studyWindowEnd}
                onChange={(e) => onUpdateSettings({ studyWindowEnd: e.target.value })}
                className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm tabular-nums"
              />
            </div>
          </div>
        </section>

        {/* iPhone Safari PWA Install */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-3">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            아이폰 Safari 홈 화면에 추가 (PWA)
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            별도 로그인 없이 기기 내부(IndexedDB)에 안전하게 저장되며, 홈 화면에 추가하면 오프라인에서도 앱처럼 빠르게 실행됩니다.
          </p>
          <PWAInstallButton variant="full" />
        </section>
      </div>

      {/* RIGHT COLUMN: Notifications, .ics Calendar Sync, JSON Backup/Restore */}
      <div className="space-y-6">
        {/* Notifications & .ics */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <Bell className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <span>웹 알림 및 캘린더(.ics) 연동</span>
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                현재 알림 권한:{" "}
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {notifPermission === "granted"
                    ? "허용됨"
                    : notifPermission === "denied"
                    ? "차단됨"
                    : notifPermission === "default"
                    ? "미설정"
                    : "지원되지 않음"}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleRequestNotifications}
              className="min-h-[40px] px-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              알림 권한 요청
            </button>
          </div>

          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              <span>Apple 캘린더 · Google 캘린더 (.ics) 가져오기 / 내보내기</span>
            </p>
            <input
              ref={icsInputRef}
              type="file"
              accept=".ics,text/calendar"
              onChange={handleImportIcs}
              className="hidden"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleExportAllIcs}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-800 dark:text-zinc-100 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <span>전체 일정 .ics 내보내기</span>
              </button>
              <button
                type="button"
                onClick={() => icsInputRef.current?.click()}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-800 dark:text-zinc-100 flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <span>.ics 파일 가져오기</span>
              </button>
            </div>
          </div>
        </section>

        {/* Local Storage JSON Backup / Restore */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              기기 내부 저장 백업 및 복원 (JSON)
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              현재 저장된 데이터: 일정 {state.schedules.length}건 · 공부 목표 {state.studyGoals.length}과목 · 측정 기록 {state.studySessions.length}건
            </p>
          </div>

          <input
            ref={jsonInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJson}
            className="hidden"
          />

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleExportJson}
              className="w-full min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>전체 데이터 JSON 백업 다운로드</span>
            </button>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  JSON 복원 방식
                </span>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-200/70 dark:bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => setRestoreMode("replace")}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                      restoreMode === "replace"
                        ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    덮어쓰기
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreMode("merge")}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                      restoreMode === "merge"
                        ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    병합하기
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => jsonInputRef.current?.click()}
                className="w-full min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-800 dark:text-zinc-100 flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <span>JSON 백업 파일 불러오기</span>
              </button>
            </div>
          </div>

          {/* Reset All Data */}
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              기기 내 모든 일정 및 기록 초기화
            </span>
            {confirmReset ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onResetAllData();
                    setConfirmReset(false);
                    onShowToast("모든 기기 내 저장 데이터가 초기화되었습니다.");
                  }}
                  className="min-h-[38px] px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
                >
                  초기화 실행
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>초기화</span>
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
