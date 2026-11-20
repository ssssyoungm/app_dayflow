import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import * as webpush from "web-push";
import type { PushSubscription } from "web-push";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const PRIMARY_MODEL = "gemini-4-hydrogen";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(message: string): boolean {
  return (
    message.includes("503") ||
    message.includes("UNAVAILABLE") ||
    message.includes("high demand") ||
    message.includes("500") ||
    message.includes("INTERNAL") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("fetch failed")
  );
}

function isModelUnavailableError(message: string): boolean {
  return (
    message.includes("NOT_FOUND") ||
    message.includes("404") ||
    message.includes("503") ||
    message.includes("UNAVAILABLE") ||
    message.includes("high demand")
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 응답 시간이 초과되었습니다 (${Math.round(ms / 1000)}초).`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function isTimeoutOrTransientError(message: string): boolean {
  return (
    message.includes("초과") ||
    message.includes("timeout") ||
    message.includes("TIMEOUT") ||
    isRetryableError(message) ||
    isModelUnavailableError(message)
  );
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">
): Promise<GenerateContentResponse> {
  const attemptsPlan = [
    { model: PRIMARY_MODEL, maxAttempts: 1, timeoutMs: 10000 },
    { model: FALLBACK_MODEL, maxAttempts: 2, timeoutMs: 20000 },
  ];
  let lastError: unknown = null;

  for (const { model, maxAttempts, timeoutMs } of attemptsPlan) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await withTimeout(
          ai.models.generateContent({
            ...params,
            model,
          }),
          timeoutMs,
          model
        );
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Gemini ${model}] attempt ${attempt}/${maxAttempts} failed:`, msg.slice(0, 220));

        // Do not retry invalid API key or permission errors
        if (
          msg.includes("API_KEY_INVALID") ||
          msg.includes("PERMISSION_DENIED") ||
          msg.includes("403")
        ) {
          throw err;
        }

        // If 404 NOT_FOUND on primary, immediately move to fallback model
        if (msg.includes("NOT_FOUND") || msg.includes("404")) {
          break;
        }

        if (isTimeoutOrTransientError(msg) && attempt < maxAttempts) {
          await sleep(600 * attempt);
          continue;
        }

        // Move to fallback model on timeout / 503 / transient errors
        if (isTimeoutOrTransientError(msg)) {
          break;
        }

        throw err;
      }
    }
  }

  throw lastError ?? new Error("Gemini API 호출에 실패했습니다.");
}

function safeParseJsonObject<T>(rawText: string | undefined): T {
  const trimmed = (rawText ?? "").trim();
  if (!trimmed) {
    throw new Error("AI가 빈 응답을 반환했습니다. 다시 시도해 주세요.");
  }

  // Strip optional markdown code fences
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error("AI 응답 형식을 해석하지 못했습니다. 다시 시도해 주세요.");
  }
}

function normalizeHHMM(val: unknown, fallback = "09:00"): string {
  if (typeof val !== "string") return fallback;
  const cleaned = val.trim();
  const match = /^(\d{1,2})\s*[:시]\s*(\d{1,2})?/.exec(cleaned);
  if (!match) return fallback;
  const h = Math.max(0, Math.min(23, Number(match[1])));
  const m = Math.max(0, Math.min(59, Number(match[2] ?? 0)));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function normalizeDayOfWeek(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) {
    const n = Math.trunc(val);
    if (n >= 0 && n <= 6) return n;
    if (n === 7) return 0;
  }
  if (typeof val === "string") {
    const s = val.trim();
    const map: Record<string, number> = {
      "0": 0, 일: 0, 일요일: 0, sun: 0,
      "1": 1, 월: 1, 월요일: 1, mon: 1,
      "2": 2, 화: 2, 화요일: 2, tue: 2,
      "3": 3, 수: 3, 수요일: 3, wed: 3,
      "4": 4, 목: 4, 목요일: 4, thu: 4,
      "5": 5, 금: 5, 금요일: 5, fri: 5,
      "6": 6, 토: 6, 토요일: 6, sat: 6,
    };
    const key = s.toLowerCase();
    if (key in map) return map[key];
  }
  return null;
}

