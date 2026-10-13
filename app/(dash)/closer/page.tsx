import { CloserClient, type CloserHistoryItem } from "@/components/CloserClient";
import { PageHead } from "@/components/ui/PageHead";
import { listJobs, listProposals, listReports } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Closer" };

export default async function CloserPage() {
  const history = await listReports("closer", 20) as CloserHistoryItem[];
  const proposals = (await listProposals()).filter((p) => p.status !== "discarded");
  const jobs = await listJobs({ status: "all" });
  const seen = new Set<string>();
  const jobOptions = [
    ...proposals.map((p) => ({ id: p.jobId, label: `${p.jobTitle} (proposal ${p.status})` })),
    ...jobs.map((j) => ({ id: j.id, label: j.title })),
  ].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true))).slice(0, 80);
  return (
    <>
      <PageHead title="Closer" subtitle="Reply coaching for live client conversations: where the deal stands, what to say next and what to avoid. You send every message yourself." />
      <CloserClient history={history} jobs={jobOptions} />
    </>
  );
}
