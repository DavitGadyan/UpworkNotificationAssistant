import { postedMs } from "./jobFilters";
import { one, query, tx } from "./pg";
import type {
  CachedJob, FeedbackRow, Job, JobEnrichment, JobStatus, NotificationRow, OutcomeLabel, Proposal, ProposalOutcome, ProposalStatus,
  RankingRules, SavedSearch, ScoreBreakdown, Settings,
} from "./types";

/*
 * Data layer over Supabase Postgres (lib/pg.ts). Every function is async.
 * Retention split:
 *  - our own data (settings, feeds, tokens, counters, feedback, prompts) is kept;
 *  - Upwork job data nobody acted on (jobs, notifications.title) is purged after 24h;
 *    jobs with a proposal draft or an active watch are kept until those finish.
 * Secrets and internal state live in private.kv, which the mobile app can never read.
 */

export const DEFAULT_RULES: RankingRules = {
  excludedCountries: ["India", "Pakistan", "Turkey", "Türkiye", "Azerbaijan", "IND", "PAK", "TUR", "AZE"],
  maxProposals: 20,
  watchWarnAt: 15,
  minHourly: 80,
  minClientAvgPaid: 80,
  ai: { minHireRate: 90, minAvgPaid: 50, recentHireDays: 90 },
  devops: { minHireRate: 75 },
  lowRateMax: 25,
  smallJobAvg: 200,
  ignoredOpenJobs: 3,
  unverifiedExceptionFit: 85,
  weights: { rules: 0.45, llm: 0.55 },
};

export const DEFAULT_SETTINGS: Settings = {
  pollIntervalSec: 240,
  alertsPaused: false,
  telegramEnabled: true,
  telegramMin: 60,
  callMode: "outside_hours",
  callMin: 85,
  callCooldownMin: 15,
  maxCallsPerDay: 5,
  quietHours: { enabled: true, start: "23:00", end: "08:00" },
  workingHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", timezone: process.env.DEFAULT_TIMEZONE ?? "UTC" },
  source: "auto",
  guard: { maxEnrichPerCycle: 25, dailyCallCap: 2000, jitterSec: 30, minGapMs: 1500 },
  watch: { enabled: true, intervalMin: 15, maxHours: 72 },
  llm: { enabled: true, provider: "api", rankingModel: "claude-sonnet-5-5", writerModel: "claude-opus-5-5", maxRankPerCycle: 20, dailyBudgetUsd: 5, prepaidCreditUsd: null, creditSetAt: null },
  rules: DEFAULT_RULES,
  autoDraft: { enabled: true, minRank: 60, dailyCap: 10, perCycle: 3, webSearch: true },
  profileFit: { never: [], alsoMine: [] },
};


export { resetDbForTests } from "./pg";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(Number(ms)).toISOString();

