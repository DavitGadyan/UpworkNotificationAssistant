import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSearch, getSettings, insertJob, logMcpCall, resetDbForTests, saveSettings, startWatch } from "@/lib/db";
import { demoJobs } from "@/lib/fixtures";
import { scoreJob } from "@/lib/scoring";
import { cadenceMs, classify, decide, governorStatus, isHighValue, learnedPeakHours, LIMITS, nextCategory, noteJobs, record, resume } from "@/lib/upwork/governor";

// Midday local time, so the "ahead of the day's pace" check is predictable.
const NOON = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const MIN = 60_000;
const RESTRICTED = 'find_jobs: {"error_code":"CLIENT","reason":"Your access to search has been restricted due to violations of our Terms of Service."}';
const TOO_QUICKLY = "find_jobs: {\"error_code\":\"PERMISSION\",\"reason\":\"This job can't be opened right now. It may be private or invite-only, or jobs are being opened too quickly.\"}";

async function logCalls(n: number, at: number, tool = "find_jobs", action = "search") {
  for (let i = 0; i < n; i++) await logMcpCall(tool, action, true, 1, null, at);
}

/** The core tests run with the evening peak off (always full speed); the peak has its own tests below. */
async function peakOff() {
  await resetDbForTests();
  const s = await getSettings();
  await saveSettings({ upwork: { ...s.upwork, peak: { ...s.upwork.peak, enabled: false } } });
}

