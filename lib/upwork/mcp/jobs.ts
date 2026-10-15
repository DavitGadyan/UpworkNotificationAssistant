import type { Job, JobEnrichment, SavedSearch } from "../../types";
import { callTool } from "./client";

/*
 * find_jobs over MCP. Feeds map to the three Upwork views David watches:
 *   most_recent  → smart_search mode=most_recent   (nx/find-work/most-recent)
 *   best_match   → smart_search mode=best_match    (nx/find-work/)
 *   search       → search with filters             (nx/search/jobs?… imported via urlImport.ts)
 * Field names below follow the payloads the connector returns (verified 2026-10-13).
 */

type Row = Record<string, unknown> & {
  id: string; title: string; url?: string; budget?: string; job_type?: string; skills?: string[];
  description_snippet?: string; description?: string; published_date?: string; created_date?: string;
  experience_level?: string; duration?: string; engagement?: string; proposal_count?: number;
  proposals_tier?: string; applied?: boolean; featured?: boolean; premium?: boolean;
  category?: string; subcategory?: string;
  client?: {
    country?: string; verification_status?: string; total_posted_jobs?: number; rating?: number;
    total_reviews?: number; total_spent?: string; total_hires?: number;
  };
};

export const parseMoney = (s: unknown): number | null => {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && s.match(/\d/) ? n : null;
};

/** "10.00–15.00/hr", "$70.00–$110.00/hr", "4,000.00", "$1,500.00" */
export function parseBudget(budget: string | undefined, jobType: string | undefined) {
  const hourly = /hourly/i.test(jobType ?? "") || /\/hr/.test(budget ?? "");
  if (!budget) return { hourly, amount: null, min: null, max: null };
  if (hourly) {
    const parts = budget.replace(/\/hr/, "").split(/[–-]/).map(parseMoney);
    const min = parts[0] ?? null, max = parts.length > 1 ? parts[1] ?? null : null;
    return { hourly, amount: null, min, max: max ?? (budget.includes("+") ? null : min) };
  }
  return { hourly, amount: parseMoney(budget), min: null, max: null };
}

import { proposalsLow, tierHigh, tierLow } from "../tiers";
export { proposalsLow, tierHigh, tierLow };

export const ciphertextFromUrl = (url?: string, id?: string) => url?.match(/~0[0-9a-z]+/i)?.[0] ?? (id ? `~02${id}` : "");

export function mapRow(r: Row): Job {
  const b = parseBudget(r.budget, r.job_type);
  const c = r.client ?? {};
  const exact = typeof r.proposal_count === "number" ? r.proposal_count : null;
  return {
    id: String(r.id),
    ciphertext: ciphertextFromUrl(r.url, String(r.id)),
    title: r.title,
    description: r.description ?? r.description_snippet ?? "",
    skills: r.skills ?? [],
    jobType: b.hourly ? "HOURLY" : "FIXED",
    amount: b.amount, hourlyMin: b.min, hourlyMax: b.max,
    experienceLevel: r.experience_level ? r.experience_level.toUpperCase().replace(/^ENTRY$/, "ENTRY_LEVEL").replace(/\s+/g, "_") : null,
    totalApplicants: exact ?? tierHigh(r.proposals_tier),
    proposalsTier: exact == null ? r.proposals_tier ?? null : null,
    publishedAt: r.published_date ?? r.created_date ?? new Date().toISOString(),
    category: r.category ?? null,
    subcategory: r.subcategory ?? null,
    duration: r.duration ?? null,
    workload: r.engagement ?? null,
    applied: !!r.applied,
    featured: !!(r.featured || r.premium),
    client: {
      paymentVerified: c.verification_status ? c.verification_status === "VERIFIED" : null,
      identityVerified: c.verification_status === "VERIFIED",
      totalSpent: parseMoney(c.total_spent) ?? 0,
      totalHires: c.total_hires ?? 0,
      totalPostedJobs: c.total_posted_jobs ?? 0,
      totalReviews: c.total_reviews ?? 0,
      totalFeedback: c.rating ?? 0,
      country: c.country ? normalizeCountry(c.country) : null,
      hasFinancialPrivacy: false,
    },
  };
}

