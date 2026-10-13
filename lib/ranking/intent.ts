import type { ClientIntent, IntentArchetype, Job, JobEnrichment, LlmRanking } from "../types";

/*
 * Hire likelihood / ghost risk - ADVISORY. It never changes the rank (`score.total`) or David's rules
 * (lib/ranking/rules.ts). High risk ⇒ the alert is labelled "Likely not hiring — skip" and no auto-draft
 * is written; David can still apply by hand.
 *
 * Archetypes, taken from patterns in real jobs the assistant saw (2026-10-13):
 *   ghost_poster        $0 spent, posts jobs, never hires
 *   unfunded            payment method not attached and no hiring history
 *   template_collector  asks for free plans/architecture/rate cards, "quote your true price", "nonbinding
 *                       budget", "no hire authorized", huge spec with a tiny budget
 *   mass_poster         hundreds of posts with a low hire rate / many open jobs at once (proposal harvesting)
 *   identity_fronting   "US-only" or "represent us in client meetings" from a non-US $0-spend account
 *   data_harvest        wants personal device / account / ID data
 *   stale               2+ days old and the client has not invited or interviewed anyone
 *   repeat_no_hire      this client's earlier jobs (seen by the assistant) closed without a hire
 */

export interface ClientHistory { jobsSeen: number; hired: number; closedNoHire: number }

const clamp = (x: number, lo = 2, hi = 98) => Math.max(lo, Math.min(hi, Math.round(x)));
const DAY = 864e5;

/** [pattern, evidence, weight]. "No hire authorized" and placeholder budgets are near-certain; the rest only add up. */
const TEMPLATE_PATTERNS: [RegExp, string, number][] = [
  [/price shopping|quote your (true|real) price|not a proposed price|nonbinding|non-binding|placeholder (budget|price)/i, "budget is a placeholder / price-shopping language", 2],
  [/no (job )?offer|no hire|not (yet )?authori[sz]ed|nothing in this (posting|recruitment) authorizes|hiring is not guaranteed/i, "says no hire is authorized yet", 3],
  [/rate card|detailed breakdown|per[- ]milestone (breakdown|rates)|propose(d)? (an? )?(architecture|milestones|plan)|explain how you would (build|approach|design)|describe your (approach|architecture|plan) in detail/i, "asks for a free plan, architecture or rate card", 1],
  [/read (both|all|the) (complete )?attachments|mandatory before quoting|attached (spec|specification|rider)/i, "requires reading long attachments before quoting", 1],
];
const FRONTING = /\b(us[- ]only|u\.s\.[- ]only|must be (based|located) in the (us|united states)|us[- ]based (engineer|developer|candidate))\b|represent (our|the) (team|company) in (client )?meetings|non-coding role|client[- ]facing (role|representative)/i;
const HARVEST = /personal (device|account) data|emails?, photos|collection of (personal|device)|share your (id|identity|bank|login)|provide (your )?(login|credentials|ssn|passport)/i;

