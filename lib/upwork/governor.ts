import { bumpDailyRequests, getSettings, kvGet, kvSet, logMcpCall, mcpCallCounts, mcpFailures } from "../db";
import type { Settings } from "../types";
import { sendText } from "../notify/telegram";
import { today } from "../ratelimit";

/*
 * Upwork pacing governor - the one place that decides whether an Upwork call may go out.
 * Upwork restricted search twice (2026-10-15, 2026-10-17) for traffic: ~3,900 calls/day, the same jobs
 * re-opened ~40 times after "jobs are being opened too quickly", and search kept being called after the
 * restriction. Every caller obeys this: the worker and web app (through guard.ts) and the Claude chat
 * loop (through `npm run governor -- check/record`).
 *
 *   restricted  → STOP everything until a human runs `resume` (never automatic).
 *   one poller  → feed searches only from Settings → "Who searches Upwork" (chat session or worker).
 *   budgets     → per 24 h: total (settings cap, ≤ 2,800), searches ≤ 1,400, job opens ≤ 120; ≤ 200 per hour.
 *   slow-down   → any 429 / too quickly / 5xx doubles the feed cadence per level (L1 ×2 … L3 ×8);
 *                 2 clean hours lower it one step. Running ahead of the day's pace counts as one level.
 *   job opens   → ≥ 8 s apart; the same job at most once per 6 h; never again after a refusal;
 *                 all opens pause 30 min (doubling per level) after a "too quickly".
 *   evening     → high-value US clients post from ~18:00 Armenian time (David, 2026-10-17). Inside the peak
 *                 window (Settings, default 18:00-01:00 Asia/Yerevan) each feed runs every 4 min; outside it
 *                 every 7 min (David, 2026-10-18), and off-peak Upwork job calls may use at most 40% of the day's budget, so the
 *                 evening always has its reserve. The budget day starts when the peak window ends. Hours where
 *                 high-value jobs actually appear (learned from feed results) are added to the peak.
 */

export const LIMITS = {
  hardDailyCap: 2800,
  hourly: 200,
  searchPerDay: 1400,
  getPerDay: 120, // David, 2026-10-19: 60 ran out by early morning, so nothing new was ranked, drafted or auto-applied
  getGapMs: 8_000,
  sameJobMs: 6 * 36e5,
  getPauseMs: 30 * 60_000,
  baseCadenceMs: 5 * 60_000,
  cadenceSlackMs: 25_000,
  decayMs: 2 * 36e5,
  maxLevel: 3,
};

export type Caller = "worker" | "chat" | "app";
export type ErrorClass = "restricted" | "throttle" | "transient" | "auth" | "other";
export interface CallMeta {
  /** A feed search (Most Recent, Best Matches, saved/keyword search) - only the active poller may make these. */
  feed?: boolean;
  /** Cadence key for feed calls, e.g. "most_recent", "saved_query", "feed:3". */
  category?: string;
  jobId?: string;
}
export type Decision =
  | { go: true }
  | { go: false; scope: "stop" | "wait" | "job"; reason: string; retryAt: number };

interface State {
  level: number;
  levelAt: number;
  restricted: { at: number; detail: string } | null;
  lastCall: Record<string, number>;
  lastGetAt: number;
  getPauseUntil: number;
  lastError: { at: number; cls: ErrorClass; detail: string } | null;
}
const KEY = "upwork_governor";
const JOBS_KEY = "governor_jobs";
const fresh = (): State => ({ level: 0, levelAt: 0, restricted: null, lastCall: {}, lastGetAt: 0, getPauseUntil: 0, lastError: null });

let caller: Caller = "app";
/** The worker calls setCaller("worker") at start; the CLI passes its own caller explicitly. */
export const setCaller = (c: Caller) => { caller = c; };
export const currentCaller = () => caller;

const RESTRICTED = /has been restricted|Terms of Service/i;
const THROTTLE = /too quickly|PERMISSION|can't be opened/i;
const TRANSIENT = /\b(429|500|502|503|504)\b|rate.?limit|too many|timeout|ECONNRESET|fetch failed|socket/i;
const AUTH = /unauthori[sz]ed|invalid_token|\b401\b|invalid_grant/i;
export function classify(msg: string): ErrorClass {
  if (RESTRICTED.test(msg)) return "restricted";
  if (THROTTLE.test(msg)) return "throttle";
  if (TRANSIENT.test(msg)) return "transient";
  if (AUTH.test(msg)) return "auth";
  return "other";
}

