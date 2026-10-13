import { assessIntent, type ClientHistory } from "./ranking/intent";
import { blend, evaluateRules, type RuleContext } from "./ranking/rules";
import type { Job, RankingRules, SavedSearch, ScoreBreakdown } from "./types";
import { DEFAULT_RULES } from "./db";

/*
 * Score one job for one feed. Feed-level filters (exclude keywords / countries / proposal cap) run
 * first, then the JobRankingAssistant rules (lib/ranking/rules.ts), then the optional LLM blend.
 * Pure: same inputs → same score.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();

export function hardExclude(job: Job, search: SavedSearch): string | null {
  const text = norm(`${job.title} ${job.description}`);
  const hit = search.excludeKeywords.map(norm).find((k) => k && text.includes(k));
  if (hit) return `Excluded keyword "${hit}"`;
  const country = job.client.country?.toLowerCase();
  if (country && search.excludeCountries.some((c) => c.toLowerCase() === country)) {
    return `Excluded client country ${job.client.country}`;
  }
  if (search.verifiedPaymentOnly && job.client.paymentVerified === false) return "Payment not verified";
  if (search.maxProposals != null && !job.proposalsTier && job.totalApplicants > search.maxProposals) {
    return `${job.totalApplicants} proposals > max ${search.maxProposals}`;
  }
  return null;
}

export function matchedSkills(job: Job, search: SavedSearch): string[] {
  const jobSkills = job.skills.map(norm);
  const title = norm(job.title);
  return search.skills.filter((w) => {
    const n = norm(w);
    return n && (jobSkills.some((s) => s === n || s.includes(n) || n.includes(s)) || title.includes(n));
  });
}

export function scoreJob(
  job: Job, search: SavedSearch, now = new Date(), rules: RankingRules = DEFAULT_RULES, ctx: RuleContext & { history?: ClientHistory | null } = {},
): ScoreBreakdown {
  const r = evaluateRules(job, rules, { ...ctx, now });
  const feedExcluded = hardExclude(job, search);
  const excluded = feedExcluded ?? r.rejected;
  const total = excluded ? 0 : blend(r, ctx.llm, rules.weights);
  const pen = r.flags.reduce((a, f) => a + f.penalty, 0);
  return {
    total,
    skills: Math.round(ctx.llm ? ctx.llm.fit * 0.4 : Math.min(40, r.score * 0.4 + pen * 0.4)),
    client: Math.round(Math.max(0, 35 - r.flags.filter((f) => !["low_rate", "small_budget", "crowded"].includes(f.code)).reduce((a, f) => a + f.penalty, 0) * 0.6)),
    budget: Math.round(Math.max(0, 15 - r.flags.filter((f) => ["low_rate", "small_budget", "client_avg_low"].includes(f.code)).reduce((a, f) => a + f.penalty, 0) * 0.6)),
    competition: Math.round(Math.max(0, 10 - (r.flags.some((f) => f.code === "crowded") ? 5 : 0))),
    excluded,
    matchedSkills: ctx.llm?.skillsWanted?.length ? ctx.llm.skillsWanted.slice(0, 6) : matchedSkills(job, search),
    rules: r,
    llm: ctx.llm ?? null,
    // Advisory only: computed alongside, never feeds `total`.
    intent: excluded ? null : assessIntent(job, ctx.enrichment, { now, llm: ctx.llm, history: ctx.history }),
  };
}
