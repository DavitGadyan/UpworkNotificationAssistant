import { rankWithLlm } from "./agents/jobRanking";
import { isHighValue, noteJobs } from "./upwork/governor";
import { BudgetError, llmReady } from "./agents/llm";
import { markAiRankingPaused, markAiRankingResumed } from "./aiStatus";
import { config } from "./config";
import {
  addJobFeed, callStats, clientHistory, getJob, getSettings, insertJob, knownJobIds, trackOutcome, kvGet, kvSet, listPendingJobs, listSearches, logNotification,
  setJobStatus, startWatch, updateJobData,
} from "./db";
import { callAboutJob } from "./notify/retell";
import { currentFieldSpec } from "./ranking/fieldSpec";
import { assessIntent } from "./ranking/intent";
import { sendPush } from "./notify/push";
import { sendJobAlert, sendText } from "./notify/telegram";
import { shouldCall } from "./schedule";
import { scoreJob } from "./scoring";
import type { CachedJob, Job, JobEnrichment, LlmRanking, SavedSearch, ScoreBreakdown } from "./types";
import { mergeDetail } from "./upwork/mcp/jobs";
import { fetchDetail } from "./upwork/source";
import { applyFeedCounts, countFromFeed } from "./watch";

/*
 * New job → JobRankingAssistant → store → notify → watch.
 *   1. cheap score from the feed row (rules + profile-fit gate) - every new job; off-profile ⇒ excluded
 *   2. enrichment via find_jobs get (client record)        - only promising jobs, capped per cycle
 *   3. LLM fit / value judgement                           - jobs in David's core fields, or still above the floor
 *   4. Telegram alert + proposal-count watch when the final rank clears the threshold; call for the best.
 *   5. Payment not verified but a good fit: held as "awaiting_payment" and re-checked until the client verifies
 *      (new clients often add a payment method hours or days after posting), then alerted like any new job.
 *      Never on rules alone: with the AI on, a job that missed the AI check waits as "awaiting_ai".
 */

export interface Notifiers {
  telegram: (job: Job, score: ScoreBreakdown, feedName: string, e?: JobEnrichment | null, lane?: AlertLane) => ReturnType<typeof sendJobAlert>;
  call: typeof callAboutJob;
  /** Channels with credentials present. An unconfigured channel is skipped without logging a failure. */
  ready: { telegram: boolean; call: boolean };
}
export const channelsReady = () => ({
  telegram: !!(config.telegram.botToken && config.telegram.chatId),
  call: !!(config.retell.apiKey && config.retell.fromNumber && config.retell.toNumber),
});
const defaultNotifiers = (): Notifiers => ({ telegram: sendJobAlert, call: callAboutJob, ready: channelsReady() });

export interface Hooks {
  enrich?: (id: string) => Promise<{ enrichment: JobEnrichment; patch: Partial<Job> } | null>;
  rank?: typeof rankWithLlm;
}

/** Per-cycle allowance shared by every feed in one worker tick. */
/** `refused`: "can't be opened / too quickly" answers this cycle - shared by every feed and retry in the tick. */
export interface CycleBudget { enrich: number; llm: number; refused?: number }

/** Why a job is alerted: it cleared the rank threshold, or the AI rates it a strong fit despite weak signals. */
export type AlertLane = "rank" | "strong_fit";
export const STRONG_FIT = 80;

/** `requireAi`: with the AI ranker on, nothing alerts until it has judged the job (David, 2026-10-14). */
export function alertLane(score: ScoreBreakdown, telegramMin: number, requireAi = true): AlertLane | null {
  if (score.excluded) return null;
  // He won't apply where the client requires a country of residence or on-site work (David, 2026-10-15).
  if (score.rules?.flags.some((f) => f.code === "location_restricted")) return null;
  if (requireAi && !score.llm) return null;
  if (score.total >= telegramMin) return "rank";
  const red = score.rules?.flags.some((f) => f.severity === "red");
  if (score.llm && score.llm.fit >= STRONG_FIT && !red) return "strong_fit";
  return null;
}

type Opts = { now?: Date; notifiers?: Notifiers; budget?: CycleBudget; hooks?: Hooks };
type Summary = { fresh: number; enriched: number; ranked: number; pending: number; awaitingAi: number; telegram: number; calls: number };
const emptySummary = (): Summary => ({ fresh: 0, enriched: 0, ranked: 0, pending: 0, awaitingAi: 0, telegram: 0, calls: 0 });