async function load(now: number): Promise<State> {
  const s = { ...fresh(), ...(await kvGet<State>(KEY)) };
  // Decay: each full clean 2 h since the last level change lowers the level by one.
  while (s.level > 0 && now - s.levelAt >= LIMITS.decayMs) { s.level--; s.levelAt += LIMITS.decayMs; }
  return s;
}
const save = (s: State) => kvSet(KEY, s);
type JobMark = { at: number; refused?: boolean };
const jobMarks = async () => (await kvGet<Record<string, JobMark>>(JOBS_KEY)) ?? {};

/** Job opens and searches, on either backend: the MCP connector (find_jobs.*) or the official API (api.*). */
const isGet = (label: string) => label === "find_jobs.get" || label === "api.job";
const isSearch = (label: string) => label === "find_jobs.search" || label === "find_jobs.smart_search" || label === "api.search";
const isJobCall = (label: string) => label.startsWith("find_jobs.") || label === "api.search" || label === "api.job";

// ---------- evening peak ----------
type Peak = Settings["upwork"]["peak"];
const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
/** Minutes and seconds into the day in `tz`, plus that day's date (YYYY-MM-DD). */
function localClock(nowMs: number, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const h = Number(parts.hour) % 24;
  return { min: h * 60 + Number(parts.minute), sec: Number(parts.second), hour: h, date: `${parts.year}-${parts.month}-${parts.day}` };
}
const inWindow = (min: number, start: number, end: number) => (start <= end ? min >= start && min < end : min >= start || min < end);

/** High-value job for the evening-peak learning: a client who has spent ≥ $10k, or a budget worth his time. */
export function isHighValue(j: { client?: { totalSpent?: number | null } | null; jobType?: string; amount?: number | null; hourlyMax?: number | null }) {
  return (j.client?.totalSpent ?? 0) >= 10_000 || (j.jobType === "FIXED" && (j.amount ?? 0) >= 1_000) || (j.hourlyMax ?? 0) >= 70;
}

const PROFILE_KEY = "value_profile";
type Profile = { hv: number[]; fresh: number[]; days: string[] };
const emptyProfile = (): Profile => ({ hv: Array(24).fill(0), fresh: Array(24).fill(0), days: [] });
/** Count fresh and high-value jobs per local hour (one feed result at a time). Kept for the last 28 days of data. */
export async function noteJobs(fresh: number, highValue: number, nowMs = Date.now()) {
  if (!fresh && !highValue) return;
  const tz = (await getSettings()).upwork.peak.timezone;
  const c = localClock(nowMs, tz);
  const p = { ...emptyProfile(), ...(await kvGet<Profile>(PROFILE_KEY)) };
  if (!p.days.includes(c.date)) {
    p.days = [...p.days, c.date].slice(-28);
    // Older than 28 days of data: decay the counts so the profile follows the current season.
    if (p.days.length === 28) { p.hv = p.hv.map((x) => x * 0.97); p.fresh = p.fresh.map((x) => x * 0.97); }
  }
  p.hv[c.hour] += highValue;
  p.fresh[c.hour] += fresh;
  await kvSet(PROFILE_KEY, p);
}
/** Hours where high-value jobs clearly cluster (≥ 1.5× the hourly mean), once there are 7+ days of data. */
export async function learnedPeakHours(): Promise<number[]> {
  const p = await kvGet<Profile>(PROFILE_KEY);
  if (!p || p.days.length < 7) return [];
  const mean = p.hv.reduce((a, b) => a + b, 0) / 24;
  return p.hv.map((v, h) => (v >= 3 && v >= 1.5 * mean ? h : -1)).filter((h) => h >= 0);
}

