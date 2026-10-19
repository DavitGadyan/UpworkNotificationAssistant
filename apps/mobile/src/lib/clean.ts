import { LOOM_PLACEHOLDER } from "./format";

/*
 * Client-facing text checks for the copy-and-paste route (mirrors lib/proposals/clean.ts on the server).
 * The client must never see a note to David ("[DAVID: add link]"), a fill-in slot or a TODO, and the section
 * headings are in capitals (DELIVERABLES:, BUDGET:). The server gate refuses the same things.
 */

// [DAVID: …], [TODO], [add link], [X], [NOTE: …] - but not a markdown link "[text](url)".
const BRACKET = /\[([^\[\]\n]{1,400})\](?!\()/g;
const BRACKET_NOTE = /^\s*(david|todo|tbd|fixme|note|add|insert|fill|replace|placeholder|link|url|number|name|your|client|x|y|n|\.\.\.|…)\b/i;
const BRACKET_LABEL = /^\s*[A-Z][A-Z ]{1,20}:/;
const ANGLE = /<([a-z][a-z0-9 ,_\-\/']{1,60})>/gi;
const MUSTACHE = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;
const BARE = /\b(TODO|TBD|FIXME|XXX)\b|\bfrom X to Y\b/g;

/** Notes, slots and markers the client must never see. Empty = clean. */
export function findPlaceholders(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(BRACKET)) if (BRACKET_NOTE.test(m[1]) || BRACKET_LABEL.test(m[1]) || /\bdavid\b/i.test(m[1])) found.push(m[0]);
  for (const m of text.matchAll(ANGLE)) found.push(m[0]);
  for (const m of text.matchAll(MUSTACHE)) if (m[0] !== LOOM_PLACEHOLDER) found.push(m[0]);
  for (const m of text.matchAll(BARE)) found.push(m[0]);
  return [...new Set(found)];
}

/** Section headings in capitals: "Deliverables:" → "DELIVERABLES:", "budget :" → "BUDGET:". */
export const normalizeHeadings = (cover: string) =>
  cover.replace(/^([ \t]*)deliverables[ \t]*:/gim, "$1DELIVERABLES:").replace(/^([ \t]*)budget[ \t]*:/gim, "$1BUDGET:");

/** Remove the "Loom: {{LOOM_URL}}" line when no video is attached - pasting the placeholder would show it to the client. */
export const stripLoomLine = (cover: string) =>
  cover.split("\n").filter((l) => !l.includes(LOOM_PLACEHOLDER)).join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** The cover letter exactly as it should be pasted into Upwork. */
export const letterForUpwork = (cover: string) => normalizeHeadings(stripLoomLine(cover));

/** Upwork's apply page for a job ("~02…" ciphertext from the job or its URL); null when it can't be worked out. */
export function applyUrl(job: { ciphertext?: string | null; url?: string | null }): string | null {
  const cipher = job.ciphertext || job.url?.match(/~0[0-9a-z]+/i)?.[0];
  return cipher ? `https://www.upwork.com/nx/proposals/job/${cipher}/apply/` : null;
}

/** Upwork's "project length" choices for fixed-price jobs. */
export const DURATIONS = ["Less than 1 month", "1 to 3 months", "3 to 6 months", "More than 6 months"] as const;