/**
 * Judge one job end to end. Client details are loaded BEFORE any LLM ranking or alert: a job whose
 * record could not be loaded (budget spent, Upwork error) is saved as "pending" and retried next cycle,
 * so nothing is ever ranked or alerted on feed data alone. GraphQL has no detail call, so it skips this.
 */
type Ctx = Required<Pick<Opts, "now" | "notifiers" | "budget">> & { hooks: Hooks };
/** `stored`: the client record is already loaded (a job waiting for its AI check) - don't open the job again. */
async function judge(job: Job, search: SavedSearch, ctx: Ctx, summary: Summary, existing = false, prior: LlmRanking | null = null, stored?: JobEnrichment | null) {
  const s = await getSettings();
  const rules = s.rules;
  const enrich = ctx.hooks.enrich ?? fetchDetail;
  const rank = ctx.hooks.rank ?? rankWithLlm;
  const now = ctx.now;
  const fields = await currentFieldSpec();
  // A feed's "verified payment only" filter must not drop a good fit for good: judge it as if verified,
  // then hold it for the payment watch below. Only jobs in his fields, or near the threshold, are worth that.
  const unverified = search.verifiedPaymentOnly && job.client.paymentVerified === false;
  const judgeAs = unverified ? { ...search, verifiedPaymentOnly: false } : search;
  const sc = (c: Parameters<typeof scoreJob>[4] = {}) => scoreJob(job, judgeAs, now, rules, { fields, ...c });
  let score = sc();
  const holdable = (x: ScoreBreakdown) => !x.excluded && (x.profileFit?.verdict === "core" || x.total >= Math.max(0, s.telegramMin - 25));
  if (unverified && !holdable(score)) score = scoreJob(job, search, now, rules, { fields });
  let enrichment: JobEnrichment | null = null;
  let llm: LlmRanking | null = prior; // a re-judged job keeps its earlier AI verdict unless re-ranked
  let pending = false;

  if (!score.excluded && stored !== undefined) {
    enrichment = stored;
    score = sc({ enrichment, llm });
  } else if (!score.excluded) {
    if (ctx.budget.enrich > 0) {
      try {
        const d = await enrich(job.id);
        ctx.budget.enrich--;
        if (d) {
          enrichment = d.enrichment;
          job = mergeDetail(job, d.patch, d.enrichment);
          score = sc({ enrichment, llm });
          summary.enriched++;
        }
        // d === null: the source has no detail call (GraphQL) - judge on what we have.
      } catch (e) {
        const msg = (e as Error).message;
        console.warn("enrich failed", job.id, msg.slice(0, 160));
        if ((e as { kind?: string }).kind) ctx.budget.enrich = 0; // guard tripped: stop enriching this cycle
        const refused = /PERMISSION|opened too quickly|private|invite-only|not reopened/i.test(msg);
        // "not reopened": the governor skipped a job it opened < 6 h ago or that Upwork refused - no call was made.
        if (refused && !/not reopened/.test(msg)) {
          // Either this job is private, or Upwork wants us to slow down. Skip this job (attempt counter
          // limits retries), pause 20 s, and stop opening jobs this cycle on a second refusal.
          ctx.budget.refused = (ctx.budget.refused ?? 0) + 1;
          if (ctx.budget.refused >= 2) ctx.budget.enrich = 0;
          else await new Promise((r) => setTimeout(r, ctx.hooks.enrich ? 0 : 20_000));
        }
        // A refused lookup can stay refused for hours. A job in his fields must not wait on it (David,
        // 2026-10-15: a fresh $57k-spend client went unalerted): judge it on the feed row now, and the alert
        // says the client record is missing. Other errors (502, timeouts) are transient: retry next cycle.
        // The governor's daily job-open budget is spent (David, 2026-10-19: a $50-90/hr AI job in his fields sat
        // "pending" for hours and was never alerted). No call was made; jobs in his fields are judged on the row.
        const noOpens = /job-open budget used|job opens paused/i.test(msg);
        if (noOpens) ctx.budget.enrich = 0;
        if ((refused || noOpens) && score.profileFit?.verdict === "core") {
          pending = false;
          console.warn("client record unavailable - judging on the feed row", job.id);
        } else if (noOpens) {
          pending = true; // not the job's fault: don't use up its retry attempts
        } else {
          pending = await bumpAttempts(job.id) < MAX_DETAIL_ATTEMPTS;
          if (!pending) console.warn("giving up on client record for", job.id);
        }
      }
    } else if (existing && score.profileFit?.verdict === "core") {
      // No lookups left this cycle (Upwork refusing, or the per-cycle cap) and this job in his fields has
      // already waited at least one cycle: judge it on the feed row rather than hold it indefinitely.
      console.warn("no client lookup available - judging waiting job on the feed row", job.id);
    } else pending = true;
  }

  // Jobs in his core fields always get the AI check; others only while the cheap rank is near the threshold.
  const aiOn = s.llm.enabled && await llmReady();
  const wantsAi = !pending && !score.excluded && (score.total >= Math.max(0, s.telegramMin - 25) || score.profileFit?.verdict === "core");
  if (wantsAi && aiOn && ctx.budget.llm > 0) {
    try {
      llm = await rank(job, enrichment, score.rules!);
      ctx.budget.llm--;
      score = sc({ enrichment, llm, similarProject: llm.similarProject });
      summary.ranked++;
      await markAiRankingResumed();
    } catch (e) {
      console.warn("llm rank failed", job.id, (e as Error).message);
      if (e instanceof BudgetError) {
        ctx.budget.llm = 0;
        await markAiRankingPaused(e.message, now);
      }
    }
  }

  if (!enrichment && llm) score = sc({ llm });
  // Advisory hire-likelihood with this client's track record (jobs the assistant saw close without a hire).
  if (!score.excluded) {
    const history = await clientHistory(enrichment?.clientId);
    score = { ...score, intent: assessIntent(job, enrichment, { now, llm, history }) };
  }
  if (enrichment && !score.excluded) {
    await trackOutcome({ jobId: job.id, clientId: enrichment.clientId ?? null, title: job.title, publishedAt: job.publishedAt, country: job.client.country, archetype: score.intent?.archetype ?? null, hireLikelihood: score.intent?.hireLikelihood ?? null }, now.getTime());
  }
  if (existing) await updateJobData(job.id, { job, score, ...(enrichment ? { enrichment } : {}) });
  else { await insertJob(job, search.id, score, now.getTime(), { enrichment, feeds: [search.name] }); summary.fresh++; }
  if (pending) { await setJobStatus(job.id, "pending"); summary.pending++; return; }
  // Missed the AI check (budget, outage, per-cycle cap): wait for it instead of alerting on rules alone.
  if (wantsAi && aiOn && !score.llm && !score.excluded) { await setJobStatus(job.id, "awaiting_ai"); summary.awaitingAi++; return; }
  if (unverified && !score.excluded) {
    if (score.llm && score.llm.fit >= PAYMENT_WATCH.fit) { await holdForPayment(job.id, now); return; }
    // Not a good enough fit to wait for: the feed's verified-payment filter applies as before.
    score = scoreJob(job, search, now, rules, { fields, enrichment, llm });
    await updateJobData(job.id, { job, score });
    if (existing) await setJobStatus(job.id, "new");
    return;
  }
  if (existing) await setJobStatus(job.id, "new");
  if (score.excluded || s.alertsPaused) return;

  const lane = alertLane(score, s.telegramMin, aiOn);
  if (lane && ctx.notifiers.ready.telegram && s.telegramEnabled) {
    const r = await ctx.notifiers.telegram(job, score, search.name, enrichment, lane);
    await logNotification({ jobId: job.id, channel: "telegram", ok: r.ok, detail: r.detail, title: job.title, score: score.total }, now.getTime());
    void sendPush({
      title: lane === "strong_fit" ? `💡 Strong fit · AI fit ${score.llm?.fit ?? "?"}` : `${score.total}/100 · ${search.name}`,
      body: job.title, data: { jobId: job.id },
    });
    if (r.ok) {
      await setJobStatus(job.id, "notified");
      summary.telegram++;
      if (s.watch.enabled) {
        await startWatch(job.id, r.messageId ?? null, job.totalApplicants, job.proposalsTier ?? null, now.getTime() + s.watch.intervalMin * 60_000, now.getTime());
      }
    }
  }

  const decision = shouldCall({ now, score: score.total, settings: s, calls: await callStats(now.getTime() - 864e5) });
  if (decision.ok && ctx.notifiers.ready.call) {
    const r = await ctx.notifiers.call(job, score);
    await logNotification({ jobId: job.id, channel: "call", ok: r.ok, detail: r.detail, title: job.title, score: score.total }, now.getTime());
    if (r.ok) { await setJobStatus(job.id, "called"); summary.calls++; }
  }
}

