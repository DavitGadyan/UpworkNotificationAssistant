import Link from "next/link";
import { IconBriefcase, IconDoc, IconStar } from "@/components/icons";
import { Empty } from "@/components/ui/bits";
import { PageHead } from "@/components/ui/PageHead";
import { SearchBox } from "@/components/SearchBox";
import { UpworkLink } from "@/components/UpworkLink";
import { listProposalOutcomes, listProposals } from "@/lib/db";
import { OUTCOME_LABEL } from "@/lib/learning/labels";
import { money, PROPOSAL_STATUS, percentChanged, timeAgo } from "@/lib/format";
import type { ProposalStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposals" };

const FILTERS: { value: string; label: string; match: ProposalStatus[] }[] = [
  { value: "", label: "Open", match: ["draft", "needs_loom", "ready", "approved", "previewed"] },
  { value: "needs_loom", label: "Needs Loom", match: ["needs_loom", "draft"] },
  { value: "ready", label: "To approve", match: ["ready"] },
  { value: "approved", label: "To preview", match: ["approved", "previewed"] },
  { value: "submitted", label: "Submitted", match: ["submitted"] },
  { value: "discarded", label: "Discarded", match: ["discarded"] },
  { value: "all", label: "All", match: [] },
];

export default async function Proposals({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";
  // Search covers the job title, the draft text and the client the research found.
  const all = (await listProposals()).filter((p) => !q
    || [p.jobTitle, p.coverLetter, p.research?.contactName, p.research?.company].filter(Boolean).join(" ").toLowerCase().includes(q));
  const f = FILTERS.find((x) => x.value === (sp.status ?? "")) ?? FILTERS[0];
  const rows = f.value === "all" ? all : all.filter((p) => f.match.includes(p.status));
  const tabHref = (status: string) => {
    const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(sp.q ? { q: sp.q } : {}) }).toString();
    return qs ? `/proposals?${qs}` : "/proposals";
  };
  // What the client did with sent ones (read back from Upwork; empty until the outcomes table exists).
  const outcomes = new Map((await listProposalOutcomes({ limit: 500 }).catch(() => [])).map((o) => [o.jobId, o]));
  const count = (x: (typeof FILTERS)[number]) => (x.value === "all" ? all.length : all.filter((p) => x.match.includes(p.status)).length);

  return (
    <>
      <PageHead title="Proposals" subtitle="Drafts written for you, waiting for a Loom, your approval and a final check. Nothing is sent to Upwork until you submit it yourself." />

      <SearchBox placeholder="Search proposals: job, draft text or client" className="mb-4" />
      <nav aria-label="Filter by status" className="seg mb-6 w-full md:w-auto">
        {FILTERS.map((x) => (
          <Link key={x.value || "open"} href={tabHref(x.value)} aria-current={x === f ? "page" : undefined} className="seg-item">
            {x.label}<span className="num text-[13px] opacity-70">{count(x)}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Empty title={q ? `Nothing matches “${sp.q}”` : all.length ? "Nothing in this view" : "No proposal drafts yet"}>
          {q ? "Try other words or another status above." : all.length
            ? "Try another status above."
            : <>Open a job and tap <b>Generate proposal draft</b>, or use the <b>Draft proposal</b> button on a Telegram alert. Drafts land here.</>}
        </Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const st = PROPOSAL_STATUS[p.status] ?? { label: p.status, cls: "pill-neutral" };
            const changed = p.originalDraft ? percentChanged(p.originalDraft, p.coverLetter) : 0;
            return (
              <li key={p.id} className={`card card-link relative p-5 ${p.status === "discarded" ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex flex-wrap gap-1.5">
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                    {p.status === "submitted" && outcomes.get(p.jobId) && (() => { const o = OUTCOME_LABEL[outcomes.get(p.jobId)!.outcome]; return <span className={`pill ${o.cls}`} title={o.hint}>{o.label}</span>; })()}
                  </span>
                  <span className="text-[14px] text-[var(--color-muted)]">{timeAgo(p.updatedAt)}</span>
                </div>
                <h2 className="mt-3 line-clamp-2 text-[17px] font-semibold leading-snug">
                  <Link href={`/proposals/${p.id}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-[var(--color-ink)]">
                    {p.jobTitle}
                  </Link>
                </h2>
                <p className="mt-1 line-clamp-2 text-[14px] text-[var(--color-muted)]">{p.coverLetter.slice(0, 200)}</p>
                <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px]">
                  <span className="inline-flex items-center gap-1.5"><IconBriefcase size={15} className="text-[var(--color-good)]" />{p.bid != null ? money(p.bid) : "No bid"}</span>
                  <span className="text-[var(--color-faint)]">/</span>
                  <span className="inline-flex items-center gap-1.5"><IconDoc size={15} className="text-[var(--color-muted)]" />{changed}% edited</span>
                  {p.research?.bigFish && <><span className="text-[var(--color-faint)]">/</span><span className="inline-flex items-center gap-1.5"><IconStar size={15} className="text-[var(--color-warn)]" />Big fish</span></>}
                </p>
                <p className="mt-2 text-right"><UpworkLink url={p.jobUrl} jobId={p.jobId} /></p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
