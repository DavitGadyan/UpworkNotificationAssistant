/*
 * The chat watch loop vouches for a job it alerted on (David, 2026-10-19): after a Telegram alert at fit ≥ 75 it runs
 *   npm run -s vouch -- <jobId> <fit> "<one-line why>"
 * which stores the fit on the job (score.watch). Auto-draft then drafts it even if the app could not rank it yet, and
 * night auto-apply treats it as clearing the rank and AI-fit bars; every other bar (proposals, verified payment,
 * open, 24 h, night and Connects limits) still applies. Run `ingest` for the job first so it is in the database.
 */
import { getJob, updateJobData } from "@/lib/db";

async function main(): Promise<number> {
  const [id, fitArg, ...why] = process.argv.slice(2);
  const fit = Number(fitArg);
  if (!id || !Number.isFinite(fit) || fit < 0 || fit > 100) { console.log("usage: vouch <jobId> <fit 0-100> [why]"); return 2; }
  const job = await getJob(id);
  if (!job) { console.log(`NOT FOUND ${id} - ingest it first`); return 1; }
  await updateJobData(id, { score: { ...job.score, watch: { fit, at: new Date().toISOString(), why: why.join(" ") || undefined } } });
  console.log(`VOUCHED ${id} fit ${fit} (app rank ${job.score.total}, status ${job.status}${job.score.excluded ? `, excluded: ${job.score.excluded}` : ""})`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(2); });