async function peakState(nowMs: number) {
  const pk: Peak = (await getSettings()).upwork.peak;
  const c = localClock(nowMs, pk.timezone);
  const start = toMin(pk.start), end = toMin(pk.end);
  const learned = pk.enabled && pk.learn ? await learnedPeakHours() : [];
  const configured = pk.enabled && inWindow(c.min, start, end);
  const peak = !pk.enabled || configured || learned.includes(c.hour);
  // The budget day starts when the configured peak ends, so one evening is never split across two days.
  const sinceEnd = (c.min - end + 1440) % 1440;
  const dayStart = nowMs - sinceEnd * 60_000 - c.sec * 1000;
  const peakLen = (end - start + 1440) % 1440 || 1440, offLen = 1440 - peakLen;
  const nextPeak = nowMs + (((start - c.min + 1440) % 1440) * 60_000) - c.sec * 1000;
  return { pk, peak, configured, learned, dayStart, sinceEnd, peakLen, offLen, nextPeak, local: `${String(c.hour).padStart(2, "0")}:${String(c.min % 60).padStart(2, "0")}` };
}

/** Calls this budget day vs where the reserve-weighted pace would be: ahead ⇒ treat as one level slower. */
async function aheadOfPace(cap: number, nowMs: number, ps: Awaited<ReturnType<typeof peakState>>) {
  const done = (await mcpCallCounts(ps.dayStart)).total;
  const r = ps.pk.enabled ? ps.pk.reservePct / 100 : (ps.peakLen / 1440);
  const fracOff = Math.min(ps.sinceEnd, ps.offLen) / Math.max(1, ps.offLen);
  const fracPeak = Math.max(0, ps.sinceEnd - ps.offLen) / ps.peakLen;
  const expected = cap * ((1 - r) * fracOff + r * fracPeak);
  return done > expected * 1.1 + 60;
}

export const dailyCap = async () => Math.min(LIMITS.hardDailyCap, (await getSettings()).guard.dailyCallCap);
export const cadenceMs = (level: number, baseMs = LIMITS.baseCadenceMs) => baseMs * 2 ** Math.min(level, LIMITS.maxLevel);

export async function decide(label: string, meta: CallMeta = {}, who: Caller = caller, nowMs = Date.now()): Promise<Decision> {
  const st = await load(nowMs);
  if (st.restricted) {
    return { go: false, scope: "stop", reason: `Upwork restricted access at ${new Date(st.restricted.at).toISOString()} - run "npm run governor -- resume" only after Upwork support restores it`, retryAt: Infinity };
  }
  const settings = await getSettings();
  if (meta.feed && (who === "worker" || who === "chat") && settings.upwork.poller !== who) {
    return { go: false, scope: "stop", reason: `not-active-poller: Settings → Who searches Upwork is "${settings.upwork.poller}"`, retryAt: Infinity };
  }
  const cap = await dailyCap();
  const day = await mcpCallCounts(nowMs - 864e5);
  if (day.total >= cap) return { go: false, scope: "wait", reason: `24 h budget used (${day.total}/${cap})`, retryAt: nowMs + 30 * 60_000 };
  if ((await mcpCallCounts(nowMs - 36e5)).total >= LIMITS.hourly) return { go: false, scope: "wait", reason: `hourly budget used (${LIMITS.hourly})`, retryAt: nowMs + 10 * 60_000 };
  if (isSearch(label) && day.search >= LIMITS.searchPerDay) return { go: false, scope: "wait", reason: `search budget used (${day.search}/${LIMITS.searchPerDay})`, retryAt: nowMs + 30 * 60_000 };

  if (isGet(label)) {
    if (meta.jobId) {
      const m = (await jobMarks())[meta.jobId];
      if (m?.refused) return { go: false, scope: "job", reason: `job ${meta.jobId} was refused before - not reopened`, retryAt: Infinity };
      if (m && nowMs - m.at < LIMITS.sameJobMs) return { go: false, scope: "job", reason: `job ${meta.jobId} opened < 6 h ago - not reopened`, retryAt: m.at + LIMITS.sameJobMs };
    }
    if (nowMs < st.getPauseUntil) return { go: false, scope: "wait", reason: `job opens paused after "too quickly" until ${new Date(st.getPauseUntil).toISOString()}`, retryAt: st.getPauseUntil };
    if (day.get >= LIMITS.getPerDay) return { go: false, scope: "wait", reason: `job-open budget used (${day.get}/${LIMITS.getPerDay})`, retryAt: nowMs + 60 * 60_000 };
    if (nowMs - st.lastGetAt < LIMITS.getGapMs) return { go: false, scope: "wait", reason: "job opens are spaced 8 s apart", retryAt: st.lastGetAt + LIMITS.getGapMs };
  }

  const ps = await peakState(nowMs);
  // Off-peak, job searches and opens leave the evening's share of the budget untouched.
  if (!ps.peak && isJobCall(label)) {
    const allowance = Math.floor(cap * (1 - ps.pk.reservePct / 100));
    const used = (await mcpCallCounts(ps.dayStart)).total;
    if (used >= allowance) return { go: false, scope: "wait", reason: `off-peak share used (${used}/${allowance}) - the rest is kept for the ${ps.pk.start} peak`, retryAt: ps.nextPeak };
  }

  if (meta.category) {
    const level = Math.min(LIMITS.maxLevel, st.level + ((await aheadOfPace(cap, nowMs, ps)) ? 1 : 0));
    const base = (ps.peak ? ps.pk.peakEveryMin : ps.pk.offPeakEveryMin) * 60_000;
    const every = cadenceMs(level, base);
    const last = st.lastCall[meta.category] ?? 0;
    const due = last + every - LIMITS.cadenceSlackMs;
    if (nowMs < due) {
      const why = ps.peak ? `slow-down level L${level}` : `off-peak (peak ${ps.pk.start}-${ps.pk.end})${level ? `, level L${level}` : ""}`;
      return { go: false, scope: "wait", reason: `${why}: ${meta.category} runs every ${every / 60_000} min`, retryAt: due };
    }
  }
  return { go: true };
}

