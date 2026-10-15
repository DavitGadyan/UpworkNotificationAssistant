/*
 * One-off clean-up after the profile-fit change (2026-10-14). Dry run by default; --apply writes.
 *   1. sync David's Upwork profile (its skills feed the gate) - one MCP call
 *   2. re-score every stored job with the gate (rule values unchanged; stored AI verdicts kept)
 *   3. off-profile jobs that were alerted: edit the Telegram alert ("❌ Not your field") and stop the watch
 *   4. in-field jobs never AI-checked: new ones wait as "awaiting_ai" for the worker; ones already alerted are
 *      AI-checked here and their alert gets the verdict as a footer (no second alert)
 * Usage: npx tsx --env-file=.env scripts/refit.ts [--apply]
 */
import { rankWithLlm } from "../lib/agents/jobRanking";
import { getSettings, listJobs, listSearches, listWatches, setJobStatus, updateJobData, updateWatch } from "../lib/db";
import { syncProfile } from "../lib/insights/metrics";
import { editJobAlert } from "../lib/notify/telegram";
import { currentFieldSpec, resetFieldSpecCache } from "../lib/ranking/fieldSpec";
import { NOT_YOUR_FIELD, scoreJob } from "../lib/scoring";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (APPLY) {
    try {
      const p = await syncProfile();
      console.log(`Profile synced: ${p?.title ?? "?"} · ${p?.skills?.length ?? 0} skills`);
    } catch (e) { console.warn("Profile sync failed:", (e as Error).message); }
  }
  resetFieldSpecCache();
  const s = await getSettings();
  const fields = await currentFieldSpec();
  const feeds = new Map((await listSearches()).map((f) => [f.id, f]));
  const watches = new Map((await listWatches()).map((w) => [w.jobId, w]));
  const now = new Date();
  const rows: string[] = [];
  let off = 0, edited = 0, queued = 0, rankedNow = 0;

  for (const cj of await listJobs({ status: "all" })) {
    const feed = feeds.get(cj.searchId);
    if (!feed) continue;
    const { searchId: _s, searchName, score: old, status, fetchedAt, enrichment, feeds: _f, ...job } = cj;
    let score = scoreJob(job, feed, now, s.rules, { enrichment: enrichment ?? null, llm: old.llm ?? null, fields });
    const wasOff = !!old.excluded?.startsWith(NOT_YOUR_FIELD);
    const isOff = !!score.excluded?.startsWith(NOT_YOUR_FIELD);
    const fresh = now.getTime() - new Date(fetchedAt).getTime() < 864e5;
    const alerted = status === "notified" || status === "called";
    const needsAi = !score.excluded && !score.llm && fresh && ["new", "notified", "called"].includes(status);
    const action = isOff && !wasOff ? "→ NOT YOUR FIELD" : needsAi ? (alerted ? "→ AI check now, alert gets the verdict" : "→ waiting for AI") : "";
    if (isOff && !wasOff) off++;
    if (!action && score.total === old.total && score.excluded === old.excluded) continue;
    rows.push(`${String(old.total).padStart(3)}→${String(score.total).padStart(3)} ${status.padEnd(10)} ${job.title.slice(0, 58).padEnd(58)} ${action} ${score.profileFit?.field ? `(${score.profileFit.field})` : ""}`);
    if (!APPLY) continue;

    if (alerted && needsAi) {
      try {
        const llm = await rankWithLlm(job, enrichment, score.rules!);
        score = scoreJob(job, feed, now, s.rules, { enrichment: enrichment ?? null, llm, fields });
        rankedNow++;
      } catch (e) { console.warn("AI check failed", job.id, (e as Error).message); }
    }
    await updateJobData(job.id, { score });

    const w = watches.get(job.id);
    const proposals = job.proposalsTier ?? String(job.totalApplicants);
    if (alerted && w?.messageId && score.excluded?.startsWith(NOT_YOUR_FIELD) && !wasOff) {
      const why = score.profileFit?.verdict === "off" ? score.profileFit.field : "per the AI check";
      const r = await editJobAlert(w.messageId, job, score, searchName, enrichment, proposals, `❌ <b>Not your field</b> (${why}) - ignore this one.`);
      if (r.ok) edited++;
      await updateWatch(job.id, { done: "not your field" });
    } else if (alerted && w?.messageId && score.llm && !old.llm) {
      const r = await editJobAlert(w.messageId, job, score, searchName, enrichment, proposals, `🤖 AI check: fit ${score.llm.fit}, value ${score.llm.valuePotential} → rank ${score.total}.`);
      if (r.ok) edited++;
    } else if (status === "new" && needsAi) {
      await setJobStatus(job.id, "awaiting_ai");
      queued++;
    }
  }

  rows.forEach((r) => console.log(r));
  console.log(`\n${APPLY ? "Applied" : "Dry run"}: ${rows.length} jobs change · ${off} newly "not your field"${APPLY ? ` · ${edited} Telegram alerts edited · ${queued} queued for the AI · ${rankedNow} ranked now` : ""}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
