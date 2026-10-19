import { classify } from "./upwork/governor";

/*
 * Upwork call history report (David, 2026-10-19): per-day volumes and peak rates, and every throttle/restriction
 * episode with the call rates that led up to it - so we know which rates Upwork tolerates and which it blocks.
 * Pure: takes rows from public.upwork_calls (or mcp_log / its local export) and returns Markdown.
 */

export interface CallRow { created_at: number; tool: string; action: string | null; ok: boolean; detail: string | null; error_class?: string | null; source?: string | null }

const TZ = "Asia/Yerevan";
const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, ...opts }).format(new Date(ms));
const day = (ms: number) => fmt(ms, { year: "numeric", month: "2-digit", day: "2-digit" });
const hm = (ms: number) => fmt(ms, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
const kind = (r: CallRow) => r.tool === "find_jobs" ? (r.action === "get" ? "get" : "search") : "other";
export const errorClass = (r: CallRow) => r.ok ? null : (r.error_class ?? classify(r.detail ?? ""));
/** Upwork's own answers about pace or access - not "room not found" style errors. */
const pacing = (c: string | null) => c === "restricted" || c === "throttle";

/** Most calls in any window of `win` ms (two-pointer over sorted times). */
function maxIn(times: number[], win: number): number {
  let best = 0;
  for (let i = 0, j = 0; j < times.length; j++) {
    while (times[j] - times[i] >= win) i++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}
const countIn = (times: number[], from: number, to: number) => times.filter((t) => t >= from && t < to).length;

export function callReport(input: CallRow[], limits: Record<string, number | string>, nowMs = Date.now()): string {
  const rows = [...input].sort((a, b) => a.created_at - b.created_at);
  const all = rows.map((r) => r.created_at);
  const gets = rows.filter((r) => kind(r) === "get").map((r) => r.created_at);
  const searches = rows.filter((r) => kind(r) === "search").map((r) => r.created_at);
  const out: string[] = [];
  out.push("# Upwork call history", "");
  out.push(`Generated ${hm(nowMs)} (${TZ}) from ${rows.length.toLocaleString("en")} logged calls${rows.length ? `, ${hm(rows[0].created_at)} → ${hm(rows[rows.length - 1].created_at)}` : ""}.`);
  out.push("Regenerate with `npm run -s calls -- report`. Source: `public.upwork_calls` (permanent), else `public.mcp_log` (7 days).", "");
  out.push("## Current limits", "", "| Limit | Value |", "|---|---|", ...Object.entries(limits).map(([k, v]) => `| ${k} | ${v} |`), "");

  out.push("## Per day (Yerevan time)", "");
  out.push("| Day | Calls | Searches | Job opens | Other | Max / hour | Max / 10 min | Max opens / hour | Throttled | Restricted | Other errors |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|");
  const days = [...new Set(rows.map((r) => day(r.created_at)))];
  for (const d of days) {
    const rs = rows.filter((r) => day(r.created_at) === d);
    const t = rs.map((r) => r.created_at);
    const g = rs.filter((r) => kind(r) === "get").map((r) => r.created_at);
    const cls = rs.map(errorClass);
    out.push(`| ${d} | ${rs.length} | ${rs.filter((r) => kind(r) === "search").length} | ${g.length} | ${rs.filter((r) => kind(r) === "other").length} | ${maxIn(t, 36e5)} | ${maxIn(t, 6e5)} | ${maxIn(g, 36e5)} | ${cls.filter((c) => c === "throttle").length} | ${cls.filter((c) => c === "restricted").length} | ${cls.filter((c) => c && !pacing(c)).length} |`);
  }
  out.push("");

  // Episodes: pacing errors less than 30 min apart belong together.
  const bad = rows.filter((r) => pacing(errorClass(r)));
  const episodes: CallRow[][] = [];
  for (const r of bad) {
    const last = episodes[episodes.length - 1];
    if (last && r.created_at - last[last.length - 1].created_at < 30 * 60_000) last.push(r); else episodes.push([r]);
  }
  out.push("## Throttle and restriction episodes", "");
  if (!episodes.length) out.push("None in the logged period.", "");
  else {
    out.push("Rates are counted over all calls before the first error of each episode.", "");
    out.push("| Start | End | Kind | Errors | Calls 10 min before | 1 h before | 24 h before | Opens 1 h before | Opens 24 h before | Searches 1 h before | First message |");
    out.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const ep of episodes) {
      const s = ep[0].created_at;
      const kinds = [...new Set(ep.map((r) => `${errorClass(r)} (${r.tool}.${r.action ?? ""})`))].join(", ");
      const msg = (ep[0].detail ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 90);
      out.push(`| ${hm(s)} | ${hm(ep[ep.length - 1].created_at)} | ${kinds} | ${ep.length} | ${countIn(all, s - 6e5, s)} | ${countIn(all, s - 36e5, s)} | ${countIn(all, s - 864e5, s)} | ${countIn(gets, s - 36e5, s)} | ${countIn(gets, s - 864e5, s)} | ${countIn(searches, s - 36e5, s)} | ${msg} |`);
    }
    out.push("");
  }

  const clean = days.filter((d) => !rows.some((r) => day(r.created_at) === d && pacing(errorClass(r))));
  out.push("## What has been safe so far", "");
  if (!clean.length) out.push("No day without a throttle or restriction yet.", "");
  else {
    const t = (d: string) => rows.filter((r) => day(r.created_at) === d);
    const peak = (f: (d: string) => number) => Math.max(...clean.map(f));
    out.push(`Days with no throttle or restriction: ${clean.join(", ")}.`, "");
    out.push(`- Highest daily total on a clean day: ${peak((d) => t(d).length)} calls.`);
    out.push(`- Highest job opens on a clean day: ${peak((d) => t(d).filter((r) => kind(r) === "get").length)}.`);
    out.push(`- Highest calls in one hour on a clean day: ${peak((d) => maxIn(t(d).map((r) => r.created_at), 36e5))}.`, "");
  }
  return out.join("\n");
}