// ---------- key/value (private) ----------
export async function kvGet<T>(key: string): Promise<T | null> {
  const r = await one<{ value: T }>("select value from private.kv where key = $1", [key]);
  return r ? r.value : null;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await query(
    `insert into private.kv(key, value, updated_at) values($1, $2::text::jsonb, $3)
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [key, jsv(value), Date.now()],
  );
}
export async function kvDel(...keys: string[]): Promise<void> {
  if (keys.length) await query("delete from private.kv where key in (select jsonb_array_elements_text($1::text::jsonb))", [keys]);
}
/**
 * JSON params are always sent as text and parsed by Postgres ($n::text::jsonb), so neither driver
 * re-encodes them. Objects/arrays are serialized in lib/pg.ts; jsv() also covers kv scalars.
 */
const jsv = (v: unknown) => JSON.stringify(v ?? null);

// ---------- settings ----------
export function mergeSettings(s: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...s.quietHours },
    workingHours: { ...DEFAULT_SETTINGS.workingHours, ...s.workingHours },
    guard: { ...DEFAULT_SETTINGS.guard, ...s.guard },
    watch: { ...DEFAULT_SETTINGS.watch, ...s.watch },
    llm: { ...DEFAULT_SETTINGS.llm, ...s.llm },
    autoDraft: { ...DEFAULT_SETTINGS.autoDraft, ...s.autoDraft },
    profileFit: { ...DEFAULT_SETTINGS.profileFit, ...s.profileFit },
    rules: {
      ...DEFAULT_RULES,
      ...s.rules,
      ai: { ...DEFAULT_RULES.ai, ...s.rules?.ai },
      devops: { ...DEFAULT_RULES.devops, ...s.rules?.devops },
      weights: { ...DEFAULT_RULES.weights, ...s.rules?.weights },
    },
  };
}
export async function getSettings(): Promise<Settings> {
  const r = await one<{ data: Partial<Settings> }>("select data from public.settings where id = 1");
  return mergeSettings(r?.data ?? {});
}
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await query(
    `insert into public.settings(id, data, updated_at) values(1, $1::text::jsonb, $2)
     on conflict(id) do update set data = excluded.data, updated_at = excluded.updated_at`,
    [next, Date.now()],
  );
  return next;
}

export interface StoredTokens {
  accessToken: string; // encrypted
  refreshToken: string; // encrypted
  expiresAt: number; // ms epoch
  refreshedAt: number;
  account?: string | null;
}
export const getTokens = () => kvGet<StoredTokens>("tokens");
export const saveTokens = (t: StoredTokens) => kvSet("tokens", t);
export const clearTokens = () => kvDel("tokens");

export type Heartbeat = { at: number; lastError: string | null; lastFetched: number };
export const getWorkerHeartbeat = () => kvGet<Heartbeat>("heartbeat");
export const setWorkerHeartbeat = (h: Heartbeat) => kvSet("heartbeat", h);

// ---------- feeds (saved searches) ----------
type SearchInput = Omit<SavedSearch, "id" | "createdAt">;
type FeedRow = { id: number; data: SearchInput; created_at: string };
const toFeed = (r: FeedRow): SavedSearch => ({ ...r.data, kind: r.data.kind ?? "search", id: Number(r.id), createdAt: r.created_at });

export async function listSearches(): Promise<SavedSearch[]> {
  return (await query<FeedRow>("select id, data, created_at from public.feeds order by id")).map(toFeed);
}
export async function getSearch(id: number): Promise<SavedSearch | null> {
  const r = await one<FeedRow>("select id, data, created_at from public.feeds where id = $1", [id]);
  return r ? toFeed(r) : null;
}
export async function createSearch(input: SearchInput): Promise<SavedSearch> {
  const createdAt = new Date().toISOString();
  const r = await one<{ id: number }>(
    "insert into public.feeds(name, kind, enabled, data, created_at) values($1, $2, $3, $4::text::jsonb, $5) returning id",
    [input.name, input.kind ?? "search", input.enabled, input, createdAt],
  );
  return { ...input, id: Number(r!.id), createdAt };
}
export async function updateSearch(id: number, patch: Partial<SearchInput>): Promise<SavedSearch | null> {
  const cur = await getSearch(id);
  if (!cur) return null;
  const { id: _i, createdAt: _c, ...rest } = { ...cur, ...patch };
  await query("update public.feeds set name = $1, kind = $2, enabled = $3, data = $4::text::jsonb where id = $5", [rest.name, rest.kind, rest.enabled, rest, id]);
  return getSearch(id);
}
export async function deleteSearch(id: number): Promise<void> {
  await tx(async (q) => {
    await q("delete from public.feeds where id = $1", [id]);
    await q("delete from public.jobs where feed_id = $1", [id]);
  });
}

// ---------- jobs ----------
export async function hasJob(id: string): Promise<boolean> {
  return !!(await one("select 1 from public.jobs where id = $1", [id]));
}
/** Which of these ids are already stored (one round trip for a whole feed page). */
export async function knownJobIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return new Set((await query<{ id: string }>("select id from public.jobs where id in (select jsonb_array_elements_text($1::text::jsonb))", [ids])).map((r) => r.id));
}
export async function insertJob(
  job: Job, searchId: number, score: ScoreBreakdown, now = Date.now(),
  extra: { enrichment?: JobEnrichment | null; feeds?: string[] } = {},
): Promise<void> {
  await query(
    `insert into public.jobs(id, feed_id, title, url, total, status, published_at, fetched_at, data, score, enrichment, feeds)
     values($1, $2, $3, $4, $5, 'new', $6, $7, $8::text::jsonb, $9::text::jsonb, $10::text::jsonb, $11::text::jsonb)
     on conflict(id) do nothing`,
    [job.id, searchId, job.title, `https://www.upwork.com/jobs/${job.ciphertext.startsWith("~") ? job.ciphertext : "~" + job.ciphertext}`,
      score.total, job.publishedAt, now, job, score, extra.enrichment ?? null, extra.feeds ?? []],
  );
}
export async function updateJobData(id: string, patch: { job?: Job; score?: ScoreBreakdown; enrichment?: JobEnrichment | null }): Promise<void> {
  if (patch.job) await query("update public.jobs set data = $1::text::jsonb, title = $2 where id = $3", [patch.job, patch.job.title, id]);
  if (patch.score) await query("update public.jobs set score = $1::text::jsonb, total = $2 where id = $3", [patch.score, patch.score.total, id]);
  if (patch.enrichment !== undefined) await query("update public.jobs set enrichment = $1::text::jsonb where id = $2", [patch.enrichment, id]);
}
export async function addJobFeed(id: string, feed: string): Promise<void> {
  await query(
    `update public.jobs set feeds = feeds || to_jsonb($2::text)
     where id = $1 and not (feeds ? $2)`,
    [id, feed],
  );
}
/** Keep a job past the 24h purge (it has a draft, proposal or active watch). */
export async function keepJob(id: string, keep = true): Promise<void> {
  await query("update public.jobs set keep = $1 where id = $2", [keep, id]);
}
export async function setJobStatus(id: string, status: JobStatus): Promise<void> {
  await query("update public.jobs set status = $1 where id = $2", [status, id]);
}

