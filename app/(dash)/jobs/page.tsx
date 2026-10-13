import Link from "next/link";
import { AlertsToggle } from "@/components/AlertsToggle";
import { IconBriefcase, IconFilter, IconStar, IconUser } from "@/components/icons";
import { JobMenu } from "@/components/JobMenu";
import { JobsFilterBar } from "@/components/JobsFilterBar";
import { PageHead } from "@/components/ui/PageHead";
import { UpworkLink } from "@/components/UpworkLink";
import { ClaudeFetchButton } from "@/components/ClaudeFetchButton";
import { Pagination } from "@/components/ui/Pagination";
import { jobPill } from "@/components/ui/status";
import { getSettings, listJobs, listSearches } from "@/lib/db";
import { budgetLabel, compactMoney, INTENT_LABELS, intentPill, proposalsLabel, timeAgo } from "@/lib/format";
import type { JobStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs" };

const PER_PAGE = 15;
type SP = Promise<{ q?: string; search?: string; status?: string; min?: string; page?: string; filters?: string }>;

export default async function Jobs({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const settings = await getSettings();
  const searches = await listSearches();
  const all = await listJobs({
    status: (sp.status as JobStatus) || "all",
    searchId: sp.search ? Number(sp.search) : undefined,
    q: sp.q,
    minScore: sp.min ? Number(sp.min) : undefined,
  });
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const jobs = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const filtersOpen = !!(sp.filters || sp.search || sp.status || sp.min);
  const filterHref = (() => {
    const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["filters", "search", "status", "min", "page"].includes(k)) as [string, string][]);
    if (!filtersOpen) q.set("filters", "1");
    return `/jobs${q.size ? `?${q}` : ""}`;
  })();
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    q.set("page", String(p));
    return `/jobs?${q}`;
  };

  return (
    <>
      <PageHead
        title="Jobs"
        subtitle={sp.q ? `Results for “${sp.q}” in the last 24 hours.` : "New jobs from the last 24 hours, newest first. Anything older is deleted automatically."}
        meta={<Link href="/ranking" className="font-medium text-[var(--color-accent)] underline-offset-4 hover:underline">How ranking works →</Link>}
        actions={<>
          <Link href={filterHref} className="btn" aria-pressed={filtersOpen} aria-controls="job-filters" scroll={false}>
            <IconFilter size={18} /> {filtersOpen ? "Clear filters" : "Filter"}
          </Link>
          <ClaudeFetchButton compact />
          <AlertsToggle paused={settings.alertsPaused} />
        </>}
      />

      {filtersOpen && <JobsFilterBar searches={searches.map((s) => ({ value: String(s.id), label: s.name }))} />}

      {jobs.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <h2 className="display text-[22px] font-semibold">No jobs here yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[var(--color-muted)]">
            {searches.length ? "New jobs appear after the next poll. Try clearing filters if you expected results." : "Create a saved search first, then jobs show up here."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((j) => {
            const pill = jobPill(j.status, j.score, settings);
            const intent = j.score.intent;
            return (
              <li key={j.id} className={`card card-link relative p-5 ${j.status === "dismissed" ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`pill ${pill.cls}`}>{pill.label}<span className="num opacity-80">{j.score.total}%</span></span>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] text-[var(--color-muted)]">{timeAgo(j.publishedAt)}</span>
                    <div className="relative z-10"><JobMenu id={j.id} ciphertext={j.ciphertext} status={j.status} /></div>
                  </div>
                </div>
                <h2 className="mt-3 line-clamp-2 text-[17px] font-semibold leading-snug">
                  <Link href={`/jobs/${encodeURIComponent(j.id)}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-[var(--color-ink)]">
                    {j.title}
                  </Link>
                  <span className="ml-2 font-normal text-[var(--color-muted)]">{j.jobType === "HOURLY" ? "Hourly" : "Fixed"}</span>
                </h2>
                <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px]">
                  <span className="inline-flex items-center gap-1.5"><IconBriefcase size={15} className="text-[var(--color-good)]" />{budgetLabel(j)}</span>
                  <span className="text-[var(--color-faint)]">/</span>
                  <span className="inline-flex items-center gap-1.5"><IconUser size={15} className="text-[var(--color-muted)]" />{compactMoney(j.client.totalSpent)} spent</span>
                  <span className="text-[var(--color-faint)]">/</span>
                  <span className="inline-flex items-center gap-1.5"><IconStar size={15} className="text-[var(--color-warn)]" />{proposalsLabel(j)}</span>
                </p>
                {intent && (
                  <p className="mt-3 flex flex-wrap items-center gap-2" aria-label="Client intent (advisory)">
                    <span className={`pill ${intentPill(intent.ghostRisk)} text-[13px]`} title={`Ghost risk: ${intent.ghostRisk}`}>Hire chance <span className="num">{intent.hireLikelihood}%</span></span>
                    {intent.ghostRisk === "high" && (
                      <span className="pill pill-bad h-auto min-h-[26px] whitespace-normal py-0.5 text-[13px]" title={intent.evidence.join(" · ")}>
                        <span>Likely not hiring — skip <span className="font-normal opacity-80">· {INTENT_LABELS[intent.archetype] ?? intent.archetype}</span></span>
                      </span>
                    )}
                  </p>
                )}
                <p className="mt-2 flex items-center justify-between gap-3">
                  {j.status === "pending" ? <span className="text-[13px] text-[var(--color-muted)]">Checking client record…</span> : <span />}
                  <UpworkLink ciphertext={j.ciphertext} jobId={j.id} />
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} pages={pages} href={href} />
    </>
  );
}
