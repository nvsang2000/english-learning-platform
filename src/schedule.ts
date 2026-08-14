export const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";
export const DAILY_REMINDER_MINUTES = 7 * 60;
export const MICRO_START_MINUTES = 7 * 60 + 30;
export const QUIET_START_MINUTES = 22 * 60 + 30;

export type VietnamLocalTime = {
  date: string;
  hour: number;
  minute: number;
  totalMinutes: number;
};

export function vietnamNow(now = new Date()): VietnamLocalTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return { date: `${values.year}-${values.month}-${values.day}`, hour, minute, totalMinutes: hour * 60 + minute };
}

export function isDeliveryWindow(now = new Date(), expectedDate?: string): boolean {
  const local = vietnamNow(now);
  return (!expectedDate || local.date === expectedDate)
    && local.totalMinutes >= DAILY_REMINDER_MINUTES
    && local.totalMinutes < QUIET_START_MINUTES;
}

export function isDailyReminderWindow(now = new Date(), expectedDate?: string): boolean {
  const local = vietnamNow(now);
  return (!expectedDate || local.date === expectedDate)
    && local.totalMinutes >= DAILY_REMINDER_MINUTES
    && local.totalMinutes < DAILY_REMINDER_MINUTES + 30;
}

export function currentMicroSlot(now = new Date()): string | null {
  const local = vietnamNow(now);
  if (local.totalMinutes < MICRO_START_MINUTES || local.totalMinutes >= QUIET_START_MINUTES) return null;
  const slotMinutes = Math.floor(local.totalMinutes / 30) * 30;
  if (slotMinutes < MICRO_START_MINUTES || slotMinutes >= QUIET_START_MINUTES) return null;
  return `${String(Math.floor(slotMinutes / 60)).padStart(2, "0")}:${String(slotMinutes % 60).padStart(2, "0")}`;
}

export function isNotificationDeliveryWindow(notificationType: string, expectedDate: string, now = new Date()): boolean {
  const local = vietnamNow(now);
  if (local.date !== expectedDate) return false;
  if (notificationType === "daily_lesson") return isDailyReminderWindow(now, expectedDate);
  if (notificationType.startsWith("micro_")) {
    const slot = currentMicroSlot(now);
    return slot !== null && notificationType === `micro_${slot.replace(":", "")}`;
  }
  return isDeliveryWindow(now, expectedDate);
}
