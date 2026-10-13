import type { ClientIntent, IntentArchetype, Job, ProposalResearch } from "../types";

/* Display helpers - same rules as the web app's lib/format.ts. */

export function jobUrl(ciphertext: string) {
  return `https://www.upwork.com/jobs/${ciphertext.startsWith("~") ? ciphertext : "~" + ciphertext}`;
}

export const money = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;

export const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(n < 10 ? 2 : 0)}`);

export function compactMoney(n: number | null | undefined): string {
  if (n == null) return "—";
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

export function timeAgo(t: string | number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(t).getTime()) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function timeUntil(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  if (s <= 0) return "Due now";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export const proposalsLabel = (j: Pick<Job, "totalApplicants" | "proposalsTier">) =>
  j.proposalsTier ? `${j.proposalsTier} proposals` : `${j.totalApplicants} proposals`;

export const fmtDateTime = (t: string | number) =>
  new Date(t).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const fmtDate = (t: string | number) =>
  new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);

/** A loom.com link or a branded short link (Rebrandly…); the worker follows redirects and checks it lands on Loom. */
export const LOOM_RE = /^https:\/\/[^\s/]+\.[^\s/]+\/\S+$/;
export const LOOM_PLACEHOLDER = "{{LOOM_URL}}";
export const COVER_MAX = 5000;

/* ---------- client intent (advisory hire likelihood) - same labels as web lib/format.ts ---------- */

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

export const intentLabel = (a: string) => INTENT_LABELS[a as IntentArchetype] ?? (a === "unknown" ? "Not assessed" : a);

export const intentTone = (risk: ClientIntent["ghostRisk"]) => (risk === "high" ? "bad" : risk === "medium" ? "warn" : "good") as "bad" | "warn" | "good";

export const intentRiskLabel = (risk: ClientIntent["ghostRisk"]) => (risk === "high" ? "High risk" : risk === "medium" ? "Medium risk" : "Low risk");

export const CONTACT_ROLE_LABELS: Record<NonNullable<ProposalResearch["contactRole"]>, string> = {
  hr_recruiter: "HR / recruiter",
  technical_lead: "Technical lead",
  founder_exec: "Founder / exec",
  marketing_seo: "Marketing / SEO",
  operations: "Operations",
  investor_shareholder: "Investor / shareholder",
  unknown: "Unknown",
};
