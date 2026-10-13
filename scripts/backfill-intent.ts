/*
 * Compute the advisory hire-likelihood verdict for every stored job and start outcome tracking for the
 * enriched ones. No Upwork calls, no alerts. Usage: npx tsx --env-file=.env scripts/backfill-intent.ts
 */
import { clientHistory, listJobs, trackOutcome, updateJobData } from "@/lib/db";
import { buildGhostReport } from "@/lib/insights/ghosts";
import { assessIntent } from "@/lib/ranking/intent";

async function main() {
  const jobs = (await listJobs({ status: "all" })).filter((j) => !j.score.excluded);
  for (const j of jobs) {
    const { searchId: _s, searchName: _n, score, status: _st, fetchedAt: _f, enrichment, feeds: _fd, ...job } = j;
    const intent = assessIntent(job, enrichment, { llm: score.llm, history: await clientHistory(enrichment?.clientId) });
    await updateJobData(j.id, { score: { ...score, intent } });
    if (enrichment) await trackOutcome({ jobId: j.id, clientId: enrichment.clientId ?? null, title: j.title, publishedAt: j.publishedAt, country: j.client.country, archetype: intent.archetype, hireLikelihood: intent.hireLikelihood });
  }
  const r = await buildGhostReport();
  console.log(`assessed ${jobs.length} jobs`);
  console.table(r.byArchetype);
  for (const j of (await listJobs({ status: "all" })).filter((x) => x.score.intent && x.score.intent.ghostRisk !== "low").sort((a, b) => a.score.intent!.hireLikelihood - b.score.intent!.hireLikelihood).slice(0, 25)) {
    const i = j.score.intent!;
    console.log(`${String(i.hireLikelihood).padStart(3)}% ${i.ghostRisk.padEnd(6)} ${i.archetype.padEnd(18)} rank ${String(j.score.total).padStart(3)}  ${j.title.slice(0, 50).padEnd(50)} | ${i.evidence[0]}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