function sanitizeMimeType(mimeType: unknown): string {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (typeof mimeType === "string") {
    const lower = mimeType.toLowerCase().trim();
    if (lower === "image/jpg") return "image/jpeg";
    if (allowed.has(lower)) return lower;
  }
  return "image/jpeg";
}

function handleGeminiError(res: Response, err: unknown, fallbackMsg: string) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[Gemini API Error]:", message);

  if (
    message.includes("PERMISSION_DENIED") ||
    message.includes("API_KEY_INVALID") ||
    message.includes("API key not valid") ||
    message.includes("403")
  ) {
    return res.status(400).json({
      error:
        "Gemini API 키가 유효하지 않거나 설정되지 않았습니다. 환경변수(GEMINI_API_KEY) 또는 Settings > Secrets를 확인해 주세요.",
      details: message,
    });
  }
  if (message.includes("RESOURCE_EXHAUSTED") || message.includes("429")) {
    return res.status(429).json({
      error: "Gemini API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
      details: message,
    });
  }
  if (message.includes("503") || message.includes("UNAVAILABLE") || message.includes("high demand")) {
    return res.status(503).json({
      error: "현재 AI 서버 요청이 일시적으로 많습니다. 5~10초 후 다시 눌러 주세요.",
      details: message,
    });
  }
  return res.status(500).json({
    error: fallbackMsg,
    details: message,
  });
}

interface ParsedTimetableBlock {
  title: string;
  category: "fixed" | "personal";
  subType: "class" | "assignment" | "exam" | "event" | "study" | "routine";
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string;
  endTime: string;
  priority: "high" | "medium" | "low";
  memo: string;
}

interface StudyGoalInput {
  id: string;
  subjectName: string;
  weeklyTargetMinutes: number;
  defaultSessionMinutes: number;
  priority: "high" | "medium" | "low";
  completedThisWeekMinutes: number;
  actualToPlannedRatio: number;
  sessionCount: number;
}