export function assessIntent(job: Job, e: JobEnrichment | null | undefined, ctx: { now?: Date; history?: ClientHistory | null; llm?: LlmRanking | null } = {}): ClientIntent {
  const now = ctx.now ?? new Date();
  const text = `${job.title}\n${e?.description || job.description}`;
  const r = e?.record;
  const spend = r?.totalSpent ?? job.client.totalSpent ?? 0;
  const hires = r?.hires ?? job.client.totalHires ?? 0;
  const posted = r?.jobsPosted ?? job.client.totalPostedJobs ?? 0;
  const hireRate = r?.hireRatePercent ?? (posted > 0 ? Math.round((hires / posted) * 100) : null);
  const open = r?.openJobs ?? null;
  const ageH = (now.getTime() - new Date(job.publishedAt).getTime()) / 36e5;

  let score = 60;
  const evidence: string[] = [];
  const hits: { a: IntentArchetype; w: number }[] = [];
  const hit = (a: IntentArchetype, w: number, why: string, penalty: number) => { hits.push({ a, w }); evidence.push(why); score -= penalty; };

  // ---- positive history ----
  if (hires > 0 && hireRate != null) score += (hireRate - 50) / 2;
  if (spend > 0) score += Math.min(15, Math.log10(spend + 1) * 3);
  if ((r?.feedbackScore ?? job.client.totalFeedback) >= 4.5 && (r?.feedbackCount ?? job.client.totalReviews) >= 5) score += 5;
  const starts = (e?.workHistory ?? []).map((w) => (w.started ? new Date(w.started).getTime() : 0)).filter(Boolean);
  if (starts.length && now.getTime() - Math.max(...starts) < 90 * DAY) score += 5;

  // ---- negative patterns ----
  if (spend === 0 && hires === 0) {
    if (posted >= 2) hit("ghost_poster", 3, `$0 spent: posted ${posted} jobs and never hired`, 45);
    else { score -= 15; evidence.push(`New client: no hiring history yet (${posted || 1} job posted)`); } // unknown, not damning
  }
  if (job.client.paymentVerified === false && hires === 0) hit("unfunded", 3, "No payment method attached and no hiring history", 25);
  if (posted >= 100 && hireRate != null && hireRate < 20) hit("mass_poster", 2, `${posted} jobs posted, only ${hireRate}% hired`, 25);
  else if (open != null && open >= 10) hit("mass_poster", 1, `${open} jobs open at the same time`, 10);

  let templates = 0; // weighted
  for (const [re, why, w] of TEMPLATE_PATTERNS) if (re.test(text)) { templates += w; evidence.push(why); }
  const budget = job.amount ?? 0;
  // A long, detailed brief is normal on its own; it only counts alongside another collection signal.
  if (templates && budget > 0 && budget <= 800 && text.length > 3500) { templates += 1; evidence.push(`Very long spec (${Math.round(text.length / 100) / 10}k chars) for a $${budget} budget`); }
  if (templates) { hits.push({ a: "template_collector", w: templates >= 3 ? 3 : 1 }); score -= Math.min(45, templates * 10); }

  const country = (job.client.country ?? "").toLowerCase();
  if (FRONTING.test(text) && spend === 0 && country && !/united states|usa/.test(country)) {
    hit("identity_fronting", 4, `Asks for a US-based/front-facing person from a $0-spend ${job.client.country} account`, 45);
  }
  if (HARVEST.test(text)) hit("data_harvest", 4, "Asks for personal device, account or identity data", 45);

  if (e && ageH >= 48 && e.activity.invitesSent === 0 && e.activity.interviewed === 0 && e.activity.hired === 0) {
    hit("stale", 1, `${Math.round(ageH / 24)} days old with no invites or interviews`, 15);
  }
  const h = ctx.history;
  if (h && h.closedNoHire >= 2 && h.hired === 0) hit("repeat_no_hire", 3, `${h.closedNoHire} of this client's earlier jobs closed without a hire`, 30);
  else if (h && h.hired > 0) score += 5;

  let hireLikelihood = clamp(score);
  let archetype: IntentArchetype = hits.sort((a, b) => b.w - a.w)[0]?.a ?? "genuine";
  let source: ClientIntent["source"] = "rules";

  // The AI read may only make the verdict MORE cautious, never rescue a pattern the rules caught.
  const ai = ctx.llm?.intent;
  if (ai) {
    source = "rules+ai";
    if (ai.hireLikelihood < hireLikelihood) {
      hireLikelihood = clamp(ai.hireLikelihood);
      if (archetype === "genuine" && ai.archetype !== "genuine") archetype = ai.archetype;
    }
    for (const ev of ai.evidence.slice(0, 3)) if (!evidence.includes(ev)) evidence.push(`AI: ${ev}`);
  }

  // Several quote/plan-collection signals at once (e.g. "no hire authorized" + "quote your true price" + a
  // long spec for a tiny budget) is a template harvest, whatever the client's spend.
  const severe = archetype === "identity_fronting" || archetype === "data_harvest" || templates >= 4;
  const ghostRisk: ClientIntent["ghostRisk"] = severe || hireLikelihood <= 30 ? "high" : hireLikelihood <= 55 ? "medium" : "low";
  if (!evidence.length) evidence.push("Hiring history and posting look normal");
  return { hireLikelihood, ghostRisk, archetype, evidence: evidence.slice(0, 6), source };
}
