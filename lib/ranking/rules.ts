import type { Job, JobCategory, JobEnrichment, LlmRanking, RankingRules, RuleFlag, RuleResult } from "../types";
import { proposalsLow } from "../upwork/tiers";
import { malwareLure } from "./scam";

/**
 * The client's hire count, or null when we don't actually know it (David, 2026-10-19). Upwork's keyword/saved-search
 * rows carry total_posted_jobs and total_spent but NOT total_hires, which then arrives as 0 - and a client with
 * $4.1M spent and 331 hires was labelled "mass poster, 0% hired". Money spent means hires happened, so a 0 next to
 * spend > 0 without the client record is "unknown", never "never hires".
 */
export function knownHires(job: Pick<Job, "client">, e: JobEnrichment | null | undefined): number | null {
  if (e?.record.hires != null) return e.record.hires;
  const h = job.client.totalHires ?? 0;
  if (h > 0) return h;
  return (job.client.totalSpent ?? 0) > 0 ? null : 0;
}

/** Hire rate in percent (capped at 100: clients often hire several people per post), or null when unknown. */
export function knownHireRate(job: Pick<Job, "client">, e: JobEnrichment | null | undefined): number | null {
  if (e?.record.hireRatePercent != null) return Math.min(100, e.record.hireRatePercent);
  const hires = knownHires(job, e), posted = e?.record.jobsPosted ?? job.client.totalPostedJobs ?? 0;
  return hires == null || posted <= 0 ? null : Math.min(100, Math.round((hires / posted) * 100));
}

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
/* Title and Upwork skill tags. Stems end in \w* so "fine-tuning", "data scientist", "copywriting" match. */
const CAT: [JobCategory, RegExp][] = [
  ["mlops", /\b(mlops|ml ops|aiops|ai ops|llmops|llm ops|(ai|ml|llm|model) (deployment|serving|monitoring|inference|infrastructure|infra)|inference (server|endpoint|optimi[sz]\w*)|sagemaker|vertex ai|bedrock|kubeflow|mlflow|feature store|vllm|triton)\b/i],
  ["ai", /\b(ai|llms?|gpt|chatgpt|openai|claude|anthropic|gemini|genai|gen ai|generative ai|rag|retrieval.augmented|langchain|langgraph|llamaindex|agentic|ai agents?|agent (development|framework|workflows?)|chatbots?|voice (ai|agents?)|machine learning|deep learning|nlp|computer vision|fine.?tun\w*|embeddings?|vector (db|database|store|search)|mcp)\b/i],
  ["devops", /\b(devops|kubernetes|k8s|terraform|ci\/cd|docker|aws infrastructure|gcp|azure|sre|helm|ansible)\b/i],
  ["saas", /\b(saas|mvp|web app|platform|full.?stack|dashboard|next\.?js|react|node\.?js|backend|api development)\b/i],
  ["automation", /\b(automation|automate|n8n|zapier|make\.com|workflow|rpa|integration)\b/i],
  ["data", /\b(data scien\w*|data engineer\w*|analytics|etl|sql|tableau|power bi|forecast\w*|statistic\w*)\b/i],
  ["marketing", /\b(seo|geo|aeo|marketing|social media|ads|ppc|content writ\w*|copywrit\w*|branding|pr)\b/i],
];
/*
 * Descriptions use "AI", "agent", "rag", "vector", "platform" in every sense ("enemy AI", "rag doll physics",
 * "agent of record", "vector illustration"), so only unambiguous phrases count there.
 */
const CAT_DESC: [JobCategory, RegExp][] = [
  ["mlops", CAT[0][1]],
  ["ai", /\b(artificial intelligence|machine learning|deep learning|llms?|large language models?|gpt-?\d*|chatgpt|openai|anthropic|langchain|langgraph|llamaindex|ai agents?|agentic|chatbots?|voice (ai|agents?)|nlp|computer vision|fine.?tun\w*|embeddings|vector (db|database|store|search)|retrieval.augmented|rag (pipeline|system|chatbot|app)|mcp server|generative ai|gen ?ai)\b/i],
  ["devops", CAT[2][1]],
  ["saas", /\b(saas|mvp|web app|full.?stack|next\.?js|react|node\.?js|api development)\b/i],
  ["automation", /\b(automation|automate|n8n|zapier|make\.com|rpa)\b/i],
  ["data", CAT[5][1]],
  ["marketing", /\b(seo|aeo|marketing|social media|google ads|meta ads|facebook ads|ppc|content writ\w*|copywrit\w*|branding)\b/i],
];

