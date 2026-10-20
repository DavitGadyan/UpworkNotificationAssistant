import { alertCounts, kvGet, kvSet, listProposalOutcomesSafe, listReports, saveReport } from "../db";
import type { ProposalOutcome } from "../types";
import { segmentOf } from "./segments";

/*
 * 24-hour proposal KPIs (David, 2026-10-20): how many proposals went out, how many clients viewed them, replied,
 * offered or hired - for the last 24 h and the 24 h before that. The earlier window is re-read every sync, so a
 * view that lands the next day still updates it. "Views in the last 24 h" counts views that HAPPENED in the window
 * (first time a sync saw the proposal as viewed), whenever the proposal was sent.
 * A snapshot is stored every night at 00:00 (reports kind "daily_kpis", in Supabase) so the history stays.
 */

const DAY = 864e5;
export const VIEWED_AT_KEY = "proposal_viewed_at";
export const KPI_KIND = "daily_kpis";

export interface KpiWindow { from: string; to: string; sent: number; viewed: number; replied: number; offers: number; hired: number; ghosts: number; viewRate: number | null; replyRate: number | null }
export interface ProposalKpis {
  at: string;
  last24: KpiWindow;
  prev24: KpiWindow;
  last7d: KpiWindow;
  /** Views that happened in the last 24 h (any proposal); null before view times were recorded. */
  viewsLast24: number | null;
  /** Job alerts sent to Telegram in the last 24 h (app pipeline + chat watch loop). Older snapshots may lack it. */
  alerts?: { app: number; watch: number; total: number };
  /** Proposals viewed in the last 24 h, newest first. */
  recentViews: { id: string; jobId: string; title: string; at: number }[];
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const isOfferOrHire = (o: ProposalOutcome) => o.status === "Offered" || o.status === "Hired";

export function kpiWindow(rows: ProposalOutcome[], from: number, to: number): KpiWindow {
  const xs = rows.filter((o) => o.outcome !== "void" && Date.parse(o.submittedAt) >= from && Date.parse(o.submittedAt) < to);
  const viewed = xs.filter((o) => o.viewed || o.outcome === "win").length;
  const replied = xs.filter((o) => o.outcome === "win").length;
  return {
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), sent: xs.length, viewed, replied,
    offers: xs.filter(isOfferOrHire).length, hired: xs.filter((o) => o.status === "Hired").length,
    ghosts: xs.filter((o) => segmentOf(o) === "ghost").length,
    viewRate: pct(viewed, xs.length), replyRate: pct(replied, xs.length),
  };
}

export function computeKpis(rows: ProposalOutcome[], viewedAt: Record<string, number>, now = Date.now()): ProposalKpis {
  const recent = Object.entries(viewedAt).filter(([, at]) => at > 0 && now - at < DAY);
  const byId = new Map(rows.map((o) => [o.upworkProposalId, o]));
  return {
    at: new Date(now).toISOString(),
    last24: kpiWindow(rows, now - DAY, now + 1),
    prev24: kpiWindow(rows, now - 2 * DAY, now - DAY),
    last7d: kpiWindow(rows, now - 7 * DAY, now + 1),
    viewsLast24: Object.keys(viewedAt).length ? recent.length : null,
    recentViews: recent.map(([id, at]) => ({ id, jobId: byId.get(id)?.jobId ?? "", title: byId.get(id)?.jobTitle ?? id, at })).sort((a, b) => b.at - a.at),
  };
}

export async function proposalKpis(now = Date.now()): Promise<ProposalKpis> {
  const rows = await listProposalOutcomesSafe({ since: new Date(now - 8 * DAY).toISOString(), limit: 500 });
  const a = await alertCounts(now - DAY).catch(() => null);
  return { ...computeKpis(rows, (await kvGet<Record<string, number>>(VIEWED_AT_KEY)) ?? {}, now), ...(a ? { alerts: { ...a, total: a.app + a.watch } } : {}) };
}

/**
 * Record when each proposal was first seen as viewed. Returns the ones newly viewed since the last sync.
 * The very first call only records what is already viewed (time unknown = 0), so old views aren't announced.
 */
export async function noteViews(rows: Pick<ProposalOutcome, "upworkProposalId" | "viewed" | "outcome">[], now = Date.now()): Promise<string[]> {
  const prev = await kvGet<Record<string, number>>(VIEWED_AT_KEY);
  const map = { ...(prev ?? {}) };
  const fresh: string[] = [];
  for (const o of rows) {
    if (!(o.viewed || o.outcome === "win") || o.upworkProposalId in map) continue;
    map[o.upworkProposalId] = prev ? now : 0;
    if (prev) fresh.push(o.upworkProposalId);
  }
  if (!prev || fresh.length) await kvSet(VIEWED_AT_KEY, map);
  return fresh;
}

/** Nightly snapshot of the KPIs (kept in Supabase so the daily history survives). */
export async function snapshotKpis(now = Date.now()): Promise<ProposalKpis> {
  const k = await proposalKpis(now);
  await saveReport(KPI_KIND, k);
  return k;
}

export async function kpiHistory(n = 14): Promise<ProposalKpis[]> {
  return (await listReports(KPI_KIND, n).catch(() => [])).map((r) => r.data as ProposalKpis);
}
