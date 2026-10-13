"use client";

import { useEffect, useState } from "react";
import { CardHead, Spinner } from "@/components/ui/bits";
import type { UsageReport } from "@/lib/usage";

const usd = (n: number | null | undefined, d = 2) => (n == null ? "—" : `$${n.toFixed(n !== 0 && Math.abs(n) < 0.1 ? 3 : d)}`);
const LABELS: Record<string, string> = { ranking: "Job ranking", proposal: "Proposal drafts", closer: "Closer", coach: "Profile coach", review: "Monthly review", claude_fetch: "Load via Claude", other: "Other" };

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
      <CardHead id="usage-h" title="Costs & balance" sub="Claude (Anthropic) spend and credit, Upwork usage and Connects."
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
            <ul className="mt-3 grid gap-1 text-[14px]">
              <li className="flex justify-between gap-3"><span>Console API (billed to your credit)</span><span className="num">{usd(c.consoleToday)} today · {usd(c.consoleLast30)} / 30d</span></li>
              <li className="flex justify-between gap-3"><span>Claude subscription (Load via Claude / CLI)</span><span className="num">{usd(c.subscriptionToday)} today · {usd(c.subscriptionLast30)} / 30d</span></li>
            </ul>
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">Subscription figures are list-price equivalents of plan usage, not charges.</p>
            <div className="mt-3">
              <div className="flex justify-between text-[13px] text-[var(--color-muted)]"><span>Daily budget (auto ranking)</span><span className="num">{usd(c.today)} / {usd(c.dailyBudget)}</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-control)]" role="progressbar" aria-valuenow={Math.round(budgetPct)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full" style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? "var(--color-bad)" : "var(--color-accent)" }} />
              </div>
            </div>
            <p className="mt-3 text-[14px]">
              Remaining credit: {c.remainingCredit != null
                ? <b className="num" style={{ color: c.remainingCredit < 5 ? "var(--color-bad)" : undefined }}>{usd(c.remainingCredit)}</b>
                : <span className="text-[var(--color-muted)]">set your prepaid credit in Settings → AI models</span>}
              {c.prepaidCredit != null && c.creditSetAt && <span className="text-[13px] text-[var(--color-muted)]"> (of {usd(c.prepaidCredit)} since {c.creditSetAt.slice(0, 10)})</span>}
            </p>
            <div className="mt-3 flex h-12 items-end gap-[3px]" aria-label="Claude spend per day, last 30 days">
              {c.daily.map((d) => (
                <span key={d.date} title={`${d.date}: ${usd(d.total, 3)}`} className="flex-1 rounded-t-[3px] bg-[var(--color-accent)]" style={{ height: `${Math.max(d.total > 0 ? 6 : 2, (d.total / maxDay) * 100)}%`, opacity: d.total > 0 ? 1 : 0.25 }} />
              ))}
            </div>
            {Object.keys(c.byAgent30).length > 0 && (
              <ul className="mt-3 grid gap-1 text-[14px]">
                {Object.entries(c.byAgent30).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span>{LABELS[k] ?? k}</span><span className="num">{usd(v, 3)}</span></li>)}
              </ul>
            )}
            {c.lastClaudeFetch && <p className="mt-2 text-[13px] text-[var(--color-muted)]">Last “Load via Claude”: {new Date(c.lastClaudeFetch.startedAt).toLocaleString()} · {usd(c.lastClaudeFetch.costUsd)}</p>}
          </div>
          <div className="rounded-[16px] bg-[var(--color-sunken)] p-4">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Upwork · MCP connector</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Connects" value={w.connects.balance != null ? String(w.connects.balance) : "—"} />
              <Stat label="Calls today" value={`${w.callsToday}`} sub={`of ${w.dailyCap.toLocaleString()}`} />
              <Stat label="Failed 24h" value={String(w.failed24h)} tone={w.failed24h ? "bad" : undefined} />
            </div>
            <p className="mt-2 text-[13px] text-[var(--color-muted)]">
              {w.connects.at ? `Connects from ${w.connects.source}, ${new Date(w.connects.at).toLocaleString()}` : "Connects appear after Upwork is connected (or after the first job detail)."}
            </p>
            {Object.keys(w.byTool24h).length > 0 && (
              <ul className="mt-3 grid gap-1 text-[14px]">
                {Object.entries(w.byTool24h).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="truncate">{k}</span><span className="num">{v}</span></li>)}
              </ul>
            )}
            <p className="mt-3 text-[13px] text-[var(--color-muted)]">Upwork doesn&apos;t charge for MCP calls; Connects are spent only when you submit a proposal.</p>
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
