import "dotenv/config";
import express, { type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
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

function handleGeminiError(res: Response, err: unknown, fallbackMsg: string) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[Gemini API Error]:", message);

  if (message.includes("PERMISSION_DENIED") || message.includes("API_KEY_INVALID") || message.includes("403") || message.includes("400")) {
    return res.status(400).json({
      error: "Gemini API 키가 유효하지 않거나 설정되지 않았습니다. Settings > Secrets에서 GEMINI_API_KEY를 확인해 주세요.",
      details: message,
    });
  }
  if (message.includes("RESOURCE_EXHAUSTED") || message.includes("429")) {
    return res.status(429).json({
      error: "Gemini API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
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
  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "dayflow-api" });
  });

  // 1. Everytime Timetable / Schedule Photo Recognition via Gemini AI
  app.post("/api/timetable/parse", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        error: "GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 패널에서 API 키를 설정해 주세요.",
      });
    }

    try {
      const { imageBase64, mimeType, referenceDate } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        referenceDate?: string;
      };

      if (!imageBase64 || !mimeType) {
        return res.status(400).json({ error: "이미지 데이터가 필요합니다." });
      }

      const cleanedBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");

      const prompt = `당신은 한국 대학생의 시간표(에브리타임 등) 및 일정 이미지를 정확하게 분석하는 플래너 어시스턴트입니다.
업로드된 이미지를 분석해 모든 수업, 시험, 과제, 행사, 또는 개인 일정을 구조화된 JSON 배열로 추출하세요.
기준 날짜(참고용): ${referenceDate || "오늘"}

추출 규칙:
1. 에브리타임 주간 시간표(월~일 요일 격자)인 경우:
   - dayOfWeek를 0(일), 1(월), 2(화), 3(수), 4(목), 5(금), 6(토) 중 하나로 정확히 지정하고 specificDate는 null로 두세요.
   - 1교시/2교시 또는 시간 눈금(예: 9, 10, 11, 오전/오후)을 기준으로 시작/종료 시각을 HH:mm (24시간 형식, 예: "09:00", "13:30")으로 추론하세요.
   - 강의명과 강의실/교수명이 보이면 title에는 과목명을, memo에는 강의실/교수명 등 부가 정보를 적으세요.
   - 정규 수업은 category: "fixed", subType: "class", priority: "medium"으로 분류하세요.
2. 특정 날짜가 명시된 달력/공지/캘린더/시험 일정표 이미지인 경우:
   - specificDate를 "YYYY-MM-DD" 형식으로 채우고 dayOfWeek는 null로 두세요.
   - 시험은 subType: "exam", priority: "high" / 과제는 subType: "assignment", priority: "high" / 학과 행사는 subType: "event"로 분류하세요.
   - 개인 공부나 루틴 성격이면 category: "personal", subType: "study" 또는 "routine"으로 분류하세요.
3. 시간이 명시되지 않은 종일 일정이면 startTime: "09:00", endTime: "10:00"을 기본값으로 두고 memo에 "(종일 일정)"을 추가하세요.
4. 이미지에서 읽을 수 없는 항목을 임의로 지어내지 마세요.`;

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
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
                    subType: { type: Type.STRING, description: "class, assignment, exam, event, study, routine 중 하나" },
                    dayOfWeek: { type: Type.INTEGER, nullable: true, description: "0(일)~6(토), 특정 날짜가 없는 주간 시간표일 때" },
                    specificDate: { type: Type.STRING, nullable: true, description: "YYYY-MM-DD 형식, 특정 날짜가 명시된 경우" },
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

      const rawText = (response.text ?? "{}").trim();
      const parsed = JSON.parse(rawText) as { summary?: string; items?: ParsedTimetableBlock[] };

      return res.json({
        summary: parsed.summary || "시간표를 인식했습니다.",
        items: Array.isArray(parsed.items) ? parsed.items : [],
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
        error: "GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 패널에서 API 키를 설정해 주세요.",
      });
    }

    try {
      const {
        targetDate,
        freeSlots,
        studyGoals,
        existingEvents,
        mode,
      } = req.body as {
        targetDate: string;
        freeSlots: FreeSlotInput[];
        studyGoals: StudyGoalInput[];
        existingEvents: ExistingScheduleInput[];
        mode?: "day" | "week";
      };

      if (!freeSlots || freeSlots.length === 0) {
        return res.status(400).json({ error: "배치할 수 있는 빈 시간대가 없습니다." });
      }
      if (!studyGoals || studyGoals.length === 0) {
        return res.status(400).json({ error: "먼저 공부 목표 과목을 1개 이상 추가해 주세요." });
      }

      const prompt = `당신은 열품타 학습 데이터와 사용자의 빈 시간대를 분석하여 최적의 개인 공부 타임블록을 추천하는 AI 학습 플래너입니다.

목표 범위: ${mode === "week" ? "이번 주 전체" : `${targetDate} 하루`}

[과목별 목표 및 실제 스톱워치 학습 피드백]
${studyGoals
  .map(
    (g) =>
      `- id="${g.id}", 과목="${g.subjectName}", 주간목표=${g.weeklyTargetMinutes}분, 이번주누적=${g.completedThisWeekMinutes}분, 기본세션=${g.defaultSessionMinutes}분, 우선순위=${g.priority}, 실제/목표 소요비율=${g.actualToPlannedRatio.toFixed(2)}배 (기록 ${g.sessionCount}회)`
  )
  .join("\n")}

[사용 가능한 빈 시간대 목록 (반드시 이 시간대 내부에만 배치하세요)]
${freeSlots
  .map((s) => `- ${s.date}: ${s.startTime} ~ ${s.endTime} (${s.durationMinutes}분 가능)`)
  .join("\n")}

[이미 등록된 일정 (참고용 - 겹치지 않게 배치)]
${
  existingEvents.length > 0
    ? existingEvents.map((e) => `- ${e.date} ${e.startTime}~${e.endTime}: ${e.title} (${e.category}, ${e.priority})`).join("\n")
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

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
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
                  required: ["subjectId", "subjectName", "date", "startTime", "endTime", "plannedMinutes", "reason"],
                },
              },
            },
            required: ["strategySummary", "recommendations"],
          },
        },
      });

      const rawText = (response.text ?? "{}").trim();
      const parsed = JSON.parse(rawText) as {
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
      };

      return res.json({
        strategySummary: parsed.strategySummary || "빈 시간대와 학습 기록을 반영해 추천 스케줄을 생성했습니다.",
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      });
    } catch (err) {
      return handleGeminiError(res, err, "AI 공부 시간 추천 생성 중 오류가 발생했습니다.");
    }
  });

  // Vite dev middleware vs static production build
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DayFlow server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
