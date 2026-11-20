import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  Clock,
  ImagePlus,
  Loader2,
  Palette,
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
import {
  COLOR_CARD_LIST,
  PRIORITY_LABELS,
  colorToHex,
  formatSubTypeLabel,
  isPresetColorId,
  resolveColorTheme,
} from "../lib/colors";
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
  onUpdateStudyGoalColor: (id: string, color: ColorCardId) => void;
  onDeleteStudyGoal: (id: string) => void;
  onShowToast: (msg: string) => void;
}

interface ReviewBlock extends ParsedTimetableBlock {
  tempId: string;
  selected: boolean;
}

/**
 * Compresses & converts uploaded iPhone screenshots / HEIC / large PNGs into a clean JPEG data URL
 * (max 1600px) so mobile Safari never hits payload limits or invalid MIME issues.
 */
async function prepareImageForUpload(
  file: File
): Promise<{ dataUrl: string; mimeType: string }> {
  const readAsDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("이미지를 읽을 수 없습니다."));
      };
      reader.onerror = () => reject(new Error("이미지 파일 읽기에 실패했습니다."));
      reader.readAsDataURL(blob);
    });

  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("이미지 디코딩 실패"));
        el.src = objectUrl;
      });

      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const targetW = Math.max(1, Math.round((img.naturalWidth || 800) * scale));
      const targetH = Math.max(1, Math.round((img.naturalHeight || 800) * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Fill white background in case PNG has transparency
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.88);
        if (jpegDataUrl.startsWith("data:image/jpeg;base64,") && jpegDataUrl.length > 64) {
          return { dataUrl: jpegDataUrl, mimeType: "image/jpeg" };
        }
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    // Fallback to raw FileReader below if canvas decode fails
  }

  const rawDataUrl = await readAsDataUrl(file);
  const inferredMime =
    file.type && file.type.startsWith("image/") && !file.type.includes("heic") && !file.type.includes("heif")
      ? file.type
      : "image/jpeg";
  return { dataUrl: rawDataUrl, mimeType: inferredMime };
}

interface ApiParseResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorMsg: string;
  shouldRetry?: boolean;
  needsAuthReload?: boolean;
}

/**
 * Safely parses fetch responses without triggering Safari's
 * "The string did not match the expected pattern." JSON SyntaxError on HTML/empty responses,
 * and identifies why a non-JSON HTTP 200 response occurred (SPA static fallback, auth redirect, or waking proxy).
 */
