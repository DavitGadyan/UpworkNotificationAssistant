import { RunButton } from "@/components/insights/RunButton";
import { CardHead, Note } from "@/components/ui/bits";
import { latestReport } from "@/lib/db";
import { fmtDate, fmtDateTime, jobUrl } from "@/lib/format";
import { REVIEW_KIND, type NightlyReview as Review } from "@/lib/learning/review";
import { SEGMENT_LABEL } from "@/lib/learning/segments";
import type { OutcomeSegment } from "@/lib/types";

const GROUPS: OutcomeSegment[] = ["hired", "replied", "opener_worked", "opener_missed", "ghost"];

/** Insights card: tonight's split of every sent proposal, and what the assistant learned from each group. */
export async function NightlyReview() {
  const r = await latestReport<Review>(REVIEW_KIND).catch(() => null);
  const d = r?.data;
  return (
    <section className="card mt-4 p-5 md:p-6" aria-labelledby="nr-h">
      <CardHead id="nr-h" title="Nightly review"
        sub="Every night at 00:00 each proposal you sent is sorted: ghost jobs (the client engaged with nobody - the ranker learns to skip them), opener missed, opener worked, and wins, whose conversations are read to repeat what worked. Findings feed the writer and ranker on their own."
        right={<RunButton action="nightly-review" label="Run now" done="Updated" />} />
      {!d ? <Note className="mt-4">No review yet - the first one runs tonight at 00:00, or press “Run now”.</Note> : (
        <>
          <p className="mt-2 text-[13px] text-[var(--color-muted)]">{fmtDateTime(d.builtAt)} · {d.message}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {GROUPS.map((g) => (
              <div key={g} className="min-w-0 rounded-[14px] bg-[var(--color-sunken)] p-3" title={SEGMENT_LABEL[g].hint}>
                <p className="truncate text-[13px] text-[var(--color-muted)]">{SEGMENT_LABEL[g].label}</p>
                <p className="display num mt-0.5 text-[26px] font-bold leading-tight">{d.counts[g]}</p>
              </div>
            ))}
          </div>

          {d.ai && (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Block title="Headline"><p>{d.ai.headline}</p></Block>
              <Block title="Ghost jobs - signs to skip">
                <List items={d.ai.ghostSigns.map((x) => `${x.point} (${x.evidence})`)} />
              </Block>
              <Block title="Openers to reuse, by situation">
                <List items={d.ai.openersToReuse.map((x) => `${x.situation}: ${x.pattern}`)} />
                <p className="mt-2 text-[13px] text-[var(--color-muted)]">{d.ai.openerWorked}</p>
              </Block>
              <Block title="Why openers were skipped">
                <p>{d.ai.openerMissed}</p>
              </Block>
              <Block title="What led to replies and contracts" wide>
                <List items={d.ai.winPlaybook.map((x) => `${x.point} (${x.evidence})`)} />
              </Block>
            </div>
          )}

          <div className="mt-5 space-y-2">
            {GROUPS.map((g) => {
              const xs = d.items.filter((x) => x.segment === g);
              if (!xs.length) return null;
              return (
                <details key={g} className="rounded-[14px] border border-[var(--color-line)] p-3">
                  <summary className="cursor-pointer text-[14px] font-medium">
                    <span className={`pill ${SEGMENT_LABEL[g].cls}`}>{SEGMENT_LABEL[g].label}</span> <span className="text-[var(--color-muted)]">{xs.length} · {SEGMENT_LABEL[g].hint}</span>
                  </summary>
                  <ul className="mt-2 space-y-2 text-[14px]">
                    {xs.slice(0, 40).map((x) => (
                      <li key={x.id} className="border-t border-[var(--color-line)] pt-2">
                        <a className="font-medium hover:underline" href={jobUrl(`~02${x.jobId}`)} target="_blank" rel="noreferrer">{x.title}</a>
                        <span className="block text-[12px] text-[var(--color-muted)]">{[fmtDate(x.sent), x.field, x.country, x.spent != null ? `$${Math.round(x.spent).toLocaleString()} spent` : null, x.applicants != null ? `${x.applicants} applicants` : null].filter(Boolean).join(" · ")}</span>
                        {x.opener && g !== "ghost" && <span className="mt-0.5 block text-[13px] text-[var(--color-muted)]">“{x.opener}”</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function Block({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-[14px] bg-[var(--color-sunken)] p-4 text-[14px] ${wide ? "md:col-span-2" : ""}`}>
      <p className="mb-1.5 text-[13px] font-medium text-[var(--color-muted)]">{title}</p>
      {children}
    </div>
  );
}

const List = ({ items }: { items: string[] }) => items.length
  ? <ul className="list-disc space-y-1 pl-5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
  : <p className="text-[var(--color-muted)]">Not enough examples yet.</p>;
