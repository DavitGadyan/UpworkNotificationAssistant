import Link from "next/link";
import { AlertsToggle, DemoButton } from "@/components/AlertsToggle";
import { IconAlert, IconChart, IconDoc, IconEye, IconGlobe, IconLink, IconPin } from "@/components/icons";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { PageHead } from "@/components/ui/PageHead";
import { ClaudeFetchButton } from "@/components/ClaudeFetchButton";
import { UsageCard } from "@/components/UsageCard";
import { Sparkline } from "@/components/ui/Sparkline";
import { StatGrid } from "@/components/ui/StatGrid";
import { LlmSpend } from "@/components/LlmSpend";
import { config } from "@/lib/config";
import { dailyRequests, getSettings, getTokens, getWorkerHeartbeat, latestReport, listJobs, listProposals, listSearches, listWatches } from "@/lib/db";
import { healthReport } from "@/lib/health";
import type { MonthlyReview } from "@/lib/insights/metrics";
import { breakerState, mcpCallsToday } from "@/lib/upwork/guard";
import { mcpAccount, mcpConnected } from "@/lib/upwork/mcp/client";
import { timeAgo } from "@/lib/format";
import { today } from "@/lib/ratelimit";
import { searchStats } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

type SP = Promise<{ search?: string; country?: string; state?: string }>;

