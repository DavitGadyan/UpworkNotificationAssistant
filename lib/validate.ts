import type { CallMode, FeedKind, RankingRules, SavedSearch, Settings } from "./types";

/* Hand-rolled input checks for the forms this app has. Returns a cleaned object or an error string. */

const list = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
const numOrNull = (v: unknown) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS: FeedKind[] = ["search", "most_recent", "best_match"];

export function cleanSearch(b: Record<string, unknown>): Omit<SavedSearch, "id" | "createdAt"> | string {
  const name = String(b.name ?? "").trim();
  if (!name) return "Name is required";
  const kind = KINDS.includes(b.kind as FeedKind) ? (b.kind as FeedKind) : "search";
  const skills = list(b.skills);
  const query = String(b.query ?? "").trim();
  if (kind === "search" && !skills.length && !query) return "Add at least one skill or a search query";
  const minHourly = numOrNull(b.minHourly), minBudget = numOrNull(b.minBudget), maxProposals = numOrNull(b.maxProposals);
  if ([minHourly, minBudget, maxProposals].some((n) => Number.isNaN(n) || (n != null && n < 0))) return "Numbers must be positive";
  const jobType = ["HOURLY", "FIXED"].includes(String(b.jobType)) ? (b.jobType as "HOURLY" | "FIXED") : "ANY";
  const exp = ["ENTRY_LEVEL", "INTERMEDIATE", "EXPERT"].includes(String(b.experienceLevel))
    ? (b.experienceLevel as SavedSearch["experienceLevel"]) : "ANY";
  return {
    name, enabled: b.enabled !== false, kind, skills, query, jobType, minHourly, minBudget,
    experienceLevel: exp, verifiedPaymentOnly: !!b.verifiedPaymentOnly, maxProposals,
    excludeKeywords: list(b.excludeKeywords), excludeCountries: list(b.excludeCountries),
    sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : null,
  };
}

const n = (v: unknown, lo: number, hi: number, fallback: number, round = true) => {
  if (v == null || v === "") return fallback;
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  const c = Math.min(hi, Math.max(lo, x));
  return round ? Math.round(c) : c;
};
const bool = (v: unknown, fallback: boolean) => (v == null ? fallback : !!v);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function cleanRules(b: Record<string, unknown>, cur: RankingRules): RankingRules {
  const ai = obj(b.ai), devops = obj(b.devops), w = obj(b.weights);
  const rulesW = n(w.rules, 0, 1, cur.weights.rules, false);
  return {
    excludedCountries: b.excludedCountries == null ? cur.excludedCountries : list(b.excludedCountries),
    maxProposals: n(b.maxProposals, 1, 100, cur.maxProposals),
    watchWarnAt: n(b.watchWarnAt, 1, 100, cur.watchWarnAt),
    minHourly: n(b.minHourly, 0, 1000, cur.minHourly),
    minClientAvgPaid: n(b.minClientAvgPaid, 0, 1000, cur.minClientAvgPaid),
    ai: {
      minHireRate: n(ai.minHireRate, 0, 100, cur.ai.minHireRate),
      minAvgPaid: n(ai.minAvgPaid, 0, 1000, cur.ai.minAvgPaid),
      recentHireDays: n(ai.recentHireDays, 1, 3650, cur.ai.recentHireDays),
    },
    devops: { minHireRate: n(devops.minHireRate, 0, 100, cur.devops.minHireRate) },
    lowRateMax: n(b.lowRateMax, 0, 500, cur.lowRateMax),
    smallJobAvg: n(b.smallJobAvg, 0, 100_000, cur.smallJobAvg),
    ignoredOpenJobs: n(b.ignoredOpenJobs, 1, 100, cur.ignoredOpenJobs),
    unverifiedExceptionFit: n(b.unverifiedExceptionFit, 0, 100, cur.unverifiedExceptionFit),
    weights: { rules: rulesW, llm: Math.round((1 - rulesW) * 100) / 100 },
  };
}