export function detectCategory(job: Pick<Job, "title" | "description" | "skills">): JobCategory {
  // Title decides first: "AI Voice Agent Developer" is AI even if the description mentions SEO. Then the
  // Upwork skill tags, then the description with the stricter patterns.
  for (const [cat, re] of CAT) if (has(job.title, re)) return cat;
  const tags = job.skills.join(" · ");
  for (const [cat, re] of CAT) if (has(tags, re)) return cat;
  const desc = job.description.slice(0, 1500);
  for (const [cat, re] of CAT_DESC) if (has(desc, re)) return cat;
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
    hireRate: knownHireRate(job, e),
  };
}

/*
 * Location requirements on the freelancer ("MUST BE UK BASED", "US-based candidates only", on-site / in-office work).
 * David works remotely for clients worldwide and won't apply to these (2026-10-15): a red flag, a heavy penalty and
 * no alert. Only requirement wording counts - "we are a UK company based in London" or "overlap with EST" do not.
 */
const PLACE = "(?:the\\s+)?(?:[A-Z]{2,3}|U\\.S\\.A?|U\\.K\\.|[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})";
const LOCATION_RULES: RegExp[] = [
  new RegExp(`\\bmust\\s+be\\s+(?:in\\s+)?${PLACE}[- ]based\\b`, "i"),
  /\b(?:must|should|need to|required to|have to)\s+(?:be\s+)?(?:currently\s+)?(?:be\s+)?(?:based|located|living|residing|reside|live|physically)\s+(?:in|within)\s+[^.,;\n]{2,40}/i,
  new RegExp(`\\b${PLACE}[- ](?:based|located)\\s+(?:only|candidates?|freelancers?|applicants?|talent|developers?|engineers?|professionals?|individuals?)\\b`),
  /\b(?:US|U\.S\.|USA|UK|EU|EEA)[- ](?:only|residents? only|citizens? only)\b/i,
  /\b(?:US|U\.S\.|USA|UK|EU|American|British|Canadian|Australian)\s+(?:citizens?|residents?|citizenship)\s+(?:only|required|is required)\b/i,
  /\b(?:only|exclusively)\s+(?:open to|accepting|considering|hiring)\s+(?:candidates|freelancers|applicants|people|talent)?\s*(?:from|in|based in|located in)\s+[^.,;\n]{2,40}/i,
  /\b(?:on-?site|in[- ]person|in[- ]office)\b[^.\n]{0,60}\b(?:required|mandatory|only|days?\s+(?:a|per)\s+week|client site)\b/i,
  /\bhybrid\b[^.\n]{0,40}\b(?:on-?site|in the office|office days?|days?\s+(?:a|per)\s+week)\b/i,
  /\bremote[- ]only(?: delivery)? is not acceptable\b/i,
];
/** The requirement wording if the post restricts where the freelancer must be, else null. */
export function locationRequirement(text: string): string | null {
  for (const re of LOCATION_RULES) {
    const m = text.match(re);
    if (m) return m[0].trim().replace(/\s+/g, " ").slice(0, 80);
  }
  return null;
}

/** A new client is an account created at most 2 days ago. Zero hires alone is not "new" - it may be a dormant account. */
export const NEW_CLIENT_DAYS = 2;
export function isNewClient(e: JobEnrichment | null | undefined, now = new Date()): boolean {
  const since = e?.clientSince ? new Date(e.clientSince).getTime() : NaN;
  return Number.isFinite(since) && now.getTime() - since <= NEW_CLIENT_DAYS * DAY;
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
  const newClient = isNewClient(e, now);
  const noHires = knownHires(job, e) === 0;
  if (job.client.paymentVerified === false) {
    const fit = ctx.llm?.fit ?? 0;
    if (newClient && fit >= rules.unverifiedExceptionFit && ctx.similarProject !== false) {
      flag("unverified_new", `Payment not verified - account created ≤ ${NEW_CLIENT_DAYS} days ago, allowed because the fit is very tight`, "amber", 6);
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
    } else if (e && !noHires) flag("hire_rate_unknown", "Hire rate unknown", "info", 3);
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
  const where = locationRequirement(`${job.title}\n${e?.description || job.description}`);
  if (where) flag("location_restricted", `Location requirement: "${where}" - remote worldwide work only`, "red", 35);
  const lure = malwareLure(job, e);
  if (lure) flag(lure.code, lure.label, lure.severity, lure.severity === "red" ? 40 : 8);

  // A client with history but no loaded record: say so instead of showing "no flags".
  if (!e && !rejected && (job.client.totalSpent > 0 || job.client.totalHires > 0)) {
    flag("no_record", "Client record not loaded - hire rate and rates unchecked", "amber", 5);
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