type JobRow = {
  id: string; feed_id: number; data: Job; score: ScoreBreakdown; status: JobStatus; fetched_at: number;
  enrichment: JobEnrichment | null; feeds: string[] | null; feed_name: string | null;
};
const JOB_SELECT = `select j.id, j.feed_id, j.data, j.score, j.status, j.fetched_at, j.enrichment, j.feeds, f.name as feed_name
  from public.jobs j left join public.feeds f on f.id = j.feed_id`;
const toCached = (r: JobRow): CachedJob => ({
  ...r.data,
  searchId: Number(r.feed_id),
  searchName: r.feed_name ?? "Deleted feed",
  score: r.score,
  status: r.status,
  fetchedAt: iso(r.fetched_at),
  enrichment: r.enrichment,
  feeds: r.feeds ?? [],
});

export async function listJobs(opts: {
  status?: JobStatus | "all"; searchId?: number; q?: string; minScore?: number; maxScore?: number;
  /** Posted-time window (epoch ms). */
  since?: number | null; until?: number | null;
  /** Jobs outside David's fields ("Not your field — …"): hidden from lists by default, or only those. */
  offProfile?: "hide" | "only";
} = {}): Promise<CachedJob[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.status && opts.status !== "all") { args.push(opts.status); where.push(`j.status = $${args.length}`); }
  if (opts.offProfile === "hide") where.push(`coalesce(j.score->>'excluded', '') not like 'Not your field%'`);
  if (opts.offProfile === "only") where.push(`j.score->>'excluded' like 'Not your field%'`);
  if (opts.searchId) { args.push(opts.searchId); where.push(`j.feed_id = $${args.length}`); }
  if (opts.minScore) { args.push(opts.minScore); where.push(`j.total >= $${args.length}`); }
  if (opts.maxScore != null && opts.maxScore < 100) { args.push(opts.maxScore); where.push(`j.total <= $${args.length}`); }
  const rows = await query<JobRow>(`${JOB_SELECT} ${where.length ? "where " + where.join(" and ") : ""} order by j.published_at desc`, args);
  let jobs = rows.map(toCached);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    jobs = jobs.filter((j) => j.title.toLowerCase().includes(q) || j.skills.some((s) => s.toLowerCase().includes(q))
      || (j.enrichment?.description || j.description).toLowerCase().includes(q));
  }
  // published_at is stored as text in whatever format the feed returned, so compare parsed times here.
  if (opts.since || opts.until) {
    jobs = jobs.filter((j) => {
      const t = postedMs(j);
      return (!opts.since || t >= opts.since) && (!opts.until || t <= opts.until);
    });
  }
  return jobs;
}
export async function getJob(id: string): Promise<CachedJob | null> {
  const r = await one<JobRow>(`${JOB_SELECT} where j.id = $1`, [id]);
  return r ? toCached(r) : null;
}
/** Jobs saved without client details (enrichment failed or budget ran out) - retried before anything else. */
export async function listPendingJobs(limit = 30, now = Date.now(), status: "pending" | "awaiting_ai" = "pending"): Promise<CachedJob[]> {
  const rows = await query<JobRow>(`${JOB_SELECT} where j.status = $3 and j.fetched_at >= $1 order by j.published_at desc limit $2`, [now - RETENTION_MS, limit, status]);
  return rows.map(toCached);
}

// ---------- notifications ----------
export async function logNotification(n: Omit<NotificationRow, "id" | "createdAt">, now = Date.now()): Promise<void> {
  await query(
    "insert into public.notifications(job_id, channel, ok, detail, title, score, created_at) values($1, $2, $3, $4, $5, $6, $7)",
    [n.jobId, n.channel, n.ok, n.detail, n.title, n.score, now],
  );
}
export async function listNotifications(jobId?: string): Promise<NotificationRow[]> {
  const rows = await query<{ id: number; job_id: string; channel: "telegram" | "call"; ok: boolean; detail: string; title: string; score: number; created_at: number }>(
    `select * from public.notifications ${jobId ? "where job_id = $1" : ""} order by created_at desc limit 500`, jobId ? [jobId] : [],
  );
  return rows.map((r) => ({ id: Number(r.id), jobId: r.job_id, channel: r.channel, ok: r.ok, detail: r.detail, title: r.title, score: r.score, createdAt: iso(r.created_at) }));
}
/** Successful calls since `since` (ms), plus the most recent one - for cooldown and daily cap. */
export async function callStats(since: number): Promise<{ count: number; lastAt: number | null }> {
  const r = await one<{ c: number; last: number | null }>(
    `select count(*) filter (where created_at >= $1)::int as c, max(created_at) as last
     from public.notifications where channel = 'call' and ok`, [since],
  );
  return { count: r?.c ?? 0, lastAt: r?.last != null ? Number(r.last) : null };
}