/**
 * The chat loop's cron fires every minute and asks which category is due: the one waiting longest among those
 * the governor allows now. One call per fire, so calls spread out by themselves. STOP wins over everything.
 */
export async function nextCategory(categories: Record<string, string>, who: Caller = "chat", nowMs = Date.now()): Promise<{ category: string; label: string } | Decision> {
  const st = await load(nowMs);
  let firstWait: Decision | null = null;
  const due: { category: string; label: string; last: number }[] = [];
  for (const [category, label] of Object.entries(categories)) {
    const d = await decide(label, { feed: true, category }, who, nowMs);
    if (d.go) due.push({ category, label, last: st.lastCall[category] ?? 0 });
    else if (d.scope === "stop") return d;
    else if (!firstWait || d.retryAt < (firstWait as { retryAt: number }).retryAt) firstWait = d;
  }
  if (due.length) { const n = due.sort((a, b) => a.last - b.last)[0]; return { category: n.category, label: n.label }; }
  return firstWait!;
}

/**
 * Record a call's outcome. `log`: also write the call log and day counter - guard.ts already does that for
 * in-process calls, so only the CLI (chat loop) passes true.
 */
export async function record(label: string, ok: boolean, detail: string | null, meta: CallMeta = {}, opts: { log?: boolean; nowMs?: number; notify?: boolean } = {}): Promise<ErrorClass | null> {
  const nowMs = opts.nowMs ?? Date.now();
  const cls = ok ? null : classify(detail ?? "");
  if (opts.log) {
    const [tool, action] = label.split(".");
    await logMcpCall(tool, action ?? null, ok, 0, detail?.slice(0, 300) ?? null, nowMs, { source: "chat", category: meta.category, errorClass: cls });
    await bumpDailyRequests(`${today(new Date(nowMs))}#mcp`);
  }
  const st = await load(nowMs);
  if (meta.category) st.lastCall[meta.category] = nowMs;
  if (isGet(label)) st.lastGetAt = nowMs;
  if (isGet(label) && meta.jobId) {
    const marks = await jobMarks();
    marks[meta.jobId] = { at: nowMs, ...(cls === "throttle" ? { refused: true } : {}) };
    const keys = Object.keys(marks);
    if (keys.length > 1000) keys.slice(0, keys.length - 1000).forEach((k) => delete marks[k]);
    await kvSet(JOBS_KEY, marks);
  }
  if (cls) {
    st.lastError = { at: nowMs, cls, detail: (detail ?? "").slice(0, 200) };
    if (cls === "restricted" && !st.restricted) {
      st.restricted = { at: nowMs, detail: (detail ?? "").slice(0, 200) };
      if (opts.notify !== false) {
        await sendText(`⛔ <b>Upwork restricted access</b> - every Upwork call is stopped (worker and chat loop). Contact Upwork support; after they restore access run <code>npm run governor -- resume</code>.`).catch(() => undefined);
      }
    } else if (cls === "throttle" || cls === "transient") {
      st.level = Math.min(LIMITS.maxLevel, st.level + 1);
      st.levelAt = nowMs;
      if (cls === "throttle") st.getPauseUntil = nowMs + LIMITS.getPauseMs * 2 ** (st.level - 1);
    }
  }
  await save(st);
  return cls;
}