export function cleanSettings(b: Record<string, unknown>, cur: Settings): Settings | string {
  const modes: CallMode[] = ["outside_hours", "inside_hours", "always", "off"];
  const wh = { ...cur.workingHours, ...obj(b.workingHours) } as Settings["workingHours"];
  const qh = { ...cur.quietHours, ...obj(b.quietHours) } as Settings["quietHours"];
  if (!hhmm.test(wh.start) || !hhmm.test(wh.end) || !hhmm.test(qh.start) || !hhmm.test(qh.end)) return "Times must be HH:MM";
  try { new Intl.DateTimeFormat("en-US", { timeZone: wh.timezone }); } catch { return `Unknown timezone ${wh.timezone}`; }
  const g = obj(b.guard), wa = obj(b.watch), l = obj(b.llm), up = obj(b.upwork);
  const model = (v: unknown, fallback: string) => (typeof v === "string" && /^claude-[a-z0-9-]+$/.test(v) ? v : fallback);
  return {
    pollIntervalSec: n(b.pollIntervalSec, 300, 3600, cur.pollIntervalSec),
    alertsPaused: bool(b.alertsPaused, cur.alertsPaused),
    telegramEnabled: bool(b.telegramEnabled, cur.telegramEnabled),
    telegramMin: n(b.telegramMin, 0, 100, cur.telegramMin),
    callMode: modes.includes(b.callMode as CallMode) ? (b.callMode as CallMode) : cur.callMode,
    callMin: n(b.callMin, 0, 100, cur.callMin),
    callCooldownMin: n(b.callCooldownMin, 0, 1440, cur.callCooldownMin),
    maxCallsPerDay: n(b.maxCallsPerDay, 0, 50, cur.maxCallsPerDay),
    quietHours: { enabled: !!qh.enabled, start: qh.start, end: qh.end },
    workingHours: {
      days: Array.isArray(wh.days) ? [...new Set(wh.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : cur.workingHours.days,
      start: wh.start, end: wh.end, timezone: wh.timezone,
    },
    source: ["auto", "mcp", "graphql"].includes(String(b.source)) ? (b.source as Settings["source"]) : cur.source,
    guard: {
      maxEnrichPerCycle: n(g.maxEnrichPerCycle, 0, 10, cur.guard.maxEnrichPerCycle),
      dailyCallCap: n(g.dailyCallCap, 50, 2800, cur.guard.dailyCallCap),
      jitterSec: n(g.jitterSec, 0, 300, cur.guard.jitterSec),
      minGapMs: n(g.minGapMs, 3000, 30_000, cur.guard.minGapMs),
    },
    upwork: {
      poller: up.poller === "worker" || up.poller === "chat" ? up.poller : cur.upwork.poller,
      peak: (() => {
        const pk = obj(up.peak), c = cur.upwork.peak;
        let tz = typeof pk.timezone === "string" ? pk.timezone : c.timezone;
        try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = c.timezone; }
        return {
          enabled: bool(pk.enabled, c.enabled),
          timezone: tz,
          start: typeof pk.start === "string" && hhmm.test(pk.start) ? pk.start : c.start,
          end: typeof pk.end === "string" && hhmm.test(pk.end) ? pk.end : c.end,
          peakEveryMin: n(pk.peakEveryMin, 4, 30, c.peakEveryMin),
          offPeakEveryMin: n(pk.offPeakEveryMin, 4, 60, c.offPeakEveryMin),
          reservePct: n(pk.reservePct, 0, 90, c.reservePct),
          learn: bool(pk.learn, c.learn),
        };
      })(),
      recoverAfterMin: n(up.recoverAfterMin, 10, 240, cur.upwork.recoverAfterMin ?? 30),
      jobOpensPerDay: n(up.jobOpensPerDay, 60, 600, cur.upwork.jobOpensPerDay ?? 500),
    },
    watch: {
      enabled: bool(wa.enabled, cur.watch.enabled),
      intervalMin: n(wa.intervalMin, 30, 240, cur.watch.intervalMin),
      maxHours: n(wa.maxHours, 1, 336, cur.watch.maxHours),
    },
    llm: {
      enabled: bool(l.enabled, cur.llm.enabled),
      provider: l.provider === "claude-cli" || l.provider === "api" ? l.provider : cur.llm.provider,
      dailyBudgetUsd: n(l.dailyBudgetUsd, 0, 100, cur.llm.dailyBudgetUsd, false),
      ...creditPatch(l.prepaidCreditUsd, cur.llm),
      rankingModel: model(l.rankingModel, cur.llm.rankingModel),
      writerModel: model(l.writerModel, cur.llm.writerModel),
      maxRankPerCycle: n(l.maxRankPerCycle, 0, 50, cur.llm.maxRankPerCycle),
    },
    rules: b.rules ? cleanRules(obj(b.rules), cur.rules) : cur.rules,
    autoApply: (() => {
      const a = obj(b.autoApply), c = cur.autoApply;
      let tz = typeof a.timezone === "string" ? a.timezone : c.timezone;
      try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = c.timezone; }
      return {
        enabled: bool(a.enabled, c.enabled),
        timezone: tz,
        start: typeof a.start === "string" && hhmm.test(a.start) ? a.start : c.start,
        end: typeof a.end === "string" && hhmm.test(a.end) ? a.end : c.end,
        maxPerNight: n(a.maxPerNight, 0, 20, c.maxPerNight),
        minRank: n(a.minRank, 50, 100, c.minRank),
        minFit: n(a.minFit, 50, 100, c.minFit),
        maxProposals: n(a.maxProposals, 1, 20, c.maxProposals),
        maxConnectsPerNight: n(a.maxConnectsPerNight, 0, 500, c.maxConnectsPerNight),
        minConnectsBalance: n(a.minConnectsBalance, 0, 1000, c.minConnectsBalance),
        requireVerifiedPayment: bool(a.requireVerifiedPayment, c.requireVerifiedPayment),
      };
    })(),
    autoDraft: (() => {
      const a = obj(b.autoDraft), c = cur.autoDraft;
      return {
        enabled: bool(a.enabled, c.enabled),
        minRank: n(a.minRank, 0, 100, c.minRank),
        dailyCap: n(a.dailyCap, 0, 100, c.dailyCap),
        perCycle: n(a.perCycle, 0, 10, c.perCycle),
        webSearch: bool(a.webSearch, c.webSearch),
      };
    })(),
    profileFit: (() => {
      const pf = obj(b.profileFit), c = cur.profileFit;
      // Accept a list or a comma/newline-separated string; keep short phrases only.
      const list = (v: unknown, fallback: string[]) => {
        const items = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[,\n]/) : null;
        return items ? [...new Set(items.map((x) => x.trim()).filter((x) => x.length > 1 && x.length <= 60))].slice(0, 100) : fallback;
      };
      return { never: list(pf.never, c.never), alsoMine: list(pf.alsoMine, c.alsoMine) };
    })(),
  };
}

/** Prepaid credit only restarts its "spent since" clock when the amount actually changes. */
function creditPatch(v: unknown, cur: Settings["llm"]): Pick<Settings["llm"], "prepaidCreditUsd" | "creditSetAt"> {
  if (v === undefined) return { prepaidCreditUsd: cur.prepaidCreditUsd ?? null, creditSetAt: cur.creditSetAt ?? null };
  if (v === null || v === "") return { prepaidCreditUsd: null, creditSetAt: null };
  const amount = n(v, 0, 1_000_000, 0, false);
  if (amount === cur.prepaidCreditUsd && cur.creditSetAt) return { prepaidCreditUsd: amount, creditSetAt: cur.creditSetAt };
  return { prepaidCreditUsd: amount, creditSetAt: new Date().toISOString() };
}