// ---------- request counters ----------
export async function bumpDailyRequests(day: string, n = 1): Promise<number> {
  const r = await one<{ requests: number }>(
    `insert into public.counters(day, requests) values($1, $2)
     on conflict(day) do update set requests = public.counters.requests + excluded.requests returning requests`, [day, n],
  );
  return r?.requests ?? n;
}
export async function dailyRequests(day: string): Promise<number> {
  return (await one<{ requests: number }>("select requests from public.counters where day = $1", [day]))?.requests ?? 0;
}

// ---------- retention ----------
/** Delete Upwork data nobody acted on that is older than 24h. Returns rows removed. */
export async function purgeExpired(now = Date.now()): Promise<{ jobs: number; notifications: number }> {
  const cutoff = now - RETENTION_MS;
  const jobs = await query(
    `delete from public.jobs where fetched_at < $1 and not keep
       and id not in (select job_id from public.proposals) and id not in (select job_id from public.job_watch where done is null)
     returning id`, [cutoff],
  );
  const notifications = await query("delete from public.notifications where created_at < $1 returning id", [cutoff]);
  await query("delete from public.counters where day < $1", [new Date(now - 7 * 864e5).toISOString().slice(0, 10)]);
  await query("delete from public.mcp_log where created_at < $1", [now - 7 * 864e5]);
  await query("delete from public.job_watch where done is not null and started_at < $1", [now - 7 * 864e5]);
  return { jobs: jobs.length, notifications: notifications.length };
}

// ---------- proposals ----------
type ProposalRow = { id: number; job_id: string; status: ProposalStatus; data: Omit<Proposal, "id" | "jobId" | "status" | "createdAt" | "updatedAt">; created_at: string; updated_at: string };
const toProposal = (r: ProposalRow): Proposal => ({ ...r.data, id: Number(r.id), jobId: r.job_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
export type ProposalInput = Omit<Proposal, "id" | "createdAt" | "updatedAt">;

export async function createProposal(p: ProposalInput): Promise<Proposal> {
  const now = new Date().toISOString();
  const { jobId, status, ...data } = p;
  const r = await one<{ id: number }>(
    "insert into public.proposals(job_id, status, data, created_at, updated_at) values($1, $2, $3::text::jsonb, $4, $4) returning id",
    [jobId, status, data, now],
  );
  await keepJob(jobId);
  return (await getProposal(Number(r!.id)))!;
}
export async function getProposal(id: number): Promise<Proposal | null> {
  const r = await one<ProposalRow>("select * from public.proposals where id = $1", [id]);
  return r ? toProposal(r) : null;
}
export async function listProposals(opts: { jobId?: string; status?: ProposalStatus } = {}): Promise<Proposal[]> {
  const where: string[] = [], args: unknown[] = [];
  if (opts.jobId) { args.push(opts.jobId); where.push(`job_id = $${args.length}`); }
  if (opts.status) { args.push(opts.status); where.push(`status = $${args.length}`); }
  return (await query<ProposalRow>(`select * from public.proposals ${where.length ? "where " + where.join(" and ") : ""} order by id desc`, args)).map(toProposal);
}
export async function updateProposal(id: number, patch: Partial<ProposalInput>): Promise<Proposal | null> {
  const cur = await getProposal(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  const { id: _i, jobId: _j, status, createdAt: _c, updatedAt: _u, ...data } = next;
  await query("update public.proposals set status = $1, data = $2::text::jsonb, updated_at = $3 where id = $4", [status, data, new Date().toISOString(), id]);
  return getProposal(id);
}

// ---------- proposal-count watch ----------
export interface WatchRow { jobId: string; messageId: number | null; lastCount: number; lastTier: string | null; warned: boolean; startedAt: number; nextAt: number; done: string | null }
type WatchDbRow = { job_id: string; message_id: number | null; last_count: number; last_tier: string | null; warned: boolean; started_at: number; next_at: number; done: string | null };
const toWatch = (r: WatchDbRow): WatchRow => ({
  jobId: r.job_id, messageId: r.message_id != null ? Number(r.message_id) : null, lastCount: r.last_count, lastTier: r.last_tier,
  warned: r.warned, startedAt: Number(r.started_at), nextAt: Number(r.next_at), done: r.done,
});
export async function startWatch(jobId: string, messageId: number | null, count: number, tier: string | null, nextAt: number, now = Date.now()): Promise<void> {
  await query(
    `insert into public.job_watch(job_id, message_id, last_count, last_tier, warned, started_at, next_at, done)
     values($1, $2, $3, $4, false, $5, $6, null) on conflict(job_id) do nothing`,
    [jobId, messageId, count, tier, now, nextAt],
  );
}
export async function dueWatches(now = Date.now()): Promise<WatchRow[]> {
  return (await query<WatchDbRow>("select * from public.job_watch where done is null and next_at <= $1 order by next_at", [now])).map(toWatch);
}
export async function listWatches(): Promise<WatchRow[]> {
  return (await query<WatchDbRow>("select * from public.job_watch order by started_at desc limit 200")).map(toWatch);
}
export async function updateWatch(jobId: string, patch: Partial<Pick<WatchRow, "lastCount" | "lastTier" | "warned" | "nextAt" | "done" | "messageId">>): Promise<void> {
  const cur = await one<WatchDbRow>("select * from public.job_watch where job_id = $1", [jobId]);
  if (!cur) return;
  const n = { ...toWatch(cur), ...patch };
  await query(
    "update public.job_watch set message_id = $1, last_count = $2, last_tier = $3, warned = $4, next_at = $5, done = $6 where job_id = $7",
    [n.messageId, n.lastCount, n.lastTier, n.warned, n.nextAt, n.done, jobId],
  );
}

// ---------- feedback (preference signals) ----------
export async function addFeedback(f: Omit<FeedbackRow, "id" | "createdAt">): Promise<FeedbackRow> {
  const createdAt = new Date().toISOString();
  const r = await one<{ id: number }>(
    "insert into public.feedback(kind, ref_id, rating, reason, data, created_at) values($1, $2, $3, $4, $5::text::jsonb, $6) returning id",
    [f.kind, f.refId, f.rating, f.reason, f.data, createdAt],
  );
  return { ...f, id: Number(r!.id), createdAt };
}
export async function listFeedback(kind?: FeedbackRow["kind"], limit = 500): Promise<FeedbackRow[]> {
  const rows = await query<{ id: number; kind: FeedbackRow["kind"]; ref_id: string; rating: number; reason: string | null; data: Record<string, unknown> | null; created_at: string }>(
    `select * from public.feedback ${kind ? "where kind = $1" : ""} order by id desc limit ${kind ? "$2" : "$1"}`, kind ? [kind, limit] : [limit],
  );
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, refId: r.ref_id, rating: r.rating, reason: r.reason, data: r.data, createdAt: r.created_at }));
}

