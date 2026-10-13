import { bumpDailyRequests, dailyRequests, getSettings, kvGet, kvSet, logMcpCall } from "../db";
import { today } from "../ratelimit";

/*
 * Ban-safety for the Upwork MCP connector. Every MCP call goes through `guarded()`:
 *   - one call in flight at a time (single-flight queue) with a minimum gap between calls;
 *   - a persisted daily cap (Settings → guard.dailyCallCap);
 *   - exponential backoff on 429 / 5xx / transport errors, then a circuit breaker that pauses all
 *     calls for 30 min after 3 consecutive failures.
 * Upwork's MCP terms ask that the connector is used "the way you'd normally use Upwork": a person
 * checking a few feeds every few minutes. These limits keep the worker well inside that.
 */

export class GuardError extends Error {
  constructor(message: string, public readonly kind: "cap" | "breaker" | "auth") { super(message); }
}

interface Breaker { failures: number; openUntil: number; lastError: string | null }
const BREAKER_KEY = "mcp_breaker";
const FAILS_TO_OPEN = 3;
const OPEN_MS = 30 * 60_000;

const dayKey = (now = new Date()) => `${today(now)}#mcp`;
export const mcpCallsToday = async () => await dailyRequests(dayKey());

export async function breakerState(): Promise<Breaker> {
  return (await kvGet<Breaker>(BREAKER_KEY)) ?? { failures: 0, openUntil: 0, lastError: null };
}
export async function resetBreaker() { await kvSet(BREAKER_KEY, { failures: 0, openUntil: 0, lastError: null }); }

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const retryable = (msg: string) => /\b(429|500|502|503|504)\b|rate.?limit|too many|timeout|ECONNRESET|fetch failed|socket/i.test(msg);
const isAuth = (msg: string) => /unauthori[sz]ed|invalid_token|\b401\b|invalid_grant/i.test(msg);

/** Run `fn` under the guard. `label` is "tool.action" for the call log. */
export function guarded<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const s = (await getSettings()).guard;
    const b = await breakerState();
    if (b.openUntil > Date.now()) {
      throw new GuardError(`Paused until ${new Date(b.openUntil).toISOString()} after repeated errors: ${b.lastError}`, "breaker");
    }
    if ((await mcpCallsToday()) >= s.dailyCallCap) throw new GuardError(`Daily cap of ${s.dailyCallCap} Upwork calls reached`, "cap");

    const [tool, action] = label.split(".");
    // Opening job details is what Upwork throttles ("jobs are being opened too quickly"): space them wider.
    const minGap = label === "find_jobs.get" ? Math.max(s.minGapMs, 3500) : s.minGapMs;
    for (let attempt = 0; ; attempt++) {
      const gap = minGap - (Date.now() - lastCallAt);
      if (gap > 0) await sleep(gap);
      lastCallAt = Date.now();
      await bumpDailyRequests(dayKey());
      const started = Date.now();
      try {
        const out = await fn();
        await logMcpCall(tool, action ?? null, true, Date.now() - started, null);
        if (b.failures) await kvSet(BREAKER_KEY, { failures: 0, openUntil: 0, lastError: null });
        return out;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        await logMcpCall(tool, action ?? null, false, Date.now() - started, msg.slice(0, 300));
        if (isAuth(msg)) throw new GuardError(`Upwork login expired - reconnect in Settings (${msg})`, "auth");
        if (retryable(msg) && attempt < 3) {
          await sleep(Math.min(60_000, 2_000 * 2 ** attempt) + Math.random() * 1_000);
          continue;
        }
        // Only transport / rate-limit trouble counts toward the breaker. A tool refusing a request
        // (wrong account role, bad parameter, not found) is that call's problem and must not pause polling.
        if (!retryable(msg)) throw e;
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

/** ±jitter around the poll interval so requests never land on an exact schedule. */
export function jitteredInterval(baseSec: number, jitterSec: number) {
  const j = (Math.random() * 2 - 1) * jitterSec;
  return Math.max(60, baseSec + j) * 1000;
}
