import Link from "next/link";
import { TrendChart } from "@/components/insights/charts";
import { PinButton } from "@/components/insights/LabControls";
import { tabOf, tabParam, VersionTable } from "@/components/insights/promptAnalytics";
import { CardHead, Note } from "@/components/ui/bits";
import { PageHead } from "@/components/ui/PageHead";
import { OUTCOME_LABEL } from "@/lib/learning/labels";
import { getPromptVersion, listPromptStats } from "@/lib/db";
import { fmtDate, jobUrl } from "@/lib/format";
import { DEFAULT_PROMPTS } from "@/lib/agents/prompts";
import { armLabel, BUILT_IN, HAND, labBoard, type Board } from "@/lib/learning/promptLab";

export const dynamic = "force-dynamic";

/** One prompt version: its funnel against the others, per scenario, its trend and every proposal it wrote. */
export default async function VersionPage({ params, searchParams }: { params: Promise<{ version: string }>; searchParams: Promise<{ p?: string }> }) {
  const arm = Number((await params).version);
  const prompt = tabOf((await searchParams).p);
  const b = await labBoard(prompt);
  const info = b.versions.find((v) => v.id === arm);
  const body = arm === BUILT_IN ? DEFAULT_PROMPTS[prompt] : arm === HAND ? null : (await getPromptVersion(arm))?.body ?? null;
  const me = b.overall.arms.find((a) => a.arm === arm);
  const rows = b.proposals[String(arm)] ?? [];
  const stats = (await listPromptStats({ prompt, version: arm })).map((r) => ({ day: r.day, value: r.sent ? Math.round((r.replied / r.sent) * 100) : null }));
  const scenarios: Board[] = b.byScenario.filter((s) => s.arms.some((a) => a.arm === arm));
  const label = armLabel(arm, prompt);

  return (
    <>
      <PageHead title={label}
        subtitle={info ? `${info.note ?? ""}${info.createdAt ? ` · saved ${fmtDate(info.createdAt)}` : ""}${info.active ? " · active now" : ""}${b.config.arms.includes(arm) && prompt === "proposal" ? " · in the A/B test" : ""}` : arm === HAND ? "Proposals you wrote yourself on Upwork - the baseline." : undefined}
        actions={<Link className="btn btn-sm" href={`/insights/prompts?p=${tabParam(prompt)}`}>← All versions</Link>} />

      <section className="card mt-4 p-5 md:p-6" aria-labelledby="c-h">
        <CardHead id="c-h" title="Compared with the other versions" sub={me ? `${me.n} proposals with a result: ${me.replyRate}% replied, ${me.hireRate}% hired.` : "No proposals with a result yet."} />
        {b.decided > 0 && <VersionTable b={b.overall} prompt={prompt} />}
      </section>

      <section className="card mt-4 p-5 md:p-6" aria-labelledby="t-h">
        <CardHead id="t-h" title="Reply rate over time" />
        <div className="mt-3"><TrendChart title={`${label} reply rate`} series={[{ label, points: stats }]} /></div>
      </section>

      {scenarios.length > 0 && (
        <section className="card mt-4 p-5 md:p-6" aria-labelledby="s-h">
          <CardHead id="s-h" title="Per scenario" />
          <div className="mt-3 grid gap-4">
            {scenarios.map((s) => (
              <div key={s.key}>
                <h3 className="text-[15px] font-medium">{s.label} <span className="text-[13px] font-normal text-[var(--color-muted)]">· {s.n} decided</span></h3>
                <VersionTable b={s} prompt={prompt} />
                {prompt === "proposal" && arm !== HAND && s.pinned !== arm && <div className="mt-2"><PinButton scenario={s.key} version={arm} label={`Use ${label} for ${s.label}`} /></div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card mt-4 p-5 md:p-6" aria-labelledby="p-h">
        <CardHead id="p-h" title={`Proposals (${rows.length})`} sub={prompt === "proposal" ? "“Text kept” = how much of the AI draft you kept before sending." : "The rank this version gave each job you applied to."} />
        {!rows.length ? <Note className="mt-3">None yet.</Note> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead><tr className="text-[var(--color-muted)]"><th className="py-1.5 pr-3 font-medium">Sent</th><th className="py-1.5 pr-3 font-medium">Job</th><th className="py-1.5 pr-3 font-medium">Result</th><th className="py-1.5 pr-3 font-medium">{prompt === "proposal" ? "Text kept" : "Rank"}</th><th className="py-1.5 font-medium">Draft</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.upworkProposalId} className="border-t border-[var(--color-line)] align-top">
                    <td className="num whitespace-nowrap py-2 pr-3 text-[var(--color-muted)]">{fmtDate(r.submittedAt)}</td>
                    <td className="py-2 pr-3"><a className="font-medium hover:underline" href={jobUrl(`~02${r.jobId}`)} target="_blank" rel="noreferrer">{r.jobTitle}</a><span className="block text-[12px] text-[var(--color-muted)]">{r.scenario}</span></td>
                    <td className="py-2 pr-3"><span className={`pill ${OUTCOME_LABEL[r.outcome].cls}`}>{r.status === "Hired" ? "Hired" : r.status === "Offered" ? "Offer" : OUTCOME_LABEL[r.outcome].label}</span></td>
                    <td className="num py-2 pr-3">{prompt === "proposal" ? (r.kept == null ? "-" : `${r.kept}%`) : r.rank ?? "-"}</td>
                    <td className="py-2">{r.localProposalId != null ? <Link className="underline" href={`/proposals/${r.localProposalId}`}>open</Link> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {body && (
        <section className="card mt-4 p-5 md:p-6">
          <details><summary className="cursor-pointer font-medium">The prompt text</summary>
            <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-[12px] bg-[var(--color-sunken)] p-3 text-[13px]">{body}</pre>
          </details>
        </section>
      )}
    </>
  );
}
