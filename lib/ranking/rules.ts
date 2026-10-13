import type { Job, JobCategory, JobEnrichment, LlmRanking, RankingRules, RuleFlag, RuleResult } from "../types";
import { proposalsLow } from "../upwork/tiers";

/*
 * JobRankingAssistant, stage A: David's hard business rules. Pure and deterministic.
 *
 *   Hard reject  : excluded client country (India, Pakistan, Turkey, Azerbaijan by default), more than
 *                  `maxProposals` proposals, already applied, job closed, client already hired.
 *   Red flags    : unverified payment (forgiven only for a brand-new client on a very tight fit),
 *                  a cheap-labour history (avg ≤ $25/hr), mostly tiny jobs (< $200 per contract),
 *                  several open jobs the client is ignoring, low hire rate for AI / DevOps work.
 *   Value gates  : hourly ≥ $80, or no rate but the client has paid ≥ $80/hr before; AI/SaaS clients
 *                  with 90-100 % hire rate, ≥ $50/hr average and a hire in the last ~3 months.
 *
 * Upwork does not expose the client's per-contract rates, so "average paid" is estimated as lifetime
 * spend ÷ lifetime hours. Fixed-price spend inflates it, so it is treated as an upper estimate.
 * A field Upwork doesn't return is "unknown": a small penalty, never a pass.
 */

const has = (text: string, words: RegExp) => words.test(text);
const CAT: [JobCategory, RegExp][] = [
  ["mlops", /\b(mlops|ml ops|model (deployment|serving|monitoring)|sagemaker|vertex ai|kubeflow|mlflow|feature store|llmops)\b/i],
  ["ai", /\b(ai|a\.i\.|llm|gpt|chatgpt|openai|claude|anthropic|gemini|genai|generative|rag|retrieval|langchain|langgraph|llamaindex|agentic|ai agent|agents?|chatbot|voice (ai|agent)|machine learning|deep learning|nlp|computer vision|fine.?tun|embeddings?|vector|mcp)\b/i],
  ["devops", /\b(devops|kubernetes|k8s|terraform|ci\/cd|docker|aws infrastructure|gcp|azure|sre|helm|ansible)\b/i],
  ["saas", /\b(saas|mvp|web app|platform|full.?stack|dashboard|next\.?js|react|node\.?js|backend|api development)\b/i],
  ["automation", /\b(automation|automate|n8n|zapier|make\.com|workflow|rpa|integration)\b/i],
  ["data", /\b(data scien|data engineer|analytics|etl|sql|tableau|power bi|forecast|statistic)\b/i],
  ["marketing", /\b(seo|geo|aeo|marketing|social media|ads|ppc|content writer|copywrit|branding|pr\b)\b/i],
];

export function detectCategory(job: Pick<Job, "title" | "description" | "skills">): JobCategory {
  const text = `${job.title} ${job.skills.join(" ")} ${job.description.slice(0, 1500)}`;
  // Title decides first: "AI Voice Agent Developer" is AI even if the description mentions SEO.
  for (const [cat, re] of CAT) if (has(job.title, re)) return cat;
  for (const [cat, re] of CAT) if (has(text, re)) return cat;
  return "other";
}

const isAiLike = (c: JobCategory) => c === "ai" || c === "saas" || c === "automation";
const isOpsLike = (c: JobCategory) => c === "devops" || c === "mlops";
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const DAY = 864e5;

export interface RuleContext {
  enrichment?: JobEnrichment | null;
  llm?: LlmRanking | null;
  /** True when David's history has a finished project similar to this one (from the LLM / ICP). */
  similarProject?: boolean;
  now?: Date;
}

export function derive(job: Job, e?: JobEnrichment | null, now = new Date()) {
  const spend = e?.record.totalSpent ?? job.client.totalSpent ?? 0;
  const hours = e?.record.hours ?? null;
  const contracts = e?.record.contractsTotal ?? null;
  const starts = (e?.workHistory ?? []).map((w) => w.started).filter(Boolean).map((s) => new Date(s!).getTime());
  return {
    avgPaid: hours && hours >= 10 ? Math.round(spend / hours) : null,
    avgPerContract: contracts && contracts > 0 ? Math.round(spend / contracts) : null,
    lastHireDays: starts.length ? Math.round((now.getTime() - Math.max(...starts)) / DAY) : null,
    hireRate: e?.record.hireRatePercent ?? (job.client.totalPostedJobs > 0 && job.client.totalHires > 0
      ? Math.round((job.client.totalHires / job.client.totalPostedJobs) * 100) : null),
  };
}

