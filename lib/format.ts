import type { ClientIntent, IntentArchetype, Job, ProposalResearch } from "./types";

/* Display helpers shared by server pages, client components and notifiers. No server imports here. */

/**
 * Keep this exact shape: Upwork's phone apps claim https://www.upwork.com/jobs/* as an app link but exclude
 * /jobs/<id>/<more> and ?openInSafari=true, so extra path segments or that query would open a browser instead
 * of the Upwork app (Telegram tries the app first).
 */
export function jobUrl(ciphertext: string) {
  return `https://www.upwork.com/jobs/${ciphertext.startsWith("~") ? ciphertext : "~" + ciphertext}`;
}

export const money = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;

export function compactMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `$${Math.round(n)}`;
}

export function budgetLabel(j: Pick<Job, "jobType" | "amount" | "hourlyMin" | "hourlyMax">): string {
  if (j.jobType === "HOURLY") {
    if (j.hourlyMin != null && j.hourlyMax != null) return `${money(j.hourlyMin)}–${money(j.hourlyMax)}/hr`;
    if (j.hourlyMin != null || j.hourlyMax != null) return `${money(j.hourlyMin ?? j.hourlyMax)}/hr`;
    return "Hourly";
  }
  return j.amount != null ? `${money(j.amount)} fixed` : "Fixed";
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const experienceLabel = (e: string | null) =>
  e ? e.replace("_LEVEL", "").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Any level";

/* ---------- display helpers for the assistant pages ---------- */

/** "10 to 15" style tier when the feed only exposes a band, else the exact count. */
export const proposalsLabel = (j: Pick<Job, "totalApplicants" | "proposalsTier">) =>
  j.proposalsTier ? `${j.proposalsTier} proposals` : `${j.totalApplicants} proposals`;

export const fmtDateTime = (iso: string | number) =>
  new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const fmtDate = (iso: string | number) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

/** "in 12m" / "in 3h" for future times; falls back to timeAgo for the past. */
export function timeUntil(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  if (s <= 0) return "Due now";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export const PROPOSAL_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "pill-neutral" },
  needs_loom: { label: "To review", cls: "pill-warn" },
  ready: { label: "Ready to approve", cls: "pill-info" },
  approved: { label: "Approved", cls: "pill-info" },
  previewed: { label: "Previewed", cls: "pill-good" },
  submitted: { label: "Submitted", cls: "pill-good" },
  discarded: { label: "Discarded", cls: "pill-neutral" },
};

/**
 * Rough share of the text that changed between two versions (word-level LCS on up to ~1500 words).
 * 0 = identical, 100 = completely rewritten.
 */
export function percentChanged(original: string, current: string): number {
  const a = original.split(/\s+/).filter(Boolean).slice(0, 1500);
  const b = current.split(/\s+/).filter(Boolean).slice(0, 1500);
  if (!a.length && !b.length) return 0;
  if (!a.length || !b.length) return 100;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  const lcs = prev[b.length];
  return Math.round((1 - (2 * lcs) / (a.length + b.length)) * 100);
}

export const pct = (n: number | null | undefined, digits = 0) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}%`);

/* ---------- client intent (advisory hire likelihood) ---------- */

export const INTENT_LABELS: Record<IntentArchetype, string> = {
  ghost_poster: "Posts but never hires",
  unfunded: "No payment attached",
  template_collector: "Collects free plans/quotes",
  mass_poster: "Mass poster, rarely hires",
  identity_fronting: "Front/identity request",
  data_harvest: "Harvests personal data",
  stale: "No client activity",
  repeat_no_hire: "Closed past jobs without hiring",
  genuine: "Looks genuine",
};

/** Pill class for a ghost-risk level: low = good, medium = warn, high = bad. */
export const intentPill = (risk: ClientIntent["ghostRisk"]) => (risk === "high" ? "pill-bad" : risk === "medium" ? "pill-warn" : "pill-good");

export const intentRiskLabel = (risk: ClientIntent["ghostRisk"]) => (risk === "high" ? "High risk" : risk === "medium" ? "Medium risk" : "Low risk");

/** Who the proposal speaks to (ProposalResearch.contactRole). */
export const CONTACT_ROLE_LABELS: Record<NonNullable<ProposalResearch["contactRole"]>, string> = {
  hr_recruiter: "HR / recruiter",
  technical_lead: "Technical lead",
  founder_exec: "Founder / exec",
  marketing_seo: "Marketing / SEO",
  operations: "Operations",
  investor_shareholder: "Investor / shareholder",
  unknown: "Unknown",
};
