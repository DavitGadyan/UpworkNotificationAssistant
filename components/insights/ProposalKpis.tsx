import Link from "next/link";
import { fmtDate, timeAgo, jobUrl } from "@/lib/format";
import { kpiHistory, proposalKpis, type KpiWindow } from "@/lib/learning/kpis";

/** 24-hour proposal KPIs: sent, viewed (conversion), replied, offers - last 24 h vs the 24 h before (re-read). */
export async function ProposalKpis({ history = false }: { history?: boolean }) {
  const k = await proposalKpis().catch(() => null);
  if (!k) return null;
  const hist = history ? await kpiHistory(14) : [];
  return (
    <section className="card mb-6 p-5 md:p-6" aria-labelledby="kpi-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="kpi-h" className="display text-[20px] font-semibold">Proposals · last 24 h</h2>
        <Link href="/insights" className="text-[14px] text-[var(--color-muted)] hover:underline">Nightly review →</Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Job alerts sent" value={k.alerts?.total ?? "-"} sub={k.alerts ? `${k.alerts.app} app · ${k.alerts.watch} watch loop` : undefined} />
        <Kpi label="Proposals sent" value={k.last24.sent} sub={delta(k.last24.sent, k.prev24.sent)} />
        <Kpi label="Viewed" value={k.last24.viewed} sub={k.last24.viewRate != null ? `${k.last24.viewRate}% view rate` : "-"} tone="good" />
        <Kpi label="Replied" value={k.last24.replied} sub={k.last24.replyRate != null ? `${k.last24.replyRate}% reply rate` : "-"} />
        <Kpi label="Offers / hired" value={`${k.last24.offers} / ${k.last24.hired}`} />
        <Kpi label="7-day view rate" value={k.last7d.viewRate != null ? `${k.last7d.viewRate}%` : "-"} sub={`${k.last7d.viewed} of ${k.last7d.sent} · ${k.last7d.ghosts} ghost jobs`} />
      </div>
      <p className="mt-3 text-[13px] text-[var(--color-muted)]">
        Previous 24 h (re-read, views that came later count): {line(k.prev24)}
      </p>
      {k.recentViews.length > 0 && (
        <ul className="mt-3 space-y-1 text-[14px]">
          {k.recentViews.slice(0, 5).map((v) => (
            <li key={v.id}>👀 <a className="hover:underline" href={jobUrl(`~02${v.jobId}`)} target="_blank" rel="noreferrer">{v.title}</a> <span className="text-[var(--color-muted)]">viewed {timeAgo(new Date(v.at).toISOString())}</span></li>
          ))}
        </ul>
      )}
      {hist.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[14px]">
            <thead><tr className="text-[var(--color-muted)]"><th className="py-1.5 pr-3 font-medium">Night of</th><th className="py-1.5 pr-3 font-medium">Alerts</th><th className="py-1.5 pr-3 font-medium">Sent</th><th className="py-1.5 pr-3 font-medium">Viewed</th><th className="py-1.5 pr-3 font-medium">Replied</th><th className="py-1.5 font-medium">Offers</th></tr></thead>
            <tbody>
              {hist.map((h) => (
                <tr key={h.at} className="num border-t border-[var(--color-line)]">
                  <td className="py-1.5 pr-3">{fmtDate(h.at)}</td><td className="py-1.5 pr-3">{h.alerts?.total ?? "-"}</td><td className="py-1.5 pr-3">{h.last24.sent}</td>
                  <td className="py-1.5 pr-3">{h.last24.viewed}{h.last24.viewRate != null ? ` (${h.last24.viewRate}%)` : ""}</td>
                  <td className="py-1.5 pr-3">{h.last24.replied}</td><td className="py-1.5">{h.last24.offers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const line = (w: KpiWindow) => `${w.sent} sent · ${w.viewed} viewed${w.viewRate != null ? ` (${w.viewRate}%)` : ""} · ${w.replied} replied · ${w.offers} offers · ${w.ghosts} ghost jobs`;
const delta = (a: number, b: number) => (a === b ? "same as previous 24 h" : `${a > b ? "+" : ""}${a - b} vs previous 24 h`);

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "good" }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-[var(--color-sunken)] p-3">
      <p className="truncate text-[13px] text-[var(--color-muted)]">{label}</p>
      <p className="display num mt-0.5 truncate text-[26px] font-bold leading-tight" style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</p>
      {sub && <p className="truncate text-[12px] text-[var(--color-muted)]">{sub}</p>}
    </div>
  );
}
