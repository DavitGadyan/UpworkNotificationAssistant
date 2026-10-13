import { latestReport, listJobs, outcomeStats, saveReport } from "../db";
import { query } from "../pg";

/*
 * "Ghost patterns" report: how many jobs fall into each hire-likelihood archetype, how many of the tracked
 * ones actually hired, and the clients that keep posting without hiring. Produces rule SUGGESTIONS as text
 * for David - nothing is applied; his ranking rules stay exactly as he set them.
 */

export interface GhostReport {
  builtAt: string;
  jobsAssessed: number;
  byArchetype: { archetype: string; jobs: number; highRisk: number; avgLikelihood: number }[];
  outcomes: Awaited<ReturnType<typeof outcomeStats>>;
  topClients: { clientId: string; country: string | null; jobsSeen: number; hired: number; closedNoHire: number }[];
  suggestions: { suggestion: string; rationale: string }[];
}

export async function buildGhostReport(): Promise<GhostReport> {
  const jobs = (await listJobs({ status: "all" })).filter((j) => j.score.intent);
  const groups = new Map<string, { jobs: number; highRisk: number; sum: number }>();
  for (const j of jobs) {
    const i = j.score.intent!;
    const g = groups.get(i.archetype) ?? { jobs: 0, highRisk: 0, sum: 0 };
    g.jobs++; g.sum += i.hireLikelihood; if (i.ghostRisk === "high") g.highRisk++;
    groups.set(i.archetype, g);
  }
  const byArchetype = [...groups.entries()].map(([archetype, g]) => ({ archetype, jobs: g.jobs, highRisk: g.highRisk, avgLikelihood: Math.round(g.sum / g.jobs) }))
    .sort((a, b) => b.jobs - a.jobs);
  const outcomes = await outcomeStats();
  const topClients = (await query<{ client_id: string; country: string | null; jobs_seen: number; hired: number; closed_no_hire: number }>(
    "select * from public.clients where closed_no_hire > 0 or jobs_seen > 1 order by closed_no_hire desc, jobs_seen desc limit 10",
  )).map((r) => ({ clientId: r.client_id, country: r.country, jobsSeen: r.jobs_seen, hired: r.hired, closedNoHire: r.closed_no_hire }));

  const suggestions: GhostReport["suggestions"] = [];
  for (const o of outcomes) {
    const resolved = o.hired + o.closedNoHire;
    if (resolved >= 5 && o.hired / resolved < 0.1 && o.archetype !== "genuine") {
      suggestions.push({ suggestion: `Consider hard-rejecting "${o.archetype}" jobs`, rationale: `${o.hired} of ${resolved} tracked jobs from this pattern hired (${Math.round((o.hired / resolved) * 100)}%).` });
    }
  }
  const ghost = groups.get("ghost_poster");
  if (ghost && ghost.jobs >= 3) suggestions.push({ suggestion: "Consider rejecting $0-spend clients with 2+ posts and no hires", rationale: `${ghost.jobs} recent jobs matched this pattern (avg hire chance ${Math.round(ghost.sum / ghost.jobs)}%). Your current rules let them through when the rank is otherwise high.` });
  const tc = groups.get("template_collector");
  if (tc && tc.jobs >= 2) suggestions.push({ suggestion: "Consider skipping posts that say 'no hire authorized' / 'quote your true price'", rationale: `${tc.jobs} posts asked for free plans or quotes; these collect proposal templates rather than hire.` });
  if (!suggestions.length) suggestions.push({ suggestion: "No rule change suggested yet", rationale: "Outcomes are tracked ~2 and ~7 days after posting; suggestions appear once enough jobs have resolved." });

  const report: GhostReport = { builtAt: new Date().toISOString(), jobsAssessed: jobs.length, byArchetype, outcomes, topClients, suggestions };
  await saveReport("ghost_patterns", report);
  return report;
}

export const latestGhostReport = () => latestReport<GhostReport>("ghost_patterns");