/** Client-record attempts per job: a job Upwork won't open is tried at most 3 times, never hammered. */
const MAX_DETAIL_ATTEMPTS = 3;
async function bumpAttempts(id: string): Promise<number> {
  const all = await kvGet<Record<string, number>>("detail_attempts") ?? {};
  all[id] = (all[id] ?? 0) + 1;
  const keys = Object.keys(all);
  if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete all[k]);
  await kvSet("detail_attempts", all);
  return all[id];
}

/** New jobs from one feed: rank, store, notify. Already-known jobs only refresh their proposal counts. */
export async function processResults(search: SavedSearch, jobs: Job[], opts: Opts = {}): Promise<Summary> {
  const ctx = { now: opts.now ?? new Date(), notifiers: opts.notifiers ?? defaultNotifiers(), budget: opts.budget ?? { enrich: Infinity, llm: Infinity }, hooks: opts.hooks ?? {} };
  const summary = emptySummary();
  const known = await knownJobIds(jobs.map((j) => j.id));
  const seen = jobs.filter((j) => known.has(j.id));
  for (const j of seen) await addJobFeed(j.id, search.name);
  await applyFeedCounts(seen);
  await expeditePaymentWatch(seen.filter((j) => j.client.paymentVerified === true).map((j) => j.id));
  // Best first by the cheap score, so the detail/LLM budget goes to the strongest candidates.
  const rules = (await getSettings()).rules;
  const fields = await currentFieldSpec();
  const fresh = jobs.filter((j) => !known.has(j.id))
    .map((j) => ({ j, t: scoreJob(j, search, ctx.now, rules, { fields }).total }))
    .sort((a, b) => b.t - a.t);
  // Evening-peak learning: which local hours bring new, high-value jobs (lib/upwork/governor.ts).
  await noteJobs(fresh.length, fresh.filter(({ j }) => isHighValue(j)).length, ctx.now.getTime()).catch(() => undefined);
  for (const { j } of fresh) await judge(j, search, ctx, summary);
  return summary;
}

