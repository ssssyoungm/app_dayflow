import type { ScheduleItem } from "../types/dayflow";
import { getTodayStr, timeToMinutes } from "./dateUtils";

export function isWebNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestWebNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isWebNotificationSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function fireReminderNotification(title: string, body: string) {
  if (!isWebNotificationSupported() || Notification.permission !== "granted") return;

  // Prefer Service Worker registration notification on iOS Safari PWA when available
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg && typeof reg.showNotification === "function") {
          return reg.showNotification(title, {
            body,
            icon: "/pwa-192x192.png",
            badge: "/pwa-192x192.png",
            tag: `dayflow-${Date.now()}`,
          });
        }
        new Notification(title, { body, icon: "/pwa-192x192.png" });
      })
      .catch(() => {
        new Notification(title, { body, icon: "/pwa-192x192.png" });
      });
    return;
  }

  new Notification(title, { body, icon: "/pwa-192x192.png" });
}

export function findDueReminders(
  schedules: ScheduleItem[],
  alreadyNotifiedIds: Set<string>
): ScheduleItem[] {
  const todayStr = getTodayStr();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return schedules.filter((item) => {
    if (!item.notifyEnabled || item.completed || item.date !== todayStr) return false;
    const key = `${item.id}_${item.date}_${item.startTime}_${item.notifyMinutesBefore}`;
    if (alreadyNotifiedIds.has(key)) return false;

    const targetMin = item.isAllDay ? 9 * 60 : timeToMinutes(item.startTime);
    const triggerMin = targetMin - item.notifyMinutesBefore;
    return nowMinutes >= triggerMin && nowMinutes <= triggerMin + 2;
  });
}
