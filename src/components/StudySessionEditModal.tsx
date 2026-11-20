import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { StudySession } from "../types/dayflow";
import {
  formatDurationKo,
  formatKoreanDateFull,
  getKstDateParts,
  kstDateTimeToEpoch,
} from "../lib/dateUtils";

type EditTimeMode = "duration" | "timeRange";

interface StudySessionEditModalProps {
  session: StudySession;
  onSave: (updated: StudySession) => void;
  onClose: () => void;
}

function clampInt(val: string, min: number, max: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

function getInitialClockParts(session: StudySession) {
  const rawSeconds =
    typeof session.actualSeconds === "number" && session.actualSeconds > 0
      ? session.actualSeconds
      : Math.max(1, session.actualMinutes || 1) * 60;
  const initTotalMinutes = Math.max(1, Math.min(23 * 60 + 59, Math.round(rawSeconds / 60)));

  const startDate = new Date(session.startedAt);
  const endDate = new Date(session.endedAt);

  const startParts = Number.isNaN(startDate.getTime())
    ? { hour: 9, minute: 0 }
    : getKstDateParts(startDate);

  const endParts = Number.isNaN(endDate.getTime())
    ? {
        hour: Math.floor(((startParts.hour * 60 + startParts.minute + initTotalMinutes) % 1440) / 60),
        minute: (startParts.hour * 60 + startParts.minute + initTotalMinutes) % 60,
      }
    : getKstDateParts(endDate);

  return {
    initTotalMinutes,
    durHours: Math.floor(initTotalMinutes / 60),
    durMinutes: initTotalMinutes % 60,
    startHour: startParts.hour,
    startMinute: startParts.minute,
    endHour: endParts.hour,
    endMinute: endParts.minute,
  };
}

export const StudySessionEditModal: React.FC<StudySessionEditModalProps> = ({
  session,
  onSave,
  onClose,
}) => {
  const init = useMemo(() => getInitialClockParts(session), [session]);

  const [editMode, setEditMode] = useState<EditTimeMode>("duration");
  const [subjectName, setSubjectName] = useState<string>(session.subjectName || "");
  const [memo, setMemo] = useState<string>(session.memo || "");
  const [includeInTotal, setIncludeInTotal] = useState<boolean>(
    session.includeInTotal !== false
  );

  // Duration inputs (hours & minutes)
  const [durHoursStr, setDurHoursStr] = useState<string>(String(init.durHours));
  const [durMinutesStr, setDurMinutesStr] = useState<string>(String(init.durMinutes));

  // Start & end KST clock inputs (hour & minute)
  const [startHourStr, setStartHourStr] = useState<string>(pad2(init.startHour));
  const [startMinStr, setStartMinStr] = useState<string>(pad2(init.startMinute));
  const [endHourStr, setEndHourStr] = useState<string>(pad2(init.endHour));
  const [endMinStr, setEndMinStr] = useState<string>(pad2(init.endMinute));

  const [errorMsg, setErrorMsg] = useState<string>("");

  const syncEndFromDuration = (
    nextDurHStr: string,
    nextDurMStr: string,
    curStartHStr = startHourStr,
    curStartMStr = startMinStr
  ) => {
    const dH = clampInt(nextDurHStr || "0", 0, 23);
    const dM = clampInt(nextDurMStr || "0", 0, 59);
    const total = dH * 60 + dM;
    if (total <= 0) return;
    const sH = clampInt(curStartHStr || "0", 0, 23);
    const sM = clampInt(curStartMStr || "0", 0, 59);
    const endTotal = (sH * 60 + sM + total) % 1440;
    setEndHourStr(pad2(Math.floor(endTotal / 60)));
    setEndMinStr(pad2(endTotal % 60));
  };

  const syncDurationFromRange = (
    sHStr: string,
    sMStr: string,
    eHStr: string,
    eMStr: string
  ) => {
    const sH = clampInt(sHStr || "0", 0, 23);
    const sM = clampInt(sMStr || "0", 0, 59);
    const eH = clampInt(eHStr || "0", 0, 23);
    const eM = clampInt(eMStr || "0", 0, 59);
    const startTotal = sH * 60 + sM;
    const endTotal = eH * 60 + eM;
    if (startTotal === endTotal) {
      setDurHoursStr("0");
      setDurMinutesStr("0");
      return;
    }
    const diff = endTotal > startTotal ? endTotal - startTotal : endTotal + 1440 - startTotal;
    setDurHoursStr(String(Math.floor(diff / 60)));
    setDurMinutesStr(String(diff % 60));
  };

  const preview = useMemo(() => {
    const sH = clampInt(startHourStr || "0", 0, 23);
    const sM = clampInt(startMinStr || "0", 0, 59);
    const eH = clampInt(endHourStr || "0", 0, 23);
    const eM = clampInt(endMinStr || "0", 0, 59);
    const startTotal = sH * 60 + sM;
    const endTotal = eH * 60 + eM;

    if (editMode === "duration") {
      const dH = clampInt(durHoursStr || "0", 0, 23);
      const dM = clampInt(durMinutesStr || "0", 0, 59);
      const totalMinutes = dH * 60 + dM;
      const computedEndTotal = startTotal + totalMinutes;
      const crossesMidnight = computedEndTotal >= 1440;
      const endMod = computedEndTotal % 1440;
      return {
        totalMinutes,
        startClock: `${pad2(sH)}:${pad2(sM)}`,
        endClock: `${pad2(Math.floor(endMod / 60))}:${pad2(endMod % 60)}`,
        crossesMidnight,
        isSameTimeError: false,
      };
    }

    if (startTotal === endTotal) {
      return {
        totalMinutes: 0,
        startClock: `${pad2(sH)}:${pad2(sM)}`,
        endClock: `${pad2(eH)}:${pad2(eM)}`,
        crossesMidnight: false,
        isSameTimeError: true,
      };
    }

    const crossesMidnight = endTotal < startTotal;
    const totalMinutes = crossesMidnight ? endTotal + 1440 - startTotal : endTotal - startTotal;
    return {
      totalMinutes,
      startClock: `${pad2(sH)}:${pad2(sM)}`,
      endClock: `${pad2(eH)}:${pad2(eM)}`,
      crossesMidnight,
      isSameTimeError: false,
    };
  }, [editMode, durHoursStr, durMinutesStr, startHourStr, startMinStr, endHourStr, endMinStr]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (preview.isSameTimeError) {
      setErrorMsg("시작 시각과 종료 시각이 같습니다. 종료 시각을 다르게 입력해 주세요.");
      return;
    }
    if (preview.totalMinutes < 1) {
      setErrorMsg("공부 시간은 최소 1분 이상이어야 합니다.");
      return;
    }
    if (preview.totalMinutes >= 24 * 60) {
      setErrorMsg("공부 시간은 23시간 59분 이하로 입력해 주세요.");
      return;
    }

    const startEpoch =
      kstDateTimeToEpoch(session.date, preview.startClock) ??
      (Number.isNaN(new Date(session.startedAt).getTime())
        ? Date.now() - preview.totalMinutes * 60_000
        : new Date(session.startedAt).getTime());
    const endEpoch = startEpoch + preview.totalMinutes * 60_000;

    const nextSubjectName =
      subjectName.trim() || session.subjectName || "자율 집중 공부";
    const subjectChanged =
      nextSubjectName !== (session.subjectName || "").trim();

    onSave({
      ...session,
      subjectId: subjectChanged ? "adhoc" : session.subjectId,
      subjectName: nextSubjectName,
      startedAt: new Date(startEpoch).toISOString(),
      endedAt: new Date(endEpoch).toISOString(),
      actualMinutes: preview.totalMinutes,
      actualSeconds: preview.totalMinutes * 60,
      includeInTotal,
      memo: memo.trim() || undefined,
    });
  };

  const handleNumericField = (raw: string, max: number): string => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 2);
    if (digits === "") return "";
    return String(Math.min(max, Number(digits)));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-session-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h3
              id="edit-session-modal-title"
              className="text-base font-bold text-zinc-950 dark:text-zinc-50"
            >
              공부 측정 기록 수정
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              {formatKoreanDateFull(session.date)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Subject Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              과목 / 활동명
            </label>
            <input
              type="text"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="과목명을 입력하세요"
              className="w-full min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* Mode Toggle: Duration Directly vs Start/End Clock */}
          <div className="space-y-2.5">
            <div
              role="tablist"
              aria-label="시간 수정 방식 선택"
              className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900"
            >
              <button
                type="button"
                role="tab"
                aria-selected={editMode === "duration"}
                onClick={() => {
                  setEditMode("duration");
                  setErrorMsg("");
                }}
                className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  editMode === "duration"
                    ? "bg-white dark:bg-zinc-800 text-violet-700 dark:text-violet-300 shadow-xs"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                공부 시간 직접 수정
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editMode === "timeRange"}
                onClick={() => {
                  setEditMode("timeRange");
                  setErrorMsg("");
                }}
                className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  editMode === "timeRange"
                    ? "bg-white dark:bg-zinc-800 text-violet-700 dark:text-violet-300 shadow-xs"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                시작 · 종료 시각 수정
              </button>
            </div>

            {editMode === "duration" ? (
              <div className="space-y-2">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  시작·종료 시각이 기억나지 않을 때 총 공부 시간의 시간과 분을 바로 수정하세요.
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 min-h-[46px] focus-within:ring-2 focus-within:ring-violet-500">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={23}
                      value={durHoursStr}
                      onChange={(e) => {
                        const next = handleNumericField(e.target.value, 23);
                        setDurHoursStr(next);
                        setErrorMsg("");
                        syncEndFromDuration(next, durMinutesStr);
                      }}
                      onBlur={() => {
                        const h = clampInt(durHoursStr || "0", 0, 23);
                        setDurHoursStr(String(h));
                        syncEndFromDuration(String(h), durMinutesStr);
                      }}
                      aria-label="공부 시간 (시간)"
                      className="w-full bg-transparent text-right text-base font-bold text-zinc-950 dark:text-zinc-50 tabular-nums focus:outline-none"
                    />
                    <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 shrink-0">
                      시간
                    </span>
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 min-h-[46px] focus-within:ring-2 focus-within:ring-violet-500">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={59}
                      value={durMinutesStr}
                      onChange={(e) => {
                        const next = handleNumericField(e.target.value, 59);
                        setDurMinutesStr(next);
                        setErrorMsg("");
                        syncEndFromDuration(durHoursStr, next);
                      }}
                      onBlur={() => {
                        const m = clampInt(durMinutesStr || "0", 0, 59);
                        setDurMinutesStr(String(m));
                        syncEndFromDuration(durHoursStr, String(m));
                      }}
                      aria-label="공부 시간 (분)"
                      className="w-full bg-transparent text-right text-base font-bold text-zinc-950 dark:text-zinc-50 tabular-nums focus:outline-none"
                    />
                    <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 shrink-0">
                      분
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  대한민국 시각(24시간제) 기준으로 시작 시각과 끝낸 시각을 시간·분 단위로 수정하세요.
                </p>

                {/* Start Clock */}
                <div className="space-y-1">
                  <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    공부 시작 시각
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 min-h-[44px] focus-within:ring-2 focus-within:ring-violet-500">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={23}
                        value={startHourStr}
                        onChange={(e) => {
                          const next = handleNumericField(e.target.value, 23);
                          setStartHourStr(next);
                          setErrorMsg("");
                          syncDurationFromRange(next, startMinStr, endHourStr, endMinStr);
                        }}
                        onBlur={() => {
                          const v = pad2(clampInt(startHourStr || "0", 0, 23));
                          setStartHourStr(v);
                          syncDurationFromRange(v, startMinStr, endHourStr, endMinStr);
                        }}
                        aria-label="시작 시"
                        className="w-full bg-transparent text-right text-sm font-bold text-zinc-950 dark:text-zinc-50 tabular-nums focus:outline-none"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">시</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 min-h-[44px] focus-within:ring-2 focus-within:ring-violet-500">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={59}
                        value={startMinStr}
                        onChange={(e) => {
                          const next = handleNumericField(e.target.value, 59);
                          setStartMinStr(next);
                          setErrorMsg("");
                          syncDurationFromRange(startHourStr, next, endHourStr, endMinStr);
                        }}
                        onBlur={() => {
                          const v = pad2(clampInt(startMinStr || "0", 0, 59));
                          setStartMinStr(v);
                          syncDurationFromRange(startHourStr, v, endHourStr, endMinStr);
                        }}
                        aria-label="시작 분"
                        className="w-full bg-transparent text-right text-sm font-bold text-zinc-950 dark:text-zinc-50 tabular-nums focus:outline-none"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">분</span>
                    </div>
                  </div>
                </div>

                {/* End Clock */}
                <div className="space-y-1">
                  <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    공부 끝낸 시각
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 min-h-[44px] focus-within:ring-2 focus-within:ring-violet-500">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={23}
                        value={endHourStr}
                        onChange={(e) => {
                          const next = handleNumericField(e.target.value, 23);
                          setEndHourStr(next);
                          setErrorMsg("");
                          syncDurationFromRange(startHourStr, startMinStr, next, endMinStr);
                        }}
                        onBlur={() => {
                          const v = pad2(clampInt(endHourStr || "0", 0, 23));
                          setEndHourStr(v);
                          syncDurationFromRange(startHourStr, startMinStr, v, endMinStr);
                        }}
                        aria-label="종료 시"
                        className="w-full bg-transparent text-right text-sm font-bold text-zinc-950 dark:text-zinc-50 tabular-nums focus:outline-none"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">시</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 min-h-[44px] focus-within:ring-2 focus-within:ring-violet-500">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={59}
                        value={endMinStr}
                        onChange={(e) => {
                          const next = handleNumericField(e.target.value, 59);
                          setEndMinStr(next);
                          setErrorMsg("");
                          syncDurationFromRange(startHourStr, startMinStr, endHourStr, next);
                        }}
                        onBlur={() => {
                          const v = pad2(clampInt(endMinStr || "0", 0, 59));
                          setEndMinStr(v);
                          syncDurationFromRange(startHourStr, startMinStr, endHourStr, v);
                        }}
                        aria-label="종료 분"
                        className="w-full bg-transparent text-right text-sm font-bold text-zinc-950 dark:text-zinc-50 tabular-nums focus:outline-none"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">분</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Live Calculation Preview */}
            <div className="rounded-xl bg-violet-50/70 dark:bg-violet-950/35 border border-violet-200/70 dark:border-violet-800/60 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs tabular-nums">
              <span className="text-zinc-600 dark:text-zinc-300">
                {preview.startClock} ~{" "}
                {preview.crossesMidnight ? `다음 날 ${preview.endClock}` : preview.endClock}
              </span>
              <span className="font-bold text-violet-700 dark:text-violet-300">
                {preview.totalMinutes > 0
                  ? `총 ${formatDurationKo(preview.totalMinutes)}`
                  : "0분"}
              </span>
            </div>
          </div>

          {/* Include in total study time */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeInTotal}
              onChange={(e) => setIncludeInTotal(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-violet-600 cursor-pointer shrink-0"
            />
            <span className="text-xs text-zinc-700 dark:text-zinc-300 leading-snug">
              총 공부 시간에 포함
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                체크 해제 시 과목별·측정 기록에는 남고 총 공부 시간 합계에서는 제외됩니다.
              </span>
            </span>
          </label>

          {/* Memo */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              메모 (선택)
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="공부 내용 한 줄 메모"
              className="w-full min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{errorMsg}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition-colors"
            >
              수정 저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
