import type { CSSProperties } from "react";
import type {
  ColorCardId,
  PresetColorId,
  PriorityLevel,
  ScheduleCategory,
  ScheduleSubType,
} from "../types/dayflow";

export interface ColorCardTheme {
  id: PresetColorId;
  label: string;
  swatchHex: string;
  cardClass: string;
  accentTextClass: string;
  dotClass: string;
}

export const COLOR_CARDS: Record<PresetColorId, ColorCardTheme> = {
  violet: {
    id: "violet",
    label: "퍼플",
    swatchHex: "#7C3AED",
    cardClass:
      "bg-violet-50/75 dark:bg-violet-950/35 border-violet-200/80 dark:border-violet-800/60",
    accentTextClass: "text-violet-700 dark:text-violet-300",
    dotClass: "bg-violet-600 dark:bg-violet-400",
  },
  indigo: {
    id: "indigo",
    label: "인디고",
    swatchHex: "#4F46E5",
    cardClass:
      "bg-indigo-50/75 dark:bg-indigo-950/35 border-indigo-200/80 dark:border-indigo-800/60",
    accentTextClass: "text-indigo-700 dark:text-indigo-300",
    dotClass: "bg-indigo-600 dark:bg-indigo-400",
  },
  sky: {
    id: "sky",
    label: "스카이",
    swatchHex: "#0284C7",
    cardClass:
      "bg-sky-50/75 dark:bg-sky-950/35 border-sky-200/80 dark:border-sky-800/60",
    accentTextClass: "text-sky-700 dark:text-sky-300",
    dotClass: "bg-sky-600 dark:bg-sky-400",
  },
  emerald: {
    id: "emerald",
    label: "에메랄드",
    swatchHex: "#059669",
    cardClass:
      "bg-emerald-50/75 dark:bg-emerald-950/35 border-emerald-200/80 dark:border-emerald-800/60",
    accentTextClass: "text-emerald-700 dark:text-emerald-300",
    dotClass: "bg-emerald-600 dark:bg-emerald-400",
  },
  amber: {
    id: "amber",
    label: "앰버",
    swatchHex: "#D97706",
    cardClass:
      "bg-amber-50/75 dark:bg-amber-950/35 border-amber-200/80 dark:border-amber-800/60",
    accentTextClass: "text-amber-700 dark:text-amber-300",
    dotClass: "bg-amber-600 dark:bg-amber-400",
  },
  rose: {
    id: "rose",
    label: "로즈",
    swatchHex: "#E11D48",
    cardClass:
      "bg-rose-50/75 dark:bg-rose-950/35 border-rose-200/80 dark:border-rose-800/60",
    accentTextClass: "text-rose-700 dark:text-rose-300",
    dotClass: "bg-rose-600 dark:bg-rose-400",
  },
  slate: {
    id: "slate",
    label: "모노",
    swatchHex: "#52525B",
    cardClass:
      "bg-zinc-50 dark:bg-zinc-900/90 border-zinc-200 dark:border-zinc-800",
    accentTextClass: "text-zinc-700 dark:text-zinc-300",
    dotClass: "bg-zinc-600 dark:bg-zinc-400",
  },
};

export const COLOR_CARD_LIST: ColorCardTheme[] = Object.values(COLOR_CARDS);

export function isPresetColorId(val: string): val is PresetColorId {
  return Object.prototype.hasOwnProperty.call(COLOR_CARDS, val);
}

export function isValidHexColor(val: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(val.trim());
}

export function colorToHex(color: ColorCardId): string {
  if (isPresetColorId(color)) {
    return COLOR_CARDS[color].swatchHex;
  }
  if (isValidHexColor(color)) {
    return color.toUpperCase();
  }
  return COLOR_CARDS.violet.swatchHex;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export interface ResolvedColorTheme {
  hex: string;
  isCustom: boolean;
  cardClass: string;
  cardStyle?: CSSProperties;
  dotClass: string;
  dotStyle?: CSSProperties;
  accentTextClass: string;
  accentStyle?: CSSProperties;
  progressStyle: CSSProperties;
}

/** Resolves either a built-in preset ID or any custom #RRGGBB hex color cleanly for light/dark themes */
export function resolveColorTheme(color: ColorCardId | undefined): ResolvedColorTheme {
  const val = (color || "violet").trim();
  if (isPresetColorId(val)) {
    const preset = COLOR_CARDS[val];
    return {
      hex: preset.swatchHex,
      isCustom: false,
      cardClass: preset.cardClass,
      dotClass: preset.dotClass,
      accentTextClass: preset.accentTextClass,
      progressStyle: { backgroundColor: preset.swatchHex },
    };
  }

  const hex = isValidHexColor(val) ? val : COLOR_CARDS.violet.swatchHex;
  const { r, g, b } = hexToRgb(hex);

  return {
    hex,
    isCustom: true,
    cardClass: "",
    cardStyle: {
      backgroundColor: `rgba(${r}, ${g}, ${b}, 0.11)`,
      borderColor: `rgba(${r}, ${g}, ${b}, 0.34)`,
    },
    dotClass: "",
    dotStyle: {
      backgroundColor: hex,
    },
    accentTextClass: "",
    accentStyle: {
      color: hex,
    },
    progressStyle: {
      backgroundColor: hex,
    },
  };
}

export const CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  fixed: "고정 일정",
  personal: "개인 스케줄",
};

export const SUBTYPE_LABELS: Record<ScheduleSubType, string> = {
  assignment: "과제",
  event: "학과 행사",
  exam: "시험",
  class: "수업",
  study: "과목 공부",
  routine: "개인 루틴",
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};
