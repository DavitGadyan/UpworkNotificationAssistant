import { rankWithLlm } from "./agents/jobRanking";
import { BudgetError, llmReady } from "./agents/llm";
import { config } from "./config";
import {
  addJobFeed, callStats, clientHistory, getSettings, insertJob, knownJobIds, trackOutcome, kvGet, kvSet, listPendingJobs, listSearches, logNotification,
  setJobStatus, startWatch, updateJobData,
} from "./db";
import { callAboutJob } from "./notify/retell";
import { assessIntent } from "./ranking/intent";
import { sendPush } from "./notify/push";
import { sendJobAlert } from "./notify/telegram";
import { shouldCall } from "./schedule";
import { scoreJob } from "./scoring";
import type { Job, JobEnrichment, LlmRanking, SavedSearch, ScoreBreakdown } from "./types";
import { mergeDetail } from "./upwork/mcp/jobs";
import { fetchDetail } from "./upwork/source";
import { applyFeedCounts } from "./watch";

/*
 * New job → JobRankingAssistant → store → notify → watch.
 *   1. cheap score from the feed row (rules only)          - every new job
 *   2. enrichment via find_jobs get (client record)        - only promising jobs, capped per cycle
 *   3. LLM fit / value judgement                           - only jobs still above the floor, capped
 *   4. Telegram alert + proposal-count watch when the final rank clears the threshold; call for the best
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
export interface CycleBudget { enrich: number; llm: number }

/** Why a job is alerted: it cleared the rank threshold, or the AI rates it a strong fit despite weak signals. */
export type AlertLane = "rank" | "strong_fit";
export const STRONG_FIT = 80;

export function alertLane(score: ScoreBreakdown, telegramMin: number): AlertLane | null {
  if (score.excluded) return null;
  if (score.total >= telegramMin) return "rank";
  const red = score.rules?.flags.some((f) => f.severity === "red");
  if (score.llm && score.llm.fit >= STRONG_FIT && !red) return "strong_fit";
  return null;
}

type Opts = { now?: Date; notifiers?: Notifiers; budget?: CycleBudget; hooks?: Hooks };
type Summary = { fresh: number; enriched: number; ranked: number; pending: number; telegram: number; calls: number };

/**
 * Judge one job end to end. Client details are loaded BEFORE any LLM ranking or alert: a job whose
 * record could not be loaded (budget spent, Upwork error) is saved as "pending" and retried next cycle,
 * so nothing is ever ranked or alerted on feed data alone. GraphQL has no detail call, so it skips this.
 */
type Ctx = Required<Pick<Opts, "now" | "notifiers" | "budget">> & { hooks: Hooks; permHits?: number };
async function judge(job: Job, search: SavedSearch, ctx: Ctx, summary: Summary, existing = false, prior: LlmRanking | null = null) {
  const s = await getSettings();
  const rules = s.rules;
  const enrich = ctx.hooks.enrich ?? fetchDetail;
  const rank = ctx.hooks.rank ?? rankWithLlm;
  const now = ctx.now;
  let score = scoreJob(job, search, now, rules);
  let enrichment: JobEnrichment | null = null;
  let llm: LlmRanking | null = prior; // a re-judged job keeps its earlier AI verdict unless re-ranked
  let pending = false;

  if (!score.excluded) {
    if (ctx.budget.enrich > 0) {
      try {
        const d = await enrich(job.id);
        ctx.budget.enrich--;
        if (d) {
          enrichment = d.enrichment;
          job = mergeDetail(job, d.patch, d.enrichment);
          score = scoreJob(job, search, now, rules, { enrichment, llm });
          summary.enriched++;
        }
        // d === null: the source has no detail call (GraphQL) - judge on what we have.
      } catch (e) {
        const msg = (e as Error).message;
        console.warn("enrich failed", job.id, msg.slice(0, 160));
        if ((e as { kind?: string }).kind) ctx.budget.enrich = 0; // guard tripped: stop enriching this cycle
        if (/PERMISSION|opened too quickly|private|invite-only/i.test(msg)) {
          // Either this job is private, or Upwork wants us to slow down. Skip this job (attempt counter
          // limits retries), pause 20 s, and stop opening jobs this cycle on a second refusal.
          ctx.permHits = (ctx.permHits ?? 0) + 1;
          if (ctx.permHits >= 2) ctx.budget.enrich = 0;
          else await new Promise((r) => setTimeout(r, ctx.hooks.enrich ? 0 : 20_000));
        }
        pending = await bumpAttempts(job.id) < MAX_DETAIL_ATTEMPTS;
        if (!pending) console.warn("giving up on client record for", job.id);
      }
    } else pending = true;
  }

  if (!pending && s.llm.enabled && await llmReady() && !score.excluded && score.total >= Math.max(0, s.telegramMin - 25) && ctx.budget.llm > 0) {
    try {
      llm = await rank(job, enrichment, score.rules!);
      ctx.budget.llm--;
      score = scoreJob(job, search, now, rules, { enrichment, llm, similarProject: (llm as LlmRanking & { similarProject?: boolean }).similarProject });
      summary.ranked++;
    } catch (e) {
      console.warn("llm rank failed", job.id, (e as Error).message);
      if (e instanceof BudgetError) ctx.budget.llm = 0;
    }
  }

  if (!enrichment && llm) score = scoreJob(job, search, now, rules, { llm });
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
  if (existing) await setJobStatus(job.id, "new");
  if (score.excluded || s.alertsPaused) return;

  const lane = alertLane(score, s.telegramMin);
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
  const summary: Summary = { fresh: 0, enriched: 0, ranked: 0, pending: 0, telegram: 0, calls: 0 };
  const known = await knownJobIds(jobs.map((j) => j.id));
  const seen = jobs.filter((j) => known.has(j.id));
  for (const j of seen) await addJobFeed(j.id, search.name);
  await applyFeedCounts(seen);
  // Best first by the cheap score, so the detail/LLM budget goes to the strongest candidates.
  const rules = (await getSettings()).rules;
  const fresh = jobs.filter((j) => !known.has(j.id))
    .map((j) => ({ j, t: scoreJob(j, search, ctx.now, rules).total }))
    .sort((a, b) => b.t - a.t);
  for (const { j } of fresh) await judge(j, search, ctx, summary);
  return summary;
}

/** Retry jobs parked as "pending" (client record not loaded yet). Runs before new feeds each cycle. */
export async function retryPending(opts: Opts = {}): Promise<Summary> {
  const ctx = { now: opts.now ?? new Date(), notifiers: opts.notifiers ?? defaultNotifiers(), budget: opts.budget ?? { enrich: Infinity, llm: Infinity }, hooks: opts.hooks ?? {} };
  const summary: Summary = { fresh: 0, enriched: 0, ranked: 0, pending: 0, telegram: 0, calls: 0 };
  const feeds = new Map((await listSearches()).map((f) => [f.id, f]));
  for (const cj of await listPendingJobs()) {
    if (ctx.budget.enrich <= 0) break;
    const feed = feeds.get(cj.searchId);
    if (!feed) continue;
    const { searchId: _s, searchName: _n, score: _sc, status: _st, fetchedAt: _f, enrichment: _e, feeds: _fd, ...job } = cj;
    await judge(job, feed, ctx, summary, true, cj.score.llm ?? null);
  }
  return summary;
}
