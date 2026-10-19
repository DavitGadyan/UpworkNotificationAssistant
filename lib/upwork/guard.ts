import { bumpDailyRequests, dailyRequests, getSettings, kvGet, kvSet, logMcpCall } from "../db";
import { today } from "../ratelimit";
import { classify, currentCaller, decide, record, type CallMeta } from "./governor";

/*
 * Ban-safety for the Upwork MCP connector. Every MCP call goes through `guarded()`:
 *   - the pacing governor (lib/upwork/governor.ts) decides first: budgets, slow-down level, one poller,
 *     job-open rules, and a hard stop once Upwork says access is "restricted";
 *   - one call in flight at a time (single-flight queue) with a minimum gap between calls (≥ 4 s, 8 s for job opens);
 *   - a persisted daily cap (Settings → guard.dailyCallCap, at most 2,800);
 *   - one retry on 429 / 5xx / transport errors, then a circuit breaker that pauses all calls for 30 min
 *     after 3 consecutive failures. "Too quickly" is never retried; "restricted" stops everything.
 */

export class GuardError extends Error {
  constructor(message: string, public readonly kind: "cap" | "breaker" | "auth" | "restricted" | "throttled" | "inactive") { super(message); }
}

interface Breaker { failures: number; openUntil: number; lastError: string | null }
const BREAKER_KEY = "mcp_breaker";
const FAILS_TO_OPEN = 3;
const OPEN_MS = 30 * 60_000;
const MAX_RETRIES = 1;
const MIN_GAP_MS = 4_000;
const GET_GAP_MS = 8_000;

const dayKey = (now = new Date()) => `${today(now)}#mcp`;
export const mcpCallsToday = async () => await dailyRequests(dayKey());

export async function breakerState(): Promise<Breaker> {
  return (await kvGet<Breaker>(BREAKER_KEY)) ?? { failures: 0, openUntil: 0, lastError: null };
}
export async function resetBreaker() { await kvSet(BREAKER_KEY, { failures: 0, openUntil: 0, lastError: null }); }

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isAuth = (msg: string) => classify(msg) === "auth";

/** Run `fn` under the guard. `label` is "tool.action" for the call log; `meta` tells the governor what the call is. */
export function guarded<T>(label: string, fn: () => Promise<T>, meta: CallMeta = {}): Promise<T> {
  const run = async (): Promise<T> => {
    const s = (await getSettings()).guard;
    const b = await breakerState();
    if (b.openUntil > Date.now()) {
      throw new GuardError(`Paused until ${new Date(b.openUntil).toISOString()} after repeated errors: ${b.lastError}`, "breaker");
    }
    if ((await mcpCallsToday()) >= s.dailyCallCap) throw new GuardError(`Daily cap of ${s.dailyCallCap} Upwork calls reached`, "cap");

    const [tool, action] = label.split(".");
    const minGap = label === "find_jobs.get" ? Math.max(s.minGapMs, GET_GAP_MS) : Math.max(s.minGapMs, MIN_GAP_MS);
    for (let attempt = 0; ; attempt++) {
      let d = await decide(label, meta);
      // A short wait (job-open spacing) is slept here; anything longer is the caller's problem.
      if (!d.go && d.scope === "wait" && d.retryAt - Date.now() <= 10_000) { await sleep(Math.max(0, d.retryAt - Date.now())); d = await decide(label, meta); }
      if (!d.go) {
        if (d.scope === "job") throw new Error(`${label}: ${d.reason}`); // this one job only - not a reason to stop the cycle
        throw new GuardError(d.reason, d.reason.startsWith("not-active-poller") ? "inactive" : d.scope === "stop" ? "restricted" : "throttled");
      }
      // Random extra second so calls never land on an exact beat (David, 2026-10-16).
      const gap = minGap + Math.random() * 1_000 - (Date.now() - lastCallAt);
      if (gap > 0) await sleep(gap);
      lastCallAt = Date.now();
      await bumpDailyRequests(dayKey());
      const started = Date.now();
      try {
        const out = await fn();
        await logMcpCall(tool, action ?? null, true, Date.now() - started, null, Date.now(), { source: currentCaller(), category: meta.category });
        await record(label, true, null, meta);
        if (b.failures) await kvSet(BREAKER_KEY, { failures: 0, openUntil: 0, lastError: null });
        return out;
      } catch (e) {
        if (e instanceof GuardError) throw e;
        const msg = (e as Error).message ?? String(e);
        await logMcpCall(tool, action ?? null, false, Date.now() - started, msg.slice(0, 300), Date.now(), { source: currentCaller(), category: meta.category, errorClass: classify(msg) });
        const cls = await record(label, false, msg, meta);
        if (cls === "restricted") throw new GuardError(`Upwork restricted access - all Upwork calls stopped (${msg.slice(0, 200)})`, "restricted");
        if (isAuth(msg)) throw new GuardError(`Upwork login expired - reconnect in Settings (${msg})`, "auth");
        // "Too quickly" is never retried: the governor has already slowed down and paused job opens.
        if (cls === "transient" && attempt < MAX_RETRIES) {
          await sleep(5_000 + Math.random() * 2_000);
          continue;
        }
        // Only transport / rate-limit trouble counts toward the breaker. A tool refusing a request
        // (wrong account role, bad parameter, not found) is that call's problem and must not pause polling.
        if (cls !== "transient") throw e;
        const cur = await breakerState();
        const failures = cur.failures + 1;
        await kvSet(BREAKER_KEY, {
          failures,
          openUntil: failures >= FAILS_TO_OPEN ? Date.now() + OPEN_MS : 0,
          lastError: msg.slice(0, 200),
        });
        throw e;
      }
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/** Up to +jitter after the poll interval (never earlier, so feeds never run faster than their pace). */
export function jitteredInterval(baseSec: number, jitterSec: number) {
  const j = Math.random() * jitterSec;
  return Math.max(60, baseSec + j) * 1000;
}
