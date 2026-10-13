import Link from "next/link";
import { PageHead } from "@/components/ui/PageHead";
import { getSettings, listJobs } from "@/lib/db";
import { STRONG_FIT } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "How ranking works" };

/** Plain-language explanation of the ranking pipeline with the live thresholds and a worked example. */
export default async function Ranking() {
  const s = await getSettings();
  const r = s.rules;
  const example = (await listJobs({ status: "all" })).filter((j) => j.score.llm && j.score.rules && !j.score.excluded).sort((a, b) => b.score.total - a.score.total)[0];
  const red = example?.score.rules?.flags.filter((f) => f.severity === "red").length ?? 0;

  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <section className="card p-5 md:p-6">
      <h2 className="display text-[19px] font-semibold"><span className="mr-2 text-[var(--color-muted)]">{n}.</span>{title}</h2>
      <div className="mt-3 grid gap-2 text-[15px] leading-relaxed">{children}</div>
    </section>
  );

  return (
    <>
      <PageHead title="How ranking works" subtitle={`Every ${Math.round(s.pollIntervalSec / 60)} minutes the worker reads your feeds through the official Upwork MCP connector and runs each new job through these steps.`} />
      <div className="grid gap-4">
        <Step n={1} title="Hard rejects (your rules → rank 0, never alerted)">
          <p>Client country in <b>{r.excludedCountries.filter((c) => c.length > 3).join(", ")}</b>; more than <b>{r.maxProposals}</b> proposals; already applied; job closed or already hired; the feed&apos;s own exclude filters.</p>
        </Step>
        <Step n={2} title="Client record first">
          <p>The client&apos;s hire rate, spend, hours, open jobs, recent contracts and reviews are loaded before anything is judged. If Upwork won&apos;t return them, the job waits as <b>Checking client…</b> and is retried; it is never alerted on feed data alone.</p>
          <p className="text-[var(--color-muted)]">Upwork doesn&apos;t expose per-contract rates, so average paid ≈ total spent ÷ total hours (an upper estimate).</p>
        </Step>
        <Step n={3} title="Rule score (0–100)">
          <p><code>fit by category + client quality + money + competition − flag penalties</code></p>
          <ul className="list-disc pl-5">
            <li>Money: hourly max vs your <b>${r.minHourly}/hr</b>; no rate → client average paid vs <b>${r.minClientAvgPaid}/hr</b>; fixed budget on a log scale.</li>
            <li>AI/SaaS clients need ≥ <b>{r.ai.minHireRate}%</b> hire rate and ≥ <b>${r.ai.minAvgPaid}/hr</b> average paid; DevOps/MLOps ≥ <b>{r.devops.minHireRate}%</b>; other work flags below 50% / 30%.</li>
            <li>Red flags: unverified payment, cheap-labour history (≤ ${r.lowRateMax}/hr), mostly small jobs (≤ ${r.smallJobAvg}), ignored client ({r.ignoredOpenJobs}+ open jobs, no activity), crowded ({r.watchWarnAt}+ proposals).</li>
          </ul>
        </Step>
        <Step n={4} title={`AI judgement (${s.llm.rankingModel})`}>
          <p><b>Fit</b> = how closely the work matches what you have delivered (budget ignored). <b>Value</b> = how likely the client pays a senior professional for the whole solution. Plus summary, final product, big fish and red flags.</p>
        </Step>
        <Step n={5} title="Final rank">
          <p><code>{r.weights.rules} × rule score + {r.weights.llm} × (0.7 × AI fit + 0.3 × AI value) − 5 × red flags</code></p>
          {example && (
            <p className="rounded-[12px] bg-[var(--color-sunken)] p-3 text-[14px]">
              Example: <Link className="underline" href={`/jobs/${encodeURIComponent(example.id)}`}>{example.title}</Link> → {r.weights.rules} × {example.score.rules!.score} + {r.weights.llm} × (0.7 × {example.score.llm!.fit} + 0.3 × {example.score.llm!.valuePotential}) − 5 × {red} = <b>{example.score.total}</b>
            </p>
          )}
        </Step>
        <Step n={6} title="What happens next">
          <ul className="list-disc pl-5">
            <li>Rank ≥ <b>{s.telegramMin}</b>: Telegram + phone alert and a proposal-count watch (warn at {r.watchWarnAt}, skip past {r.maxProposals}).</li>
            <li>Strong-fit lane: AI fit ≥ {STRONG_FIT} with no red flags alerts even below {s.telegramMin}.</li>
            <li>Auto-draft: rank ≥ <b>{s.autoDraft.minRank}</b>, up to {s.autoDraft.dailyCap}/day. Never submitted automatically.</li>
          </ul>
        </Step>
        <Step n={7} title="Hire likelihood / ghost risk (advisory, rules untouched)">
          <p>A separate verdict on whether the client will hire anyone at all. High risk → the alert says <b>🚫 Likely not hiring — skip</b> and no auto-draft is written; you can still apply by hand.</p>
          <ul className="list-disc pl-5">
            <li><b>Posts but never hires</b>: $0 spent, 2+ posts, no hires.</li>
            <li><b>No payment attached</b>: unverified payment and no hiring history.</li>
            <li><b>Collects free plans/quotes</b>: &ldquo;quote your true price&rdquo;, &ldquo;nonbinding budget&rdquo;, &ldquo;no hire authorized&rdquo;, architecture or rate-card requests, huge spec for a tiny budget.</li>
            <li><b>Mass poster</b>: hundreds of posts with a low hire rate, or 10+ open jobs.</li>
            <li><b>Front/identity request</b>: &ldquo;US-only&rdquo; or &ldquo;represent us in meetings&rdquo; from a non-US $0-spend account.</li>
            <li><b>Harvests personal data</b>, <b>no client activity</b>, and <b>closed past jobs without hiring</b> (learned by re-checking jobs ~2 and ~7 days later).</li>
          </ul>
          <p className="text-[var(--color-muted)]">See Insights → Ghost patterns for how often each pattern actually hired and suggested rule changes (never applied automatically).</p>
        </Step>
      </div>
    </>
  );
}
