import { getJob } from "../db";
import { catalogue, relevantProjects } from "../agents/profile";
import { highlights } from "../agents/proposal";
import { activeSource } from "../upwork/source";
import type { PortfolioChoices } from "./similarWork";

/*
 * Portfolio items for a proposal (David, 2026-10-20: "a way to attach portfolio items", web and phone).
 * Two kinds, because Upwork only attaches one of them:
 *   - Upwork portfolio items - real attachments. Their ids go in portfolioProjectIds and preview() sends them as
 *     portfolio_project_ids. The list comes from get_profile list_highlights, cached a day; a page view never
 *     calls Upwork, only the Refresh button does (through the ban-safety guard like every other call).
 *   - Portfolio-site projects (knowledge_base/portfolio.json, each with a public page). Upwork can't attach these,
 *     so attaching one adds a visible "Similar work:" line to the letter (lib/proposals/similarWork.ts).
 */

export type { PortfolioChoices } from "./similarWork";

export async function portfolioChoices(jobId: string | null, opts: { refresh?: boolean } = {}): Promise<PortfolioChoices> {
  const h = await highlights({ force: opts.refresh === true, fetch: opts.refresh === true });
  const job = jobId ? await getJob(jobId) : null;
  const projects = catalogue().projects
    .filter((p): p is typeof p & { url: string } => !!p.url)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .map((p) => ({ id: p.id, title: p.title, url: p.url, summary: p.summary, date: p.date }));
  const relevant = job
    ? relevantProjects(`${job.title} ${job.skills.join(" ")} ${(job.enrichment?.description || job.description).slice(0, 3000)}`, 5).filter((p) => p.url).map((p) => p.id)
    : [];
  return {
    upwork: { items: h?.portfolio_projects ?? [], checkedAt: h ? new Date(h.fetchedAt).toISOString() : null, canRefresh: (await activeSource()) === "mcp" },
    site: { relevant, projects },
  };
}
