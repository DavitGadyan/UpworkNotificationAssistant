import * as z from "zod/v4";
import { getSettings, kvGet, kvSet, listFeedback, listJobs, listProposals, listSnapshots, saveReport, saveSnapshot } from "../db";
import { structured } from "../agents/llm";
import { catalogue, profileDigest, saveUpworkProfile, upworkProfile } from "../agents/profile";
import { getPrompt } from "../agents/prompts";
import { callTool, resolveClientOrg } from "../upwork/mcp/client";
import { parseServiceFees } from "./icp";

/*
 * Profile intelligence:
 *   syncProfile()      - daily: own Upwork profile (title, overview, rate, JSS, skills) → kv
 *   monthlySnapshot()  - proposals funnel (sent / viewed / offers / hired), invites, Connects, earnings,
 *                        plus manual metrics David enters (profile views, search appearances) → time series
 *   benchmarkPeers()   - top-performing freelancers in David's categories vs his profile → ProfileCoach advice
 *   monthlyReview()    - LLM review of the month vs previous months + ranking-threshold suggestions
 */

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const pick = (o: Obj | undefined, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null) return o[k]; return undefined; };

export async function syncProfile() {
  const r = await callTool<Obj>("get_profile", "get");
  const p: Obj = r.profile ?? r.data?.talentProfileByProfileKey ?? r.data?.profile ?? r;
  const skills = (pick(p, "skills", "skillset") as Obj[] | string[] | undefined) ?? [];
  await saveUpworkProfile({
    fetchedAt: new Date().toISOString(),
    title: pick(p, "title", "professionalTitle") ?? null,
    overview: pick(p, "overview", "description", "summary") ?? null,
    hourlyRate: Number(String(pick(p, "hourly_rate", "hourlyRate", "rate") ?? "").replace(/[^0-9.]/g, "")) || null,
    jss: Number(pick(p, "job_success_score", "jobSuccessScore", "jss")) || null,
    totalEarnings: (pick(p, "total_earnings", "totalEarnings") as string | undefined) ?? null,
    badges: [pick(p, "top_rated_label", "badge"), pick(p, "expert_vetted_label")].filter(Boolean) as string[],
    skills: skills.map((s) => (typeof s === "string" ? s : s.name ?? s.prettyName ?? "")).filter(Boolean),
    raw: p,
  });
  return await upworkProfile();
}

const STATUSES = ["Accepted", "Offered", "Hired", "Declined", "Withdrawn", "Archived"] as const;

export interface MonthMetrics {
  period: string; // YYYY-MM
  proposals: { sent: number; viewed: number; offers: number; hired: number; declined: number; withdrawn: number; boosted: number };
  invites: number;
  connects: { balance: number | null; spentInPeriod: number | null };
  earnings: { gross: number; contracts: number };
  alerts: { alerted: number; applied: number; thumbsUp: number; thumbsDown: number };
  drafts: { created: number; submitted: number; avgEditSimilarity: number | null };
  manual: Record<string, number>;
}

/** Proposal rows created inside [from, to) for one status (pages until older than `from`). */
async function proposalsIn(status: string, from: string, to: string): Promise<Obj[]> {
  const out: Obj[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 6; page++) {
    const r = await callTool<Obj>("list_freelancer_proposals", "list", { status, limit: 10, sort_field: "CREATEDDATETIME", sort_order: "DESC", ...(cursor ? { cursor } : {}) });
    const rows: Obj[] = r.proposals ?? r.data?.proposals ?? r.items ?? [];
    let older = false;
    for (const p of rows) {
      const created = String(pick(p, "createdDateTime", "created", "created_date") ?? "");
      if (created && created < from) { older = true; continue; }
      if (!created || created < to) out.push(p);
    }
    cursor = r.pageInfo?.endCursor ?? r.next_cursor;
    if (older || !cursor || !(r.pageInfo?.hasNextPage ?? r.hasMore)) break;
  }
  return out;
}

