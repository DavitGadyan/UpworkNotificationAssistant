"use client";

import { useEffect, useState } from "react";
import { CardHead, Spinner } from "@/components/ui/bits";
import type { UsageReport } from "@/lib/usage";
import { agentLabel } from "@/lib/costLabels";
import Link from "next/link";

const usd = (n: number | null | undefined, d = 2) => (n == null ? "—" : `$${n.toFixed(n !== 0 && Math.abs(n) < 0.1 ? 3 : d)}`);


/** Costs & balance: Claude spend and remaining credit, Upwork calls and Connects. */
export function UsageCard() {
  const [u, setU] = useState<UsageReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (refresh = false) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/usage${refresh ? "?refresh=1" : ""}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setU(await r.json()); setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const c = u?.claude, w = u?.upwork;
  const maxDay = Math.max(0.0001, ...(c?.daily.map((d) => d.total) ?? [0]));
  const budgetPct = c ? Math.min(100, (c.today / Math.max(0.01, c.dailyBudget)) * 100) : 0;

  return (
    <section className="card mb-6 p-5 md:p-6" aria-labelledby="usage-h">
      <CardHead id="usage-h" title="Costs & balance" sub="Claude spend and Upwork Connects."
        right={<button type="button" className="btn btn-sm" onClick={() => load(true)} disabled={busy}>{busy ? <Spinner /> : null}Refresh</button>} />
      {err && <p className="mt-3 text-[14px] text-[var(--color-bad)]">Couldn&apos;t load usage: {err}</p>}
      {!u && !err && <p className="mt-4 flex items-center gap-2 text-[var(--color-muted)]"><Spinner /> Loading…</p>}
      {c && w && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[16px] bg-[var(--color-sunken)] p-4">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Claude · {c.provider === "claude-cli" ? "subscription (CLI)" : "API key"}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Today" value={usd(c.today)} />
              <Stat label="7 days" value={usd(c.last7)} />
              <Stat label="30 days" value={usd(c.last30)} />
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-[13px] text-[var(--color-muted)]"><span>Daily budget (auto ranking)</span><span className="num">{usd(c.today)} / {usd(c.dailyBudget)}</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-control)]" role="progressbar" aria-valuenow={Math.round(budgetPct)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full" style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? "var(--color-bad)" : "var(--color-accent)" }} />
              </div>
            </div>
            <p className="mt-3 text-[14px]">
              Credit left: {c.remainingCredit != null
                ? <b className="num" style={{ color: c.remainingCredit < 5 ? "var(--color-bad)" : undefined }}>{usd(c.remainingCredit)}</b>
                : <span className="text-[var(--color-muted)]">set it in Settings → AI models</span>}
              {c.prepaidCredit != null && c.creditSetAt && <span className="text-[13px] text-[var(--color-muted)]"> (of {usd(c.prepaidCredit)} since {c.creditSetAt.slice(0, 10)})</span>}
            </p>
            <div className="mt-3 flex h-12 items-end gap-[3px]" aria-label="Claude spend per day, last 30 days">
              {c.daily.map((d) => (
                <span key={d.date} title={`${d.date}: ${usd(d.total, 3)}`} className="flex-1 rounded-t-[3px] bg-[var(--color-accent)]" style={{ height: `${Math.max(d.total > 0 ? 6 : 2, (d.total / maxDay) * 100)}%`, opacity: d.total > 0 ? 1 : 0.25 }} />
              ))}
            </div>
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-[var(--color-muted)]">Breakdown</summary>
              <ul className="mt-2 grid gap-1">
                <li className="flex justify-between gap-3"><span>Console API</span><span className="num">{usd(c.consoleToday)} · {usd(c.consoleLast30)}/30d</span></li>
                <li className="flex justify-between gap-3"><span>Subscription (list-price equiv.)</span><span className="num">{usd(c.subscriptionToday)} · {usd(c.subscriptionLast30)}/30d</span></li>
                {Object.entries(c.byAgent30).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span>{agentLabel(k)}</span><span className="num">{usd(v, 3)}</span></li>)}
              </ul>
              {c.lastClaudeFetch && <p className="mt-2 text-[var(--color-muted)]">Last “Load via Claude”: {new Date(c.lastClaudeFetch.startedAt).toLocaleString()} · {usd(c.lastClaudeFetch.costUsd)}</p>}
            </details>
            <p className="mt-2 text-[13px]"><Link href="/costs" className="underline underline-offset-2">All costs →</Link></p>
          </div>
          <div className="rounded-[16px] bg-[var(--color-sunken)] p-4">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Upwork · MCP connector</p>
            <div className="mt-2">
              <Stat label="Connects" value={w.connects.balance != null ? String(w.connects.balance) : "—"} />
            </div>
            <p className="mt-2 text-[12px] text-[var(--color-muted)]">
              {w.connects.at ? `Connects as of ${new Date(w.connects.at).toLocaleString()}` : "Connects appear once Upwork is connected."} Calls, pacing and errors: Upwork card above.
            </p>
            {Object.keys(w.byTool24h).length > 0 && (
              <details className="mt-3 text-[13px]">
                <summary className="cursor-pointer font-medium text-[var(--color-muted)]">Calls by tool, 24 h</summary>
                <ul className="mt-2 grid gap-1">
                  {Object.entries(w.byTool24h).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="truncate">{k}</span><span className="num">{v}</span></li>)}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-[var(--color-muted)]">{label}</p>
      <p className="display num truncate text-[20px] font-semibold" style={tone ? { color: "var(--color-bad)" } : undefined}>{value}</p>
      {sub && <p className="text-[12px] text-[var(--color-muted)]">{sub}</p>}
    </div>
  );
}
