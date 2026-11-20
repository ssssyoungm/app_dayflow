import type { ScheduleItem } from "../types/dayflow";
import { kstDateTimeToEpoch } from "./dateUtils";

export function isWebNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
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

export function getReminderKey(item: ScheduleItem): string {
  return `${item.id}_${item.date}_${item.startTime}_${item.notifyMinutesBefore}`;
}

export function computeReminderTriggerEpoch(item: ScheduleItem): number | null {
  if (!item.notifyEnabled || item.completed || !item.date) return null;
  const targetTime = item.isAllDay ? "09:00" : item.startTime || "09:00";
  const baseEpoch = kstDateTimeToEpoch(item.date, targetTime);
  if (baseEpoch === null) return null;

  const offsetMs = Math.max(0, Number(item.notifyMinutesBefore) || 0) * 60_000;
  return baseEpoch - offsetMs;
}

export function formatReminderBody(item: ScheduleItem): string {
  if (item.isAllDay) return "오늘 종일 일정 알림";
  const lead = item.notifyMinutesBefore === 0 ? "정시" : `${item.notifyMinutesBefore}분 전`;
  return `${item.startTime} 시작 (${lead})`;
}

export function fireReminderNotification(title: string, body: string, tag?: string) {
  if (!isWebNotificationSupported() || Notification.permission !== "granted") return;

  const resolvedTag = tag || `dayflow-${Date.now()}`;

  // Prefer Service Worker registration notification on iOS Safari PWA when available
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg && typeof reg.showNotification === "function") {
          return reg.showNotification(title, {
            body,
            icon: "/pwa-192x192.png",
            badge: "/pwa-192x192.png",
            tag: resolvedTag,
          });
        }
        new Notification(title, { body, icon: "/pwa-192x192.png", tag: resolvedTag });
      })
      .catch(() => {
        try {
          new Notification(title, { body, icon: "/pwa-192x192.png", tag: resolvedTag });
        } catch {
          // ignore on iOS where window.Notification constructor is disallowed
        }
      });
    return;
  }

  try {
    new Notification(title, { body, icon: "/pwa-192x192.png", tag: resolvedTag });
  } catch {
    // ignore
  }
}

export function findDueReminders(
  schedules: ScheduleItem[],
  alreadyNotifiedKeys: Set<string>
): ScheduleItem[] {
  const now = Date.now();

  return schedules.filter((item) => {
    const triggerAt = computeReminderTriggerEpoch(item);
    if (triggerAt === null) return false;

    const key = getReminderKey(item);
    if (alreadyNotifiedKeys.has(key)) return false;

    return now >= triggerAt && now <= triggerAt + 3 * 60_000;
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid-public-key", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { publicKey?: string };
    return typeof data.publicKey === "string" && data.publicKey.length > 10 ? data.publicKey : null;
  } catch {
    return null;
  }
}

export async function ensurePushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported() || Notification.permission !== "granted") {
    return null;
  }

  try {
    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) return null;

    const reg = await navigator.serviceWorker.ready;
    if (!reg || !reg.pushManager) return null;

    const expectedKeyBytes = urlBase64ToUint8Array(publicKey);
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      const existingKey = existing.options?.applicationServerKey;
      if (existingKey && uint8ArraysEqual(new Uint8Array(existingKey), expectedKeyBytes)) {
        return existing;
      }
      // Server VAPID key rotated (e.g. after redeploy) — re-subscribe cleanly
      try {
        await existing.unsubscribe();
      } catch {
        // ignore
      }
    }

    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: expectedKeyBytes.buffer as ArrayBuffer,
    });
  } catch {
    return null;
  }
}

export async function syncScheduledPushReminders(schedules: ScheduleItem[]): Promise<boolean> {
  if (!isWebPushSupported() || Notification.permission !== "granted") {
    return false;
  }

  const subscription = await ensurePushSubscription();
  if (!subscription) return false;

  const now = Date.now();
  const maxFutureMs = 30 * 24 * 60 * 60 * 1000;

  const reminders = schedules
    .map((item) => {
      const triggerAtEpoch = computeReminderTriggerEpoch(item);
      if (triggerAtEpoch === null) return null;
      if (triggerAtEpoch < now - 60_000 || triggerAtEpoch > now + maxFutureMs) return null;
      return {
        key: getReminderKey(item),
        title: `데이플로우 · ${item.title}`,
        body: formatReminderBody(item),
        triggerAtEpoch,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  try {
    const res = await fetch("/api/push/sync", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        reminders,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