export async function monthlySnapshot(period?: string): Promise<MonthMetrics> {
  const now = new Date();
  const p = period ?? new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const from = `${p}-01`;
  const [y, m] = p.split("-").map(Number);
  const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const byStatus: Record<string, Obj[]> = {};
  for (const st of STATUSES) byStatus[st] = await proposalsIn(st, from, to).catch(() => []);
  const all = Object.values(byStatus).flat();
  const inv = await callTool<Obj>("list_freelancer_proposals", "invitations", { status: "pending", limit: 10 }).catch(() => ({}) as Obj);
  const invTerm = await callTool<Obj>("list_freelancer_proposals", "invitations", { status: "terminated", limit: 10 }).catch(() => ({}) as Obj);
  const invites = [...(inv.invitations ?? []), ...(invTerm.invitations ?? [])].filter((i: Obj) => {
    const c = String(pick(i, "createdDateTime", "created") ?? "");
    return c >= from && c < to;
  }).length;
  const cb = await callTool<Obj>("get_profile", "connects_balance", { limit: 10 }).catch(() => ({}) as Obj);
  const tx = await callTool<Obj>("get_profile", "transactions", { from_date: from, to_date: to, limit: 200 }).catch(() => ({}) as Obj);
  const fees = [...parseServiceFees(tx.data?.transactionHistory?.transactionDetail?.transactionHistoryRow ?? []).values()];

  const fb = (await listFeedback("alert", 1000)).filter((f) => f.createdAt.slice(0, 7) === p);
  const props = (await listProposals()).filter((x) => x.createdAt.slice(0, 7) === p);
  const draftFb = (await listFeedback("draft", 1000)).filter((f) => f.createdAt.slice(0, 7) === p);
  const sims = draftFb.map((f) => Number(f.data?.similarity)).filter((x) => Number.isFinite(x));
  const metrics: MonthMetrics = {
    period: p,
    proposals: {
      sent: all.length,
      viewed: all.filter((x) => x.viewedByClient || x.viewed_by_client).length,
      offers: byStatus.Offered.length,
      hired: byStatus.Hired.length,
      declined: byStatus.Declined.length,
      withdrawn: byStatus.Withdrawn.length,
      boosted: all.filter((x) => x.boosted).length,
    },
    invites,
    connects: { balance: Number(pick(cb, "balance", "total") ?? pick(cb.balance ?? {}, "total")) || null, spentInPeriod: null },
    earnings: { gross: Math.round(fees.reduce((a, c) => a + c.gross, 0)), contracts: fees.length },
    alerts: {
      alerted: (await listJobs({ status: "all" })).filter((j) => j.fetchedAt.slice(0, 7) === p && j.status !== "new").length,
      applied: props.filter((x) => x.status === "submitted").length,
      thumbsUp: fb.filter((f) => f.rating > 0).length,
      thumbsDown: fb.filter((f) => f.rating < 0).length,
    },
    drafts: { created: props.length, submitted: props.filter((x) => x.status === "submitted").length, avgEditSimilarity: sims.length ? Math.round((sims.reduce((a, b) => a + b, 0) / sims.length) * 100) / 100 : null },
    manual: (await kvGet<Record<string, Record<string, number>>>("manual_metrics"))?.[p] ?? {},
  };
  await saveSnapshot(p, metrics);
  return metrics;
}

/** Metrics Upwork's connector does not expose (profile views, search appearances…) entered by hand. */
export async function saveManualMetrics(period: string, values: Record<string, number>) {
  const all = await kvGet<Record<string, Record<string, number>>>("manual_metrics") ?? {};
  all[period] = { ...(all[period] ?? {}), ...values };
  await kvSet("manual_metrics", all);
}

// ---------- peers & ProfileCoach ----------
const CoachSchema = z.object({
  headline: z.string(),
  peerPatterns: z.array(z.object({ pattern: z.string(), evidence: z.string() })),
  recommendations: z.array(z.object({
    area: z.enum(["title", "overview", "rate", "skills", "portfolio", "specialized_profile", "project_catalog", "availability", "other"]),
    change: z.string(),
    newText: z.string().nullable(),
    why: z.string(),
    impact: z.enum(["high", "medium", "low"]),
  })),
  experiments: z.array(z.string()),
});
export type CoachReport = z.infer<typeof CoachSchema> & { peers: Obj[]; builtAt: string; note: string };