const ISO3: Record<string, string> = { USA: "United States", GBR: "United Kingdom", IND: "India", PAK: "Pakistan", TUR: "Turkey", AZE: "Azerbaijan", ARE: "United Arab Emirates", DEU: "Germany", CAN: "Canada", AUS: "Australia", FRA: "France", NLD: "Netherlands", CHE: "Switzerland", SAU: "Saudi Arabia", ISR: "Israel", SGP: "Singapore", JPN: "Japan", CHN: "China", IRL: "Ireland", SWE: "Sweden", NOR: "Norway", DNK: "Denmark", ESP: "Spain", ITA: "Italy", BEL: "Belgium", AUT: "Austria", POL: "Poland", BRA: "Brazil", MEX: "Mexico", PHL: "Philippines", NGA: "Nigeria", EGY: "Egypt", BHR: "Bahrain", QAT: "Qatar", KWT: "Kuwait", NZL: "New Zealand", ZAF: "South Africa", UKR: "Ukraine", RUS: "Russia", VNM: "Vietnam", PRT: "Portugal", FIN: "Finland", HKG: "Hong Kong", KOR: "South Korea" };
export const normalizeCountry = (c: string) => ISO3[c.toUpperCase()] ?? (c === "Türkiye" ? "Turkey" : c);

interface SearchResp { jobs: Row[]; pageInfo?: { endCursor?: string; hasNextPage?: boolean }; next_cursor?: string; filters_ignored?: unknown; filters_rejected?: unknown }