/** Retry jobs parked as "pending" (client record not loaded yet). Runs before new feeds each cycle. */
export async function retryPending(opts: Opts = {}): Promise<Summary> {
  const ctx = { now: opts.now ?? new Date(), notifiers: opts.notifiers ?? defaultNotifiers(), budget: opts.budget ?? { enrich: Infinity, llm: Infinity }, hooks: opts.hooks ?? {} };
  const summary = emptySummary();
  const feeds = new Map((await listSearches()).map((f) => [f.id, f]));
  for (const cj of await listPendingJobs()) {
    // Out of lookups: only jobs in his fields go on (judged on the feed row); the rest wait for next cycle.
    if (ctx.budget.enrich <= 0 && cj.score.profileFit?.verdict !== "core") continue;
    const feed = feeds.get(cj.searchId);
    if (!feed) continue;
    const { searchId: _s, searchName: _n, score: _sc, status: _st, fetchedAt: _f, enrichment: _e, feeds: _fd, ...job } = cj;
    await judge(job, feed, ctx, summary, true, cj.score.llm ?? null);
  }
  return summary;
}

/**
 * Rank jobs that waited for their AI check ("awaiting_ai"): the client record is already stored, so only the
 * AI runs. They then alert like any new job. Runs before new feeds each cycle, after pending retries.
 */
export async function retryAwaitingAi(opts: Opts = {}): Promise<Summary> {
  const ctx = { now: opts.now ?? new Date(), notifiers: opts.notifiers ?? defaultNotifiers(), budget: opts.budget ?? { enrich: Infinity, llm: Infinity }, hooks: opts.hooks ?? {} };
  const summary = emptySummary();
  const s = await getSettings();
  if (!s.llm.enabled || !(await llmReady())) return summary;
  const feeds = new Map((await listSearches()).map((f) => [f.id, f]));
  for (const cj of await listPendingJobs(30, ctx.now.getTime(), "awaiting_ai")) {
    if (ctx.budget.llm <= 0) break;
    const feed = feeds.get(cj.searchId);
    if (!feed) continue;
    const { searchId: _s, searchName: _n, score: _sc, status: _st, fetchedAt: _f, enrichment, feeds: _fd, ...job } = cj;
    await judge(job, feed, ctx, summary, true, null, enrichment ?? null);
  }
  return summary;
}