export async function benchmarkPeers(queries?: string[]): Promise<CoachReport> {
  const own = await upworkProfile() ?? (await syncProfile().catch(() => null));
  const qs = queries ?? ["AI engineer", "Machine learning engineer", "Data scientist", "LLM developer"];
  // find_freelancers is a client-side tool: run it under David's client account (e.g. "Future Technologies").
  const clientOrg = await resolveClientOrg();
  if (!clientOrg) throw new Error("Peer benchmark needs an Upwork client account (find_freelancers is client-only)");
  const peers: Obj[] = [];
  const seen = new Set<string>();
  for (const q of qs.slice(0, 4)) {
    // Upwork's expert_vetted filter needs a Business Plus client plan; from a freelancer account it is
    // ignored, so "top performers" = Top Rated Plus, JSS ≥ 90 and $100k+ earned.
    const r = await callTool<Obj>("find_freelancers", "search", { query: q, top_rated_plus: true, job_success_min: 90, earnings_min: 100000, limit: 8 }, { orgUid: clientOrg }).catch(() => ({}) as Obj);
    for (const f of (r.freelancers ?? r.results ?? []) as Obj[]) {
      const key = String(f.profile_key ?? f.personId ?? f.name);
      if (seen.has(key)) continue;
      seen.add(key);
      peers.push({ query: q, name: f.name, title: f.title, country: f.country, rate: f.hourly_rate ?? f.rate, earnings: f.total_earnings, jss: f.job_success_score, badge: f.top_rated ?? f.badge, expertVetted: f.expert_vetted_label ?? f.expert_vetted, profileKey: f.profile_key, boosted: f.boosted });
    }
  }
  // Full profiles of the top 6 (overview, skills, portfolio) for real comparison.
  const detailed: Obj[] = [];
  for (const p of peers.filter((x) => !x.boosted).slice(0, 6)) {
    if (!p.profileKey) continue;
    const d = await callTool<Obj>("find_freelancers", "get_profile", { profile_key: p.profileKey }, { orgUid: clientOrg }).catch(() => null);
    if (d) {
      const pr: Obj = d.profile ?? d;
      detailed.push({ ...p, overview: String(pr.overview ?? pr.description ?? "").slice(0, 1500), skills: (pr.skills ?? []).slice?.(0, 20), portfolio: (pr.portfolio ?? pr.portfolio_projects ?? []).slice?.(0, 5)?.map((x: Obj) => x.title), jobs: pr.total_jobs ?? pr.totalJobs });
    }
  }
  const snaps = (await listSnapshots(6)).map((s) => s.data);
  const user = [
    `David's Upwork profile: ${JSON.stringify({ title: own?.title, rate: own?.hourlyRate, jss: own?.jss, skills: own?.skills?.slice(0, 25), overview: own?.overview?.slice(0, 2000) })}`,
    `Portfolio projects on his site: ${catalogue().projects.length}`,
    `Top performers (detailed): ${JSON.stringify(detailed)}`,
    `Other top performers: ${JSON.stringify(peers.slice(0, 20).map(({ profileKey: _k, ...x }) => x))}`,
    snaps.length ? `David's recent monthly metrics: ${JSON.stringify(snaps)}` : "No monthly metrics yet.",
  ].join("\n\n");
  const system = `${(await getPrompt("profile_coach")).body}\n\n## David\n${await profileDigest({ projects: true })}`;
  const { data } = await structured({ model: (await getSettings()).llm.writerModel, system, user, schema: CoachSchema, effort: "high", agent: "coach", maxTokens: 12000 });
  const report: CoachReport = { ...data, peers, builtAt: new Date().toISOString(), note: "Peers = Top Rated Plus, JSS ≥ 90%, $100k+ earned (Upwork's Expert-Vetted filter is only available to Business Plus clients). Boosted results excluded from detail." };
  await saveReport("coach", report);
  return report;
}

// ---------- monthly review ----------
const ReviewSchema = z.object({
  headline: z.string(),
  whatChanged: z.array(z.string()),
  whatWorked: z.array(z.string()),
  whatDidnt: z.array(z.string()),
  actions: z.array(z.string()),
  rankingTweaks: z.array(z.object({ setting: z.string(), from: z.string(), to: z.string(), why: z.string() })),
});
export type MonthlyReview = z.infer<typeof ReviewSchema> & { period: string; builtAt: string };

export async function monthlyReview(): Promise<MonthlyReview> {
  const snaps = await listSnapshots(6);
  if (!snaps.length) throw new Error("No monthly snapshot yet - run one first");
  const s = await getSettings();
  const user = [
    `Monthly metrics, newest first: ${JSON.stringify(snaps.map((x) => x.data))}`,
    `Current ranking rules: ${JSON.stringify(s.rules)}; alert threshold ${s.telegramMin}`,
    `Alert feedback (last 200): ${JSON.stringify((await listFeedback("alert", 200)).map((f) => ({ r: f.rating, ...f.data })))}`,
  ].join("\n\n");
  const { data } = await structured({ model: s.llm.writerModel, system: (await getPrompt("monthly_review")).body, user, schema: ReviewSchema, effort: "high", agent: "review", maxTokens: 8000 });
  const review: MonthlyReview = { ...data, period: snaps[0].period, builtAt: new Date().toISOString() };
  await saveReport("monthly_review", review);
  return review;
}
