import React, { useState } from "react";
import { Download, Share, PlusSquare, X } from "lucide-react";
import { usePWAInstall } from "../hooks/usePWAInstall";

interface PWAInstallButtonProps {
  variant?: "compact" | "full";
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = "compact" }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    if (variant === "full") {
      return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
          홈 화면 앱(Standalone) 모드로 실행 중입니다.
        </div>
      );
    }
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === "full"
            ? "w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            : "min-h-[40px] flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>앱으로 설치</span>
      </button>
    );
  }

  // On iOS Safari (or non-Chromium browsers), show guided "홈 화면에 추가" modal
  return (
    <>
      <button
        type="button"
        onClick={() => setShowIOSGuide(true)}
        className={
          variant === "full"
            ? "w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            : "min-h-[40px] flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
        }
      >
        <Share className="w-3.5 h-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
        <span>{isIOS ? "홈 화면에 추가" : "앱 설치 안내"}</span>
      </button>

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-pwa-guide-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 pb-safe shadow-2xl">
            <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between">
              <h3
                id="ios-pwa-guide-title"
                className="text-base font-bold text-zinc-900 dark:text-zinc-50"
              >
                아이폰 Safari 홈 화면에 추가
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              데이플로우(DayFlow)를 앱처럼 전체 화면으로 사용하고 오프라인에서도 일정을 확인할 수 있습니다.
            </p>

            <ol className="mt-4 space-y-3">
              <li className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white">
                  1
                </span>
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  하단 Safari 도구 막대의{" "}
                  <span className="inline-flex items-center gap-1 font-semibold text-violet-600 dark:text-violet-400">
                    <Share className="w-3.5 h-3.5" /> 공유
                  </span>{" "}
                  버튼을 누르세요.
                </div>
              </li>
              <li className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white">
                  2
                </span>
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  아래로 스크롤해{" "}
                  <span className="inline-flex items-center gap-1 font-semibold text-violet-600 dark:text-violet-400">
                    <PlusSquare className="w-3.5 h-3.5" /> 홈 화면에 추가
                  </span>
                  를 선택하세요.
                </div>
              </li>
              <li className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white">
                  3
                </span>
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  우측 상단 <span className="font-semibold">추가</span>를 누르면 홈 화면에 DayFlow 아이콘이 생성됩니다.
                </div>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  );
};