export function evaluateRules(job: Job, rules: RankingRules, ctx: RuleContext = {}): RuleResult {
  const now = ctx.now ?? new Date();
  const e = ctx.enrichment ?? null;
  const category = ctx.llm?.category ?? detectCategory(job);
  const d = derive(job, e, now);
  const flags: RuleFlag[] = [];
  const passes: string[] = [];
  const flag = (code: string, label: string, severity: RuleFlag["severity"], penalty: number) => flags.push({ code, label, severity, penalty });

  // ---------- hard rejects ----------
  const country = job.client.country?.toLowerCase() ?? "";
  const excluded = rules.excludedCountries.map((c) => c.toLowerCase());
  let rejected: string | null = null;
  const proposals = proposalsLow(job);
  if (country && excluded.includes(country)) rejected = `Client country ${job.client.country} is on the exclude list`;
  else if (job.applied || e?.applied) rejected = "Already applied";
  else if (e?.status && e.status !== "ACTIVE") rejected = `Job is ${e.status.toLowerCase()}`;
  else if (e && e.activity.hired > 0) rejected = "Client already hired for this job";
  else if (job.proposalsTier ? proposals >= rules.maxProposals : proposals > rules.maxProposals) {
    rejected = `${job.proposalsTier ?? proposals} proposals - over ${rules.maxProposals}, unlikely to win`;
  }

  // ---------- payment ----------
  const newClient = (e?.record.hires ?? job.client.totalHires) === 0;
  if (job.client.paymentVerified === false) {
    const fit = ctx.llm?.fit ?? 0;
    if (newClient && fit >= rules.unverifiedExceptionFit && ctx.similarProject !== false) {
      flag("unverified_new", "Payment not verified - new client, allowed because the fit is very tight", "amber", 6);
    } else flag("unverified", "Payment method not verified", "red", 25);
  } else if (job.client.paymentVerified === true) passes.push("Payment verified");

  // ---------- rate ----------
  const top = job.hourlyMax ?? job.hourlyMin;
  if (job.jobType === "HOURLY" && top != null) {
    if (top >= rules.minHourly) passes.push(`Rate up to $${top}/hr (≥ $${rules.minHourly})`);
    else flag("low_rate", `Rate caps at $${top}/hr (< $${rules.minHourly})`, top < rules.minHourly * 0.6 ? "red" : "amber", top < rules.minHourly * 0.6 ? 22 : 12);
  } else {
    if (d.avgPaid != null) {
      if (d.avgPaid >= rules.minClientAvgPaid) passes.push(`No rate set, client pays ≈$${d.avgPaid}/hr on average`);
      else flag("client_avg_low", `No rate set and client averages ≈$${d.avgPaid}/hr (< $${rules.minClientAvgPaid})`, "amber", 10);
    } else if (e) flag("rate_unknown", "No rate set; client's past rates unknown", "info", 3);
    if (job.jobType === "FIXED" && job.amount != null) {
      if (job.amount < 500) flag("small_budget", `Small fixed budget $${job.amount}`, "amber", 10);
      else if (job.amount >= 3000) passes.push(`Fixed budget $${job.amount.toLocaleString("en-US")}`);
    }
  }

  // ---------- agency / cheap-labour patterns ----------
  if (d.avgPaid != null && d.avgPaid <= rules.lowRateMax && (e?.record.hours ?? 0) >= 100) {
    flag("cheap_history", `Client mostly hires at low rates (≈$${d.avgPaid}/hr over ${Math.round(e!.record.hours!)}h) - likely an agency`, "red", 20);
  }
  if (d.avgPerContract != null && d.avgPerContract <= rules.smallJobAvg && (e?.record.contractsTotal ?? 0) >= 5) {
    flag("small_jobs", `Mostly small jobs (≈$${d.avgPerContract} per contract)`, "red", 15);
  }

  // ---------- category-specific client quality ----------
  if (isAiLike(category)) {
    if (d.hireRate != null) {
      if (d.hireRate >= rules.ai.minHireRate) passes.push(`Hire rate ${d.hireRate}%`);
      else flag("hire_rate", `Hire rate ${d.hireRate}% (AI work needs ≥ ${rules.ai.minHireRate}%)`, d.hireRate < 60 ? "red" : "amber", d.hireRate < 60 ? 15 : 8);
    } else if (e && !newClient) flag("hire_rate_unknown", "Hire rate unknown", "info", 3);
    if (d.avgPaid != null && d.avgPaid < rules.ai.minAvgPaid && !flags.some((f) => f.code === "cheap_history")) {
      flag("ai_avg_low", `Client averages ≈$${d.avgPaid}/hr (AI work needs ≥ $${rules.ai.minAvgPaid})`, "amber", 8);
    }
    if (d.lastHireDays != null) {
      if (d.lastHireDays <= rules.ai.recentHireDays) passes.push(`Hired ${d.lastHireDays}d ago`);
      else flag("stale_client", `Last hire ${d.lastHireDays} days ago`, "amber", 6);
    }
  } else if (isOpsLike(category) && d.hireRate != null) {
    if (d.hireRate >= rules.devops.minHireRate) passes.push(`Hire rate ${d.hireRate}%`);
    else flag("hire_rate", `Hire rate ${d.hireRate}% (DevOps/MLOps needs ≥ ${rules.devops.minHireRate}%)`, "red", 15);
  } else if (d.hireRate != null) {
    // Every other category: a client who rarely hires is a time sink whatever the work.
    if (d.hireRate < 30) flag("hire_rate", `Hire rate only ${d.hireRate}%`, "red", 15);
    else if (d.hireRate < 50) flag("hire_rate", `Hire rate ${d.hireRate}%`, "amber", 8);
    else passes.push(`Hire rate ${d.hireRate}%`);
  }
  // A client with history but no loaded record: say so instead of showing "no flags".
  if (!e && !rejected && (job.client.totalSpent > 0 || job.client.totalHires > 0)) {
    flag("no_record", "Client record not loaded yet - hire rate and rates unchecked", "info", 5);
  }

  // ---------- ignored open jobs ----------
  const ageH = (now.getTime() - new Date(job.publishedAt).getTime()) / 36e5;
  const openJobs = e?.record.openJobs ?? 0;
  if (e && openJobs >= rules.ignoredOpenJobs && ageH >= 48 && e.activity.invitesSent === 0 && e.activity.interviewed === 0) {
    flag("ignored", `${openJobs} open jobs and no client activity on this one after ${Math.round(ageH / 24)} days`, "red", 15);
  }

  // ---------- competition ----------
  if (!rejected && proposals >= rules.watchWarnAt) flag("crowded", `${job.proposalsTier ?? proposals} proposals already`, "amber", 8);

  // ---------- positives ----------
  const spend = e?.record.totalSpent ?? job.client.totalSpent;
  if (spend >= 50_000) passes.push(`Client spent $${Math.round(spend / 1000)}k`);
  const fb = e?.record.feedbackScore ?? job.client.totalFeedback;
  if (fb >= 4.8 && (e?.record.feedbackCount ?? job.client.totalReviews) >= 5) passes.push(`Client rated ${fb.toFixed(2)}★`);

  // ---------- score ----------
  const fit = { ai: 34, saas: 30, automation: 28, mlops: 34, devops: 24, data: 24, marketing: 8, other: 8 }[category];
  const quality = clamp(Math.log10(spend + 1) / Math.log10(100_001), 0, 1) * 20 + (d.hireRate != null ? clamp(d.hireRate / 100, 0, 1) * 10 : 5) + clamp((fb || 4) / 5, 0, 1) * 5;
  const money = job.jobType === "HOURLY"
    ? (top != null ? clamp(top / rules.minHourly, 0, 1.2) * 12.5 : (d.avgPaid != null ? clamp(d.avgPaid / rules.minClientAvgPaid, 0, 1) * 12 : 6))
    : (job.amount != null ? clamp(Math.log10(job.amount) / Math.log10(10_000), 0, 1) * 15 : 6);
  const competition = clamp(1 - proposals / 25, 0, 1) * 6 + clamp(1 - ageH / 6, 0, 1) * 4;
  const penalty = flags.reduce((a, f) => a + f.penalty, 0);
  const score = rejected ? 0 : Math.round(clamp(fit + quality + money + competition - penalty, 0, 100));

  return { score, rejected, flags, passes, category, derived: d };
}

/** Final rank: rules score blended with the LLM's fit/value judgement. A hard reject is always 0. */
export function blend(rules: RuleResult, llm: LlmRanking | null | undefined, w: RankingRules["weights"]): number {
  if (rules.rejected) return 0;
  if (!llm) return rules.score;
  const llmScore = 0.7 * llm.fit + 0.3 * llm.valuePotential;
  // LLM can lift or sink a job, but red flags keep pulling it down through the rules score.
  return Math.round(clamp(w.rules * rules.score + w.llm * llmScore - rules.flags.filter((f) => f.severity === "red").length * 5, 0, 100));
}