// ---------- payment watch ----------
/**
 * Good-fit jobs whose client hasn't verified payment yet. New clients often add a payment method hours or
 * days after posting (David, 2026-10-15), so these are re-checked every `everyMin` for up to `maxHours`
 * (one Upwork call each) and alerted the moment the client verifies. A feed row showing the job verified
 * makes the check due at once.
 */
export const PAYMENT_WATCH = { fit: 75, everyMin: 10, maxHours: 72 };
type PaymentWatch = { since: number; nextAt: number; checks: number };
const PAYMENT_KEY = "payment_watch";
const paymentWatches = async () => (await kvGet<Record<string, PaymentWatch>>(PAYMENT_KEY)) ?? {};

async function holdForPayment(id: string, now: Date) {
  const all = await paymentWatches();
  all[id] ??= { since: now.getTime(), nextAt: now.getTime() + PAYMENT_WATCH.everyMin * 60_000, checks: 0 };
  await kvSet(PAYMENT_KEY, all);
  await setJobStatus(id, "awaiting_payment");
}

async function expeditePaymentWatch(ids: string[]) {
  if (!ids.length) return;
  const all = await paymentWatches();
  const due = ids.filter((id) => all[id]);
  if (!due.length) return;
  for (const id of due) all[id].nextAt = 0;
  await kvSet(PAYMENT_KEY, all);
}

/** Re-check due payment watches, at most `max` per cycle. Returns what happened per job id. */
export async function checkPaymentWatches(max: number, opts: Opts & { lookup?: (j: CachedJob) => Promise<Job | null> } = {}) {
  const ctx = { now: opts.now ?? new Date(), notifiers: opts.notifiers ?? defaultNotifiers(), budget: opts.budget ?? { enrich: Infinity, llm: Infinity }, hooks: opts.hooks ?? {} };
  const now = ctx.now.getTime();
  const lookup = opts.lookup ?? countFromFeed;
  const all = await paymentWatches();
  const feeds = new Map((await listSearches()).map((f) => [f.id, f]));
  const out: Record<string, string> = {};
  const due = Object.entries(all).filter(([, w]) => w.nextAt <= now).sort((a, b) => a[1].nextAt - b[1].nextAt).slice(0, max);
  for (const [id, w] of due) {
    const cj = await getJob(id);
    if (!cj || cj.status !== "awaiting_payment") { delete all[id]; out[id] = "gone"; continue; }
    if (now - w.since > PAYMENT_WATCH.maxHours * 36e5) {
      delete all[id]; await setJobStatus(id, "new"); out[id] = "timeout - never verified"; continue;
    }
    let row: Job | null;
    try { row = await lookup(cj); } catch (e) {
      w.nextAt = now + PAYMENT_WATCH.everyMin * 60_000; out[id] = `error ${(e as Error).message.slice(0, 80)}`;
      if ((e as { kind?: string }).kind) break; // guard tripped: stop calling Upwork this cycle
      continue;
    }
    w.checks++;
    w.nextAt = now + PAYMENT_WATCH.everyMin * 60_000;
    if (row?.client.paymentVerified !== true) { out[id] = row ? "still unverified" : "not in feed window"; continue; }
    delete all[id];
    const feed = feeds.get(cj.searchId);
    const { searchId: _s, searchName: _n, score: _sc, status: _st, fetchedAt: _f, enrichment, feeds: _fd, ...base } = cj;
    const job: Job = { ...base, client: { ...base.client, paymentVerified: true }, totalApplicants: row.totalApplicants, proposalsTier: row.proposalsTier ?? null };
    if (!feed) { await updateJobData(id, { job }); await setJobStatus(id, "new"); out[id] = "verified (feed gone)"; continue; }
    await judge(job, feed, ctx, emptySummary(), true, cj.score.llm ?? null, enrichment ?? null);
    const after = await getJob(id);
    if (after?.status === "notified" && channelsReady().telegram && !opts.notifiers) {
      await sendText(`💳 <b>Client just verified payment</b> on “${job.title.replace(/</g, "&lt;")}” - alert above. Proposals now: ${row.proposalsTier ?? row.totalApplicants}.`);
    }
    out[id] = `verified → ${after?.status ?? "?"}`;
  }
  await kvSet(PAYMENT_KEY, all);
  return out;
}
