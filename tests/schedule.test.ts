import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/db";
import { inRange, isWorkingTime, localClock, shouldCall } from "@/lib/schedule";
import type { Settings } from "@/lib/types";

// Mon 2026-10-12 — UTC timestamps, evaluated in Europe/Berlin (UTC+2 in October).
const berlin = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 12, hh - 2, mm));
const base: Settings = { ...DEFAULT_SETTINGS, workingHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", timezone: "Europe/Berlin" } };
const noCalls = { count: 0, lastAt: null };

describe("localClock / inRange", () => {
  it("reads weekday and minutes in the given timezone", () => {
    expect(localClock(berlin(10, 30), "Europe/Berlin")).toEqual({ day: 1, minutes: 630 });
    expect(localClock(berlin(10, 30), "America/Los_Angeles").minutes).toBe(90); // 01:30 PDT
  });
  it("handles ranges that wrap midnight", () => {
    expect(inRange(23 * 60 + 30, "23:00", "08:00")).toBe(true);
    expect(inRange(7 * 60, "23:00", "08:00")).toBe(true);
    expect(inRange(12 * 60, "23:00", "08:00")).toBe(false);
  });
});

describe("isWorkingTime", () => {
  it("is true inside hours on a working day and false on the weekend", () => {
    expect(isWorkingTime(berlin(10), base.workingHours)).toBe(true);
    expect(isWorkingTime(berlin(18), base.workingHours)).toBe(false); // end is exclusive
    const sat = new Date(Date.UTC(2026, 9, 17, 8));
    expect(isWorkingTime(sat, base.workingHours)).toBe(false);
  });
  it("attributes the after-midnight part of an overnight shift to the previous day", () => {
    const night = { days: [5], start: "22:00", end: "04:00", timezone: "Europe/Berlin" }; // Friday night shift
    expect(isWorkingTime(new Date(Date.UTC(2026, 9, 17, 0)), night)).toBe(true); // Sat 02:00 local
    expect(isWorkingTime(new Date(Date.UTC(2026, 9, 18, 0)), night)).toBe(false); // Sun 02:00 local
  });
});

describe("shouldCall", () => {
  it("outside_hours: calls at night, not during the day", () => {
    const s = { ...base, callMode: "outside_hours" as const, quietHours: { enabled: false, start: "23:00", end: "08:00" } };
    expect(shouldCall({ now: berlin(20), score: 90, settings: s, calls: noCalls }).ok).toBe(true);
    expect(shouldCall({ now: berlin(11), score: 90, settings: s, calls: noCalls })).toMatchObject({ ok: false, reason: "Inside working hours" });
  });
  it("inside_hours: the opposite", () => {
    const s = { ...base, callMode: "inside_hours" as const };
    expect(shouldCall({ now: berlin(11), score: 90, settings: s, calls: noCalls }).ok).toBe(true);
    expect(shouldCall({ now: berlin(20), score: 90, settings: s, calls: noCalls }).reason).toBe("Outside working hours");
  });
  it("quiet hours block every mode except always", () => {
    const s = { ...base, callMode: "outside_hours" as const }; // quiet 23–08 by default
    expect(shouldCall({ now: berlin(23, 30), score: 95, settings: s, calls: noCalls }).reason).toBe("Quiet hours");
    expect(shouldCall({ now: berlin(23, 30), score: 95, settings: { ...s, callMode: "always" }, calls: noCalls }).ok).toBe(true);
  });
  it("off, paused, threshold, cooldown and daily cap", () => {
    const s = { ...base, callMode: "always" as const };
    expect(shouldCall({ now: berlin(11), score: 95, settings: { ...s, callMode: "off" }, calls: noCalls }).reason).toBe("Calls are off");
    expect(shouldCall({ now: berlin(11), score: 95, settings: { ...s, alertsPaused: true }, calls: noCalls }).reason).toBe("Alerts paused");
    expect(shouldCall({ now: berlin(11), score: 80, settings: s, calls: noCalls }).reason).toMatch(/below|</);
    expect(shouldCall({ now: berlin(11), score: 95, settings: s, calls: { count: 1, lastAt: berlin(10, 50).getTime() } }).reason).toMatch(/Cooldown/);
    expect(shouldCall({ now: berlin(11), score: 95, settings: s, calls: { count: 5, lastAt: berlin(8).getTime() } }).reason).toMatch(/Daily cap/);
    expect(shouldCall({ now: berlin(11), score: 95, settings: s, calls: { count: 4, lastAt: berlin(8).getTime() } }).ok).toBe(true);
  });
});
