import React, { useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  Clock,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AIStudyRecommendation,
  AppSettings,
  ColorCardId,
  FreeSlot,
  ParsedTimetableBlock,
  PriorityLevel,
  ScheduleItem,
  StudyGoal,
  StudySession,
} from "../types/dayflow";
import { COLOR_CARD_LIST, COLOR_CARDS, PRIORITY_LABELS, SUBTYPE_LABELS } from "../lib/colors";
import {
  WEEKDAY_KO,
  addDays,
  computeFreeSlotsForDate,
  formatDurationKo,
  formatKoreanDateFull,
  getTodayStr,
  getWeekDates,
  parseLocalDate,
} from "../lib/dateUtils";
import { generateId } from "../lib/storage";

interface AITimetableTabProps {
  schedules: ScheduleItem[];
  studyGoals: StudyGoal[];
  studySessions: StudySession[];
  settings: AppSettings;
  selectedDate: string;
  onAddSchedulesBatch: (items: ScheduleItem[]) => void;
  onAddStudyGoal: (goal: StudyGoal) => void;
  onDeleteStudyGoal: (id: string) => void;
  onShowToast: (msg: string) => void;
}

interface ReviewBlock extends ParsedTimetableBlock {
  tempId: string;
  selected: boolean;
}

export const AITimetableTab: React.FC<AITimetableTabProps> = ({
  schedules,
  studyGoals,
  studySessions,
  settings,
  selectedDate,
  onAddSchedulesBatch,
  onAddStudyGoal,
  onDeleteStudyGoal,
  onShowToast,
}) => {
  // ---- 1. Everytime Timetable Photo Recognition State ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageMime, setImageMime] = useState<string>("image/png");
  const [parsingImage, setParsingImage] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parseSummary, setParseSummary] = useState("");
  const [reviewBlocks, setReviewBlocks] = useState<ReviewBlock[]>([]);
  const [repeatWeeks, setRepeatWeeks] = useState<number>(1);
  const [baseWeekDate, setBaseWeekDate] = useState<string>(selectedDate || getTodayStr());

  // ---- 2. Study Goal Form State ----
  const [subjectName, setSubjectName] = useState("");
  const [weeklyTargetHours, setWeeklyTargetHours] = useState("6");
  const [defaultSessionMins, setDefaultSessionMins] = useState("50");
  const [goalPriority, setGoalPriority] = useState<PriorityLevel>("high");
  const [goalColor, setGoalColor] = useState<ColorCardId>("violet");

  // ---- 3. Adaptive AI Study Recommendation State ----
  const [recommendScope, setRecommendScope] = useState<"day" | "week">("day");
  const [recommendDate, setRecommendDate] = useState<string>(selectedDate || getTodayStr());
  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState("");
  const [strategySummary, setStrategySummary] = useState("");
  const [recommendations, setRecommendations] = useState<AIStudyRecommendation[]>([]);

  const weekDatesForRec = useMemo(() => getWeekDates(recommendDate), [recommendDate]);

  // Compute real YPT stopwatch stats per StudyGoal
  const subjectStats = useMemo(() => {
    const weekSet = new Set(getWeekDates(getTodayStr()));
    return studyGoals.map((g) => {
      const sessions = studySessions.filter((s) => s.subjectId === g.id);
      const completedThisWeekMinutes = sessions
        .filter((s) => weekSet.has(s.date))
        .reduce((acc, s) => acc + s.actualMinutes, 0);

      const totalPlanned = sessions.reduce((acc, s) => acc + Math.max(1, s.plannedMinutes), 0);
      const totalActual = sessions.reduce((acc, s) => acc + s.actualMinutes, 0);
      const actualToPlannedRatio =
        sessions.length > 0 && totalPlanned > 0 ? totalActual / totalPlanned : 1.0;

      return {
        goal: g,
        completedThisWeekMinutes,
        actualToPlannedRatio,
        sessionCount: sessions.length,
      };
    });
  }, [studyGoals, studySessions]);

  // Free slots computed cleanly on client
  const availableFreeSlots = useMemo<FreeSlot[]>(() => {
    const targetDates = recommendScope === "day" ? [recommendDate] : weekDatesForRec;
    return targetDates.flatMap((d) =>
      computeFreeSlotsForDate(d, schedules, settings.studyWindowStart, settings.studyWindowEnd, 25)
    );
  }, [recommendScope, recommendDate, weekDatesForRec, schedules, settings.studyWindowStart, settings.studyWindowEnd]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setReviewBlocks([]);
    setParseSummary("");
    setImageMime(file.type || "image/png");

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImagePreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleParseImage = async () => {
    if (!imagePreview) return;
    setParsingImage(true);
    setParseError("");
    try {
      const res = await fetch("/api/timetable/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imagePreview,
          mimeType: imageMime,
          referenceDate: baseWeekDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "시간표 인식에 실패했습니다.");
      }
      const items: ParsedTimetableBlock[] = Array.isArray(data.items) ? data.items : [];
      const paletteCycle: ColorCardId[] = ["violet", "indigo", "sky", "emerald", "amber", "rose"];
      setParseSummary(data.summary || "");
      setReviewBlocks(
        items.map((it, idx) => ({
          ...it,
          tempId: generateId("ai"),
          selected: true,
          color: it.color || paletteCycle[idx % paletteCycle.length],
        }))
      );
      if (items.length === 0) {
        setParseError("이미지에서 일정 항목을 찾지 못했습니다. 더 선명한 캡처 이미지로 다시 시도해 주세요.");
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "네트워크 오류가 발생했습니다.");
    } finally {
      setParsingImage(false);
    }
  };

  const handleApplyParsedBlocks = () => {
    const chosen = reviewBlocks.filter((b) => b.selected);
    if (chosen.length === 0) return;

    const baseWeek = getWeekDates(baseWeekDate); // index 0 = Mon .. 6 = Sun
    const nowIso = new Date().toISOString();
    const created: ScheduleItem[] = [];

    for (const block of chosen) {
      if (block.specificDate) {
        created.push({
          id: generateId("tt"),
          title: block.title,
          category: block.category === "personal" ? "personal" : "fixed",
          subType: block.subType || "class",
          priority: block.priority || "medium",
          date: block.specificDate,
          startTime: block.startTime || "09:00",
          endTime: block.endTime || "10:00",
          isAllDay: false,
          notifyEnabled: false,
          notifyMinutesBefore: 10,
          color: block.color || "violet",
          memo: block.memo || "",
          completed: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      } else {
        // dayOfWeek: 0=Sun..6=Sat -> map to baseWeek (Mon=0..Sun=6)
        const dow = typeof block.dayOfWeek === "number" ? block.dayOfWeek : 1;
        const weekIdx = dow === 0 ? 6 : dow - 1;
        const firstDate = baseWeek[weekIdx] || baseWeekDate;

        for (let w = 0; w < repeatWeeks; w++) {
          const targetDate = addDays(firstDate, w * 7);
          created.push({
            id: generateId("tt"),
            title: block.title,
            category: block.category === "personal" ? "personal" : "fixed",
            subType: block.subType || "class",
            priority: block.priority || "medium",
            date: targetDate,
            startTime: block.startTime || "09:00",
            endTime: block.endTime || "10:00",
            isAllDay: false,
            notifyEnabled: false,
            notifyMinutesBefore: 10,
            color: block.color || "violet",
            memo: block.memo || "",
            completed: false,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }
    }

    onAddSchedulesBatch(created);
    onShowToast(`${created.length}개의 타임블록을 플래너에 배치했습니다.`);
    setReviewBlocks([]);
    setParseSummary("");
    setImagePreview("");
  };

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const name = subjectName.trim();
    if (!name) return;

    const hours = Math.max(0.5, Number(weeklyTargetHours) || 3);
    const sessionMins = Math.max(15, Math.min(180, Number(defaultSessionMins) || 50));

    onAddStudyGoal({
      id: generateId("goal"),
      subjectName: name,
      weeklyTargetMinutes: Math.round(hours * 60),
      defaultSessionMinutes: sessionMins,
      color: goalColor,
      priority: goalPriority,
      createdAt: new Date().toISOString(),
    });
    setSubjectName("");
    onShowToast(`"${name}" 공부 목표가 추가되었습니다.`);
  };

  const handleGenerateRecommendations = async () => {
    if (studyGoals.length === 0) {
      setRecommendError("먼저 공부 목표 과목을 1개 이상 등록해 주세요.");
      return;
    }
    if (availableFreeSlots.length === 0) {
      setRecommendError("선택한 기간의 공부 가능 시간대 안에 남은 빈 시간대가 없습니다.");
      return;
    }

    setRecommending(true);
    setRecommendError("");
    setRecommendations([]);
    setStrategySummary("");

    try {
      const targetDatesSet = new Set(
        recommendScope === "day" ? [recommendDate] : weekDatesForRec
      );
      const existingEvents = schedules
        .filter((s) => targetDatesSet.has(s.date))
        .map((s) => ({
          title: s.title,
          category: s.category,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          priority: s.priority,
        }));

      const res = await fetch("/api/study/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDate: recommendDate,
          mode: recommendScope,
          freeSlots: availableFreeSlots,
          existingEvents,
          studyGoals: subjectStats.map((st) => ({
            id: st.goal.id,
            subjectName: st.goal.subjectName,
            weeklyTargetMinutes: st.goal.weeklyTargetMinutes,
            defaultSessionMinutes: st.goal.defaultSessionMinutes,
            priority: st.goal.priority,
            completedThisWeekMinutes: st.completedThisWeekMinutes,
            actualToPlannedRatio: st.actualToPlannedRatio,
            sessionCount: st.sessionCount,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "공부 추천 생성에 실패했습니다.");
      }

      setStrategySummary(data.strategySummary || "");
      setRecommendations(Array.isArray(data.recommendations) ? data.recommendations : []);
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : "네트워크 오류가 발생했습니다.");
    } finally {
      setRecommending(false);
    }
  };

  const handleAcceptRecommendations = (list: AIStudyRecommendation[]) => {
    if (list.length === 0) return;
    const nowIso = new Date().toISOString();
    const newItems: ScheduleItem[] = list.map((rec) => {
      const matchedGoal = studyGoals.find(
        (g) => g.id === rec.subjectId || g.subjectName === rec.subjectName
      );
      return {
        id: generateId("rec"),
        title: `${rec.subjectName} 집중 공부`,
        category: "personal",
        subType: "study",
        priority: matchedGoal?.priority || "medium",
        date: rec.date,
        startTime: rec.startTime,
        endTime: rec.endTime,
        isAllDay: false,
        notifyEnabled: true,
        notifyMinutesBefore: 10,
        color: matchedGoal?.color || "violet",
        memo: rec.reason,
        completed: false,
        subjectId: matchedGoal?.id,
        plannedMinutes: rec.plannedMinutes,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    });

    onAddSchedulesBatch(newItems);
    setRecommendations((prev) =>
      prev.filter((r) => !list.some((acc) => acc.date === r.date && acc.startTime === r.startTime))
    );
    onShowToast(`${newItems.length}개의 추천 공부 스케줄을 개인 일정에 배치했습니다.`);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      {/* ================= LEFT: EVERYTIME TIMETABLE AI PHOTO PARSER ================= */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Camera className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span>에브리타임 시간표 · 일정 사진 AI 인식</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            에브리타임 시간표 캡처나 강의계획서·공지 사진을 올리면 Gemini AI가 요일과 시간을 분석해 타임블록으로 자동 배치합니다.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />

        {!imagePreview ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/50 hover:border-violet-500 dark:hover:border-violet-500 py-10 px-4 flex flex-col items-center justify-center gap-2 transition-colors"
          >
            <ImagePlus className="w-7 h-7 text-violet-600 dark:text-violet-400" />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              시간표 또는 일정 사진 선택하기
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              아이폰 사진 보관함 · 스크린샷(PNG, JPG) 지원
            </span>
          </button>
        ) : (
          <div className="space-y-3">
            <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-100 dark:bg-zinc-950 max-h-64 flex items-center justify-center">
              <img
                src={imagePreview}
                alt="업로드된 시간표 미리보기"
                className="max-h-64 w-auto object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[42px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                다른 사진 선택
              </button>
              <button
                type="button"
                onClick={handleParseImage}
                disabled={parsingImage}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {parsingImage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Gemini AI가 시간표를 읽는 중...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>AI로 시간표 인식하기</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {parseError && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300">
            {parseError}
          </div>
        )}

        {/* Parsed Blocks Review List */}
        {reviewBlocks.length > 0 && (
          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
            {parseSummary && (
              <p className="text-xs font-medium text-violet-700 dark:text-violet-300">
                {parseSummary}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  기준 주간 날짜
                </label>
                <input
                  type="date"
                  value={baseWeekDate}
                  onChange={(e) => setBaseWeekDate(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  주간 시간표 반복 배치
                </label>
                <select
                  value={repeatWeeks}
                  onChange={(e) => setRepeatWeeks(Number(e.target.value))}
                  className="w-full min-h-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-xs"
                >
                  <option value={1}>이번 1주만 배치</option>
                  <option value={4}>4주 반복 배치</option>
                  <option value={15}>15주 (한 학기) 배치</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {reviewBlocks.map((blk) => (
                <div
                  key={blk.tempId}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 flex items-start gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setReviewBlocks((prev) =>
                        prev.map((x) =>
                          x.tempId === blk.tempId ? { ...x, selected: !x.selected } : x
                        )
                      )
                    }
                    className={`mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center shrink-0 ${
                      blk.selected
                        ? "bg-violet-600 border-violet-600 text-white"
                        : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                    }`}
                  >
                    {blk.selected && <Check className="w-3.5 h-3.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={blk.title}
                      onChange={(e) =>
                        setReviewBlocks((prev) =>
                          prev.map((x) =>
                            x.tempId === blk.tempId ? { ...x, title: e.target.value } : x
                          )
                        )
                      }
                      className="w-full bg-transparent text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none border-b border-transparent focus:border-violet-500"
                    />
                    <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {blk.specificDate
                        ? blk.specificDate
                        : `매주 ${WEEKDAY_KO[blk.dayOfWeek ?? 1]}요일`}{" "}
                      · {blk.startTime}–{blk.endTime} ·{" "}
                      {SUBTYPE_LABELS[blk.subType] || blk.subType} ·{" "}
                      {PRIORITY_LABELS[blk.priority] || "보통"}
                    </p>
                    {blk.memo && (
                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {blk.memo}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleApplyParsedBlocks}
              className="w-full min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors"
            >
              선택한 {reviewBlocks.filter((b) => b.selected).length}개 일정 타임블록 배치하기
            </button>
          </div>
        )}
      </section>

      {/* ================= RIGHT: STUDY GOALS + ADAPTIVE FREE-SLOT RECOMMENDER ================= */}
      <div className="space-y-6">
        {/* Study Goals Section */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              개인 공부 목표 설정
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              과목별 주간 목표 시간을 설정하면, 열품타 스톱워치의 실제 측정 시간이 다음 AI 추천에 자동 반영됩니다.
            </p>
          </div>

          <form onSubmit={handleCreateGoal} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="과목명 (예: 자료구조)"
                className="sm:col-span-2 min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <select
                value={goalPriority}
                onChange={(e) => setGoalPriority(e.target.value as PriorityLevel)}
                className="min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-xs text-zinc-900 dark:text-zinc-100"
              >
                <option value="high">우선순위 높음</option>
                <option value="medium">우선순위 보통</option>
                <option value="low">우선순위 낮음</option>
              </select>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                  주간 목표 (시간)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="60"
                  value={weeklyTargetHours}
                  onChange={(e) => setWeeklyTargetHours(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                  1회 기본 블록 (분)
                </label>
                <input
                  type="number"
                  step="5"
                  min="20"
                  max="180"
                  value={defaultSessionMins}
                  onChange={(e) => setDefaultSessionMins(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-xs tabular-nums"
                />
              </div>
              <div className="col-span-2 sm:col-span-1 flex items-end">
                <button
                  type="submit"
                  className="w-full min-h-[40px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>목표 추가</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {COLOR_CARD_LIST.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setGoalColor(c.id)}
                  className={`h-7 px-2.5 rounded-lg border text-[11px] flex items-center gap-1.5 ${
                    goalColor === c.id
                      ? "border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-zinc-900 dark:text-zinc-50 font-semibold"
                      : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.swatchHex }} />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </form>

          {/* Existing Goals List with Real Actual vs Planned Feedback */}
          {subjectStats.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              {subjectStats.map(({ goal, completedThisWeekMinutes, actualToPlannedRatio, sessionCount }) => {
                const theme = COLOR_CARDS[goal.color] || COLOR_CARDS.violet;
                const pct = Math.min(
                  100,
                  Math.round((completedThisWeekMinutes / Math.max(1, goal.weeklyTargetMinutes)) * 100)
                );
                return (
                  <div
                    key={goal.id}
                    className={`rounded-xl border p-3 ${theme.cardClass}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${theme.dotClass}`} />
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {goal.subjectName}
                          </p>
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                          이번 주 {formatDurationKo(completedThisWeekMinutes)} / 목표{" "}
                          {formatDurationKo(goal.weeklyTargetMinutes)} ({pct}%) ·{" "}
                          {sessionCount > 0
                            ? `실제 소요 ${actualToPlannedRatio.toFixed(2)}x (${sessionCount}회)`
                            : `기본 ${goal.defaultSessionMinutes}분`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteStudyGoal(goal.id)}
                        className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-white/60 dark:hover:bg-zinc-900/60"
                        aria-label={`${goal.subjectName} 목표 삭제`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-200/70 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Adaptive Free-Slot AI Study Recommender */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <span>빈 시간대 AI 공부 추천</span>
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              고정 일정과 기존 스케줄 사이의 빈 시간대를 찾아, 과목별 실제 공부 소요 시간 패턴에 맞춘 블록을 추천합니다.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setRecommendScope("day")}
                className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  recommendScope === "day"
                    ? "bg-violet-600 text-white"
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                하루 추천
              </button>
              <button
                type="button"
                onClick={() => setRecommendScope("week")}
                className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  recommendScope === "week"
                    ? "bg-violet-600 text-white"
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                이번 주 전체
              </button>
            </div>

            <input
              type="date"
              value={recommendDate}
              onChange={(e) => setRecommendDate(e.target.value)}
              className="min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-xs tabular-nums"
            />
          </div>

          {/* Detected Free Slots Preview */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">
              탐지된 빈 시간대 ({availableFreeSlots.length}구간 · 설정 {settings.studyWindowStart}~{settings.studyWindowEnd})
            </p>
            {availableFreeSlots.length === 0 ? (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                25분 이상 연속된 빈 시간이 없습니다. 설정에서 공부 가능 시간대를 조정하거나 다른 날짜를 선택해 주세요.
              </p>
            ) : (
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums leading-relaxed">
                {availableFreeSlots
                  .slice(0, 6)
                  .map(
                    (s) =>
                      `${s.date.slice(5)}(${WEEKDAY_KO[parseLocalDate(s.date).getDay()]}) ${s.startTime}–${s.endTime}`
                  )
                  .join(" · ")}
                {availableFreeSlots.length > 6 ? ` 외 ${availableFreeSlots.length - 6}개` : ""}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleGenerateRecommendations}
            disabled={recommending || studyGoals.length === 0 || availableFreeSlots.length === 0}
            className="w-full min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            {recommending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>실제 소요 시간 분석 및 추천 생성 중...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>빈 시간대 AI 공부 추천 받기</span>
              </>
            )}
          </button>

          {recommendError && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300">
              {recommendError}
            </div>
          )}

          {recommendations.length > 0 && (
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
              {strategySummary && (
                <p className="text-xs text-violet-700 dark:text-violet-300 font-medium leading-relaxed">
                  {strategySummary}
                </p>
              )}

              <div className="space-y-2">
                {recommendations.map((rec, i) => (
                  <div
                    key={`${rec.date}-${rec.startTime}-${i}`}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {rec.subjectName} · {formatDurationKo(rec.plannedMinutes)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                        {formatKoreanDateFull(rec.date)} · {rec.startTime}–{rec.endTime}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        {rec.reason}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAcceptRecommendations([rec])}
                      className="min-h-[36px] px-3 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold shrink-0 whitespace-nowrap"
                    >
                      배치
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => handleAcceptRecommendations(recommendations)}
                className="w-full min-h-[42px] rounded-xl border border-violet-600 dark:border-violet-500 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 text-xs font-semibold transition-colors"
              >
                추천된 {recommendations.length}개 공부 블록 모두 스케줄에 추가
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