describe("pacing governor", () => {
  beforeEach(peakOff);

  it("classifies Upwork's answers", () => {
    expect(classify(RESTRICTED)).toBe("restricted");
    expect(classify(TOO_QUICKLY)).toBe("throttle");
    expect(classify("find_jobs: 429 Too Many Requests")).toBe("transient");
    expect(classify("invalid_token")).toBe("auth");
    expect(classify("find_jobs: not found")).toBe("other");
  });

  it("stops every call after 'restricted' until a human resumes, then restarts slow", async () => {
    await record("find_jobs.search", false, RESTRICTED, { feed: true, category: "saved_query" }, { nowMs: NOON, notify: false });
    for (const label of ["find_jobs.search", "find_jobs.smart_search", "find_jobs.get", "get_messages.list_rooms"]) {
      const d = await decide(label, {}, "worker", NOON + 3 * 864e5);
      expect(d).toMatchObject({ go: false, scope: "stop" });
    }
    await resume(NOON + 1000);
    expect(await decide("find_jobs.search", { feed: true, category: "keyword" }, "chat", NOON + 2000)).toEqual({ go: true });
    // The category that just failed waits a full L2 interval (20 min).
    expect(await decide("find_jobs.search", { feed: true, category: "saved_query" }, "chat", NOON + 2000)).toMatchObject({ go: false, scope: "wait" });
    expect((await governorStatus(NOON + 2000)).level).toBe(2);
  });

  it("lets only the poller chosen in Settings make feed calls", async () => {
    expect((await getSettings()).upwork.poller).toBe("chat");
    const feed = { feed: true, category: "most_recent" };
    expect(await decide("find_jobs.smart_search", feed, "chat", NOON)).toEqual({ go: true });
    expect(await decide("find_jobs.smart_search", feed, "worker", NOON)).toMatchObject({ go: false, scope: "stop", reason: expect.stringContaining("not-active-poller") });
    // Non-feed calls (drafts, reply tracking) are not limited by the poller choice.
    expect(await decide("get_messages.list_rooms", {}, "worker", NOON)).toEqual({ go: true });
    await saveSettings({ upwork: { ...(await getSettings()).upwork, poller: "worker" } });
    expect(await decide("find_jobs.smart_search", feed, "worker", NOON)).toEqual({ go: true });
    expect(await decide("find_jobs.smart_search", feed, "chat", NOON)).toMatchObject({ go: false, scope: "stop" });
  });

  it("paces each category at 4 min and slows down one level per warning, recovering after clean hours", async () => {
    const meta = { feed: true, category: "keyword" };
    await record("find_jobs.search", true, null, meta, { nowMs: NOON });
    expect(await decide("find_jobs.search", meta, "chat", NOON + 2 * MIN)).toMatchObject({ go: false, scope: "wait" });
    expect(await decide("find_jobs.search", meta, "chat", NOON + 5 * MIN)).toEqual({ go: true });
    // Another category is independent - calls spread across the 5 minutes.
    expect(await decide("find_jobs.smart_search", { feed: true, category: "best_match" }, "chat", NOON + MIN)).toEqual({ go: true });

    await record("find_jobs.search", false, "find_jobs: 429 Too Many Requests", meta, { nowMs: NOON + 5 * MIN });
    expect((await governorStatus(NOON + 5 * MIN)).level).toBe(1);
    expect(await decide("find_jobs.search", meta, "chat", NOON + 10 * MIN)).toMatchObject({ go: false });
    expect(await decide("find_jobs.search", meta, "chat", NOON + 15 * MIN)).toEqual({ go: true });
    for (let i = 0; i < 5; i++) await record("find_jobs.search", false, "503", meta, { nowMs: NOON + 6 * MIN });
    expect((await governorStatus(NOON + 6 * MIN)).level).toBe(LIMITS.maxLevel);
    expect(cadenceMs(LIMITS.maxLevel)).toBe(40 * MIN);
    // Two clean hours lower it one step.
    expect((await governorStatus(NOON + 6 * MIN + LIMITS.decayMs)).level).toBe(LIMITS.maxLevel - 1);
  });

  it("never re-opens a refused job, spaces job opens, and pauses all opens after 'too quickly'", async () => {
    await record("find_jobs.get", false, TOO_QUICKLY, { jobId: "j1" }, { nowMs: NOON });
    expect(await decide("find_jobs.get", { jobId: "j1" }, "worker", NOON + 864e5)).toMatchObject({ go: false, scope: "job" });
    expect(await decide("find_jobs.get", { jobId: "j2" }, "worker", NOON + 10 * MIN)).toMatchObject({ go: false, scope: "wait", reason: expect.stringContaining("paused") });
    const later = NOON + 2 * 36e5;
    expect(await decide("find_jobs.get", { jobId: "j2" }, "worker", later)).toEqual({ go: true });
    await record("find_jobs.get", true, null, { jobId: "j2" }, { nowMs: later });
    expect(await decide("find_jobs.get", { jobId: "j3" }, "worker", later + 2000)).toMatchObject({ go: false, reason: expect.stringContaining("8 s") });
    expect(await decide("find_jobs.get", { jobId: "j2" }, "worker", later + 36e5)).toMatchObject({ go: false, scope: "job" });
    expect(await decide("find_jobs.get", { jobId: "j2" }, "worker", later + 7 * 36e5)).toEqual({ go: true });
  });

  it("enforces the hourly, daily, search and job-open budgets", async () => {
    await logCalls(LIMITS.hourly, NOON - 10 * MIN, "get_messages", "list_rooms");
    expect(await decide("get_profile.get", {}, "worker", NOON)).toMatchObject({ go: false, reason: expect.stringContaining("hourly") });
    expect(await decide("get_profile.get", {}, "worker", NOON + 2 * 36e5)).toEqual({ go: true });

    await peakOff();
    await logCalls(LIMITS.getPerDay, NOON - 5 * 36e5, "find_jobs", "get");
    expect(await decide("find_jobs.get", { jobId: "x" }, "worker", NOON)).toMatchObject({ go: false, reason: expect.stringContaining("job-open budget") });

    await peakOff();
    await saveSettings({ guard: { maxEnrichPerCycle: 5, dailyCallCap: 9999, jitterSec: 30, minGapMs: 4000 } });
    expect((await getSettings()).guard.dailyCallCap).toBe(2800); // stored values above the ceiling are clamped
    await saveSettings({ guard: { maxEnrichPerCycle: 5, dailyCallCap: 100, jitterSec: 30, minGapMs: 4000 } });
    await logCalls(100, NOON - 5 * 36e5, "get_messages", "list_rooms");
    expect(await decide("get_messages.list_rooms", {}, "worker", NOON)).toMatchObject({ go: false, reason: expect.stringContaining("24 h budget") });
  });

  it("slows down when the day's calls run ahead of an even pace", async () => {
    await logCalls(1700, NOON - 6 * 36e5, "get_messages", "list_rooms");
    const s = await governorStatus(NOON);
    expect(s.aheadOfPace).toBe(true);
    expect(s.cadenceMin).toBe(8); // 4-min peak cadence, one level slower
  }, 60_000);
});

