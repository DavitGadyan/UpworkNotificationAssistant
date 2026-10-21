/*
 * Portfolio items for a proposal (mirrors lib/proposals/similarWork.ts on the server - keep them in step).
 *   - Upwork portfolio items are real attachments: their ids are saved as portfolioProjectIds and sent with the
 *     Upwork preview.
 *   - Portfolio-site projects can't be attached by Upwork, so attaching one adds a visible "Similar work:" line
 *     with its link to the cover letter.
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

/** One "Similar work:" block holds every link; a new block goes just before DELIVERABLES: or the closing paragraph. */
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

/** Take a link out again; the "Similar work:" heading goes too once its last link is removed. */
export function removeProjectLink(cover: string, url: string): string {
  if (!hasProjectLink(cover, url)) return cover;
  return cover.replace(/\r/g, "").split(/\n\s*\n/)
    .map((b) => b.split("\n").filter((l) => !l.includes(url)).join("\n"))
    .filter((b) => b.trim() && !(HEADING_RE.test(b.trim()) && b.trim().split("\n").length === 1))
    .join("\n\n");
}
