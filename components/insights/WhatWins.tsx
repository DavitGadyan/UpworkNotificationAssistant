import { DataTable } from "@/components/insights/charts";
import { LessonsApproval } from "@/components/insights/LessonsApproval";
import { RunButton } from "@/components/insights/RunButton";
import { CardHead, Note } from "@/components/ui/bits";
import { latestReport, listProposalOutcomes, listProposals } from "@/lib/db";
import { fmtDate, fmtDateTime, jobUrl } from "@/lib/format";
import { OUTCOME_LABEL } from "@/lib/learning/labels";
import { lessonsDecisions, outcomeStats, REPORT_KIND, type LessonsReport, type LessonsTarget } from "@/lib/learning/lessons";
import type { ProposalOutcome } from "@/lib/types";

const DIMS: [string, string][] = [
  ["field", "Your field"], ["applicants", "Applicants on the job"], ["opener", "How the letter opens"], ["letterLength", "Letter length"],
  ["invited", "Invited or cold"], ["loom", "Loom"], ["clientSpend", "Client spend"], ["bidType", "Bid type"], ["boosted", "Boost"], ["clientCountry", "Client country"], ["promptVersion", "Who wrote it"],
];

/** Insights card: which proposals got a client reply, rates by signal, and lessons waiting for approval. */
export async function WhatWins() {
  let rows: ProposalOutcome[];
  try {
    rows = await listProposalOutcomes({ since: new Date(Date.now() - 180 * 864e5).toISOString() });
  } catch {
    return (
      <section className="card mt-4 p-5 md:p-6"><CardHead title="What wins" />
        <Note tone="warn" className="mt-4">The proposal_outcomes table isn&apos;t in the database yet - run supabase/migrations/007 and 008 in the Supabase SQL editor.</Note>
      </section>
    );
  }
  const versions = new Map((await listProposals()).map((p) => [p.id, p.promptVersion]));
  const st = outcomeStats(rows, versions);
  const decisions = await lessonsDecisions();

  return (
    <section className="card mt-4 p-5 md:p-6" aria-labelledby="ww-h">
      <CardHead id="ww-h" title="What wins"
        sub="Which proposals got a client reply and which didn't, read back from Upwork every 6 hours. Viewed-no-reply and never-viewed both count against; lessons only change the AI after you approve them."
        right={<div className="flex flex-wrap gap-2"><RunButton action="outcomes" label="Check replies now" done="Updated" /><a className="btn btn-sm" href="/insights/prompts">Prompt analytics →</a></div>} />

      {!rows.length ? <Note className="mt-4">No proposals read yet. “Check replies now” reads your recent proposals from Upwork (read-only).</Note> : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Tile label="Client replied" value={st.wins} tone="good" />
            <Tile label="Viewed, no reply" value={st.lossViewed} tone="bad" />
            <Tile label="Not viewed" value={st.lossUnviewed} tone="warn" />
            <Tile label="Waiting" value={st.pending} />
            <Tile label="Reply rate" value={st.replyRate != null ? `${st.replyRate}%` : "-"} sub={st.viewRate != null ? `viewed ${st.viewRate}%` : undefined} />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead><tr className="text-[var(--color-muted)]"><th className="py-1.5 pr-3 font-medium">Sent</th><th className="py-1.5 pr-3 font-medium">Job</th><th className="py-1.5 pr-3 font-medium">Result</th><th className="py-1.5 pr-3 font-medium">Applicants</th><th className="py-1.5 font-medium">Bid</th></tr></thead>
              <tbody>
                {rows.filter((o) => o.outcome !== "void").slice(0, 40).map((o) => (
                  <tr key={o.upworkProposalId} className="border-t border-[var(--color-line)] align-top">
                    <td className="num whitespace-nowrap py-2 pr-3 text-[var(--color-muted)]">{fmtDate(o.submittedAt)}</td>
                    <td className="py-2 pr-3">
                      <a className="font-medium hover:underline" href={jobUrl(`~02${o.jobId}`)} target="_blank" rel="noreferrer">{o.jobTitle}</a>
                      {o.job?.field && <span className="block text-[12px] text-[var(--color-muted)]">{o.job.field}{o.job.clientCountry ? ` · ${o.job.clientCountry}` : ""}</span>}
                      {o.firstReply && <span className="mt-1 block text-[13px] text-[var(--color-muted)]">“{o.firstReply.slice(0, 140)}”</span>}
                    </td>
                    <td className="py-2 pr-3"><span className={`pill ${OUTCOME_LABEL[o.outcome].cls}`} title={OUTCOME_LABEL[o.outcome].hint}>{OUTCOME_LABEL[o.outcome].label}</span></td>
                    <td className="num py-2 pr-3">{o.insights?.proposalsTotal ?? "-"}</td>
                    <td className="num whitespace-nowrap py-2">{o.bidLabel ?? "-"}{o.boosted ? " ⚡" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {st.decided > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-[14px] font-medium text-[var(--color-muted)]">Reply rate by signal ({st.decided} decided proposals)</summary>
              <div className="mt-3 grid gap-5 md:grid-cols-2">
                {DIMS.map(([k, title]) => (st.by[k]?.length ?? 0) > 1 && (
                  <div key={k} className="min-w-0">
                    <h3 className="tag">{title}</h3>
                    <DataTable head={["", "Sent", "Replied", "Viewed"]} rows={st.by[k].slice(0, 6).map((b) => [b.key, b.n, `${b.wins} (${b.replyRate}%)`, `${b.viewRate}%`])} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <LessonsBlock target="writer" decisions={decisions} />
      <LessonsBlock target="ranker" decisions={decisions} />
    </section>
  );
}

const TITLE: Record<LessonsTarget, { title: string; sub: string; a: string; b: string }> = {
  writer: { title: "Writer lessons", sub: "replies vs viewed-no-reply, and what you change in the AI drafts", a: "What convinced (replies vs viewed-no-reply)", b: "What you correct in the drafts" },
  ranker: { title: "Ranker lessons", sub: "which jobs earned a view and a reply, by the rank they had", a: "Where the ranking is off", b: "What earned the click (viewed vs not viewed)" },
};

async function LessonsBlock({ target, decisions }: { target: LessonsTarget; decisions: Record<number, { status: string; ids: string[]; at: string }> }) {
  const rep = await latestReport<LessonsReport>(REPORT_KIND[target]);
  const t = TITLE[target];
  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="tag">{t.title} <span className="font-normal normal-case text-[var(--color-muted)]">· {t.sub}{rep ? ` · built ${fmtDateTime(rep.createdAt)}` : ""}</span></h3>
        <RunButton action="lessons" body={{ target }} label={`Find ${target} lessons`} done="Report ready" />
      </div>
      {!rep ? <Note>No report yet. It runs weekly; the button builds one now (one AI call, about $0.30). Nothing changes in the {target === "writer" ? "writer" : "ranker"} prompt until you approve.</Note> : !rep.data.ok ? <Note tone="info">{rep.data.message}</Note> : (
        <div className="grid gap-4">
          {rep.data.headline && <p className="text-[16px] font-semibold">{rep.data.headline}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {rep.data.convinces && <Note tone="good"><b>{t.a}:</b> {rep.data.convinces}</Note>}
            {rep.data.earnsClick && <Note tone="info"><b>{t.b}:</b> {rep.data.earnsClick}</Note>}
          </div>
          <LessonsApproval reportId={rep.id} lessons={rep.data.lessons} decided={decisions[rep.id] ?? null} />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone, sub }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "warn"; sub?: string }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-[var(--color-sunken)] p-3">
      <p className="truncate text-[13px] text-[var(--color-muted)]">{label}</p>
      <p className="display num mt-0.5 truncate text-[26px] font-bold leading-tight" style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</p>
      {sub && <p className="text-[12px] text-[var(--color-muted)]">{sub}</p>}
    </div>
  );
}
