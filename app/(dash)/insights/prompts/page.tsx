import Link from "next/link";
import { DataTable, TrendChart } from "@/components/insights/charts";
import { LabControls, PinButton } from "@/components/insights/LabControls";
import { FunnelTiles, tabOf, VERDICT, VersionTable } from "@/components/insights/promptAnalytics";
import { RunButton } from "@/components/insights/RunButton";
import { CardHead, Note } from "@/components/ui/bits";
import { PageHead } from "@/components/ui/PageHead";
import { listPromptStats } from "@/lib/db";
import { armLabel, labBoard } from "@/lib/learning/promptLab";

export const dynamic = "force-dynamic";

/** Prompt analytics: reply / offer / hire rates per prompt version, writer and ranker kept apart. */
export default async function PromptsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const prompt = tabOf((await searchParams).p);
  const b = await labBoard(prompt);
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const stats = await listPromptStats({ prompt, sinceDay: since });
  const versions = [...new Set(stats.map((r) => r.version))].slice(0, 5);
  const series = (k: "replied" | "hires" | "viewed") => versions.map((v) => ({
    label: armLabel(v, prompt),
    points: stats.filter((r) => r.version === v).map((r) => ({ day: r.day, value: r.sent ? Math.round((r[k] / r.sent) * 100) : null })),
  }));
  const writer = prompt === "proposal";
  const tab = (p: "writer" | "ranker", label: string) => (
    <Link href={`/insights/prompts?p=${p}`} aria-current={(p === "writer") === writer ? "page" : undefined}
      className={`btn btn-sm ${(p === "writer") === writer ? "btn-dark" : ""}`}>{label}</Link>
  );

  return (
    <>
      <PageHead title="Prompt analytics"
        subtitle="Which prompt version gets clients to view, reply, offer and hire. Read back from Upwork 8 times a day (read-only, inside the call limits). The writer and the ranker are measured and tuned separately."
        actions={<div className="flex flex-wrap gap-2">{tab("writer", "Proposal writer")}{tab("ranker", "Job ranker")}<RunButton action="lab-refresh" label="Recalculate" done="Updated" /></div>} />

      <section className="card mt-4 p-5 md:p-6" aria-labelledby="f-h">
        <CardHead id="f-h" title="All proposals" sub={writer ? "Every proposal you sent, app-drafted or written by hand." : "Every proposal you sent, grouped by the ranker version that judged the job."} />
        <div className="mt-4"><FunnelTiles f={b.funnel} /></div>
      </section>

      <section className="card mt-4 p-5 md:p-6" aria-labelledby="v-h">
        <CardHead id="v-h" title={writer ? "Writer versions" : "Ranker versions"}
          sub={writer ? "Replies are the reward; viewed-no-reply and never-viewed are both misses. Proposals written by hand on Upwork are the baseline." : "Did the jobs each ranker version picked get viewed, replies and hires? Jobs the AI never ranked are the baseline."} />
        {!b.decided ? <Note className="mt-4">No proposals with a result yet.</Note> : <VersionTable b={b.overall} prompt={prompt} />}
        <p className="mt-2 text-[13px] text-[var(--color-muted)]">&ldquo;Expected reply&rdquo; pulls small samples toward each version&apos;s overall rate; &ldquo;Chance best&rdquo; compares only the app&apos;s versions.</p>
        {writer && <LabControls config={b.config} versions={b.versions} />}
      </section>

      <section className="card mt-4 p-5 md:p-6" aria-labelledby="t-h">
        <CardHead id="t-h" title="Trend" sub="Daily snapshot, cumulative over the proposals each version has a result for." />
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div><h3 className="tag mb-2">Reply rate</h3><TrendChart title="Reply rate per version" series={series("replied")} /></div>
          <div><h3 className="tag mb-2">Hire rate</h3><TrendChart title="Hire rate per version" series={series("hires")} /></div>
        </div>
      </section>

      {!writer && b.byRank && b.byRank.length > 0 && (
        <section className="card mt-4 p-5 md:p-6" aria-labelledby="r-h">
          <CardHead id="r-h" title="By the rank the job had" sub="If high-ranked jobs don't reply more often than low-ranked ones, the ranker needs a lesson." />
          <DataTable head={["Rank", "Sent", "Viewed", "Replied", "Hired"]} rows={b.byRank.map((r) => {
            const t = r.arms.reduce((s, a) => ({ n: s.n + a.n, v: s.v + a.viewed, w: s.w + a.wins, h: s.h + a.hires }), { n: 0, v: 0, w: 0, h: 0 });
            return [r.label, t.n, `${Math.round((t.v / t.n) * 100)}%`, `${t.w} (${Math.round((t.w / t.n) * 100)}%)`, `${t.h}`];
          })} />
        </section>
      )}

      <section className="card mt-4 p-5 md:p-6" aria-labelledby="s-h">
        <CardHead id="s-h" title="Best version per scenario" sub="Scenario = your field × client type (new < $1k spent, proven, big spender $20k+)." />
        <div className="mt-3 grid gap-3">
          {b.byScenario.map((s) => (
            <details key={s.key} className="rounded-[14px] border border-[var(--color-line)] p-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="font-medium">{s.label}</span>
                <span className="text-[13px] text-[var(--color-muted)]">{s.n} decided</span>
                <span className={`pill ${VERDICT[s.verdict].cls}`}>{VERDICT[s.verdict].label}{s.best != null ? `: ${armLabel(s.best, prompt)}` : ""}</span>
                {s.pinned != null && <span className="pill pill-good">Using {armLabel(s.pinned, prompt)}</span>}
              </summary>
              <VersionTable b={s} prompt={prompt} />
              {writer && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.best != null && s.best !== s.pinned && <PinButton scenario={s.key} version={s.best} label={`Use ${armLabel(s.best)} for this scenario`} />}
                  {s.pinned != null && <PinButton scenario={s.key} version={null} label="Stop pinning" />}
                </div>
              )}
            </details>
          ))}
          {!b.byScenario.length && <Note>No scenarios yet.</Note>}
        </div>
      </section>
    </>
  );
}
