import Link from "next/link";
import { IconEye, IconStar } from "@/components/icons";
import { Empty } from "@/components/ui/bits";
import { PageHead } from "@/components/ui/PageHead";
import { UpworkLink } from "@/components/UpworkLink";
import { getJob, getSettings, listWatches } from "@/lib/db";
import { fmtDateTime, timeAgo, timeUntil } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchlist" };

const DONE: Record<string, string> = { crowded: "Too crowded", closed: "Job closed", hired: "Client hired", expired: "Job expired", timeout: "Watch ended" };

export default async function Watchlist() {
  const s = await getSettings();
  const rows = await Promise.all((await listWatches()).map(async (w) => ({ w, job: await getJob(w.jobId) })));
  rows.sort((a, b) => Number(!!a.w.done) - Number(!!b.w.done) || b.w.startedAt - a.w.startedAt);
  const active = rows.filter((r) => !r.w.done).length;

  return (
    <>
      <PageHead title="Watchlist"
        subtitle={`Alerted jobs whose proposal count is re-checked every ${s.watch.intervalMin} minutes for up to ${s.watch.maxHours} hours. You get a warning at ${s.rules.watchWarnAt} proposals; at ${s.rules.maxProposals} the job is dropped.`}
        meta={<><span className="num">{active} watching</span><span className="num">{rows.length - active} finished</span>{!s.watch.enabled && <span className="text-[var(--color-warn)]">Watching is off in Settings</span>}</>} />

      {rows.length === 0 ? (
        <Empty title="Nothing on the watchlist">
          When a job is sent to you on Telegram, its competition is watched here so you know whether it is still worth applying.
        </Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ w, job }) => {
            const count = w.lastTier ?? String(w.lastCount);
            const done = w.done ? DONE[w.done] ?? w.done : null;
            return (
              <li key={w.jobId} className={`card relative p-5 ${job ? "card-link" : ""} ${done ? "opacity-70" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  {done ? <span className="pill pill-neutral">{done}</span> : w.warned ? <span className="pill pill-warn">Warned</span> : <span className="pill pill-good">Watching</span>}
                  <span className="text-[14px] text-[var(--color-muted)]">{done ? `Started ${timeAgo(new Date(w.startedAt).toISOString())}` : `Next check ${timeUntil(w.nextAt)}`}</span>
                </div>
                <h2 className="mt-3 line-clamp-2 text-[17px] font-semibold leading-snug">
                  {job ? (
                    <Link href={`/jobs/${encodeURIComponent(job.id)}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-[var(--color-ink)]">{job.title}</Link>
                  ) : <span className="text-[var(--color-muted)]">Job {w.jobId} (no longer cached)</span>}
                </h2>
                <div className="mt-4 flex items-end justify-between gap-3 border-t border-[var(--color-line)] pt-3">
                  <div>
                    <p className="text-[13px] text-[var(--color-muted)]">Proposals</p>
                    <p className={`display num text-[28px] font-bold leading-none ${w.warned ? "text-[var(--color-warn)]" : ""}`}>{count}</p>
                  </div>
                  <div className="text-right text-[14px] text-[var(--color-muted)]">
                    {job && <p className="inline-flex items-center gap-1.5"><IconStar size={14} className="text-[var(--color-warn)]" />Rank {job.score.total}%</p>}
                    <p className="inline-flex items-center gap-1.5"><IconEye size={14} />since {fmtDateTime(w.startedAt)}</p>
                  </div>
                </div>
                <p className="mt-2 text-right"><UpworkLink ciphertext={job?.ciphertext} jobId={w.jobId} /></p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
