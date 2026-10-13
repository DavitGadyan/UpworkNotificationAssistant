import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kvGet, kvSet } from "../db";

/*
 * What the agents know about David. Two sources:
 *   - knowledge_base/portfolio.json - the curated project catalogue (from the portfolio site, via polishmycv);
 *   - the live Upwork profile (get_profile over MCP), cached in kv by lib/insights/profileSync.ts.
 * Agents may only cite facts that appear here. Nothing is invented.
 */

export interface PortfolioProject {
  id: string; title: string; client: string | null; date: string | null; url: string | null; summary: string;
  themes: string[]; industries: string[]; domains: string[]; skills: string[]; role: string | null; outcomes: string[];
}
interface Catalogue { generated: string | null; profile: Record<string, unknown>; projects: PortfolioProject[] }

let _cat: Catalogue | null = null;
export function catalogue(): Catalogue {
  if (_cat) return _cat;
  try {
    _cat = JSON.parse(readFileSync(join(process.cwd(), "knowledge_base", "portfolio.json"), "utf8")) as Catalogue;
  } catch {
    _cat = { generated: null, profile: {}, projects: [] };
  }
  return _cat;
}

export interface UpworkProfileCache {
  fetchedAt: string;
  title?: string | null;
  overview?: string | null;
  hourlyRate?: number | null;
  jss?: number | null;
  totalEarnings?: string | null;
  badges?: string[];
  skills?: string[];
  raw?: Record<string, unknown>;
}
export const upworkProfile = async () => await kvGet<UpworkProfileCache>("upwork_profile");
export const saveUpworkProfile = async (p: UpworkProfileCache) => await kvSet("upwork_profile", p);

/** Compact profile + project list for prompts (stable text, so it caches well). */
export async function profileDigest(opts: { projects?: boolean } = {}): Promise<string> {
  const c = catalogue();
  const p = c.profile as Record<string, unknown>;
  const live = await upworkProfile();
  const lines = [
    `Name: David Gadyan. ${p.headline ?? "Data Scientist and Agentic AI Developer"}.`,
    p.positioning ? `Positioning: ${p.positioning}` : "",
    `Experience: ${p.experience_years ?? 8}+ years, ${p.projects_delivered ?? "180+"} projects, ${p.long_term_clients ?? "50+"} long-term clients.`,
    `Credentials: ${(p.credentials as string[] | undefined)?.join("; ") ?? "Upwork Expert-Vetted (top 1%)"}. Previously ${p.previously ?? "Ernst & Young"}.`,
    `Education: ${(p.education as string[] | undefined)?.join("; ") ?? ""}`,
    `Services: ${(p.services as string[] | undefined)?.join(", ") ?? ""}`,
    p.core_stack ? `Core stack: ${JSON.stringify(p.core_stack)}` : "",
    "Portfolio website: https://davidgadyan.com/portfolio",
    live?.title ? `Upwork title: ${live.title}` : "",
    live?.hourlyRate ? `Upwork rate: $${live.hourlyRate}/hr` : "",
    live?.jss ? `Job Success Score: ${live.jss}%` : "",
    live?.totalEarnings ? `Upwork earnings: ${live.totalEarnings}` : "",
  ].filter(Boolean);
  if (opts.projects !== false) {
    lines.push("", "Portfolio projects (id | title | client | industries | summary | outcomes):");
    for (const pr of c.projects) {
      lines.push(`- ${pr.id} | ${pr.title} | ${pr.client ?? "private"} | ${pr.industries.join("/")} | ${pr.summary} | ${pr.outcomes.slice(0, 3).join("; ")}`);
    }
  }
  return lines.join("\n");
}

/** Top-k portfolio projects by keyword overlap with a job (cheap pre-selection before the LLM). */
export function relevantProjects(text: string, k = 6): PortfolioProject[] {
  const words = new Set(text.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) ?? []);
  return catalogue().projects
    .map((p) => {
      const hay = [p.title, p.summary, ...p.skills, ...p.domains, ...p.themes, ...p.industries].join(" ").toLowerCase();
      const toks = hay.match(/[a-z][a-z0-9+.#-]{2,}/g) ?? [];
      const score = new Set(toks.filter((t) => words.has(t))).size;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((x) => x.score > 0)
    .map((x) => x.p);
}