async function parseApiJson<T>(res: Response): Promise<ApiParseResult<T>> {
  const rawText = await res.text();
  const trimmed = rawText.trim();
  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  let parsed: unknown = null;
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
  }

  if (res.ok && parsed && typeof parsed === "object") {
    return { ok: true, status: res.status, data: parsed as T, errorMsg: "" };
  }

  const serverError =
    parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
      ? (parsed as { error: string }).error
      : "";

  if (serverError) {
    return { ok: false, status: res.status, data: null, errorMsg: serverError };
  }
  if (res.status === 413) {
    return {
      ok: false,
      status: res.status,
      data: null,
      errorMsg: "이미지 용량이 너무 큽니다. 더 작은 사진으로 다시 시도해 주세요.",
    };
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return {
      ok: false,
      status: res.status,
      data: null,
      errorMsg: "서버가 깨어나는 중이거나 AI 응답이 지연되었습니다. 5~10초 후 다시 눌러 주세요.",
      shouldRetry: true,
    };
  }

  const lowerFull = trimmed.toLowerCase();
  const resUrlLower = (res.url || "").toLowerCase();
  const looksLikeHtml =
    contentType.includes("text/html") ||
    lowerFull.startsWith("<!doctype") ||
    lowerFull.startsWith("<html");

  if (looksLikeHtml || res.redirected) {
    // 1. Auth / cookie check redirect (e.g., AI Studio ais-pre/ais-dev preview or iOS Home Screen PWA missing session cookie)
    if (
      res.redirected ||
      resUrlLower.includes("__cookie_check") ||
      lowerFull.includes("__secure-aistudio_auth_flow") ||
      lowerFull.includes("action required to load your app") ||
      lowerFull.includes("accounts.google.com") ||
      lowerFull.includes("servicelogin")
    ) {
      const isStandalone =
        typeof window !== "undefined" &&
        (window.matchMedia?.("(display-mode: standalone)").matches ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

      return {
        ok: false,
        status: res.status,
        data: null,
        needsAuthReload: true,
        errorMsg: isStandalone
          ? "현재 홈 화면 앱의 AI Studio 보안 쿠키가 만료되어 AI 서버 요청이 차단되었습니다. 아래 '세션 새로고침'을 누르거나, Safari에서 열거나, Render Web Service 주소로 홈 화면에 추가해 주세요."
          : "보안 세션 쿠키가 만료되어 AI 서버 요청이 차단되었습니다. 아래 '세션 새로고침' 버튼을 눌러 다시 연결해 주세요.",
      };
    }

    // 2. DayFlow's own SPA index.html returned instead of Express API (Static Site / vite preview without backend)
    if (
      lowerFull.includes("dayflow") ||
      lowerFull.includes("데이플로우") ||
      lowerFull.includes('id="root"')
    ) {
      return {
        ok: false,
        status: res.status,
        data: null,
        errorMsg:
          "현재 접속한 서버에서 백엔드 API(/api)가 실행되지 않고 화면 HTML만 반환되었습니다. Render 배포 시 'Static Site'가 아닌 'Web Service'(Start Command: npm start, 환경변수 GEMINI_API_KEY 설정)인지 확인해 주세요.",
      };
    }

    // 3. Hosting wake-up / interstitial HTML (e.g., Render free-tier cold start)
    return {
      ok: false,
      status: res.status,
      data: null,
      errorMsg:
        "호스팅 서버가 깨어나는 중이거나 임시 안내 페이지(HTML)를 반환했습니다. 10~20초 후 다시 눌러 주세요.",
      shouldRetry: true,
    };
  }

  return {
    ok: false,
    status: res.status,
    data: null,
    errorMsg: `서버 응답을 처리하지 못했습니다 (HTTP ${res.status}${contentType ? `, ${contentType.split(";")[0]}` : ""}). 잠시 후 다시 시도해 주세요.`,
  };
}

async function postApiJson<T>(url: string, payload: unknown): Promise<ApiParseResult<T>> {
  const maxAttempts = 2;
  let lastResult: ApiParseResult<T> = {
    ok: false,
    status: 0,
    data: null,
    errorMsg: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 65000);
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      lastResult = await parseApiJson<T>(res);
      if (lastResult.ok || !lastResult.shouldRetry || attempt === maxAttempts) {
        return lastResult;
      }
      await new Promise((r) => window.setTimeout(r, 3500));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        lastResult = {
          ok: false,
          status: 408,
          data: null,
          errorMsg: "AI 응답 시간이 초과되었습니다. 잠시 후 다시 눌러 주세요.",
        };
        return lastResult;
      }
      if (attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => window.setTimeout(r, 2000));
    } finally {
      window.clearTimeout(timer);
    }
  }

  return lastResult;
}