// ---------- prompt versions ----------
export interface PromptVersion { id: number; name: string; body: string; note: string | null; active: boolean; createdAt: string }
type PromptRow = { id: number; name: string; body: string; note: string | null; active: boolean; created_at: string };
const toPrompt = (r: PromptRow): PromptVersion => ({ id: Number(r.id), name: r.name, body: r.body, note: r.note, active: r.active, createdAt: r.created_at });
export async function activePrompt(name: string): Promise<PromptVersion | null> {
  const r = await one<PromptRow>("select * from public.prompt_versions where name = $1 and active order by id desc limit 1", [name]);
  return r ? toPrompt(r) : null;
}
export async function getPromptVersion(id: number): Promise<PromptVersion | null> {
  const r = await one<PromptRow>("select * from public.prompt_versions where id = $1", [id]);
  return r ? toPrompt(r) : null;
}
export async function listPromptVersions(name?: string): Promise<PromptVersion[]> {
  return (await query<PromptRow>(`select * from public.prompt_versions ${name ? "where name = $1" : ""} order by id desc`, name ? [name] : [])).map(toPrompt);
}
export async function savePromptVersion(name: string, body: string, note: string | null): Promise<PromptVersion> {
  return tx(async (q) => {
    await q("update public.prompt_versions set active = false where name = $1", [name]);
    const [r] = await q<PromptRow>(
      "insert into public.prompt_versions(name, body, note, active, created_at) values($1, $2, $3, true, $4) returning *",
      [name, body, note, new Date().toISOString()],
    );
    return toPrompt(r);
  });
}
export async function activatePromptVersion(id: number): Promise<void> {
  await tx(async (q) => {
    const [r] = await q<{ name: string }>("select name from public.prompt_versions where id = $1", [id]);
    if (!r) return;
    await q("update public.prompt_versions set active = false where name = $1", [r.name]);
    await q("update public.prompt_versions set active = true where id = $1", [id]);
  });
}

// ---------- metrics snapshots & reports ----------
export async function saveSnapshot(period: string, data: unknown): Promise<void> {
  await query("insert into public.metrics_snapshots(period, data, created_at) values($1, $2::text::jsonb, $3)", [period, data, new Date().toISOString()]);
}
export async function listSnapshots(limit = 24): Promise<{ id: number; period: string; data: Record<string, unknown>; createdAt: string }[]> {
  return (await query<{ id: number; period: string; data: Record<string, unknown>; created_at: string }>("select * from public.metrics_snapshots order by id desc limit $1", [limit]))
    .map((r) => ({ id: Number(r.id), period: r.period, data: r.data, createdAt: r.created_at }));
}
export async function saveReport(kind: string, data: unknown): Promise<number> {
  const r = await one<{ id: number }>("insert into public.reports(kind, data, created_at) values($1, $2::text::jsonb, $3) returning id", [kind, data, new Date().toISOString()]);
  return Number(r!.id);
}
export async function latestReport<T>(kind: string): Promise<{ id: number; data: T; createdAt: string } | null> {
  const r = await one<{ id: number; data: T; created_at: string }>("select * from public.reports where kind = $1 order by id desc limit 1", [kind]);
  return r ? { id: Number(r.id), data: r.data, createdAt: r.created_at } : null;
}
export async function listReports(kind: string, limit = 12): Promise<{ id: number; data: unknown; createdAt: string }[]> {
  return (await query<{ id: number; data: unknown; created_at: string }>("select * from public.reports where kind = $1 order by id desc limit $2", [kind, limit]))
    .map((r) => ({ id: Number(r.id), data: r.data, createdAt: r.created_at }));
}

