import type { Settings, WorkingHours } from "./types";

/** Weekday (0=Sun) and minutes-since-midnight for `date` as seen in `timeZone`. */
export function localClock(date: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Half-open [start, end). A range whose end is before its start wraps past midnight. */
export function inRange(minutes: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

export function isWorkingTime(now: Date, wh: WorkingHours): boolean {
  const { day, minutes } = localClock(now, wh.timezone);
  if (!inRange(minutes, wh.start, wh.end)) return false;
  // For an overnight shift, the part after midnight belongs to the previous day's shift.
  const wraps = toMinutes(wh.end) < toMinutes(wh.start);
  const shiftDay = wraps && minutes < toMinutes(wh.end) ? (day + 6) % 7 : day;
  return wh.days.includes(shiftDay);
}

export function isQuietTime(now: Date, s: Settings): boolean {
  if (!s.quietHours.enabled) return false;
  const { minutes } = localClock(now, s.workingHours.timezone);
  return inRange(minutes, s.quietHours.start, s.quietHours.end);
}

export interface CallDecision { ok: boolean; reason: string }

/**
 * Whether a job with `score` should trigger a voice call right now. Every rule is a user setting.
 * `calls` = successful calls in the last 24h and the time of the most recent one.
 */
export function shouldCall(args: {
  now: Date;
  score: number;
  settings: Settings;
  calls: { count: number; lastAt: number | null };
}): CallDecision {
  const { now, score, settings: s, calls } = args;
  if (s.callMode === "off") return { ok: false, reason: "Calls are off" };
  if (s.alertsPaused) return { ok: false, reason: "Alerts paused" };
  if (score < s.callMin) return { ok: false, reason: `Score ${score} < call threshold ${s.callMin}` };

  const working = isWorkingTime(now, s.workingHours);
  if (s.callMode === "outside_hours" && working) return { ok: false, reason: "Inside working hours" };
  if (s.callMode === "inside_hours" && !working) return { ok: false, reason: "Outside working hours" };
  if (s.callMode !== "always" && isQuietTime(now, s)) return { ok: false, reason: "Quiet hours" };

  if (calls.lastAt && now.getTime() - calls.lastAt < s.callCooldownMin * 60_000) {
    return { ok: false, reason: `Cooldown (${s.callCooldownMin} min)` };
  }
  if (calls.count >= s.maxCallsPerDay) return { ok: false, reason: `Daily cap of ${s.maxCallsPerDay} calls reached` };
  return { ok: true, reason: "Call allowed" };
}

/** Plain-English summary of the current call rule, for the Settings page and Telegram footer. */
export function describeCallRule(s: Settings): string {
  const hours = `${s.workingHours.start}–${s.workingHours.end} ${s.workingHours.timezone}`;
  switch (s.callMode) {
    case "off": return "Voice calls are off.";
    case "always": return `Calls for score ≥ ${s.callMin} at any time, quiet hours ignored.`;
    case "inside_hours": return `Calls for score ≥ ${s.callMin} during working hours (${hours}).`;
    case "outside_hours": return `Calls for score ≥ ${s.callMin} outside working hours (${hours}).`;
  }
}