/** One feed → jobs. A search with jobType ANY plus both a rate and a budget floor runs as two calls (hourly + fixed). */
export async function fetchFeedMcp(feed: SavedSearch, opts: { isKnown: (id: string) => boolean | Promise<boolean>; maxPages: number } = { isKnown: () => true, maxPages: 1 }): Promise<Job[]> {
  if (feed.kind === "most_recent" || feed.kind === "best_match") {
    const params: Record<string, unknown> = { mode: feed.kind, limit: 10 };
    if (feed.kind === "most_recent") params.days_posted = 1;
    if (feed.verifiedPaymentOnly) params.verified_payment_only = true;
    if (feed.maxProposals != null) params.proposals_max = feed.maxProposals;
    const r = await callTool<SearchResp>("find_jobs", "smart_search", params);
    return (r.jobs ?? []).map(mapRow);
  }
  const base: Record<string, unknown> = { sort: "recency", limit: 10 };
  if (feed.query.trim()) base.query = feed.query.trim();
  if (feed.skills.length) base.skills = feed.skills.slice(0, 5);
  if (feed.experienceLevel !== "ANY") base.experience_level = feed.experienceLevel.toLowerCase();
  if (feed.verifiedPaymentOnly) base.verified_payment_only = true;
  if (feed.maxProposals != null) base.proposals_max = feed.maxProposals;

  const variants: Record<string, unknown>[] = [];
  const hourly = { ...base, job_type: "hourly", ...(feed.minHourly != null ? { rate_min: feed.minHourly } : {}) };
  const fixed = { ...base, job_type: "fixed", ...(feed.minBudget != null ? { budget_min: feed.minBudget } : {}) };
  if (feed.jobType === "HOURLY") variants.push(hourly);
  else if (feed.jobType === "FIXED") variants.push(fixed);
  else if (feed.minHourly != null || feed.minBudget != null) variants.push(hourly, fixed);
  else variants.push(base);

  // Page back (newest first) until we reach a job already stored, so a burst of postings between two
  // polls is never cut off at the first 10. At most `maxPages` calls per variant.
  const out = new Map<string, Job>();
  for (const params of variants) {
    let cursor: string | undefined;
    for (let page = 0; page < opts.maxPages; page++) {
      const r = await callTool<SearchResp>("find_jobs", "search", { ...params, ...(cursor ? { cursor } : {}) });
      const rows = (r.jobs ?? []).map(mapRow);
      rows.forEach((j) => out.set(j.id, j));
      cursor = r.pageInfo?.hasNextPage ? r.pageInfo.endCursor : undefined;
      if (!cursor || !rows.length) break;
      const known = await Promise.all(rows.map((j) => opts.isKnown(j.id)));
      if (known.some(Boolean)) break;
    }
  }
  return [...out.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// ---------- get: full details + client intelligence ----------
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (v: unknown): number | null => (v == null ? null : parseMoney(v as string));
/** The connector returns some lists bare and some wrapped ({jobs:[…]}, {items:[…]}, {reviews:[…]}). */
const arr = (v: unknown, ...keys: string[]): Obj[] => {
  if (Array.isArray(v)) return v as Obj[];
  if (v && typeof v === "object") for (const k of [...keys, "jobs", "items", "results", "data"]) if (Array.isArray((v as Obj)[k])) return (v as Obj)[k];
  return [];
};

export function mapDetail(r: Obj): { enrichment: JobEnrichment; patch: Partial<Job> } {
  const p: Obj = r.data?.marketplaceJobPosting ?? {};
  const rec: Obj = r.client_record ?? {};
  const act: Obj = p.activityStat?.jobActivity ?? {};
  const bids: Obj | undefined = p.activityStat?.applicationsBidStats;
  const wh: Obj = r.client_work_history ?? {};
  const terms: Obj = p.contractTerms ?? {};
  const hourlyTerms: Obj = terms.hourlyContractTerms ?? {};
  const enrichment: JobEnrichment = {
    fetchedAt: new Date().toISOString(),
    description: p.content?.description ?? "",
    connectsCost: n(r.connects_cost),
    connectsBalance: n(r.connects_balance),
    canApply: r.can_apply ?? null,
    applied: !!r.applied,
    status: p.workFlowState?.status ?? null,
    subcategory: p.classification?.subCategory?.preferredLabel ?? null,
    clientState: p.clientCompanyPublic?.state ?? null,
    clientTimezone: p.clientCompanyPublic?.timezone ?? null,
    clientId: p.clientCompanyPublic?.id != null ? String(p.clientCompanyPublic.id) : null,
    record: {
      hires: n(rec.jobs_with_hires),
      contractsTotal: n(rec.contracts_total),
      contractsActive: n(rec.contracts_active),
      totalSpent: n(rec.spend_total),
      feedbackScore: n(rec.feedback_score),
      feedbackCount: n(rec.feedback_count),
      hours: n(rec.hours_total),
      jobsPosted: n(rec.jobs_posted),
      hireRatePercent: n(rec.hire_rate_percent),
      openJobs: n(rec.open_jobs),
    },
    activity: {
      invitesSent: act.invitesSent ?? 0,
      interviewed: act.totalInvitedToInterview ?? 0,
      hired: act.totalHired ?? 0,
      offered: act.totalOffered ?? 0,
      unansweredInvites: act.totalUnansweredInvites ?? 0,
    },
    bidStats: bids ? { avg: n(bids.avgRateBid?.rawValue), min: n(bids.minRateBid?.rawValue), max: n(bids.maxRateBid?.rawValue) } : null,
    workHistory: [
      ...arr(wh.open).map((x): Obj => ({ ...x, open: true })),
      ...arr(wh.closed).map((x): Obj => ({ ...x, open: false })),
    ].map((x: Obj) => ({
      title: x.title ?? "", type: x.type ?? null, status: x.status ?? null, started: x.started ?? null,
      ended: x.ended ?? null, feedback: x.feedback_score ?? null, open: x.open,
    })),
    reviews: arr(r.client_feedback, "reviews").map((x) => ({
      comment: x.comment ?? "", score: x.score ?? null, ended: x.ended ?? null, title: x.title ?? null,
    })),
    otherOpenJobs: arr(r.client_open_jobs).map((x) => ({ id: String(x.id), title: x.title ?? "", url: x.url ?? null })),
    screeningQuestions: arr(r.screening_questions, "questions").map((q) => (typeof q === "string" ? q : String((q as Obj).question ?? (q as Obj).text ?? ""))).filter(Boolean),
    preferredQualifications: r.preferred_qualifications ?? null,
  };
  const patch: Partial<Job> = {};
  if (enrichment.description) patch.description = enrichment.description;
  if (p.classification?.category?.preferredLabel) patch.category = p.classification.category.preferredLabel;
  if (p.clientCompanyPublic?.country?.name) patch.client = { country: normalizeCountry(p.clientCompanyPublic.country.name) } as Job["client"];
  if (terms.contractType === "HOURLY") {
    const mn = n(hourlyTerms.hourlyBudgetMin?.rawValue ?? hourlyTerms.hourlyBudgetMin), mx = n(hourlyTerms.hourlyBudgetMax?.rawValue ?? hourlyTerms.hourlyBudgetMax);
    if (mn != null) patch.hourlyMin = mn;
    if (mx != null) patch.hourlyMax = mx;
  }
  return { enrichment, patch };
}

export async function getJobDetailMcp(id: string) {
  const r = await callTool<Obj>("find_jobs", "get", { id });
  return mapDetail(r);
}

/** Apply a detail patch onto a feed job (client fields merge, not replace). */
export function mergeDetail(job: Job, patch: Partial<Job>, e: JobEnrichment): Job {
  const { client, ...rest } = patch;
  return {
    ...job,
    ...rest,
    applied: job.applied || e.applied,
    client: {
      ...job.client,
      ...(client ?? {}),
      totalSpent: e.record.totalSpent ?? job.client.totalSpent,
      totalHires: e.record.hires ?? job.client.totalHires,
      totalPostedJobs: e.record.jobsPosted ?? job.client.totalPostedJobs,
      totalReviews: e.record.feedbackCount ?? job.client.totalReviews,
      totalFeedback: e.record.feedbackScore ?? job.client.totalFeedback,
    },
  };
}
