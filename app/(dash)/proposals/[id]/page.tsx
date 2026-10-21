import Link from "next/link";
import { notFound } from "next/navigation";
import { IconExternal, IconGlobe } from "@/components/icons";
import { ProposalEditor } from "@/components/ProposalEditor";
import { getJob, getProposal } from "@/lib/db";
import { jobUrl, timeAgo } from "@/lib/format";
import { portfolioChoices } from "@/lib/proposals/portfolio";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = await getProposal(Number((await params).id));
  return { title: p ? `Proposal · ${p.jobTitle}` : "Proposal" };
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await getProposal(Number((await params).id));
  if (!p) notFound();
  const job = await getJob(p.jobId);
  const url = p.jobUrl || (job ? jobUrl(job.ciphertext) : null);
  // Cache only - opening a proposal never calls Upwork; the editor's Refresh button does.
  const portfolio = await portfolioChoices(p.jobId).catch(() => ({ upwork: { items: [], checkedAt: null, canRefresh: false }, site: { relevant: [], projects: [] } }));
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 items-center gap-3 text-[14px] text-[var(--color-muted)]">
        <IconGlobe size={18} className="shrink-0 text-[var(--color-ink)]" />
        <span aria-hidden>/</span>
        <Link href="/proposals" className="hover:text-[var(--color-ink)]">Proposals</Link>
        <span aria-hidden>/</span>
        <span className="truncate font-medium text-[var(--color-ink)]">Draft #{p.id}</span>
      </nav>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="display break-words text-[24px] font-bold md:text-[32px]">{p.jobTitle}</h1>
          <p className="mt-2 text-[var(--color-muted)]">Draft updated {timeAgo(p.updatedAt)}{job ? "" : " · job no longer cached (jobs are kept 24h)"}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          {job && <Link className="btn" href={`/jobs/${encodeURIComponent(job.id)}`}>Job details</Link>}
          {url && <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open in Upwork <IconExternal size={16} /></a>}
        </div>
      </div>
      <ProposalEditor initial={p} screeningQuestions={job?.enrichment?.screeningQuestions ?? []} connectsCost={job?.enrichment?.connectsCost ?? null} portfolio={portfolio} />
    </>
  );
}