// ---------- MCP call log (ban-safety accounting) ----------
export async function logMcpCall(tool: string, action: string | null, ok: boolean, ms: number, detail: string | null, now = Date.now()): Promise<void> {
  await query("insert into public.mcp_log(tool, action, ok, ms, detail, created_at) values($1, $2, $3, $4, $5, $6)", [tool, action, ok, ms, detail, now]);
}
export async function mcpCallStats(since: number): Promise<{ total: number; failed: number; byTool: Record<string, number> }> {
  const rows = await query<{ tool: string; action: string | null; ok: boolean }>("select tool, action, ok from public.mcp_log where created_at >= $1", [since]);
  const byTool: Record<string, number> = {};
  rows.forEach((r) => { const k = r.action ? `${r.tool}.${r.action}` : r.tool; byTool[k] = (byTool[k] ?? 0) + 1; });
  return { total: rows.length, failed: rows.filter((r) => !r.ok).length, byTool };
}

// ---------- devices (Expo push) ----------
export async function listDeviceTokens(): Promise<string[]> {
  return (await query<{ token: string }>("select token from public.devices")).map((r) => r.token);
}
export async function removeDeviceToken(token: string): Promise<void> {
  await query("delete from public.devices where token = $1", [token]);
}

// ---------- outcomes: which clients actually hire (derived, kept past the 24h purge) ----------
export interface OutcomeRow {
  jobId: string; clientId: string | null; title: string; publishedAt: string; checks: number; nextCheckAt: number;
  status: "open" | "hired" | "closed_no_hire"; proposalsTier: string | null; invites: number | null; interviewed: number | null;
  hired: number | null; intentArchetype: string | null; hireLikelihood: number | null;
}
type OutcomeDb = { job_id: string; client_id: string | null; title: string; published_at: string; checks: number; next_check_at: number; status: OutcomeRow["status"]; proposals_tier: string | null; invites: number | null; interviewed: number | null; hired: number | null; intent_archetype: string | null; hire_likelihood: number | null };
const toOutcome = (r: OutcomeDb): OutcomeRow => ({
  jobId: r.job_id, clientId: r.client_id, title: r.title, publishedAt: r.published_at, checks: r.checks, nextCheckAt: Number(r.next_check_at),
  status: r.status, proposalsTier: r.proposals_tier, invites: r.invites, interviewed: r.interviewed, hired: r.hired,
  intentArchetype: r.intent_archetype, hireLikelihood: r.hire_likelihood,
});

/** Start tracking a job's outcome (first check ~2 days after posting) and count the client as seen. */
export async function trackOutcome(o: { jobId: string; clientId: string | null; title: string; publishedAt: string; country: string | null; archetype: string | null; hireLikelihood: number | null }, now = Date.now()): Promise<void> {
  const first = Math.max(now, new Date(o.publishedAt).getTime() + 2 * 864e5);
  const inserted = await query(
    `insert into public.job_outcomes(job_id, client_id, title, published_at, next_check_at, intent_archetype, hire_likelihood, updated_at)
     values($1, $2, $3, $4, $5, $6, $7, $8) on conflict(job_id) do nothing returning job_id`,
    [o.jobId, o.clientId, o.title, o.publishedAt, first, o.archetype, o.hireLikelihood, now],
  );
  if (inserted.length && o.clientId) {
    await query(
      `insert into public.clients(client_id, country, jobs_seen, last_seen) values($1, $2, 1, $3)
       on conflict(client_id) do update set jobs_seen = public.clients.jobs_seen + 1, last_seen = excluded.last_seen, country = coalesce(excluded.country, public.clients.country)`,
      [o.clientId, o.country, now],
    );
  }
}
export async function dueOutcomes(limit: number, now = Date.now()): Promise<OutcomeRow[]> {
  return (await query<OutcomeDb>("select * from public.job_outcomes where status = 'open' and next_check_at <= $1 order by next_check_at limit $2", [now, limit])).map(toOutcome);
}
/** Record a re-check. A job that reached a final state updates its client's track record once. */
export async function recordOutcome(jobId: string, patch: { status: OutcomeRow["status"]; proposalsTier: string | null; invites: number; interviewed: number; hired: number; nextCheckAt: number }, now = Date.now()): Promise<void> {
  const cur = await one<OutcomeDb>("select * from public.job_outcomes where job_id = $1", [jobId]);
  if (!cur) return;
  await query(
    `update public.job_outcomes set status = $1, proposals_tier = $2, invites = $3, interviewed = $4, hired = $5, next_check_at = $6, checks = checks + 1, updated_at = $7 where job_id = $8`,
    [patch.status, patch.proposalsTier, patch.invites, patch.interviewed, patch.hired, patch.nextCheckAt, now, jobId],
  );
  if (cur.status === "open" && patch.status !== "open" && cur.client_id) {
    await query(
      `update public.clients set ${patch.status === "hired" ? "hired = hired + 1" : "closed_no_hire = closed_no_hire + 1"} where client_id = $1`,
      [cur.client_id],
    );
  }
}
export async function clientHistory(clientId: string | null | undefined): Promise<{ jobsSeen: number; hired: number; closedNoHire: number } | null> {
  if (!clientId) return null;
  const r = await one<{ jobs_seen: number; hired: number; closed_no_hire: number }>("select jobs_seen, hired, closed_no_hire from public.clients where client_id = $1", [clientId]);
  return r ? { jobsSeen: r.jobs_seen, hired: r.hired, closedNoHire: r.closed_no_hire } : null;
}
/** Ghost-pattern stats: per predicted archetype, how many tracked jobs actually hired. */
export async function outcomeStats(): Promise<{ archetype: string; tracked: number; hired: number; closedNoHire: number; open: number; avgLikelihood: number | null }[]> {
  return (await query<{ archetype: string; tracked: number; hired: number; closed_no_hire: number; open: number; avg: number | null }>(
    `select coalesce(intent_archetype, 'unknown') archetype, count(*)::int tracked,
            count(*) filter (where status = 'hired')::int hired, count(*) filter (where status = 'closed_no_hire')::int closed_no_hire,
            count(*) filter (where status = 'open')::int open, round(avg(hire_likelihood))::int avg
     from public.job_outcomes group by 1 order by 2 desc`,
  )).map((r) => ({ archetype: r.archetype, tracked: r.tracked, hired: r.hired, closedNoHire: r.closed_no_hire, open: r.open, avgLikelihood: r.avg }));
}