export const AITimetableTab: React.FC<AITimetableTabProps> = ({
  schedules,
  studyGoals,
  studySessions,
  settings,
  selectedDate,
  onAddSchedulesBatch,
  onAddStudyGoal,
  onUpdateStudyGoalColor,
  onDeleteStudyGoal,
  onShowToast,
}) => {
  // ---- 1. Everytime Timetable Photo Recognition State ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageMime, setImageMime] = useState<string>("image/jpeg");
  const [preparingImage, setPreparingImage] = useState(false);
  const [parsingImage, setParsingImage] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parseNeedsAuthReload, setParseNeedsAuthReload] = useState(false);
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
  const [goalIncludeInTotal, setGoalIncludeInTotal] = useState<boolean>(true);

  // ---- 3. Adaptive AI Study Recommendation State ----
  const [recommendScope, setRecommendScope] = useState<"day" | "week">("day");
  const [recommendDate, setRecommendDate] = useState<string>(selectedDate || getTodayStr());
  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState("");
  const [recommendNeedsAuthReload, setRecommendNeedsAuthReload] = useState(false);
  const [strategySummary, setStrategySummary] = useState("");
  const [recommendations, setRecommendations] = useState<AIStudyRecommendation[]>([]);

  useEffect(() => {
    if (selectedDate) {
      setBaseWeekDate(selectedDate);
    }
  }, [selectedDate]);

  const weekDatesForRec = useMemo(() => getWeekDates(recommendDate), [recommendDate]);

  // Compute real stopwatch stats per StudyGoal
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
  }, [
    recommendScope,
    recommendDate,
    weekDatesForRec,
    schedules,
    settings.studyWindowStart,
    settings.studyWindowEnd,
  ]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so selecting the same photo again still fires onChange
    e.target.value = "";
    if (!file) return;

    setParseError("");
    setReviewBlocks([]);
    setParseSummary("");
    setPreparingImage(true);

    try {
      const { dataUrl, mimeType } = await prepareImageForUpload(file);
      setImagePreview(dataUrl);
      setImageMime(mimeType);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "사진을 불러오지 못했습니다. PNG 또는 JPG 이미지로 다시 시도해 주세요."
      );
    } finally {
      setPreparingImage(false);
    }
  };

  const handleParseImage = async () => {
    if (!imagePreview) {
      setParseError("먼저 시간표 또는 일정 사진을 선택해 주세요.");
      return;
    }
    setParsingImage(true);
    setParseError("");
    setParseNeedsAuthReload(false);
    try {
      const parsed = await postApiJson<{ summary?: string; items?: ParsedTimetableBlock[] }>(
        "/api/timetable/parse",
        {
          imageBase64: imagePreview,
          mimeType: imageMime,
          referenceDate: baseWeekDate,
        }
      );
      if (!parsed.ok || !parsed.data) {
        if (parsed.needsAuthReload) setParseNeedsAuthReload(true);
        throw new Error(parsed.errorMsg);
      }

      const items: ParsedTimetableBlock[] = Array.isArray(parsed.data.items) ? parsed.data.items : [];
      const paletteCycle: ColorCardId[] = ["violet", "indigo", "sky", "emerald", "amber", "rose"];
      setParseSummary(parsed.data.summary || "");
      setReviewBlocks(
        items.map((it, idx) => ({
          ...it,
          tempId: generateId("ai"),
          selected: true,
          color: it.color || paletteCycle[idx % paletteCycle.length],
        }))
      );
      if (items.length === 0) {
        setParseError(
          parsed.data.summary
            ? `${parsed.data.summary} 더 선명한 시간표 캡처 이미지로 다시 시도해 주세요.`
            : "이미지에서 일정 항목을 찾지 못했습니다. 더 선명한 캡처 이미지로 다시 시도해 주세요."
        );
      } else {
        onShowToast(`${items.length}개의 시간표 항목을 인식했습니다.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "네트워크 오류가 발생했습니다.";
      setParseError(
        msg.includes("expected pattern")
          ? "응답을 해석하는 중 오류가 발생했습니다. 사진을 다시 선택해 시도해 주세요."
          : msg
      );
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
    if (!name) {
      onShowToast("과목명을 입력해 주세요.");
      subjectInputRef.current?.focus();
      return;
    }

    const hours = Math.max(0.5, Number(weeklyTargetHours) || 3);
    const sessionMins = Math.max(15, Math.min(180, Number(defaultSessionMins) || 50));

    onAddStudyGoal({
      id: generateId("goal"),
      subjectName: name,
      weeklyTargetMinutes: Math.round(hours * 60),
      defaultSessionMinutes: sessionMins,
      color: goalColor,
      priority: goalPriority,
      includeInTotal: goalIncludeInTotal,
      createdAt: new Date().toISOString(),
    });
    setSubjectName("");
    setGoalIncludeInTotal(true);
    setRecommendError("");
    onShowToast(`"${name}" 공부 목표가 추가되었습니다.`);
  };

  const handleGenerateRecommendations = async () => {
    setRecommendError("");

    if (studyGoals.length === 0) {
      const msg = "먼저 위 '개인 공부 목표 설정'에서 공부할 과목을 1개 이상 추가해 주세요.";
      setRecommendError(msg);
      onShowToast(msg);
      subjectInputRef.current?.focus();
      return;
    }

    // Determine effective targetDate and freeSlots; if today has 0 remaining slots (e.g. late night),
    // automatically use tomorrow so the user isn't blocked.
    let effectiveDate = recommendDate;
    let slotsToUse = availableFreeSlots;

    if (slotsToUse.length === 0 && recommendScope === "day" && recommendDate === getTodayStr()) {
      const tomorrow = addDays(getTodayStr(), 1);
      const tomorrowSlots = computeFreeSlotsForDate(
        tomorrow,
        schedules,
        settings.studyWindowStart,
        settings.studyWindowEnd,
        25
      );
      if (tomorrowSlots.length > 0) {
        effectiveDate = tomorrow;
        slotsToUse = tomorrowSlots;
        setRecommendDate(tomorrow);
        onShowToast("오늘 남은 공부 시간이 없어 내일 빈 시간대 기준으로 추천을 생성합니다.");
      }
    }

    if (slotsToUse.length === 0) {
      const msg =
        "선택한 날짜의 공부 가능 시간대 안에 남은 빈 시간이 없습니다. 날짜를 내일로 바꾸거나 설정에서 공부 시간대를 늘려 주세요.";
      setRecommendError(msg);
      onShowToast("남은 빈 시간대가 없습니다.");
      return;
    }

    setRecommending(true);
    setRecommendNeedsAuthReload(false);
    setRecommendations([]);
    setStrategySummary("");

    try {
      const effectiveDates =
        recommendScope === "day" ? [effectiveDate] : getWeekDates(effectiveDate);
      const targetDatesSet = new Set(effectiveDates);
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

      const parsed = await postApiJson<{
        strategySummary?: string;
        recommendations?: AIStudyRecommendation[];
      }>("/api/study/recommend", {
        targetDate: effectiveDate,
        mode: recommendScope,
        freeSlots: slotsToUse,
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
      });

      if (!parsed.ok || !parsed.data) {
        if (parsed.needsAuthReload) setRecommendNeedsAuthReload(true);
        throw new Error(parsed.errorMsg);
      }

      const recs = Array.isArray(parsed.data.recommendations) ? parsed.data.recommendations : [];
      setStrategySummary(parsed.data.strategySummary || "");
      setRecommendations(recs);
      if (recs.length === 0) {
        setRecommendError("추천할 공부 블록을 생성하지 못했습니다. 다시 시도해 주세요.");
      } else {
        onShowToast(`${recs.length}개의 빈 시간대 공부 블록을 추천했습니다.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "네트워크 오류가 발생했습니다.";
      setRecommendError(
        msg.includes("expected pattern")
          ? "서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : msg
      );
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

  const currentCustomHex = colorToHex(goalColor);
  const isCustomGoalColor = !isPresetColorId(goalColor);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      {/* ================= LEFT: EVERYTIME TIMETABLE AI PHOTO PARSER ================= */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Camera className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span>시간표 · 일정 사진 AI 인식</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            시간표 캡처나 강의계획서·공지 사진을 올리면 AI가 요일과 시간을 분석해 타임블록으로 자동 배치합니다.
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
            disabled={preparingImage}
            className="w-full rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/50 hover:border-violet-500 dark:hover:border-violet-500 py-10 px-4 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {preparingImage ? (
              <Loader2 className="w-7 h-7 text-violet-600 dark:text-violet-400 animate-spin" />
            ) : (
              <ImagePlus className="w-7 h-7 text-violet-600 dark:text-violet-400" />
            )}
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {preparingImage ? "사진을 최적화하는 중..." : "시간표 또는 일정 사진 선택하기"}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              아이폰 사진 보관함 · 시간표 스크린샷(PNG, JPG) 자동 최적화 지원
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
                disabled={parsingImage || preparingImage}
                className="min-h-[42px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                다른 사진 선택
              </button>
              <button
                type="button"
                onClick={handleParseImage}
                disabled={parsingImage || preparingImage}
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
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300 space-y-2.5">
            <p className="leading-relaxed">{parseError}</p>
            {parseNeedsAuthReload && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[36px] px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors"
              >
                세션 새로고침
              </button>
            )}
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
                    <div className="flex items-center gap-2">
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
                        className="flex-1 min-w-0 bg-transparent text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none border-b border-transparent focus:border-violet-500"
                      />
                      <label
                        className="relative w-5 h-5 rounded-full border border-zinc-300 dark:border-zinc-600 shrink-0 cursor-pointer overflow-hidden"
                        style={{ backgroundColor: colorToHex(blk.color || "violet") }}
                        title="블록 색상 변경"
                      >
                        <input
                          type="color"
                          value={colorToHex(blk.color || "violet")}
                          onChange={(e) =>
                            setReviewBlocks((prev) =>
                              prev.map((x) =>
                                x.tempId === blk.tempId ? { ...x, color: e.target.value } : x
                              )
                            )
                          }
                          className="sr-only"
                        />
                      </label>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {blk.specificDate
                        ? blk.specificDate
                        : `매주 ${WEEKDAY_KO[blk.dayOfWeek ?? 1]}요일`}{" "}
                      · {blk.startTime}–{blk.endTime} ·{" "}
                      {formatSubTypeLabel(blk.subType) ? `${formatSubTypeLabel(blk.subType)} · ` : ""}
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
              과목별 주간 목표 시간과 원하는 색상을 자유롭게 설정하면, 타이머 측정 시간이 다음 AI 추천에 자동 반영됩니다.
            </p>
          </div>

          <form onSubmit={handleCreateGoal} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                ref={subjectInputRef}
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

            {/* Free Color Picker + Quick Presets */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                목표 색상 선택 (기본 색상 또는 자유 색상 지정)
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {COLOR_CARD_LIST.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setGoalColor(c.id)}
                    className={`min-h-[34px] px-2.5 rounded-lg border text-[11px] flex items-center gap-1.5 transition-colors ${
                      goalColor === c.id
                        ? "border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-zinc-900 dark:text-zinc-50 font-semibold"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: c.swatchHex }}
                    />
                    <span>{c.label}</span>
                  </button>
                ))}

                {/* Custom Free Color Wheel Picker */}
                <label
                  className={`min-h-[34px] px-2.5 rounded-lg border text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors ${
                    isCustomGoalColor
                      ? "border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-zinc-900 dark:text-zinc-50 font-semibold"
                      : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <input
                    type="color"
                    value={currentCustomHex}
                    onChange={(e) => setGoalColor(e.target.value)}
                    aria-label="목표 자유 색상 선택"
                    className="sr-only"
                  />
                  <span
                    className="w-3 h-3 rounded-full border border-black/15 dark:border-white/25 shrink-0"
                    style={{ backgroundColor: currentCustomHex }}
                  />
                  <Palette className="w-3 h-3 shrink-0" />
                  <span>{isCustomGoalColor ? currentCustomHex : "직접 선택"}</span>
                </label>
              </div>
            </div>

            <label className="flex items-start gap-2 pt-0.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={goalIncludeInTotal}
                onChange={(e) => setGoalIncludeInTotal(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 accent-violet-600 cursor-pointer shrink-0"
              />
              <span className="text-xs text-zinc-700 dark:text-zinc-300 leading-snug">
                총 공부 시간에 포함
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                  체크 해제 시 취미·기타 일정처럼 과목별·측정 기록에만 남고 총 공부 시간에서는 제외됩니다.
                </span>
              </span>
            </label>
          </form>

          {/* Existing Goals List with Per-Goal Free Color Customizer */}
          {subjectStats.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              {subjectStats.map(
                ({ goal, completedThisWeekMinutes, actualToPlannedRatio, sessionCount }) => {
                  const theme = resolveColorTheme(goal.color);
                  const pct = Math.min(
                    100,
                    Math.round(
                      (completedThisWeekMinutes / Math.max(1, goal.weeklyTargetMinutes)) * 100
                    )
                  );
                  return (
                    <div
                      key={goal.id}
                      className={`rounded-xl border p-3 ${theme.cardClass}`}
                      style={theme.cardStyle}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${theme.dotClass}`}
                              style={theme.dotStyle}
                            />
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
                            {goal.includeInTotal === false ? " · 총 공부 시간 제외" : ""}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <label
                            className="min-h-[34px] px-2 rounded-lg border border-zinc-200/90 dark:border-zinc-700/80 bg-white/80 dark:bg-zinc-900/80 hover:bg-white dark:hover:bg-zinc-800 flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-zinc-700 dark:text-zinc-300"
                            title={`${goal.subjectName} 색상 자유 변경`}
                          >
                            <input
                              type="color"
                              value={theme.hex}
                              onChange={(e) => onUpdateStudyGoalColor(goal.id, e.target.value)}
                              aria-label={`${goal.subjectName} 색상 변경`}
                              className="sr-only"
                            />
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-black/15 dark:border-white/25 shrink-0"
                              style={{ backgroundColor: theme.hex }}
                            />
                            <span className="hidden sm:inline">색상</span>
                          </label>

                          <button
                            type="button"
                            onClick={() => onDeleteStudyGoal(goal.id)}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-white/60 dark:hover:bg-zinc-900/60"
                            aria-label={`${goal.subjectName} 목표 삭제`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-200/70 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, ...theme.progressStyle }}
                        />
                      </div>
                    </div>
                  );
                }
              )}
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
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">
              탐지된 빈 시간대 ({availableFreeSlots.length}구간 · 설정 {settings.studyWindowStart}~
              {settings.studyWindowEnd})
            </p>
            {availableFreeSlots.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {recommendDate === getTodayStr()
                    ? "오늘 남은 공부 시간대가 없습니다. 추천 버튼을 누르면 내일 기준으로 자동 추천합니다."
                    : "25분 이상 연속된 빈 시간이 없습니다. 날짜를 바꾸거나 설정에서 공부 시간대를 조정해 주세요."}
                </p>
                {recommendDate === getTodayStr() && (
                  <button
                    type="button"
                    onClick={() => setRecommendDate(addDays(getTodayStr(), 1))}
                    className="min-h-[32px] px-2.5 rounded-lg border border-violet-300 dark:border-violet-700 text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 whitespace-nowrap"
                  >
                    내일로 변경
                  </button>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums leading-relaxed">
                {availableFreeSlots
                  .slice(0, 6)
                  .map(
                    (s) =>
                      `${s.date.slice(5)}(${WEEKDAY_KO[parseLocalDate(s.date).getDay()]}) ${
                        s.startTime
                      }–${s.endTime}`
                  )
                  .join(" · ")}
                {availableFreeSlots.length > 6 ? ` 외 ${availableFreeSlots.length - 6}개` : ""}
              </p>
            )}
          </div>

          {studyGoals.length === 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              안내: 추천을 받으려면 위 &lsquo;개인 공부 목표 설정&rsquo;에서 과목을 먼저 1개 이상 추가해 주세요.
            </p>
          )}

          <button
            type="button"
            onClick={handleGenerateRecommendations}
            disabled={recommending}
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
            <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300 space-y-2.5">
              <p className="leading-relaxed">{recommendError}</p>
              {recommendNeedsAuthReload && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="min-h-[36px] px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors"
                >
                  세션 새로고침
                </button>
              )}
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
                {recommendations.map((rec, i) => {
                  const matchedGoal = studyGoals.find(
                    (g) => g.id === rec.subjectId || g.subjectName === rec.subjectName
                  );
                  const recTheme = resolveColorTheme(matchedGoal?.color || "violet");
                  return (
                    <div
                      key={`${rec.date}-${rec.startTime}-${i}`}
                      className={`rounded-xl border p-3 flex items-start justify-between gap-3 ${recTheme.cardClass}`}
                      style={recTheme.cardStyle}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${recTheme.dotClass}`}
                            style={recTheme.dotStyle}
                          />
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            {rec.subjectName} · {formatDurationKo(rec.plannedMinutes)}
                          </p>
                        </div>
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
                  );
                })}
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
