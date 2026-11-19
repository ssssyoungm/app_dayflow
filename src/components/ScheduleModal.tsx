import React, { useEffect, useState } from "react";
import { Bell, Calendar, Download, Palette, Plus, Trash2, X } from "lucide-react";
import type {
  ColorCardId,
  PriorityLevel,
  ScheduleCategory,
  ScheduleItem,
  ScheduleSubType,
  StudyGoal,
} from "../types/dayflow";
import { COLOR_CARD_LIST, colorToHex, formatSubTypeLabel, isPresetColorId } from "../lib/colors";
import { exportSchedulesToIcs, downloadTextFile } from "../lib/ics";
import { generateId } from "../lib/storage";
import { getTodayStr, timeToMinutes } from "../lib/dateUtils";

interface ScheduleModalProps {
  isOpen: boolean;
  initialDate: string;
  editingItem: ScheduleItem | null;
  studyGoals: StudyGoal[];
  customSubTypes: string[];
  onAddCustomSubType: (label: string) => void;
  onDeleteCustomSubType: (label: string) => void;
  onClose: () => void;
  onSave: (item: ScheduleItem) => void;
  onDelete?: (id: string) => void;
  onNotifyPermissionHint?: () => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  initialDate,
  editingItem,
  studyGoals,
  customSubTypes,
  onAddCustomSubType,
  onDeleteCustomSubType,
  onClose,
  onSave,
  onDelete,
  onNotifyPermissionHint,
}) => {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ScheduleCategory>("fixed");
  const [subType, setSubType] = useState<ScheduleSubType>("");
  const [newSubTypeInput, setNewSubTypeInput] = useState("");
  const [priority, setPriority] = useState<PriorityLevel>("medium");
  const [date, setDate] = useState(initialDate || getTodayStr());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [isAllDay, setIsAllDay] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyMinutesBefore, setNotifyMinutesBefore] = useState(10);
  const [color, setColor] = useState<ColorCardId>("violet");
  const [memo, setMemo] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg("");
    setConfirmDelete(false);
    setNewSubTypeInput("");
    if (editingItem) {
      setTitle(editingItem.title);
      setCategory(editingItem.category);
      setSubType(formatSubTypeLabel(editingItem.subType));
      setPriority(editingItem.priority);
      setDate(editingItem.date);
      setStartTime(editingItem.startTime);
      setEndTime(editingItem.endTime);
      setIsAllDay(editingItem.isAllDay);
      setDueDate(editingItem.dueDate || "");
      setNotifyEnabled(editingItem.notifyEnabled);
      setNotifyMinutesBefore(editingItem.notifyMinutesBefore);
      setColor(editingItem.color);
      setMemo(editingItem.memo);
      setSubjectId(editingItem.subjectId || "");
    } else {
      setTitle("");
      setCategory("fixed");
      setSubType("");
      setPriority("medium");
      setDate(initialDate || getTodayStr());
      setStartTime("10:00");
      setEndTime("11:00");
      setIsAllDay(false);
      setDueDate("");
      setNotifyEnabled(false);
      setNotifyMinutesBefore(10);
      setColor("violet");
      setMemo("");
      setSubjectId("");
    }
  }, [isOpen, editingItem, initialDate]);

  if (!isOpen) return null;

  const handleCategoryChange = (nextCat: ScheduleCategory) => {
    setCategory(nextCat);
  };

  const handleAddSubType = () => {
    const trimmed = newSubTypeInput.trim();
    if (!trimmed) return;
    onAddCustomSubType(trimmed);
    setSubType(trimmed);
    setNewSubTypeInput("");
  };

  const handleDeleteSubType = (label: string) => {
    onDeleteCustomSubType(label);
    if (subType === label) {
      setSubType("");
    }
  };

  const handleNotificationToggle = async (checked: boolean) => {
    setNotifyEnabled(checked);
    if (checked && typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          // ignore
        }
      }
      if (Notification.permission === "denied" && onNotifyPermissionHint) {
        onNotifyPermissionHint();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setErrorMsg("일정 이름을 입력해 주세요.");
      return;
    }
    if (!isAllDay && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      setErrorMsg("종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }

    // If user typed a new subtype in the input box without tapping "추가", save & select it automatically
    const pendingSubType = newSubTypeInput.trim();
    let resolvedSubType = subType.trim();
    if (pendingSubType) {
      onAddCustomSubType(pendingSubType);
      resolvedSubType = pendingSubType;
    }

    const nowIso = new Date().toISOString();
    const plannedMinutes = isAllDay
      ? 60
      : Math.max(10, timeToMinutes(endTime) - timeToMinutes(startTime));

    const item: ScheduleItem = {
      id: editingItem ? editingItem.id : generateId("sch"),
      title: trimmed,
      category,
      subType: resolvedSubType,
      priority,
      date,
      startTime: isAllDay ? "00:00" : startTime,
      endTime: isAllDay ? "23:59" : endTime,
      isAllDay,
      dueDate: dueDate.trim() ? dueDate.trim() : undefined,
      notifyEnabled,
      notifyMinutesBefore,
      color,
      memo: memo.trim(),
      completed: editingItem ? editingItem.completed : false,
      subjectId: category === "personal" && subjectId ? subjectId : undefined,
      plannedMinutes,
      createdAt: editingItem ? editingItem.createdAt : nowIso,
      updatedAt: nowIso,
    };

    onSave(item);
    onClose();
  };

  const handleSingleIcsExport = () => {
    if (!editingItem) return;
    const ics = exportSchedulesToIcs([editingItem], editingItem.title);
    downloadTextFile(`${editingItem.title.replace(/\s+/g, "_")}.ics`, ics, "text/calendar;charset=utf-8");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
    >
      <div className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mt-3 sm:hidden shrink-0" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 id="schedule-modal-title" className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            {editingItem ? "일정 수정" : "새 일정 등록"}
          </h2>
          <div className="flex items-center gap-1">
            {editingItem && (
              <button
                type="button"
                onClick={handleSingleIcsExport}
                className="min-h-[40px] px-2.5 flex items-center gap-1 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title=".ics 캘린더 파일 내보내기"
              >
                <Download className="w-4 h-4" />
                <span>.ics</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Category Segmented Toggle */}
          <div>
            <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              일정 구분
            </span>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => handleCategoryChange("fixed")}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  category === "fixed"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                고정 일정
              </button>
              <button
                type="button"
                onClick={() => handleCategoryChange("personal")}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  category === "personal"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                개인 스케줄
              </button>
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="sch-title" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              일정 이름
            </label>
            <input
              id="sch-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                category === "fixed"
                  ? "예: 운영체제 중간고사, 팀 프로젝트 발표"
                  : "예: 자료구조 3장 복습, 토익 LC 문제풀이"
              }
              className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* Custom User-Defined SubTypes (Unlimited) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="sch-custom-subtype" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                세부 유형 (직접 설정 · 개수 제한 없음)
              </label>
              {subType && (
                <button
                  type="button"
                  onClick={() => setSubType("")}
                  className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  선택 해제
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="sch-custom-subtype"
                type="text"
                value={newSubTypeInput}
                onChange={(e) => setNewSubTypeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleAddSubType();
                  }
                }}
                placeholder="원하는 세부 유형 입력 (예: 동아리, 알바, 자격증)"
                className="flex-1 min-w-0 min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                type="button"
                onClick={handleAddSubType}
                disabled={!newSubTypeInput.trim()}
                className="min-h-[42px] px-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>추가</span>
              </button>
            </div>

            {customSubTypes.length > 0 || subType ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {subType && !customSubTypes.includes(subType) && (
                  <div className="inline-flex items-center rounded-xl border border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSubType("")}
                      className="min-h-[34px] px-3 text-xs font-semibold"
                    >
                      {subType}
                    </button>
                  </div>
                )}
                {customSubTypes.map((label) => {
                  const active = subType === label;
                  return (
                    <div
                      key={label}
                      className={`inline-flex items-center rounded-xl border transition-colors overflow-hidden ${
                        active
                          ? "border-violet-600 dark:border-violet-400 bg-violet-600 text-white"
                          : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-violet-400 dark:hover:border-violet-600"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSubType(active ? "" : label)}
                        className="min-h-[34px] pl-3 pr-2 text-xs font-medium whitespace-nowrap"
                      >
                        {label}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSubType(label)}
                        aria-label={`${label} 세부 유형 삭제`}
                        className={`min-h-[34px] px-2 flex items-center justify-center transition-colors ${
                          active
                            ? "text-violet-100 hover:bg-violet-700"
                            : "text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                아직 추가한 세부 유형이 없습니다. 위 입력창에 원하는 유형을 자유롭게 추가하거나, 선택 없이 바로 저장할 수 있습니다.
              </p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label htmlFor="sch-priority" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              우선순위 {category === "fixed" ? "(월간 표시 기준)" : ""}
            </label>
            <select
              id="sch-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as PriorityLevel)}
              className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="high">높음 (중요)</option>
              <option value="medium">보통</option>
              <option value="low">낮음</option>
            </select>
          </div>

          {/* Linked Study Subject (when Personal) */}
          {category === "personal" && studyGoals.length > 0 && (
            <div>
              <label htmlFor="sch-subject" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                연결할 공부 목표 과목 (선택)
              </label>
              <select
                id="sch-subject"
                value={subjectId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSubjectId(nextId);
                  const found = studyGoals.find((g) => g.id === nextId);
                  if (found) {
                    setColor(found.color);
                    if (!title.trim()) {
                      setTitle(`${found.subjectName} 공부`);
                    }
                  }
                }}
                className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">연결 안 함</option>
                {studyGoals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.subjectName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date & Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sch-date" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                일정 날짜
              </label>
              <div className="relative">
                <input
                  id="sch-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sch-due" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                마감일 (선택 · 월간 표시 연동)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="sch-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => setDueDate("")}
                    className="min-h-[44px] px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
                  >
                    지움
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* All-day & Start/End Time */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                시간 설정
              </span>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer min-h-[32px]">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                />
                종일 일정
              </label>
            </div>
            {!isAllDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sch-start" className="sr-only">시작 시간</label>
                  <input
                    id="sch-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label htmlFor="sch-end" className="sr-only">종료 시간</label>
                  <input
                    id="sch-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Notification toggle */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Bell className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    웹 알림 및 캘린더(.ics) 알림
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    설정한 시간 전에 브라우저 알림 및 VALARM을 포함합니다
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={notifyEnabled}
                onChange={(e) => handleNotificationToggle(e.target.checked)}
                aria-label="일정 알림 설정"
                className="h-5 w-5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
              />
            </div>
            {notifyEnabled && (
              <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-xs text-zinc-600 dark:text-zinc-400">알림 시점</span>
                <select
                  value={notifyMinutesBefore}
                  onChange={(e) => setNotifyMinutesBefore(Number(e.target.value))}
                  className="min-h-[36px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value={0}>정시 알림</option>
                  <option value={10}>10분 전</option>
                  <option value={30}>30분 전</option>
                  <option value={60}>1시간 전</option>
                </select>
              </div>
            )}
          </div>

          {/* Color Card Picker */}
          <div>
            <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
              색상 카드 선택
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_CARD_LIST.map((c) => {
                const selected = color === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColor(c.id)}
                    className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium flex items-center gap-2 transition-all ${
                      selected
                        ? "border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-950/40 text-zinc-900 dark:text-zinc-50 ring-1 ring-violet-500"
                        : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: c.swatchHex }}
                    />
                    <span>{c.label}</span>
                  </button>
                );
              })}

              <label
                className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium flex items-center gap-2 cursor-pointer transition-all ${
                  !isPresetColorId(color)
                    ? "border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-950/40 text-zinc-900 dark:text-zinc-50 ring-1 ring-violet-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                }`}
              >
                <input
                  type="color"
                  value={colorToHex(color)}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="일정 자유 색상 선택"
                  className="sr-only"
                />
                <span
                  className="w-3 h-3 rounded-full border border-black/15 dark:border-white/25 shrink-0"
                  style={{ backgroundColor: colorToHex(color) }}
                />
                <Palette className="w-3.5 h-3.5 shrink-0" />
                <span>{!isPresetColorId(color) ? colorToHex(color) : "직접 선택"}</span>
              </label>
            </div>
          </div>

          {/* Memo */}
          <div>
            <label htmlFor="sch-memo" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              메모
            </label>
            <textarea
              id="sch-memo"
              rows={3}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="강의실, 준비물, 공부 범위 등 세부 메모를 입력하세요"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            />
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{errorMsg}</p>
          )}

          {/* Footer Buttons */}
          <div className="pt-2 pb-safe flex items-center justify-between gap-3">
            {editingItem && onDelete ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(editingItem.id);
                      onClose();
                    }}
                    className="min-h-[44px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
                  >
                    삭제 확인
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[44px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>삭제</span>
                </button>
              )
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                취소
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-6 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors shadow-sm"
              >
                {editingItem ? "저장하기" : "일정 추가"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
