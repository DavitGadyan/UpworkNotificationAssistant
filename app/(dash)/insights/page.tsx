import { DataTable, FunnelChart, ShareBars, WinRateChart, type FunnelRow } from "@/components/insights/charts";
import { GhostPatterns } from "@/components/insights/GhostPatterns";
import { ManualMetricsForm } from "@/components/insights/ManualMetricsForm";
import { RunButton } from "@/components/insights/RunButton";
import { Bullets, CardHead, Note } from "@/components/ui/bits";
import { CopyButton } from "@/components/ui/CopyButton";
import { PageHead } from "@/components/ui/PageHead";
import { StatGrid } from "@/components/ui/StatGrid";
import { getSettings, latestReport, listFeedback, listProposals, listSnapshots } from "@/lib/db";
import type { Calibration } from "@/lib/feedback/calibrate";
import type { GhostReport } from "@/lib/insights/ghosts";
import type { Icp } from "@/lib/insights/icp";
import type { CoachReport, MonthlyReview, MonthMetrics } from "@/lib/insights/metrics";
import { compactMoney, fmtDateTime, money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

const MANUAL: Record<string, string> = { profileViews: "Views", searchAppearances: "Appearances", invites: "Invites (manual)" };
const IMPACT = { high: 0, medium: 1, low: 2 } as const;
const impactCls = { high: "pill-good", medium: "pill-info", low: "pill-neutral" } as const;

export default async function Insights() {
  const settings = await getSettings();
  // One snapshot per month (newest run wins), oldest → newest.
  const byPeriod = new Map<string, MonthMetrics>();
  for (const s of await listSnapshots(36)) if (!byPeriod.has(s.period)) byPeriod.set(s.period, s.data as unknown as MonthMetrics);
  const months = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  const funnel: FunnelRow[] = months.map((m) => ({ period: m.period, sent: m.proposals?.sent ?? 0, viewed: m.proposals?.viewed ?? 0, offers: m.proposals?.offers ?? 0, hired: m.proposals?.hired ?? 0 }));
  const winRate = months.map((m) => ({ period: m.period, rate: m.proposals?.sent ? (m.proposals.hired / m.proposals.sent) * 100 : null }));
  const latest = months[months.length - 1];

  const fb = await listFeedback("alert", 1000);
  const up = fb.filter((f) => f.rating > 0).length, down = fb.filter((f) => f.rating < 0).length;
  const proposals = await listProposals();
  const submitted = proposals.filter((p) => p.status === "submitted").length;
  const draftFb = await listFeedback("draft", 1000);
  const sims = draftFb.map((f) => Number(f.data?.similarity)).filter((x) => Number.isFinite(x));

  const coach = await latestReport<CoachReport>("coach");
  const review = await latestReport<MonthlyReview>("monthly_review");
  const icp = await latestReport<Icp>("icp");
  const cal = await latestReport<Calibration>("calibration");
  const ghosts = await latestReport<GhostReport>("ghost_patterns");

  return (
    <>
      <PageHead title="Insights" subtitle="How your proposals convert, whether alerts are any good, and what to change on your profile. Reports refresh monthly on their own; run any of them now with its button." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        {/* (a) Funnel */}
        <section className="card min-w-0 p-5 md:p-6" aria-labelledby="fun-h">
          <CardHead id="fun-h" title="Proposal funnel" right={<RunButton action="snapshot" label="Snapshot last month" done="Snapshot saved" />}
            sub="Sent → viewed → offers → hired, per month, from your Upwork proposals." />
          <div className="mt-5">
            {funnel.length ? <FunnelChart rows={funnel} /> : <Note>No monthly snapshots yet. The worker takes one at the start of each month; tap “Snapshot last month” to take the first one now (reads your proposals from Upwork).</Note>}
          </div>
          {winRate.some((w) => w.rate != null) && (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <h3 className="tag mb-3">Win rate (hired ÷ sent)</h3>
              <WinRateChart points={winRate} />
            </div>
          )}
          {latest && (
            <div className="mt-5">
              <StatGrid items={[
                { label: "Invites", value: latest.invites ?? 0 },
                { label: "Boosted", value: latest.proposals?.boosted ?? 0 },
                { label: "Declined", value: latest.proposals?.declined ?? 0 },
                { label: "Earned", value: compactMoney(latest.earnings?.gross ?? 0) },
                { label: "Connects", value: latest.connects?.balance ?? "—" },
                ...Object.entries(latest.manual ?? {}).slice(0, 4).map(([k, v]) => ({ label: MANUAL[k] ?? k.replace(/([A-Z])/g, " $1").toLowerCase(), value: v })),
              ]} />
              <p className="mt-2 text-[13px] text-[var(--color-faint)]">Latest month: {latest.period}</p>
            </div>
          )}
        </section>

        {/* (b) Alert quality */}
        <section className="card min-w-0 p-5 md:p-6" aria-labelledby="aq-h">
          <CardHead id="aq-h" title="Alert quality" sub="Your thumbs on alerts and how many turned into proposals." />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Big label="Thumbs up" value={up} tone="good" />
            <Big label="Thumbs down" value={down} tone="bad" />
            <Big label="Drafts" value={proposals.length} />
            <Big label="Submitted" value={submitted} />
          </div>
          {up + down > 0 && (
            <div className="mt-5">
              <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${Math.round((up / (up + down)) * 100)}% of rated alerts were good`}>
                <span className="h-full rounded-l-full bg-[var(--color-good)]" style={{ width: `${(up / (up + down)) * 100}%` }} />
                <span className="h-full flex-1 rounded-r-full bg-[var(--color-bad)]" />
              </div>
              <p className="mt-2 text-[14px] text-[var(--color-muted)]">{Math.round((up / (up + down)) * 100)}% of rated alerts were good.</p>
            </div>
          )}
          <p className="mt-4 text-[14px] text-[var(--color-muted)]">
            {sims.length ? `Average draft kept as written: ${Math.round((sims.reduce((a, b) => a + b, 0) / sims.length) * 100)}% (${sims.length} approved drafts).` : "Approve a few drafts to see how much you edit them."}
          </p>
          {up + down === 0 && <Note className="mt-4">Rate alerts with the thumbs on Telegram or on a job page. After about 20 ratings, Calibration below can tune the ranking.</Note>}
        </section>
      </div>

      {/* (d) Monthly review */}
      <section className="card mt-4 p-5 md:p-6" aria-labelledby="rv-h">
        <CardHead id="rv-h" title="Monthly review" right={<RunButton action="review" label="Run review" done="Review ready" />}
          sub={review ? `${review.data.period} · built ${fmtDateTime(review.createdAt)}` : "An AI read of last month against the months before, with concrete actions."} />
        {review ? (
          <div className="mt-5 grid gap-5">
            <p className="display text-[22px] font-semibold leading-snug">{review.data.headline}</p>
            <div className="grid gap-5 md:grid-cols-3">
              <div><h3 className="tag mb-2">What changed</h3><Bullets items={review.data.whatChanged} /></div>
              <div><h3 className="tag mb-2">Worked</h3><Bullets items={review.data.whatWorked} tone="good" /></div>
              <div><h3 className="tag mb-2">Didn&apos;t</h3><Bullets items={review.data.whatDidnt} tone="bad" /></div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div><h3 className="tag mb-2">Actions</h3><Bullets items={review.data.actions} tone="warn" /></div>
              {review.data.rankingTweaks?.length > 0 && (
                <div>
                  <h3 className="tag mb-2">Ranking tweaks</h3>
                  <ul className="divide-row">
                    {review.data.rankingTweaks.map((t, i) => (
                      <li key={i} className="py-2.5">
                        <p className="font-medium"><code>{t.setting}</code>: <span className="num">{t.from}</span> → <span className="num">{t.to}</span></p>
                        <p className="text-[14px] text-[var(--color-muted)]">{t.why}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[13px] text-[var(--color-faint)]">Change these yourself in Settings → Ranking rules if you agree.</p>
                </div>
              )}
            </div>
          </div>
        ) : <Note className="mt-4">No review yet. It needs at least one monthly snapshot; run the snapshot first, then the review.</Note>}
      </section>

      {/* (c) Profile coach */}
      <section className="card mt-4 p-5 md:p-6" aria-labelledby="pc-h">
        <CardHead id="pc-h" title="Profile coach"
          right={<div className="flex flex-wrap gap-2"><RunButton action="profile" label="Sync my profile" done="Profile synced" /><RunButton action="coach" label="Run coach" dark done="Coach report ready" /></div>}
          sub={coach ? `Built ${fmtDateTime(coach.createdAt)}` : "Compares your profile with top performers in your categories and suggests specific changes."} />
        {coach ? (
          <div className="mt-5 grid gap-6">
            <p className="display text-[20px] font-semibold leading-snug">{coach.data.headline}</p>
            <div>
              <h3 className="tag mb-3">Recommendations, by impact</h3>
              <ol className="grid gap-3">
                {[...coach.data.recommendations].sort((a, b) => IMPACT[a.impact] - IMPACT[b.impact]).map((r, i) => (
                  <li key={i} className="rounded-[16px] border border-[var(--color-line)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`pill ${impactCls[r.impact]}`}>{r.impact} impact</span>
                      <span className="tag">{r.area.replaceAll("_", " ")}</span>
                    </div>
                    <p className="mt-2 font-medium">{r.change}</p>
                    <p className="mt-1 text-[14px] text-[var(--color-muted)]">{r.why}</p>
                    {r.newText && (
                      <div className="mt-3 rounded-[12px] bg-[var(--color-sunken)] p-3">
                        <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">{r.newText}</p>
                        <CopyButton text={r.newText} label="Copy text" className="mt-3" />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <h3 className="tag mb-3">Peer patterns</h3>
                <ul className="divide-row">
                  {coach.data.peerPatterns.map((p, i) => <li key={i} className="py-2.5"><p className="font-medium">{p.pattern}</p><p className="text-[14px] text-[var(--color-muted)]">{p.evidence}</p></li>)}
                </ul>
              </div>
              {coach.data.experiments?.length > 0 && <div><h3 className="tag mb-3">Experiments to try</h3><Bullets items={coach.data.experiments} /></div>}
            </div>
            {coach.data.peers?.length > 0 && (
              <div className="min-w-0">
                <h3 className="tag mb-2">Peers compared</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[14px]">
                    <thead><tr className="text-[var(--color-muted)]">{["Name", "Title", "Country", "Rate", "Earned", "JSS", ""].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {coach.data.peers.slice(0, 20).map((p, i) => (
                        <tr key={i} className="border-t border-[var(--color-line)]">
                          <td className="py-2 pr-3 font-medium">{String(p.name ?? "—")}</td>
                          <td className="max-w-[260px] truncate py-2 pr-3" title={String(p.title ?? "")}>{String(p.title ?? "—")}</td>
                          <td className="py-2 pr-3">{String(p.country ?? "—")}</td>
                          <td className="num py-2 pr-3">{p.rate != null ? String(p.rate) : "—"}</td>
                          <td className="num py-2 pr-3">{p.earnings != null ? String(p.earnings) : "—"}</td>
                          <td className="num py-2 pr-3">{p.jss != null ? String(p.jss) : "—"}</td>
                          <td className="py-2">{p.boosted ? <span className="pill pill-warn" title="Boosted result: paid placement, excluded from the detailed comparison">Ad</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {coach.data.note && <p className="mt-2 text-[13px] text-[var(--color-faint)]">{coach.data.note}</p>}
              </div>
            )}
          </div>
        ) : <Note className="mt-4">No coach report yet. “Run coach” searches top performers on Upwork (a handful of read calls) and asks the writer model for advice. Takes a few minutes.</Note>}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* (e) ICP */}
        <section className="card min-w-0 p-5 md:p-6" aria-labelledby="icp-h">
          <CardHead id="icp-h" title="Ideal client profile" right={<RunButton action="icp" label="Rebuild" done="Profile rebuilt" />}
            sub={icp ? `Since ${icp.data.windowFrom} · built ${fmtDateTime(icp.createdAt)}` : "Who paid you the most in the last 12 months. Used by the ranking model."} />
          {icp ? (
            <div className="mt-5 grid gap-5">
              <div className="grid grid-cols-3 gap-3">
                <Big label="Earned" value={compactMoney(icp.data.totalGross)} small />
                <Big label="Contracts" value={icp.data.contracts} small />
                <Big label="Avg top" value={compactMoney(icp.data.avgTopContract)} small />
              </div>
              <div>
                <h3 className="tag mb-2">Top contracts</h3>
                <ul className="divide-row">
                  {icp.data.top.slice(0, 8).map((c) => (
                    <li key={c.contractId} className="flex items-start justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.title}</span>
                        <span className="text-[13px] text-[var(--color-muted)]">{[c.client, c.country, c.type].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="num shrink-0 font-semibold">{money(c.gross)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {Object.keys(icp.data.countries ?? {}).length > 0 && (
                <div>
                  <h3 className="tag mb-3">Revenue by country</h3>
                  <ShareBars items={Object.entries(icp.data.countries).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} format={compactMoney} />
                </div>
              )}
              {icp.data.notes?.length > 0 && <Bullets items={icp.data.notes} />}
            </div>
          ) : <Note className="mt-4">Not built yet. “Rebuild” reads 12 months of your Upwork transactions (read-only) and keeps the most valuable contracts.</Note>}
        </section>

        {/* (f) Calibration */}
        <section className="card min-w-0 p-5 md:p-6" aria-labelledby="cal-h">
          <CardHead id="cal-h" title="Calibration"
            right={<RunButton action="calibrate" label="Recalculate" done="Recalculated" />}
            sub={cal ? `${cal.data.samples} rated alerts (${cal.data.positives} good) · built ${fmtDateTime(cal.createdAt)}` : "Learns from your thumbs which signals predict a good alert."} />
          {cal ? (
            <div className="mt-5 grid gap-5">
              <Note tone={cal.data.ok ? "good" : "warn"}>{cal.data.message}</Note>
              {cal.data.proposed && (
                <div className="rounded-[16px] border border-[var(--color-line)] p-4">
                  <h3 className="tag mb-3">Proposed</h3>
                  <dl className="grid grid-cols-2 gap-3 text-[14px]">
                    <div><dt className="text-[var(--color-muted)]">Weights (rules / AI)</dt><dd className="num font-semibold">{settings.rules.weights.rules} / {settings.rules.weights.llm} → {cal.data.proposed.weights.rules} / {cal.data.proposed.weights.llm}</dd></div>
                    <div><dt className="text-[var(--color-muted)]">Alert threshold</dt><dd className="num font-semibold">{settings.telegramMin} → {cal.data.proposed.telegramMin}</dd></div>
                    {cal.data.accuracy != null && <div><dt className="text-[var(--color-muted)]">Fit accuracy</dt><dd className="num font-semibold">{Math.round(cal.data.accuracy * 100)}%</dd></div>}
                  </dl>
                  <div className="mt-4"><RunButton action="apply-calibration" label="Apply weights & threshold" dark confirmText="Apply the proposed weights and alert threshold to Settings?" done="Applied to Settings" /></div>
                </div>
              )}
              {Object.keys(cal.data.coefficients ?? {}).length > 0 && (
                <details>
                  <summary className="cursor-pointer text-[14px] font-medium text-[var(--color-muted)]">Coefficients ({Object.keys(cal.data.coefficients).length})</summary>
                  <DataTable head={["Signal", "Weight"]} rows={Object.entries(cal.data.coefficients).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => [k, v.toFixed(3)])} />
                </details>
              )}
            </div>
          ) : <Note className="mt-4">Not calculated yet. It needs about 20 rated alerts; until then it explains how many more are needed.</Note>}
        </section>
      </div>

      {/* (f2) Ghost patterns */}
      <GhostPatterns report={ghosts} />

      {/* (g) Manual metrics */}
      <section className="card mt-4 p-5 md:p-6" aria-labelledby="mm-h">
        <CardHead id="mm-h" title="Numbers from Upwork stats" sub="Profile views and search appearances aren't available through the connector. Copy them from Upwork's “My stats” page once a month." />
        <div className="mt-5"><ManualMetricsForm /></div>
      </section>
    </>
  );
}

function Big({ label, value, tone, small = false }: { label: string; value: React.ReactNode; tone?: "good" | "bad"; small?: boolean }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-[var(--color-sunken)] p-3">
      <p className="truncate text-[13px] text-[var(--color-muted)]">{label}</p>
      <p className={`display num mt-0.5 truncate font-bold leading-tight ${small ? "text-[20px]" : "text-[28px]"}`} style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</p>
    </div>
  );
}