/** Human-only: clear a restriction after Upwork support restored access. Starts slow (L2) and speeds up as it stays clean. */
export async function resume(nowMs = Date.now()) {
  const st = await load(nowMs);
  st.restricted = null;
  st.level = 2;
  st.levelAt = nowMs;
  await save(st);
}

/** Mark a restriction seen elsewhere (no Telegram) - used to carry over the 2026-10-17 event. */
export async function markRestricted(detail: string, nowMs = Date.now()) {
  const st = await load(nowMs);
  st.restricted = { at: nowMs, detail: detail.slice(0, 200) };
  await save(st);
}

export const isRestricted = async () => !!(await load(Date.now())).restricted;

export async function governorStatus(nowMs = Date.now()) {
  const st = await load(nowMs);
  const cap = await dailyCap();
  const [day, hour] = await Promise.all([mcpCallCounts(nowMs - 864e5), mcpCallCounts(nowMs - 36e5)]);
  const ps = await peakState(nowMs);
  const ahead = await aheadOfPace(cap, nowMs, ps);
  const level = Math.min(LIMITS.maxLevel, st.level + (ahead ? 1 : 0));
  const base = (ps.peak ? ps.pk.peakEveryMin : ps.pk.offPeakEveryMin) * 60_000;
  return {
    state: st.restricted ? "stopped" as const : level > 0 ? "slow" as const : "normal" as const,
    restricted: st.restricted,
    level,
    storedLevel: st.level,
    aheadOfPace: ahead,
    cadenceMin: cadenceMs(level, base) / 60_000,
    peak: {
      now: ps.peak, window: ps.pk.enabled ? `${ps.pk.start}-${ps.pk.end} ${ps.pk.timezone}` : "off", localTime: ps.local,
      learnedHours: ps.learned, peakEveryMin: ps.pk.peakEveryMin, offPeakEveryMin: ps.pk.offPeakEveryMin, reservePct: ps.pk.reservePct,
      budgetDayUsed: (await mcpCallCounts(ps.dayStart)).total, offPeakAllowance: Math.floor(cap * (1 - ps.pk.reservePct / 100)),
      nextPeak: ps.peak ? null : new Date(ps.nextPeak).toISOString(),
    },
    poller: (await getSettings()).upwork.poller,
    budgets: {
      day: { used: day.total, cap },
      hour: { used: hour.total, cap: LIMITS.hourly },
      search: { used: day.search, cap: LIMITS.searchPerDay },
      get: { used: day.get, cap: LIMITS.getPerDay },
    },
    getPauseUntil: st.getPauseUntil > nowMs ? new Date(st.getPauseUntil).toISOString() : null,
    lastCall: Object.fromEntries(Object.entries(st.lastCall).map(([k, v]) => [k, new Date(v).toISOString()])),
    lastError: st.lastError ? { ...st.lastError, at: new Date(st.lastError.at).toISOString() } : null,
    errors24h: await errorSummary(nowMs),
  };
}

/** Failed calls in the last 24 h by kind (restricted / throttle / transient / auth / other) and the latest few. */
async function errorSummary(nowMs: number) {
  const rows = await mcpFailures(nowMs - 864e5);
  const byClass: Partial<Record<ErrorClass, number>> = {};
  const recent = rows.map((r) => ({ at: new Date(r.at).toISOString(), call: r.action ? `${r.tool}.${r.action}` : r.tool, cls: classify(r.detail ?? ""), detail: (r.detail ?? "").slice(0, 200) }));
  recent.forEach((r) => { byClass[r.cls] = (byClass[r.cls] ?? 0) + 1; });
  return { total: rows.length, byClass, recent: recent.slice(0, 5) };
}
export type GovernorStatus = Awaited<ReturnType<typeof governorStatus>>;
