import { useEffect, useState } from "react";
import type { ThemeMode } from "../types/dayflow";

export function isDaytimeHour(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 6 && hour < 18;
}

export function useTheme(themeMode: ThemeMode) {
  const [nowHourDaytime, setNowHourDaytime] = useState<boolean>(() => isDaytimeHour());

  useEffect(() => {
    setNowHourDaytime(isDaytimeHour());
    const timer = window.setInterval(() => {
      setNowHourDaytime(isDaytimeHour());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isDark =
    themeMode === "dark" ? true : themeMode === "light" ? false : !nowHourDaytime;

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", isDark ? "#09090b" : "#ffffff");
    }
    const appleStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleStatus) {
      appleStatus.setAttribute("content", isDark ? "black-translucent" : "default");
    }
  }, [isDark]);

  return {
    isDark,
    isAutoDaytime: nowHourDaytime,
  };
}
