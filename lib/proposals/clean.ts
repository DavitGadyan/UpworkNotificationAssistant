/*
 * Client-facing proposal text must read as David's own, finished writing (David, 2026-10-19): no notes to David
 * ("[DAVID: add link]"), no fill-in slots, no TODOs, and the section headings in capitals (DELIVERABLES:, BUDGET:).
 * Shared by the writer (lib/agents/proposal.ts), the edit route and the submit gate (lib/proposals/submit.ts).
 */

const LOOM_PLACEHOLDER = "{{LOOM_URL}}";

// [DAVID: …], [TODO], [add link], [X], [NOTE: …] - but not a markdown link "[text](url)".
const BRACKET = /\[([^\[\]\n]{1,400})\](?!\()/g;
const BRACKET_NOTE = /^\s*(david|todo|tbd|fixme|note|add|insert|fill|replace|placeholder|link|url|number|name|your|client|x|y|n|\.\.\.|…)\b/i;
const BRACKET_LABEL = /^\s*[A-Z][A-Z ]{1,20}:/; // [CHECK: …], [EDIT: …]
// <number or range>, <client name> - template slots copied from the prompt.
const ANGLE = /<([a-z][a-z0-9 ,_\-\/']{1,60})>/gi;
const MUSTACHE = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;
const BARE = /\b(TODO|TBD|FIXME|XXX)\b|\bfrom X to Y\b/g;

/** Notes, slots and markers left in proposal text that the client must never see. Empty = clean. */
export function findPlaceholders(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(BRACKET)) if (BRACKET_NOTE.test(m[1]) || BRACKET_LABEL.test(m[1]) || /\bdavid\b/i.test(m[1])) found.push(m[0]);
  for (const m of text.matchAll(ANGLE)) found.push(m[0]);
  for (const m of text.matchAll(MUSTACHE)) if (m[0] !== LOOM_PLACEHOLDER) found.push(m[0]);
  for (const m of text.matchAll(BARE)) found.push(m[0]);
  return [...new Set(found)];
}

export interface PlaceholderHit { field: string; found: string[] }

/** Every field of a proposal that still has a note or slot in it ("Cover letter", "Answer 2"…). */
export function placeholderHits(p: { coverLetter: string; answers: { answer: string }[] }): PlaceholderHit[] {
  return [
    { field: "Cover letter", found: findPlaceholders(p.coverLetter) },
    ...p.answers.map((a, i) => ({ field: `Answer ${i + 1}`, found: findPlaceholders(a.answer) })),
  ].filter((h) => h.found.length);
}

/** One line for an error or a Telegram message: 'Answer 2 still has a note to you: "[DAVID: …]"'. */
export const describeHits = (hits: PlaceholderHit[]) =>
  hits.map((h) => `${h.field} still has a note to you: ${h.found.map((f) => `"${f.length > 80 ? `${f.slice(0, 77)}…` : f}"`).join(", ")}`).join("; ");

/** Cut every note/slot out of the text (last resort after the writer's own fix-up pass); returns what was removed. */
export function removePlaceholders(text: string): { text: string; removed: string[] } {
  const removed = findPlaceholders(text);
  let out = text;
  for (const r of removed) out = out.split(r).join("");
  out = out.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, removed };
}

/** Section headings in capitals: "Deliverables:" → "DELIVERABLES:", "budget :" → "BUDGET:". */
export const normalizeHeadings = (cover: string) =>
  cover.replace(/^([ \t]*)deliverables[ \t]*:/gim, "$1DELIVERABLES:").replace(/^([ \t]*)budget[ \t]*:/gim, "$1BUDGET:");