interface FreeSlotInput {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

interface ExistingScheduleInput {
  title: string;
  category: string;
  date: string;
  startTime: string;
  endTime: string;
  priority: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // Prevent browsers, iOS PWA, or reverse proxies from caching API responses
  app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "dayflow-api" });
  });

  // 1. Everytime Timetable / Schedule Photo Recognition via Gemini AI
  app.post("/api/timetable/parse", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        error: "GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 또는 호스팅 환경변수에 API 키를 설정해 주세요.",
      });
    }

    try {
      const { imageBase64, mimeType, referenceDate } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        referenceDate?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ error: "이미지 데이터가 필요합니다." });
      }

      const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(imageBase64.trim());
      const resolvedMime = sanitizeMimeType(dataUrlMatch?.[1] || mimeType);
      const cleanedBase64 = (dataUrlMatch ? dataUrlMatch[2] : imageBase64).replace(/\s+/g, "");

      if (!cleanedBase64 || cleanedBase64.length < 32) {
        return res.status(400).json({ error: "유효한 이미지 파일이 아닙니다. 다른 사진으로 다시 시도해 주세요." });
      }

      const prompt = `당신은 한국 대학생의 에브리타임(Everytime) 주간 시간표 및 일정 스크린샷을 정확하게 분석하는 플래너 어시스턴트입니다.
업로드된 이미지를 꼼꼼하게 읽고 모든 수업, 시험, 과제, 행사, 또는 개인 일정을 구조화된 JSON으로 추출하세요.
기준 날짜(참고용): ${referenceDate || "오늘"}

[에브리타임 시간표 핵심 판독 규칙]
1. 열(Column)은 보통 왼쪽부터 월, 화, 수, 목, 금 (또는 토, 일 포함) 순서입니다.
   - dayOfWeek 매핑: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토.
   - 주간 시간표 격자라면 specificDate는 null로 두고 dayOfWeek를 정확히 채우세요.
2. 왼쪽 세로 시간 축(예: 9, 10, 11, 12, 1, 2, 3, 4, 5, 6 또는 9~21):
   - 에브리타임에서는 숫자(예: 9, 10, 11, 12, 1, 2, 3, 4)가 각 시간 칸의 **윗 가로선(정각 시작선) 바로 아래 안쪽**에 표시됩니다.
   - 즉, 블록의 윗변이 숫자 "12"가 적힌 칸의 윗 가로선과 맞닿아 있으면 시작 시각은 "12:00"입니다("11:30"으로 오독하지 마세요).
   - 에브리타임은 오후 1시~9시를 "1, 2, 3, 4, 5, 6, 7, 8, 9"로 표기하므로 반드시 24시간제 HH:mm 형식으로 변환하세요 (예: 오후 1시 15분 -> "13:15", 오후 3시 -> "15:00").
   - 한국 대학 주 2회 수업(월·수, 화·목)은 75분(1시간 15분, 예: 09:00~10:15, 11:00~12:15, 12:00~13:15, 15:00~16:15) 또는 90분(1시간 30분) 단위인 경우가 많습니다. 블록의 윗변과 아랫변이 가로 눈금선 대비 어디에 위치하는지 15분 단위로 정밀하게 읽으세요.
   - 같은 과목이 월·수 또는 화·목 두 요일에 있으면 각각 별도의 item으로 추출하세요.
3. 블록 안의 텍스트:
   - title: 칸 너비 때문에 줄바꿈으로 잘린 과목명(예: "자바프로그래\n밍", "컴퓨터네트워\n크1", "프로그래밍개\n론")은 반드시 줄바꿈 없이 온전한 한 단어로 이어 붙여 작성하세요 (예: "자바프로그래밍", "컴퓨터네트워크1", "프로그래밍개론").
   - memo: 강의실(예: 프라임관201, 명신관701, 공학관 302), 교수명, 분반 등 부가 정보를 작성 (없으면 빈 문자열 "")
   - 정규 수업은 category: "fixed", subType: "class", priority: "medium"
4. 특정 날짜가 명시된 공지/달력/시험 일정표인 경우:
   - specificDate를 "YYYY-MM-DD"로 채우고 dayOfWeek는 null로 두세요.
   - 시험은 subType: "exam", priority: "high" / 과제는 subType: "assignment", priority: "high" / 학과 행사는 subType: "event"로 분류하세요.
5. 이미지에 실제로 보이는 항목만 추출하고, 보이지 않는 일정은 지어내지 마세요.`;

      const response = await generateContentWithRetry(ai, {
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: resolvedMime,
                data: cleanedBase64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: "인식된 시간표/일정 이미지에 대한 간단한 한국어 요약",
              },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: "수업명 또는 일정 제목" },
                    category: { type: Type.STRING, description: "fixed 또는 personal" },
                    subType: {
                      type: Type.STRING,
                      description: "class, assignment, exam, event, study, routine 중 하나",
                    },
                    dayOfWeek: {
                      type: Type.INTEGER,
                      nullable: true,
                      description: "0(일)~6(토), 주간 시간표일 때",
                    },
                    specificDate: {
                      type: Type.STRING,
                      nullable: true,
                      description: "YYYY-MM-DD 형식, 특정 날짜가 명시된 경우",
                    },
                    startTime: { type: Type.STRING, description: "HH:mm 24시간 형식" },
                    endTime: { type: Type.STRING, description: "HH:mm 24시간 형식" },
                    priority: { type: Type.STRING, description: "high, medium, low 중 하나" },
                    memo: { type: Type.STRING, description: "강의실, 교수명, 준비물 등 메모" },
                  },
                  required: ["title", "category", "subType", "startTime", "endTime", "priority", "memo"],
                },
              },
            },
            required: ["summary", "items"],
          },
        },
      });

      const parsed = safeParseJsonObject<{ summary?: string; items?: unknown[] }>(response.text);
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

      const validSubTypes = new Set(["class", "assignment", "exam", "event", "study", "routine"]);
      const validPriorities = new Set(["high", "medium", "low"]);

      const normalizedItems: ParsedTimetableBlock[] = rawItems
        .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
        .map((it) => {
          const title = typeof it.title === "string" ? it.title.trim() : "";
          let startTime = normalizeHHMM(it.startTime, "09:00");
          let endTime = normalizeHHMM(it.endTime, "10:00");

          // Fix Everytime 12-hour afternoon misread (e.g. start 12:00, end 01:30 -> 13:30)
          if (toMins(endTime) <= toMins(startTime)) {
            const [eh, em] = endTime.split(":").map(Number);
            if (eh >= 1 && eh <= 10 && eh + 12 <= 23) {
              endTime = `${String(eh + 12).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
            }
          }
          if (toMins(endTime) <= toMins(startTime)) {
            const startM = toMins(startTime);
            const fallbackEnd = Math.min(23 * 60 + 50, startM + 60);
            endTime = `${String(Math.floor(fallbackEnd / 60)).padStart(2, "0")}:${String(
              fallbackEnd % 60
            ).padStart(2, "0")}`;
          }

          const rawDate =
            typeof it.specificDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.specificDate.trim())
              ? it.specificDate.trim()
              : null;
          const dayOfWeek = rawDate ? null : normalizeDayOfWeek(it.dayOfWeek);

          const category: "fixed" | "personal" = it.category === "personal" ? "personal" : "fixed";
          const subType =
            typeof it.subType === "string" && validSubTypes.has(it.subType)
              ? (it.subType as ParsedTimetableBlock["subType"])
              : category === "personal"
              ? "study"
              : "class";
          const priority =
            typeof it.priority === "string" && validPriorities.has(it.priority)
              ? (it.priority as ParsedTimetableBlock["priority"])
              : "medium";

          return {
            title,
            category,
            subType,
            dayOfWeek: rawDate ? null : dayOfWeek ?? 1,
            specificDate: rawDate,
            startTime,
            endTime,
            priority,
            memo: typeof it.memo === "string" ? it.memo.trim() : "",
          };
        })
        .filter((it) => it.title.length > 0);

      return res.json({
        summary: parsed.summary || `총 ${normalizedItems.length}개의 시간표 일정을 인식했습니다.`,
        items: normalizedItems,
      });
    } catch (err) {
      return handleGeminiError(res, err, "시간표 이미지 분석 중 오류가 발생했습니다.");
    }
  });

  // 2. Adaptive Study Recommendation into Free Time Slots
  app.post("/api/study/recommend", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        error: "GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 또는 호스팅 환경변수에 API 키를 설정해 주세요.",
      });
    }

    try {
      const { targetDate, freeSlots, studyGoals, existingEvents, mode } = req.body as {
        targetDate: string;
        freeSlots: FreeSlotInput[];
        studyGoals: StudyGoalInput[];
        existingEvents: ExistingScheduleInput[];
        mode?: "day" | "week";
      };

      if (!Array.isArray(freeSlots) || freeSlots.length === 0) {
        return res.status(400).json({ error: "배치할 수 있는 빈 시간대가 없습니다." });
      }
      if (!Array.isArray(studyGoals) || studyGoals.length === 0) {
        return res.status(400).json({ error: "먼저 공부 목표 과목을 1개 이상 추가해 주세요." });
      }

      const prompt = `당신은 타이머 학습 데이터와 사용자의 빈 시간대를 분석하여 최적의 개인 공부 타임블록을 추천하는 AI 학습 플래너입니다.

목표 범위: ${mode === "week" ? "이번 주 전체" : `${targetDate} 하루`}

[과목별 목표 및 실제 스톱워치 학습 피드백]
${studyGoals
  .map(
    (g) =>
      `- id="${g.id}", 과목="${g.subjectName}", 주간목표=${g.weeklyTargetMinutes}분, 이번주누적=${g.completedThisWeekMinutes}분, 기본세션=${g.defaultSessionMinutes}분, 우선순위=${g.priority}, 실제/목표 소요비율=${Number(g.actualToPlannedRatio || 1).toFixed(2)}배 (기록 ${g.sessionCount}회)`
  )
  .join("\n")}

[사용 가능한 빈 시간대 목록 (반드시 이 시간대 내부에만 배치하세요)]
${freeSlots
  .map((s) => `- ${s.date}: ${s.startTime} ~ ${s.endTime} (${s.durationMinutes}분 가능)`)
  .join("\n")}

[이미 등록된 일정 (참고용 - 겹치지 않게 배치)]
${
  Array.isArray(existingEvents) && existingEvents.length > 0
    ? existingEvents
        .map((e) => `- ${e.date} ${e.startTime}~${e.endTime}: ${e.title} (${e.category}, ${e.priority})`)
        .join("\n")
    : "- 등록된 일정 없음"
}

추천 생성 규칙:
1. 모든 추천 블록의 date, startTime, endTime은 반드시 위 [사용 가능한 빈 시간대 목록] 중 하나의 범위 안에 완전히 포함되어야 합니다. 서로 겹치면 안 됩니다.
2. **적응형 소요 시간 반영 (핵심)**:
   - '실제/목표 소요비율(actualToPlannedRatio)'이 1.0보다 큰 과목(예: 1.25배)은 사용자가 실제 스톱워치 측정 시 예상보다 더 오래 집중하거나 시간이 더 걸리는 과목이므로, 빈 시간대가 허락하는 범위에서 기본세션(defaultSessionMinutes)에 비율을 곱해(최대 120분) 넉넉하게 배정하고 reason에 이를 명시하세요.
   - 비율이 0.85 이하인 과목은 집중이 빨리 끝나거나 집중력 유지가 짧았던 과목이므로 짧은 집중 세션(25~45분)으로 쪼개어 배정하세요.
   - 기록이 0회이면 기본세션 길이로 배정하세요.
3. 주간 목표 달성률이 낮고 우선순위가 높은 과목을 먼저 배치하세요.
4. 하루 추천 시 최대 3~4개 블록, 주간 추천 시 최대 8개 블록을 실용적으로 제안하세요 (휴식 10~15분 여백 권장).
5. reason에는 왜 이 빈 시간대와 길이(분)를 추천했는지 구체적인 수치와 실제 소요 시간 반영 근거를 자연스러운 한국어 1~2문장으로 적으세요.`;

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              strategySummary: {
                type: Type.STRING,
                description: "전체 추천 전략 및 실제 소요 시간 반영 요약",
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    subjectId: { type: Type.STRING },
                    subjectName: { type: Type.STRING },
                    date: { type: Type.STRING, description: "YYYY-MM-DD" },
                    startTime: { type: Type.STRING, description: "HH:mm" },
                    endTime: { type: Type.STRING, description: "HH:mm" },
                    plannedMinutes: { type: Type.INTEGER },
                    reason: { type: Type.STRING },
                  },
                  required: [
                    "subjectId",
                    "subjectName",
                    "date",
                    "startTime",
                    "endTime",
                    "plannedMinutes",
                    "reason",
                  ],
                },
              },
            },
            required: ["strategySummary", "recommendations"],
          },
        },
      });

      const parsed = safeParseJsonObject<{
        strategySummary?: string;
        recommendations?: Array<{
          subjectId: string;
          subjectName: string;
          date: string;
          startTime: string;
          endTime: string;
          plannedMinutes: number;
          reason: string;
        }>;
      }>(response.text);

      const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map(
        (rec) => ({
          subjectId: String(rec.subjectId || ""),
          subjectName: String(rec.subjectName || "공부"),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(rec.date || "")) ? String(rec.date) : targetDate,
          startTime: normalizeHHMM(rec.startTime, "09:00"),
          endTime: normalizeHHMM(rec.endTime, "10:00"),
          plannedMinutes: Math.max(15, Math.round(Number(rec.plannedMinutes) || 50)),
          reason: String(rec.reason || ""),
        })
      );

      return res.json({
        strategySummary:
          parsed.strategySummary || "빈 시간대와 학습 기록을 반영해 추천 스케줄을 생성했습니다.",
        recommendations,
      });
    } catch (err) {
      return handleGeminiError(res, err, "AI 공부 시간 추천 생성 중 오류가 발생했습니다.");
    }
  });

  // 3. Background Web Push Reminder Scheduler (delivers top-of-screen banners even when user is in another app)
  interface StoredPushReminder {
    key: string;
    title: string;
    body: string;
    triggerAtEpoch: number;
    sent: boolean;
  }

  interface StoredPushEntry {
    subscription: PushSubscription;
    reminders: StoredPushReminder[];
    updatedAt: number;
  }

  const vapidFilePath = path.join(os.tmpdir(), "dayflow-vapid.json");
  const pushStorePath = path.join(os.tmpdir(), "dayflow-push-reminders.json");

  function loadOrCreateVapidKeys(): { publicKey: string; privateKey: string } {
    const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
    const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
    if (envPub && envPriv) {
      return { publicKey: envPub, privateKey: envPriv };
    }
    try {
      if (fs.existsSync(vapidFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(vapidFilePath, "utf-8")) as {
          publicKey?: string;
          privateKey?: string;
        };
        if (parsed.publicKey && parsed.privateKey) {
          return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
        }
      }
    } catch {
      // fallback to generate below
    }
    const generated = webpush.generateVAPIDKeys();
    try {
      fs.writeFileSync(vapidFilePath, JSON.stringify(generated), "utf-8");
    } catch {
      // non-fatal
    }
    return generated;
  }

  const vapidKeys = loadOrCreateVapidKeys();
  const vapidSubject = process.env.VAPID_SUBJECT?.trim() || "mailto:dayflow-alerts@example.com";
  webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

  const pushStore = new Map<string, StoredPushEntry>();

  function loadPushStore() {
    try {
      if (!fs.existsSync(pushStorePath)) return;
      const raw = JSON.parse(fs.readFileSync(pushStorePath, "utf-8")) as StoredPushEntry[];
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        if (entry?.subscription?.endpoint && Array.isArray(entry.reminders)) {
          pushStore.set(entry.subscription.endpoint, entry);
        }
      }
    } catch {
      // ignore corrupt tmp cache
    }
  }

  function persistPushStore() {
    try {
      fs.writeFileSync(pushStorePath, JSON.stringify(Array.from(pushStore.values())), "utf-8");
    } catch {
      // non-fatal
    }
  }

  loadPushStore();

  async function dispatchDuePushReminders() {
    const now = Date.now();
    let mutated = false;

    for (const [endpoint, entry] of pushStore.entries()) {
      // Prune expired reminders older than 2 hours
      const beforeLen = entry.reminders.length;
      entry.reminders = entry.reminders.filter((r) => now - r.triggerAtEpoch < 2 * 60 * 60 * 1000);
      if (entry.reminders.length !== beforeLen) mutated = true;

      for (const reminder of entry.reminders) {
        if (reminder.sent) continue;
        // Fire within a 10-minute catch-up window once triggerAtEpoch is reached
        if (now >= reminder.triggerAtEpoch && now <= reminder.triggerAtEpoch + 10 * 60 * 1000) {
          reminder.sent = true;
          mutated = true;
          try {
            await webpush.sendNotification(
              entry.subscription,
              JSON.stringify({
                title: reminder.title,
                body: reminder.body,
                tag: `dayflow-${reminder.key}`,
                url: "/",
              }),
              { TTL: 600, urgency: "high" }
            );
          } catch (err) {
            const statusCode = (err as { statusCode?: number })?.statusCode;
            if (statusCode === 404 || statusCode === 410) {
              pushStore.delete(endpoint);
              break;
            }
            console.warn("[WebPush] delivery failed:", statusCode || (err instanceof Error ? err.message : String(err)));
          }
        }
      }
    }

    if (mutated) {
      persistPushStore();
    }
  }

  setInterval(() => {
    dispatchDuePushReminders().catch(() => {});
  }, 10_000);

  app.get("/api/push/vapid-public-key", (_req: Request, res: Response) => {
    return res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post("/api/push/sync", (req: Request, res: Response) => {
    const { subscription, reminders } = req.body as {
      subscription?: PushSubscription;
      reminders?: Array<{
        key?: string;
        title?: string;
        body?: string;
        triggerAtEpoch?: number;
      }>;
    };

    if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return res.status(400).json({ error: "유효한 푸시 구독 정보가 필요합니다." });
    }

    const existing = pushStore.get(subscription.endpoint);
    const alreadySentKeys = new Set(
      (existing?.reminders || []).filter((r) => r.sent).map((r) => r.key)
    );

    const now = Date.now();
    const maxFutureMs = 30 * 24 * 60 * 60 * 1000;
    const sanitized: StoredPushReminder[] = (Array.isArray(reminders) ? reminders : [])
      .filter(
        (r): r is { key: string; title: string; body: string; triggerAtEpoch: number } =>
          typeof r?.key === "string" &&
          typeof r?.title === "string" &&
          typeof r?.body === "string" &&
          typeof r?.triggerAtEpoch === "number" &&
          Number.isFinite(r.triggerAtEpoch) &&
          r.triggerAtEpoch >= now - 2 * 60 * 1000 &&
          r.triggerAtEpoch <= now + maxFutureMs
      )
      .slice(0, 100)
      .map((r) => ({
        key: r.key,
        title: r.title.slice(0, 120),
        body: r.body.slice(0, 240),
        triggerAtEpoch: r.triggerAtEpoch,
        sent: alreadySentKeys.has(r.key),
      }));

    pushStore.set(subscription.endpoint, {
      subscription,
      reminders: sanitized,
      updatedAt: now,
    });
    persistPushStore();
    dispatchDuePushReminders().catch(() => {});

    return res.json({ ok: true, scheduledCount: sanitized.filter((r) => !r.sent).length });
  });

  // Never let unmatched /api/* requests fall through to SPA index.html (which would return HTTP 200 HTML)
  app.all("/api/*", (req: Request, res: Response) => {
    return res.status(404).json({
      error: `존재하지 않는 API 경로입니다 (${req.method} ${req.path}).`,
    });
  });

  // Ensure API errors (including payload too large / bad JSON) always return valid JSON (never HTML)
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/")) {
      const e = err as { status?: number; type?: string; message?: string };
      if (e?.type === "entity.too.large" || e?.status === 413) {
        return res.status(413).json({
          error: "이미지 용량이 너무 큽니다. 더 작은 이미지를 선택하거나 다시 시도해 주세요.",
        });
      }
      return res.status(e?.status || 500).json({
        error: e?.message || "서버 요청 처리 중 오류가 발생했습니다.",
      });
    }
    next(err);
  });

  // Vite dev middleware vs static production build
  const distPath = path.resolve(__dirname, "dist");
  const isTsxRuntime =
    process.execArgv.some((arg) => arg.includes("tsx")) ||
    process.argv.some((arg) => arg.includes("tsx"));
  const useProductionStatic =
    process.env.NODE_ENV === "production" ||
    (!isTsxRuntime && fs.existsSync(path.join(distPath, "index.html")));

  if (!useProductionStatic) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `DayFlow server listening on http://0.0.0.0:${PORT} (${useProductionStatic ? "production" : "development"})`
    );
  });
  server.requestTimeout = 120000;
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