describe("guard with the governor", () => {
  beforeEach(peakOff);

  it("turns 'restricted' into a stop for every later call, without retrying", async () => {
    const { guarded, GuardError } = await import("@/lib/upwork/guard");
    let calls = 0;
    const fail = async () => { calls++; throw new Error(RESTRICTED); };
    await expect(guarded("find_jobs.search", fail)).rejects.toMatchObject({ kind: "restricted" });
    expect(calls).toBe(1);
    await expect(guarded("find_jobs.smart_search", async () => "never")).rejects.toBeInstanceOf(GuardError);
    expect(calls).toBe(1);
  }, 30_000);

  it("never retries 'too quickly'", async () => {
    const { guarded } = await import("@/lib/upwork/guard");
    let calls = 0;
    await expect(guarded("find_jobs.get", async () => { calls++; throw new Error(TOO_QUICKLY); }, { jobId: "q1" })).rejects.toThrow(/too quickly/);
    expect(calls).toBe(1);
    // The same job is refused by the governor without another call.
    await expect(guarded("find_jobs.get", async () => { calls++; return 1; }, { jobId: "q1" })).rejects.toThrow(/not reopened/);
    expect(calls).toBe(1);
  }, 30_000);
});

describe("job watch", () => {
  beforeEach(() => resetDbForTests());

  async function twoWatches() {
    const search = await createSearch({ kind: "search", name: "s", enabled: true, skills: ["Python"], query: "", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
    const now = Date.now();
    const [a, b] = demoJobs(now, "w");
    for (const j of [a, b]) {
      await insertJob(j, search.id, scoreJob(j, search), now);
      await startWatch(j.id, null, j.totalApplicants, j.proposalsTier ?? null, now - 1000, now);
    }
    return [a.id, b.id];
  }

  it("stops all watches this cycle when the guard stops calls", async () => {
    const ids = await twoWatches();
    const client = await import("@/lib/upwork/mcp/client");
    const { GuardError } = await import("@/lib/upwork/guard");
    let calls = 0;
    const spy = vi.spyOn(client, "callTool").mockImplementation(async () => { calls++; throw new GuardError("restricted", "restricted"); });
    const { runWatches } = await import("@/lib/watch");
    const out = await runWatches(2);
    expect(calls).toBe(1);
    expect(Object.keys(out)).toEqual([ids[0]]);
    spy.mockRestore();
  });

  it("keeps watching on the count alone when a job can't be opened", async () => {
    await twoWatches();
    const client = await import("@/lib/upwork/mcp/client");
    const source = await import("@/lib/upwork/source");
    const count = vi.spyOn(client, "callTool").mockImplementation(async () => ({ jobs: [] }) as never);
    const detail = vi.spyOn(source, "fetchDetail").mockImplementation(async () => { throw new Error(TOO_QUICKLY); });
    const { runWatches } = await import("@/lib/watch");
    const out = await runWatches(2);
    expect(Object.values(out).every((v) => !v.startsWith("error"))).toBe(true);
    expect(detail).toHaveBeenCalledTimes(2);
    count.mockRestore(); detail.mockRestore();
  });
});

describe("evening peak (Armenian time)", () => {
  beforeEach(() => resetDbForTests());
  // 2026-10-17 in Asia/Yerevan (UTC+4, no DST): 12:00 local = 08:00Z, 19:00 local = 15:00Z.
  const at = (hhmm: string) => Date.parse(`2026-10-17T${hhmm}:00+04:00`);
  const meta = { feed: true, category: "most_recent" };

  it("searches every 4 min in the evening and every 7 min during the day", async () => {
    await record("find_jobs.smart_search", true, null, meta, { nowMs: at("12:00") });
    expect(await decide("find_jobs.smart_search", meta, "chat", at("12:06"))).toMatchObject({ go: false, reason: expect.stringContaining("off-peak") });
    expect(await decide("find_jobs.smart_search", meta, "chat", at("12:07"))).toEqual({ go: true });
    await record("find_jobs.smart_search", true, null, meta, { nowMs: at("19:00") });
    expect(await decide("find_jobs.smart_search", meta, "chat", at("19:03"))).toMatchObject({ go: false });
    expect(await decide("find_jobs.smart_search", meta, "chat", at("19:04"))).toEqual({ go: true });
    const st = await governorStatus(at("19:02"));
    expect(st.peak).toMatchObject({ now: true, window: "18:00-01:00 Asia/Yerevan" });
    expect((await governorStatus(at("12:02"))).peak.now).toBe(false);
  });

  it("keeps the evening's share of the budget: off-peak job calls stop at 40% of the day", async () => {
    const s = await getSettings();
    await saveSettings({ guard: { ...s.guard, dailyCallCap: 200 } });
    for (let i = 0; i < 80; i++) await logMcpCall("find_jobs", "search", true, 1, null, at("10:00"));
    const d = await decide("find_jobs.search", {}, "chat", at("13:00"));
    expect(d).toMatchObject({ go: false, reason: expect.stringContaining("kept for the 18:00 peak") });
    expect(d.go === false && d.retryAt).toBe(at("18:00"));
    // Non-search work (drafts, reply tracking) still goes; in the evening searches go again.
    expect(await decide("get_messages.list_rooms", {}, "worker", at("13:00"))).toEqual({ go: true });
    expect(await decide("find_jobs.search", {}, "chat", at("18:30"))).toEqual({ go: true });
  });

  it("learns extra peak hours where high-value jobs show up", async () => {
    expect(isHighValue({ client: { totalSpent: 25_000 }, jobType: "HOURLY", hourlyMax: 40 })).toBe(true);
    expect(isHighValue({ client: { totalSpent: 0 }, jobType: "FIXED", amount: 300 })).toBe(false);
    for (let day = 1; day <= 7; day++) {
      const morning = Date.parse(`2026-10-0${day}T10:30:00+04:00`);
      await noteJobs(6, 4, morning);
      await noteJobs(5, 0, morning + 3 * 36e5);
    }
    expect(await learnedPeakHours()).toEqual([10]);
    await record("find_jobs.smart_search", true, null, meta, { nowMs: at("10:00") });
    expect(await decide("find_jobs.smart_search", meta, "chat", at("10:04"))).toEqual({ go: true });
  });

  it("the every-minute cron picks one due category at a time, longest-waiting first", async () => {
    const cats = { most_recent: "find_jobs.smart_search", best_match: "find_jobs.smart_search", saved_query: "find_jobs.search", keyword: "find_jobs.search" };
    const picked: string[] = [];
    for (let m = 0; m < 8; m++) {
      const now = at("19:00") + m * 60_000;
      const n = await nextCategory(cats, "chat", now);
      if ("category" in n) { picked.push(n.category); await record(n.label, true, null, { feed: true, category: n.category }, { nowMs: now }); }
      else picked.push("wait");
    }
    // One call a minute; each category comes back every 4 minutes.
    expect(picked).toEqual(["most_recent", "best_match", "saved_query", "keyword", "most_recent", "best_match", "saved_query", "keyword"]);
    // Daytime: each category every 7 minutes, so some minutes have nothing due.
    const day: string[] = [];
    for (let m = 0; m < 14; m++) {
      const now = at("12:00") + 864e5 + m * 60_000; // next day's daytime
      const n = await nextCategory(cats, "chat", now);
      if ("category" in n) { day.push(n.category); await record(n.label, true, null, { feed: true, category: n.category }, { nowMs: now }); }
      else day.push("wait");
    }
    expect(day.filter((x) => x === "wait")).toHaveLength(6);
    expect(day.filter((x) => x === "most_recent")).toHaveLength(2);
  });
});
