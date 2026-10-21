/*
 * Report a job as a scam (David, 2026-10-20 - a crypto "client" sent a GitHub repo carrying malicious code):
 *   npm run -s scam -- <jobId> "<what happened>"
 * Takes it out of every learning signal:
 *   - adds it to the sticky scam list, so the outcome sync stores its proposal as "void" (KPIs, nightly review, prompt
 *     lab, writer/ranker examples and calibration all skip void) and stops re-checking the room;
 *   - voids the proposal outcome rows now;
 *   - turns alert feedback on it neutral (rating 0, which calibration, ranker examples and metrics skip);
 *   - removes any watch-loop vouch and dismisses the job so auto-draft / auto-apply never touch it.
 * Database only - no Upwork call.
 */
import { getJob, setJobStatus, updateJobData } from "@/lib/db";
import { query } from "@/lib/pg";
import { markScamJob } from "@/lib/learning/scamJobs";

async function main(): Promise<number> {
  const [id, ...why] = process.argv.slice(2);
  const reason = why.join(" ").trim();
  if (!id || !/^\d{6,}$/.test(id) || !reason) { console.log('usage: scam <jobId> "<what happened>"'); return 2; }
  await markScamJob(id, reason);
  const outcomes = await query<{ upwork_proposal_id: string; outcome: string }>(
    "update public.proposal_outcomes set outcome = 'void', next_check_at = 0, updated_at = $2 where job_id = $1 returning upwork_proposal_id, outcome", [id, Date.now()],
  );
  const fb = await query<{ id: number }>(
    "update public.feedback set rating = 0, reason = $2 where ref_id = $1 and kind = 'alert' returning id", [id, `scam: ${reason}`.slice(0, 500)],
  );
  const job = await getJob(id);
  if (job) {
    if (job.score.watch) await updateJobData(id, { score: { ...job.score, watch: null } });
    if (job.status !== "applied") await setJobStatus(id, "dismissed");
  }
  console.log(`SCAM ${id}: ${outcomes.length} outcome row(s) voided, ${fb.length} alert feedback row(s) neutralised, job ${job ? `${job.status === "applied" ? "kept as applied" : "dismissed"}${job.score.watch ? ", vouch removed" : ""}` : "not in the database"}`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(2); });
