import { getJob, getSettings, kvGet, kvSet, listProposals } from "./db";
import { jobUrl } from "./format";
import { sendText } from "./notify/telegram";
import { approveAuto, GateError, preview, submit } from "./proposals/submit";
import type { CachedJob, Proposal, Settings } from "./types";
import { isRestricted } from "./upwork/governor";
import { proposalsLow } from "./upwork/tiers";
import { connectsBalance } from "./usage";

/*
 * Night auto-apply (David, 2026-10-18). Off by default (Settings → Auto-apply at night). While he sleeps
 * (default 00:00-11:00 Asia/Yerevan) the worker submits auto-drafted proposals - without a Loom video - for jobs
 * that clear every bar:
 *   rank ≥ minRank, AI fit ≥ minFit, fewer than maxProposals proposals, verified payment, not excluded,
 *   not a likely ghost post, still open in our data, seen in the last 24 h;
 * and only within maxPerNight submissions and maxConnectsPerNight Connects, never taking the balance below
 * minConnectsBalance. A preview without a readable Connects cost is NOT submitted - it waits for David.
 * Every Upwork call goes through the pacing governor; nothing runs while it is stopped ("restricted").
 * One submission per worker cycle, so they are spread out. Each one is reported on Telegram.
 */

type Night = { count: number; connects: number; ids: string[] };
type AA = Settings["autoApply"];

const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
function local(nowMs: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return { min: (Number(p.hour) % 24) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

/** Inside the night window? `night` names the window by the date it started on, for the per-night counters. */
export function nightWindow(a: Pick<AA, "timezone" | "start" | "end">, nowMs = Date.now()): { inside: boolean; night: string } {
  const l = local(nowMs, a.timezone);
  const s = toMin(a.start), e = toMin(a.end);
  const inside = s <= e ? l.min >= s && l.min < e : l.min >= s || l.min < e;
  // A window that crosses midnight and is in its after-midnight part belongs to the previous date.
  const night = s > e && l.min < e ? local(nowMs - 864e5, a.timezone).date : l.date;
  return { inside, night };
}

/**
 * A job the chat watch loop alerted on at fit ≥ minFit (David, 2026-10-19) stands in for the app's rank and AI fit,
 * which are missing when the job-open budget ran out or lower than the loop's own reading. Every other bar still applies.
 */
export const vouched = (j: Pick<CachedJob, "score">, minFit: number) => (j.score.watch?.fit ?? 0) >= minFit;

/** Does this job clear every auto-apply bar? Returns the first reason it doesn't, or null. */
export function autoApplyBlocker(j: CachedJob, a: AA, nowMs = Date.now()): string | null {
  if (j.score.excluded) return "excluded";
  if (["dismissed", "applied"].includes(j.status)) return `status ${j.status}`;
  const v = vouched(j, a.minFit);
  if (!v && j.score.total < a.minRank) return `rank ${j.score.total} < ${a.minRank}`;
  if (!v && (j.score.llm?.fit ?? 0) < a.minFit) return `AI fit ${j.score.llm?.fit ?? "none"} < ${a.minFit}`;
  if (proposalsLow(j) >= a.maxProposals) return `${j.proposalsTier ?? j.totalApplicants} proposals`;
  if (a.requireVerifiedPayment && j.client.paymentVerified !== true) return "payment not verified";
  if (j.score.intent?.ghostRisk === "high") return "likely not hiring";
  if (j.enrichment?.status && j.enrichment.status !== "ACTIVE") return "job closed";
  if ((j.enrichment?.activity.hired ?? 0) > 0) return "client already hired";
  if (nowMs - new Date(j.fetchedAt).getTime() > 864e5) return "older than 24 h";
  return null;
}

/** First number under a key matching `re`, anywhere in Upwork's preview payload. */
export function findNumber(v: unknown, re: RegExp): number | null {
  if (!v || typeof v !== "object") return null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (re.test(k) && (typeof x === "number" || (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))))) return Number(x);
  }
  for (const x of Object.values(v as Record<string, unknown>)) {
    const n = findNumber(x, re);
    if (n != null) return n;
  }
  return null;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const nightKey = (night: string) => `autoapply:${night}`;

export async function autoApplyStatus(nowMs = Date.now()) {
  const a = (await getSettings()).autoApply;
  const w = nightWindow(a, nowMs);
  const n = (await kvGet<Night>(nightKey(w.night))) ?? { count: 0, connects: 0, ids: [] };
  return { enabled: a.enabled, inside: w.inside, night: w.night, submitted: n.count, connects: n.connects, maxPerNight: a.maxPerNight, maxConnectsPerNight: a.maxConnectsPerNight };
}