export default async function Overview({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const settings = await getSettings();
  const searches = await listSearches();
  const jobs = await listJobs({ offProfile: "hide" }); // jobs outside his fields don't count as found or matched
  const tokens = await getTokens();
  const hb = await getWorkerHeartbeat();
  const countries = [...new Set(jobs.map((j) => j.client.country).filter(Boolean) as string[])].sort();

  const cards = searches
    .filter((s) => !sp.search || String(s.id) === sp.search)
    .filter((s) => !sp.state || (sp.state === "active" ? s.enabled : !s.enabled))
    .map((s) => ({ s, st: searchStats(s, sp.country ? jobs.filter((j) => j.client.country === sp.country) : jobs, settings) }));

  const mcp = await (async () => {
    try { return { connected: await mcpConnected(), account: await mcpAccount(), calls: await mcpCallsToday(), breakerOpen: (await breakerState()).openUntil > Date.now() }; }
    catch { return { connected: false, account: null, calls: 0, breakerOpen: false }; }
  })();
  const watching = (await listWatches()).filter((w) => !w.done).length;
  const props = await listProposals();
  const needLoom = props.filter((p) => p.status === "needs_loom" || p.status === "draft").length;
  const toApprove = props.filter((p) => p.status === "ready" || p.status === "approved" || p.status === "previewed").length;
  const review = await latestReport<MonthlyReview>("monthly_review");
  const health = await (async () => { try { return await healthReport(); } catch { return null; } })();

  const workerOk = hb && Date.now() - hb.at < Math.max(settings.pollIntervalSec * 2.5, 300) * 1000;

  return (
    <>
      <PageHead
        title="Overview"
        subtitle="Every feed in one place: how many new jobs it found, how many matched, and how many reached you."
        actions={<>{config.demoMode && <DemoButton />}<ClaudeFetchButton /><AlertsToggle paused={settings.alertsPaused} /></>}
        meta={
          <>
            <Status ok={mcp.connected || !!tokens} label={mcp.connected ? `Upwork connected (MCP)${mcp.account?.name ? ` · ${mcp.account.name}` : ""}` : tokens ? `Upwork connected (API key)${tokens.account ? ` · ${tokens.account}` : ""}` : config.demoMode ? "Demo mode · Upwork not connected" : "Upwork not connected"} href="/settings" />
            <Status ok={!!workerOk} label={hb ? `Worker ${workerOk ? "running" : "stalled"} · last run ${timeAgo(new Date(hb.at).toISOString())}` : "Worker not started"} />
            <span>AI spend: <LlmSpend budget={(settings.llm as { dailyBudgetUsd?: number }).dailyBudgetUsd ?? null} fallback={settings.llm.enabled ? "on" : "off"} /></span>
            <span className="num">API requests today: {(await dailyRequests(today())).toLocaleString()} / {config.limits.perDay.toLocaleString()}</span>
            {hb?.lastError && <span className="text-[var(--color-bad)]">{hb.lastError}</span>}
          </>
        }
      />

      {health?.aiRanking.paused && (
        <div role="status" className="card mb-6 border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-4 text-[15px]">
          <b>AI ranking paused</b>{health.aiRanking.since ? ` since ${timeAgo(health.aiRanking.since)}` : ""} - {health.aiRanking.reason}. New jobs wait as
          “Waiting for AI check” and nothing is alerted on rules alone. It resumes at 00:00 UTC, or raise the budget in <a href="/settings" className="underline">Settings → AI models</a>.
        </div>
      )}
      {health && <PollingHealth h={health} />}

      <UsageCard />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile href="/settings" icon={<IconLink size={18} />} label="Upwork"
          value={mcp.connected ? <span className="num">{mcp.calls.toLocaleString()}<span className="text-[14px] font-medium text-[var(--color-muted)]"> / {settings.guard.dailyCallCap.toLocaleString()}</span></span> : "Off"}
          sub={mcp.breakerOpen ? <span className="text-[var(--color-bad)]">Paused by breaker</span> : mcp.connected ? `calls today${mcp.account?.name ? ` · ${mcp.account.name}` : ""}` : "Not connected · tap to connect"}
          tone={mcp.breakerOpen ? "bad" : mcp.connected ? "good" : "warn"} />
        <Tile href="/watchlist" icon={<IconEye size={18} />} label="Watching" value={<span className="num">{watching}</span>} sub={watching === 1 ? "job's competition" : "jobs' competition"} />
        <Tile href="/proposals" icon={<IconDoc size={18} />} label="Drafts" value={<span className="num">{needLoom + toApprove}</span>}
          sub={needLoom + toApprove ? `${needLoom} need Loom · ${toApprove} to approve/send` : "Nothing waiting"} tone={needLoom + toApprove ? "info" : undefined} />
        <Tile href="/insights" icon={<IconChart size={18} />} label="Monthly review"
          value={null} sub={review ? <><span className="line-clamp-3 text-[var(--color-ink)]">{review.data.headline}</span><span className="mt-1 block">{review.data.period}</span></> : "No review yet"} />
      </div>

      <div className="mb-6 flex flex-col gap-3 md:flex-row">
        <FilterSelect param="search" label="Feed" icon={<IconGlobe size={20} />} options={searches.map((s) => ({ value: String(s.id), label: s.name }))} />
        <FilterSelect param="country" label="Location" icon={<IconPin size={20} />} options={countries.map((c) => ({ value: c, label: c }))} />
        <FilterSelect param="state" label="Status" icon={<IconAlert size={20} />} options={[{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }]} />
      </div>

      {cards.length === 0 ? (
        <div className="card grid place-items-center gap-3 px-6 py-16 text-center">
          <h2 className="display text-[22px] font-semibold">{searches.length ? "No feeds match these filters" : "No feeds yet"}</h2>
          <p className="max-w-md text-[var(--color-muted)]">A feed is an Upwork view (Most Recent, Best Matches or a search). Every few minutes the assistant runs it, ranks what comes back and alerts you about the best jobs.</p>
          <Link href="/feeds?new=1" className="btn btn-dark mt-2">Create a feed</Link>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map(({ s, st }) => {
            const tone = st.matchRate >= 40 ? "good" : st.matchRate >= 15 ? "warn" : "bad";
            return (
              <Link key={s.id} href={`/jobs?search=${s.id}`} className="card card-link block p-5 md:p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className={`pill ${s.enabled ? "pill-good" : "pill-bad"}`}>{s.enabled ? "Active" : "Paused"}</span>
                  {st.topCountry && <span className="flex items-center gap-2 text-[14px]"><IconPin size={15} className="text-[var(--color-muted)]" />{st.topCountry}</span>}
                </div>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="display line-clamp-2 text-[22px] font-semibold">{s.name}</h2>
                    <p className="mt-1 text-[var(--color-muted)]">{st.lastAt ? `Updated ${timeAgo(st.lastAt)}` : "No jobs in the last 24h"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="display num text-[34px] font-bold leading-none" style={{ color: `var(--color-${tone})` }} title="Share of jobs scoring at or above your Telegram threshold">{st.matchRate}%</span>
                    <Sparkline values={st.series} tone={tone} width={132} height={34} className="mt-1 block w-[96px] sm:w-[132px]" />
                  </div>
                </div>
                <div className="mt-4">
                  <StatGrid items={[
                    { label: "New", value: st.total }, { label: "Notified", value: st.notified }, { label: "Called", value: st.called },
                    { label: "Avg", value: st.avg }, { label: "Top", value: st.top }, { label: "Dismissed", value: st.dismissed },
                  ]} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Status({ ok, label, href }: { ok: boolean; label: string; href?: string }) {
  const inner = (<><span className={`size-2 rounded-full ${ok ? "bg-[var(--color-good)]" : "bg-[var(--color-warn)]"}`} />{label}</>);
  return href ? <Link href={href} className="inline-flex items-center gap-2 hover:text-[var(--color-ink)]">{inner}</Link> : <span className="inline-flex items-center gap-2">{inner}</span>;
}

function Tile({ href, icon, label, value, sub, tone }: { href: string; icon: React.ReactNode; label: string; value: React.ReactNode; sub: React.ReactNode; tone?: "good" | "warn" | "bad" | "info" }) {
  return (
    <Link href={href} className="card card-link flex min-w-0 flex-col gap-2 p-4">
      <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-muted)]">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--color-control)] text-[var(--color-ink)]">{icon}</span>
        <span className="truncate">{label}</span>
        {tone && <span className="ml-auto size-2 shrink-0 rounded-full" style={{ background: `var(--color-${tone})` }} />}
      </span>
      {value != null && <span className="display truncate text-[26px] font-bold leading-none">{value}</span>}
      <span className="text-[13px] leading-snug text-[var(--color-muted)]">{sub}</span>
    </Link>
  );
}

const KIND: Record<string, string> = { most_recent: "Most Recent", best_match: "Best Matches", search: "Search" };

function PollingHealth({ h }: { h: Awaited<ReturnType<typeof healthReport>> }) {
  return (
    <section className="card mb-4 p-5 md:p-6" aria-labelledby="ph-h">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="ph-h" className="display text-[20px] font-semibold">Polling health</h2>
          <span className={`pill ${h.ok ? "pill-good" : "pill-bad"}`}>
            <span className="size-2 rounded-full" style={{ background: h.ok ? "var(--color-good)" : "var(--color-bad)" }} />
            {h.ok ? "On target" : "Needs attention"}
          </span>
        </div>
        <span className={`text-[14px] ${h.workerStale ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"}`}>
          Worker {h.workerHeartbeat ? `seen ${timeAgo(h.workerHeartbeat)}` : "never seen"}{h.workerStale ? " · stale" : ""}
        </span>
      </div>
      <p className="mt-1 text-[14px] text-[var(--color-muted)]">Goal: {h.goal}.</p>
      {h.feeds.length === 0 ? (
        <p className="mt-4 text-[14px] text-[var(--color-muted)]">No enabled feeds. Add one on the Feeds page.</p>
      ) : (
        <ul className="mt-4 divide-row">
          {h.feeds.map((f) => (
            <li key={f.feedId} className={`grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 ${f.late ? "-mx-3 rounded-[12px] bg-[var(--color-bad-soft)] px-3" : ""}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="tag">{KIND[f.kind] ?? f.kind}</span>
                  {f.late && <span className="pill pill-bad">Late</span>}
                </p>
                {f.lastError && f.failures > 0 && <p className="mt-0.5 line-clamp-2 break-words text-[13px] text-[var(--color-bad)]">{f.lastError}</p>}
              </div>
              <p className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] sm:justify-end ${f.late ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"}`}>
                <span>Last OK: {f.lastOkAt ? timeAgo(f.lastOkAt) : "never"}</span>
                <span className="num">{f.runs24h ? `24h: ${f.successRate24h ?? 0}% of ${f.runs24h} runs` : "No runs in 24h"}</span>
                {f.failures > 0 && <span className="num font-semibold text-[var(--color-bad)]">{f.failures} failing in a row</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
