import { getSettings, getWorkerHeartbeat, kvGet, kvSet, listSearches } from "./db";

/*
 * Polling goal (SLO): every enabled feed is fetched successfully at least once per poll interval.
 *   - each fetch records lastOkAt / lastErrorAt / consecutive failures per feed;
 *   - a feed is "late" after 3 × interval without a success (15 min at the default 5 min) → Telegram alert,
 *     and a recovery message when it comes back;
 *   - /api/health returns 503 while any feed is late or the worker heartbeat is stale, so Docker and an
 *     external uptime monitor can restart / page;
 *   - success rate over the last 24 h is tracked per feed and shown on Overview.
 */

export interface FeedHealth {
  feedId: number;
  name: string;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  failures: number; // consecutive
  okCount24h: number;
  runs24h: number;
  returned: number;
}

const KEY = "feed_health";
type Store = Record<string, FeedHealth & { history: { at: number; ok: boolean }[] }>;

const load = async () => await kvGet<Store>(KEY) ?? {};

export async function recordFeedRun(feedId: number, name: string, ok: boolean, detail: { returned?: number; error?: string } = {}, now = Date.now()) {
  const all = await load();
  const cur = all[feedId] ?? { feedId, name, lastOkAt: null, lastErrorAt: null, lastError: null, failures: 0, okCount24h: 0, runs24h: 0, returned: 0, history: [] };
  cur.name = name;
  cur.history = [...cur.history.filter((h) => now - h.at < 864e5), { at: now, ok }].slice(-400);
  if (ok) { cur.lastOkAt = now; cur.failures = 0; cur.returned = detail.returned ?? 0; }
  else { cur.lastErrorAt = now; cur.lastError = detail.error?.slice(0, 300) ?? "error"; cur.failures++; }
  cur.runs24h = cur.history.length;
  cur.okCount24h = cur.history.filter((h) => h.ok).length;
  all[feedId] = cur;
  await kvSet(KEY, all);
}

export async function healthReport(now = Date.now()) {
  const s = await getSettings();
  const lateAfterMs = 3 * Math.max(120, s.pollIntervalSec) * 1000;
  const store = await load();
  const feeds = (await listSearches()).filter((f) => f.enabled).map((f) => {
    const h = store[f.id];
    const since = h?.lastOkAt ?? null;
    return {
      feedId: f.id, name: f.name, kind: f.kind,
      lastOkAt: since ? new Date(since).toISOString() : null,
      lastError: h?.lastError ?? null,
      failures: h?.failures ?? 0,
      successRate24h: h?.runs24h ? Math.round((h.okCount24h / h.runs24h) * 100) : null,
      runs24h: h?.runs24h ?? 0,
      late: !since || now - since > lateAfterMs,
    };
  });
  const hb = await getWorkerHeartbeat();
  const workerStale = !hb || now - hb.at > lateAfterMs;
  return {
    ok: !workerStale && feeds.every((f) => !f.late),
    goal: `Every enabled feed fetched successfully at least every ${Math.round(s.pollIntervalSec / 60)} min; alert after ${Math.round(lateAfterMs / 60000)} min without success`,
    workerHeartbeat: hb ? new Date(hb.at).toISOString() : null,
    workerStale,
    lateAfterMin: Math.round(lateAfterMs / 60000),
    feeds,
  };
}

/** Which feeds just went late / recovered since the last check (for one-shot alerts). */
export async function lateTransitions(now = Date.now()): Promise<{ late: string[]; recovered: string[] }> {
  const r = await healthReport(now);
  const prev = new Set(await kvGet<string[]>("feeds_late") ?? []);
  const late = r.feeds.filter((f) => f.late && f.runs24h > 0).map((f) => f.name);
  await kvSet("feeds_late", late);
  return { late: late.filter((n) => !prev.has(n)), recovered: [...prev].filter((n) => !late.includes(n)) };
}