/** One worker cycle: submit at most one qualifying auto-draft. */
export async function runAutoApply(opts: { nowMs?: number; notify?: boolean } = {}): Promise<{ submitted: string | null; skipped: string | null }> {
  const nowMs = opts.nowMs ?? Date.now();
  const a = (await getSettings()).autoApply;
  if (!a.enabled) return { submitted: null, skipped: "disabled" };
  const w = nightWindow(a, nowMs);
  if (!w.inside) return { submitted: null, skipped: "outside the night window" };
  if (await isRestricted()) return { submitted: null, skipped: "Upwork calls stopped (restricted)" };
  const n = (await kvGet<Night>(nightKey(w.night))) ?? { count: 0, connects: 0, ids: [] };
  if (n.count >= a.maxPerNight) return { submitted: null, skipped: `night limit ${a.maxPerNight} reached` };

  // Auto-drafts waiting for a Loom, best job first; a proposal already auto-approved/previewed goes on from there.
  const props = (await listProposals()).filter((p) => ["needs_loom", "ready"].includes(p.status) || (p.preview?.auto === true && ["approved", "previewed"].includes(p.status)));
  const ranked: { p: Proposal; j: CachedJob }[] = [];
  for (const p of props) {
    const j = await getJob(p.jobId);
    if (j && !n.ids.includes(j.id) && !autoApplyBlocker(j, a, nowMs)) ranked.push({ p, j });
  }
  ranked.sort((x, y) => y.j.score.total - x.j.score.total);
  const pick = ranked[0];
  if (!pick) return { submitted: null, skipped: "no qualifying draft" };
  const { j } = pick;
  let p = pick.p;

  try {
    if (p.bid == null || p.bid <= 0) return { submitted: null, skipped: `no bid on draft ${p.id}` };
    if (p.status === "needs_loom" || p.status === "ready") p = await approveAuto(p.id);
    if (p.status === "approved") p = await preview(p.id);
    const up = p.preview?.upwork;
    const cost = findNumber(up, /connects?_?(cost|required|needed)/i) ?? j.enrichment?.connectsCost ?? null;
    const balance = findNumber(up, /connects?_?balance|available_connects/i) ?? (await connectsBalance()).balance;
    const hold = cost == null ? "Upwork's preview shows no Connects cost"
      : n.connects + cost > a.maxConnectsPerNight ? `would pass tonight's ${a.maxConnectsPerNight}-Connects limit`
      : balance != null && balance - cost < a.minConnectsBalance ? `balance would drop below ${a.minConnectsBalance}`
      : null;
    if (hold) {
      n.ids.push(j.id); // don't retry it tonight; it stays previewed for David
      await kvSet(nightKey(w.night), n);
      if (opts.notify !== false) await sendText(`🤖 <b>Auto-apply held</b>: <a href="${jobUrl(j.ciphertext)}">${esc(j.title)}</a> - ${esc(hold)}. The proposal is previewed and waits for you.`);
      return { submitted: null, skipped: hold };
    }
    await submit(p.id, "SUBMIT");
    n.count++; n.connects += cost!; n.ids.push(j.id);
    await kvSet(nightKey(w.night), n);
    if (opts.notify !== false) {
      await sendText(`🤖 <b>Auto-applied</b> (rank ${j.score.total}, AI fit ${j.score.llm?.fit ?? "?"}): <a href="${jobUrl(j.ciphertext)}">${esc(j.title)}</a>\nBid ${p.bid} · ${cost} Connects · ${j.proposalsTier ?? j.totalApplicants} proposals · no Loom\nTonight: ${n.count}/${a.maxPerNight} sent, ${n.connects}/${a.maxConnectsPerNight} Connects.`);
    }
    return { submitted: j.id, skipped: null };
  } catch (e) {
    n.ids.push(j.id); // one try per job per night
    await kvSet(nightKey(w.night), n);
    const msg = (e as Error).message;
    if (opts.notify !== false && !(e instanceof GateError && /already have a proposal/.test(msg))) {
      await sendText(`🤖 Auto-apply ${e instanceof GateError ? "held" : "failed"} on <a href="${jobUrl(j.ciphertext)}">${esc(j.title)}</a>: ${esc(msg.slice(0, 200))}`).catch(() => undefined);
    }
    if ((e as { kind?: string }).kind) throw e; // governor / guard stop: the worker stops this cycle
    return { submitted: null, skipped: `error: ${msg.slice(0, 120)}` };
  }
}
