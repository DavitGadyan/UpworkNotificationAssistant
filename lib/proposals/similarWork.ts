/*
 * The "Similar work:" block in a cover letter - pure, so the browser editor uses it directly.
 * Mirrored in apps/mobile/src/lib/portfolio.ts (the phone app can't import from the web app).
 * Portfolio-site projects can't be attached by Upwork, so attaching one adds a visible line with its link.
 */

export interface UpworkPortfolioItem { id: string; title: string }
export interface SiteProject { id: string; title: string; url: string; summary: string; date: string | null }
export interface PortfolioChoices {
  upwork: { items: UpworkPortfolioItem[]; checkedAt: string | null; canRefresh: boolean };
  site: { relevant: string[]; projects: SiteProject[] };
}

export const SIMILAR_HEADING = "Similar work:";
const HEADING_RE = /^similar work\s*:/i;
const lineFor = (p: { title: string; url: string }) => `- ${p.title}: ${p.url}`;

export const hasProjectLink = (cover: string, url: string) => cover.includes(url);

/**
 * Add a project link to the letter. One "Similar work:" block holds all of them; a new block goes just before
 * DELIVERABLES: (after the opener and Loom), or before the closing paragraph when there is no DELIVERABLES block.
 */
export function addProjectLink(cover: string, p: { title: string; url: string }): string {
  if (hasProjectLink(cover, p.url)) return cover;
  const blocks = cover.replace(/\r/g, "").trim().split(/\n\s*\n/);
  const at = blocks.findIndex((b) => HEADING_RE.test(b.trim()));
  if (at !== -1) {
    blocks[at] = `${blocks[at].trimEnd()}\n${lineFor(p)}`;
    return blocks.join("\n\n");
  }
  const block = `${SIMILAR_HEADING}\n${lineFor(p)}`;
  if (!blocks.some((b) => b.trim())) return block;
  const deliverables = blocks.findIndex((b) => /^deliverables\s*:/i.test(b.trim()));
  const pos = deliverables !== -1 ? deliverables : blocks.length > 1 ? blocks.length - 1 : blocks.length;
  blocks.splice(pos, 0, block);
  return blocks.join("\n\n");
}

/** Take a project link out again; the "Similar work:" heading goes too once its last link is removed. */
export function removeProjectLink(cover: string, url: string): string {
  if (!hasProjectLink(cover, url)) return cover;
  return cover.replace(/\r/g, "").split(/\n\s*\n/)
    .map((b) => b.split("\n").filter((l) => !l.includes(url)).join("\n"))
    .filter((b) => b.trim() && !(HEADING_RE.test(b.trim()) && b.trim().split("\n").length === 1))
    .join("\n\n");
}
