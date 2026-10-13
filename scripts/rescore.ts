/*
 * One-off: re-judge jobs stored without a client record (from before "enrich before judging").
 * Loads each record, re-runs the rules + AI ranking and updates the row. Sends NO alerts.
 * Usage: npx tsx --env-file=.env scripts/rescore.ts   (stop the worker first)
 */
import { listJobs, setJobStatus } from "@/lib/db";
import { retryPending } from "@/lib/pipeline";

async function main() {
  const targets = (await listJobs({ status: "all" })).filter((j) => !j.enrichment && !j.score.excluded && (j.status === "new" || j.status === "pending"));
  for (const j of targets) await setJobStatus(j.id, "pending");
  console.log(`re-judging ${targets.length} jobs`);
  const silent = { telegram: async () => ({ ok: false, detail: "rescore" }), call: async () => ({ ok: false, detail: "rescore" }), ready: { telegram: false, call: false } };
  console.log(await retryPending({ notifiers: silent, budget: { enrich: 80, llm: 80 } }));
  const ids = new Set(targets.map((j) => j.id));
  for (const j of (await listJobs({ status: "all" })).filter((x) => ids.has(x.id)).sort((a, b) => b.score.total - a.score.total)) {
    console.log(String(j.score.total).padStart(3), `fit ${j.score.llm?.fit ?? "-"}`.padEnd(7), j.title.slice(0, 60), "|", (j.score.rules?.flags ?? []).filter((f) => f.severity !== "info").map((f) => f.code).join(","));
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
