import { ledgerDays, llmSpendToday, type LedgerDay } from "./agents/llm";
import { getSettings, kvGet, kvSet, listJobs, mcpCallStats } from "./db";
import { mcpCallsToday } from "./upwork/guard";
import { callTool, mcpConnected } from "./upwork/mcp/client";
import { lastClaudeFetch } from "./upwork/claudeFetch";

/*
 * Costs & balance:
 *   Claude  - every call's cost is computed from token usage (API) or reported by the CLI, written to a
 *             daily ledger by agent and model. Anthropic has no balance endpoint for normal API keys, so the
 *             remaining credit = the prepaid credit you enter in Settings − spend recorded since then.
 *   Upwork  - MCP calls today vs the daily cap, calls by tool in the last 24 h, and your Connects balance
 *             (get_profile connects_balance, cached 1 h; falls back to the balance seen on the last job detail).
 */

const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));

export async function connectsBalance(refresh = false, offline = false): Promise<{ balance: number | null; at: string | null; source: string }> {
  const cached = await kvGet<{ balance: number | null; at: string }>("connects_cache");
  if (cached && !refresh && (offline || Date.now() - new Date(cached.at).getTime() < 36e5)) return { ...cached, source: "upwork" };
  if (!offline && await mcpConnected()) {
    try {
      const r = await callTool<Record<string, unknown>>("get_profile", "connects_balance", { limit: 1 });
      const b = r.balance as Record<string, unknown> | number | undefined;
      const balance = typeof b === "number" ? b : Number((b as Record<string, unknown>)?.total ?? (b as Record<string, unknown>)?.available ?? r.total ?? NaN);
      const v = { balance: Number.isFinite(balance) ? balance : null, at: new Date().toISOString() };
      await kvSet("connects_cache", v);
      return { ...v, source: "upwork" };
    } catch { /* fall through */ }
  }
  const seen = (await listJobs({ status: "all" })).find((j) => j.enrichment?.connectsBalance != null);
  return seen ? { balance: seen.enrichment!.connectsBalance, at: seen.enrichment!.fetchedAt, source: "last job detail" } : { balance: null, at: null, source: "unknown" };
}

/** `offline`: never call Upwork (the worker's status row must not queue behind polling in the call guard). */
export async function usageReport(opts: { refreshConnects?: boolean; offline?: boolean } = {}) {
  const s = (await getSettings()).llm;
  const stored = await ledgerDays(days(30));
  const ledger = days(30).map((d) => stored.get(d) ?? ({ date: d, total: 0, calls: 0, byAgent: {}, byModel: {} } as LedgerDay));
  const sum = (n: number) => Math.round(ledger.slice(0, n).reduce((a, d) => a + d.total, 0) * 1e4) / 1e4;
  const merge = (key: "byAgent" | "byModel") => {
    const out: Record<string, number> = {};
    ledger.forEach((d) => Object.entries(d[key]).forEach(([k, v]) => (out[k] = Math.round(((out[k] ?? 0) + v) * 1e4) / 1e4)));
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  };
  // "(cli)" models ran on the Claude subscription (Load via Claude, CLI provider): not billed to Console.
  const isSub = (model: string) => model.endsWith("(cli)");
  const split = (days: LedgerDay[]) => days.reduce((a, d) => {
    Object.entries(d.byModel).forEach(([m, v]) => { if (isSub(m)) a.sub += v; else a.api += v; });
    return a;
  }, { api: 0, sub: 0 });
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const s30 = split(ledger), s1 = split(ledger.slice(0, 1));
  let remaining: number | null = null;
  if (s.prepaidCreditUsd != null && s.creditSetAt) {
    const since = s.creditSetAt.slice(0, 10);
    remaining = Math.round((s.prepaidCreditUsd - split(ledger.filter((d) => d.date >= since)).api) * 100) / 100;
  }
  const calls24 = await mcpCallStats(Date.now() - 864e5);
  return {
    claude: {
      today: await llmSpendToday(),
      last7: sum(7),
      last30: sum(30),
      calls30: ledger.reduce((a, d) => a + d.calls, 0),
      dailyBudget: s.dailyBudgetUsd,
      provider: s.provider,
      prepaidCredit: s.prepaidCreditUsd,
      creditSetAt: s.creditSetAt,
      remainingCredit: remaining,
      consoleToday: r4(s1.api), consoleLast30: r4(s30.api),
      subscriptionToday: r4(s1.sub), subscriptionLast30: r4(s30.sub),
      byAgent30: merge("byAgent"),
      byModel30: merge("byModel"),
      daily: ledger.slice().reverse().map((d) => ({ date: d.date, total: d.total })),
      lastClaudeFetch: await lastClaudeFetch(),
    },
    upwork: {
      callsToday: await mcpCallsToday(),
      dailyCap: (await getSettings()).guard.dailyCallCap,
      calls24h: calls24.total,
      failed24h: calls24.failed,
      byTool24h: calls24.byTool,
      connects: await connectsBalance(opts.refreshConnects, opts.offline),
    },
  };
}
export type UsageReport = Awaited<ReturnType<typeof usageReport>>;
