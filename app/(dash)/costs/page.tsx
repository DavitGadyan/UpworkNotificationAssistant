import Link from "next/link";
import { Empty } from "@/components/ui/bits";
import { PageHead } from "@/components/ui/PageHead";
import { ledgerDays, type LedgerDay } from "@/lib/agents/llm";
import { agentLabel, isSubscriptionModel } from "@/lib/costLabels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costs" };

/*
 * Costs: Claude spend per agent per day, from the daily ledger every AI call writes (lib/agents/llm.ts addSpend).
 * "Console API" is billed to the Anthropic credit; "Subscription" is Claude-plan usage (CLI provider, Load via
 * Claude), shown at list price. The Claude chat watch loop runs inside Claude Code and is not in this ledger.
 */

const RANGES = [7, 30, 90] as const;
const usd = (n: number) => (n === 0 ? "—" : `$${n.toFixed(Math.abs(n) < 0.1 ? 3 : 2)}`);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const dates = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

function split(d: LedgerDay) {
  let api = 0, sub = 0;
  Object.entries(d.byModel).forEach(([m, v]) => { if (isSubscriptionModel(m)) sub += v; else api += v; });
  return { api: r4(api), sub: r4(sub) };
}

export default async function Costs({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const want = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(want) ? want : 30;
  const stored = await ledgerDays(dates(days));
  const rows = dates(days).map((d) => stored.get(d) ?? ({ date: d, total: 0, calls: 0, byAgent: {}, byModel: {} } as LedgerDay));

  const agentTotals: Record<string, number> = {};
  const modelTotals: Record<string, number> = {};
  rows.forEach((d) => {
    Object.entries(d.byAgent).forEach(([k, v]) => (agentTotals[k] = r4((agentTotals[k] ?? 0) + v)));
    Object.entries(d.byModel).forEach(([k, v]) => (modelTotals[k] = r4((modelTotals[k] ?? 0) + v)));
  });
  const agents = Object.keys(agentTotals).sort((a, b) => agentTotals[b] - agentTotals[a]);
  const total = r4(rows.reduce((a, d) => a + d.total, 0));
  const calls = rows.reduce((a, d) => a + d.calls, 0);
  const totals = rows.reduce((a, d) => { const s = split(d); return { api: a.api + s.api, sub: a.sub + s.sub }; }, { api: 0, sub: 0 });
  const active = rows.filter((d) => d.total > 0).length;
  const maxDay = Math.max(0.0001, ...rows.map((d) => d.total));

  return (
    <>
      <PageHead title="Costs"
        subtitle="Claude spend by agent and by day. Console API is billed to your Anthropic credit; Subscription is Claude-plan usage shown at list price, not charged."
        meta={<>
          <span className="num">{usd(total)} in {days} days</span>
          <span className="num">{usd(r4(totals.api))} Console API</span>
          <span className="num">{usd(r4(totals.sub))} subscription</span>
          <span className="num">{calls.toLocaleString()} AI calls</span>
          {active > 0 && <span className="num">{usd(r4(total / active))} per active day</span>}
        </>}
        actions={<nav className="seg" aria-label="Range">
          {RANGES.map((n) => (
            <Link key={n} href={`/costs?days=${n}`} className="seg-item" aria-current={n === days ? "page" : undefined} aria-pressed={n === days}>{n} days</Link>
          ))}
        </nav>} />

      {total === 0 ? (
        <Empty title="No Claude spend recorded in this range">Every AI call (ranking, drafts, closer, coach, reviews) is written to a daily ledger; it shows here by agent.</Empty>
      ) : (
        <>
          <section className="card mb-6 p-5 md:p-6" aria-labelledby="by-agent">
            <h2 id="by-agent" className="display text-[20px] font-semibold">By agent</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {agents.map((k) => (
                <li key={k} className="rounded-[16px] bg-[var(--color-sunken)] p-4">
                  <p className="text-[13px] text-[var(--color-muted)]">{agentLabel(k)}</p>
                  <p className="display num text-[22px] font-semibold">{usd(agentTotals[k])}</p>
                  <p className="text-[12px] text-[var(--color-muted)]">{Math.round((agentTotals[k] / total) * 100)}% of spend</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="card mb-6 min-w-0 p-5 md:p-6" aria-labelledby="by-day">
            <h2 id="by-day" className="display text-[20px] font-semibold">By day</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] uppercase tracking-wide text-[var(--color-muted)]">
                    <th scope="col" className="py-2 pr-3 font-semibold">Date</th>
                    {agents.map((k) => <th key={k} scope="col" className="px-3 py-2 text-right font-semibold">{agentLabel(k)}</th>)}
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Console API</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Subscription</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Calls</th>
                    <th scope="col" className="py-2 pl-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const s = split(d);
                    return (
                      <tr key={d.date} className={`border-t border-[var(--color-line)] ${d.total === 0 ? "text-[var(--color-muted)]" : ""}`}>
                        <th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-normal"><span className="num">{d.date}</span> <span className="text-[12px] text-[var(--color-muted)]">{weekday(d.date)}</span></th>
                        {agents.map((k) => <td key={k} className="num px-3 py-2 text-right">{usd(d.byAgent[k] ?? 0)}</td>)}
                        <td className="num px-3 py-2 text-right">{usd(s.api)}</td>
                        <td className="num px-3 py-2 text-right">{usd(s.sub)}</td>
                        <td className="num px-3 py-2 text-right">{d.calls || "—"}</td>
                        <td className="py-2 pl-3 text-right">
                          <span className="inline-flex items-center gap-2">
                            <span aria-hidden className="hidden h-1.5 rounded-full bg-[var(--color-accent)] sm:inline-block" style={{ width: `${Math.max(d.total > 0 ? 4 : 0, (d.total / maxDay) * 60)}px` }} />
                            <b className="num">{usd(d.total)}</b>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--color-line)] font-semibold">
                    <th scope="row" className="py-2 pr-3 text-left">Total</th>
                    {agents.map((k) => <td key={k} className="num px-3 py-2 text-right">{usd(agentTotals[k])}</td>)}
                    <td className="num px-3 py-2 text-right">{usd(r4(totals.api))}</td>
                    <td className="num px-3 py-2 text-right">{usd(r4(totals.sub))}</td>
                    <td className="num px-3 py-2 text-right">{calls}</td>
                    <td className="num py-2 pl-3 text-right">{usd(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="card min-w-0 p-5 md:p-6" aria-labelledby="by-model">
            <h2 id="by-model" className="display text-[20px] font-semibold">By model</h2>
            <ul className="mt-3 grid gap-1 text-[14px]">
              {Object.entries(modelTotals).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
                <li key={m} className="flex justify-between gap-3"><span className="truncate">{m}{isSubscriptionModel(m) ? " · subscription" : ""}</span><span className="num">{usd(v)}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-[var(--color-muted)]">The Claude chat watch loop runs inside Claude Code on your plan, so its usage isn&apos;t in this ledger.</p>
          </section>
        </>
      )}
    </>
  );
}