// ---------- proposal outcomes (what clients did with David's sent proposals) ----------
type ProposalOutcomeDb = {
  upwork_proposal_id: string; job_id: string; job_title: string; local_proposal_id: number | null; submitted_at: string; status: string;
  status_label: string | null; archive_reason: string | null; viewed: boolean; boosted: boolean; connects_bid: number | null; bid: string | number | null;
  bid_label: string | null; cover_letter: string | null; insights: ProposalOutcome["insights"]; room_id: string | null; replied_at: string | null;
  first_reply: string | null; outcome: OutcomeLabel; job: ProposalOutcome["job"]; checks: number; next_check_at: number; updated_at: number;
};
const toProposalOutcome = (r: ProposalOutcomeDb): ProposalOutcome => ({
  upworkProposalId: r.upwork_proposal_id, jobId: r.job_id, jobTitle: r.job_title, localProposalId: r.local_proposal_id != null ? Number(r.local_proposal_id) : null,
  submittedAt: r.submitted_at, status: r.status, statusLabel: r.status_label, archiveReason: r.archive_reason, viewed: r.viewed, boosted: r.boosted,
  connectsBid: r.connects_bid, bid: r.bid != null ? Number(r.bid) : null, bidLabel: r.bid_label, coverLetter: r.cover_letter, insights: r.insights,
  roomId: r.room_id, repliedAt: r.replied_at, firstReply: r.first_reply, outcome: r.outcome, job: r.job, checks: r.checks,
  nextCheckAt: Number(r.next_check_at), updatedAt: Number(r.updated_at),
});
export async function getProposalOutcome(upworkProposalId: string): Promise<ProposalOutcome | null> {
  const r = await one<ProposalOutcomeDb>("select * from public.proposal_outcomes where upwork_proposal_id = $1", [upworkProposalId]);
  return r ? toProposalOutcome(r) : null;
}
export async function saveProposalOutcome(o: ProposalOutcome): Promise<void> {
  await query(
    `insert into public.proposal_outcomes(upwork_proposal_id, job_id, job_title, local_proposal_id, submitted_at, status, status_label, archive_reason,
       viewed, boosted, connects_bid, bid, bid_label, cover_letter, insights, room_id, replied_at, first_reply, outcome, job, checks, next_check_at, updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text::jsonb,$16,$17,$18,$19,$20::text::jsonb,$21,$22,$23)
     on conflict(upwork_proposal_id) do update set job_id = excluded.job_id, job_title = excluded.job_title, local_proposal_id = excluded.local_proposal_id,
       submitted_at = excluded.submitted_at, status = excluded.status, status_label = excluded.status_label, archive_reason = excluded.archive_reason,
       viewed = excluded.viewed, boosted = excluded.boosted, connects_bid = excluded.connects_bid, bid = excluded.bid, bid_label = excluded.bid_label,
       cover_letter = excluded.cover_letter, insights = excluded.insights, room_id = excluded.room_id, replied_at = excluded.replied_at,
       first_reply = excluded.first_reply, outcome = excluded.outcome, job = excluded.job, checks = excluded.checks,
       next_check_at = excluded.next_check_at, updated_at = excluded.updated_at`,
    [o.upworkProposalId, o.jobId, o.jobTitle, o.localProposalId, o.submittedAt, o.status, o.statusLabel, o.archiveReason, o.viewed, o.boosted,
      o.connectsBid, o.bid, o.bidLabel, o.coverLetter, o.insights, o.roomId, o.repliedAt, o.firstReply, o.outcome, o.job, o.checks, o.nextCheckAt, o.updatedAt],
  );
}
/** Newest first. `outcome` filters one label; `since` is an ISO submitted-at lower bound. */
export async function listProposalOutcomes(opts: { outcome?: OutcomeLabel; since?: string; limit?: number } = {}): Promise<ProposalOutcome[]> {
  const where: string[] = [], args: unknown[] = [];
  if (opts.outcome) { args.push(opts.outcome); where.push(`outcome = $${args.length}`); }
  if (opts.since) { args.push(opts.since); where.push(`submitted_at >= $${args.length}`); }
  args.push(opts.limit ?? 500);
  return (await query<ProposalOutcomeDb>(`select * from public.proposal_outcomes ${where.length ? "where " + where.join(" and ") : ""} order by submitted_at desc limit $${args.length}`, args)).map(toProposalOutcome);
}
/** Same as listProposalOutcomes, but [] while migration 007 isn't applied yet, so ranking and writing keep working without it. */
export async function listProposalOutcomesSafe(opts: Parameters<typeof listProposalOutcomes>[0] = {}): Promise<ProposalOutcome[]> {
  try { return await listProposalOutcomes(opts); } catch (e) {
    if (/proposal_outcomes" does not exist/.test(String((e as Error)?.message))) return [];
    throw e;
  }
}
/** Rows whose reply check is due (pending ones, newest first). */
export async function dueProposalOutcomes(limit: number, now = Date.now()): Promise<ProposalOutcome[]> {
  return (await query<ProposalOutcomeDb>("select * from public.proposal_outcomes where next_check_at > 0 and next_check_at <= $1 order by submitted_at desc limit $2", [now, limit])).map(toProposalOutcome);
}

// ---------- prompt stats (daily trend per prompt version) ----------
export interface PromptStatRow { day: string; prompt: string; version: number; scenario: string; sent: number; viewed: number; replied: number; offers: number; hires: number; kept: number | null; updatedAt: number }
export async function upsertPromptStats(rows: PromptStatRow[]): Promise<void> {
  for (const r of rows) {
    await query(
      `insert into public.prompt_stats(day, prompt, version, scenario, sent, viewed, replied, offers, hires, kept, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict(day, prompt, version, scenario) do update set sent = excluded.sent, viewed = excluded.viewed, replied = excluded.replied,
         offers = excluded.offers, hires = excluded.hires, kept = excluded.kept, updated_at = excluded.updated_at`,
      [r.day, r.prompt, r.version, r.scenario, r.sent, r.viewed, r.replied, r.offers, r.hires, r.kept, r.updatedAt],
    );
  }
}
export async function listPromptStats(opts: { prompt: string; version?: number; scenario?: string; sinceDay?: string }): Promise<PromptStatRow[]> {
  const where = ["prompt = $1"], args: unknown[] = [opts.prompt];
  if (opts.version != null) { args.push(opts.version); where.push(`version = $${args.length}`); }
  args.push(opts.scenario ?? "all"); where.push(`scenario = $${args.length}`);
  if (opts.sinceDay) { args.push(opts.sinceDay); where.push(`day >= $${args.length}`); }
  try {
    const rows = await query<{ day: string; prompt: string; version: number; scenario: string; sent: number; viewed: number; replied: number; offers: number; hires: number; kept: string | null; updated_at: number }>(
      `select * from public.prompt_stats where ${where.join(" and ")} order by day`, args);
    return rows.map((r) => ({ day: r.day, prompt: r.prompt, version: Number(r.version), scenario: r.scenario, sent: r.sent, viewed: r.viewed, replied: r.replied, offers: r.offers, hires: r.hires, kept: r.kept == null ? null : Number(r.kept), updatedAt: Number(r.updated_at) }));
  } catch (e) {
    if (/prompt_stats" does not exist/.test(String((e as Error)?.message))) return [];
    throw e;
  }
}

// ---------- leader lease: only one worker polls Upwork even if two machines run ----------
/** Take or renew the polling lease for `owner` (hostname:pid). Returns true when this worker is the leader. */
export async function acquireLease(owner: string, ttlMs: number, now = Date.now()): Promise<boolean> {
  const r = await query<{ key: string }>(
    `insert into private.kv(key, value, updated_at) values('worker_lease', $1::text::jsonb, $2)
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
       where (private.kv.value->>'owner') = $3 or (private.kv.value->>'until')::bigint < $2
     returning key`,
    [JSON.stringify({ owner, until: now + ttlMs }), now, owner],
  );
  return r.length > 0;
}
export const currentLease = () => kvGet<{ owner: string; until: number }>("worker_lease");
