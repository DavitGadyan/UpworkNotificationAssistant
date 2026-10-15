import { LOOM_PLACEHOLDER } from "../agents/proposal";
import { listProposalOutcomesSafe, listProposals } from "../db";
import { similarity } from "../proposals/submit";
import type { OutcomeLabel, Proposal, ProposalOutcome } from "../types";
import { isHire, isOffer } from "./outcomes";

/*
 * What David changes in the AI's drafts before sending them. Each submitted draft is compared with what
 * actually went to the client (the cover letter read back from Upwork when we have it, else the approved text).
 *   - used automatically: the closest pairs become "draft → what David sent" examples in the writer's prompt,
 *     pairs whose final version got a reply or a hire first (editExamples);
 *   - used with approval: the weekly lessons report turns patterns in the edits into writer rules that only
 *     reach the prompt after David approves them (lib/learning/lessons.ts).
 */

export const EDITED_BELOW = 0.97; // similarity under this = David really changed something

export interface EditSummary {
  similarity: number;
  lengthBefore: number;
  lengthAfter: number;
  openerChanged: boolean;
  greetingChanged: boolean;
  signoffChanged: boolean;
  bidBefore: number | null;
  bidAfter: number | null;
  removed: string[];
  added: string[];
}

export interface EditPair {
  proposalId: number;
  jobId: string;
  jobTitle: string;
  field: string | null;
  submittedAt: string | null;
  draft: string;
  final: string;
  summary: EditSummary;
  outcome: OutcomeLabel | null;
  offer: boolean;
  hired: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => norm(x).length > 3);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const opener = (s: string) => norm(lines(s).find((l, i) => i > 0 && !/^loom/i.test(l)) ?? "");

/** Pure: what changed between the AI draft and the version David sent. */
export function summarizeEdit(draft: string, final: string, bidBefore: number | null = null, bidAfter: number | null = null): EditSummary {
  const d = sentences(draft), f = sentences(final);
  const dn = new Set(d.map(norm)), fn = new Set(f.map(norm));
  const dl = lines(draft), fl = lines(final);
  return {
    similarity: Math.round(similarity(draft, final) * 100) / 100,
    lengthBefore: draft.length,
    lengthAfter: final.length,
    openerChanged: opener(draft) !== opener(final),
    greetingChanged: norm(dl[0] ?? "") !== norm(fl[0] ?? ""),
    signoffChanged: norm(dl.at(-1) ?? "") !== norm(fl.at(-1) ?? ""),
    bidBefore,
    bidAfter,
    removed: d.filter((x) => !fn.has(norm(x))).slice(0, 6).map((x) => x.slice(0, 200)),
    added: f.filter((x) => !dn.has(norm(x))).slice(0, 6).map((x) => x.slice(0, 200)),
  };
}

/** Pure: build pairs from local proposals + outcomes. Ordered hired → offer → replied → newest. */
export function buildEditPairs(proposals: Proposal[], outcomes: ProposalOutcome[]): EditPair[] {
  const byLocal = new Map(outcomes.filter((o) => o.localProposalId != null).map((o) => [o.localProposalId!, o]));
  const byJob = new Map(outcomes.map((o) => [o.jobId, o]));
  const pairs: EditPair[] = [];
  for (const p of proposals) {
    if (p.status !== "submitted" || !p.originalDraft) continue;
    const o = byLocal.get(p.id) ?? byJob.get(p.jobId) ?? null;
    const draft = p.loomUrl ? p.originalDraft.replaceAll(LOOM_PLACEHOLDER, p.loomUrl) : p.originalDraft;
    const final = (o?.coverLetter && o.coverLetter.length > 80 ? o.coverLetter : p.coverLetter).trim();
    const summary = summarizeEdit(draft, final, p.originalBid ?? null, p.bid);
    if (summary.similarity >= EDITED_BELOW && summary.bidBefore === summary.bidAfter) continue;
    pairs.push({
      proposalId: p.id, jobId: p.jobId, jobTitle: p.jobTitle, field: o?.job?.field ?? null, submittedAt: p.submittedAt,
      draft, final, summary, outcome: o?.outcome ?? null, offer: o ? isOffer(o) : false, hired: o ? isHire(o) : false,
    });
  }
  const weight = (x: EditPair) => (x.hired ? 3 : x.offer ? 2 : x.outcome === "win" ? 1 : 0);
  return pairs.sort((a, b) => weight(b) - weight(a) || (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
}

export async function editPairs(): Promise<EditPair[]> {
  const [proposals, outcomes] = await Promise.all([listProposals({ status: "submitted" }), listProposalOutcomesSafe({ limit: 1000 })]);
  return buildEditPairs(proposals, outcomes);
}

const RESULT = (x: EditPair) => (x.hired ? "HIRED" : x.offer ? "got an offer" : x.outcome === "win" ? "client replied" : x.outcome === "loss_viewed" ? "viewed, no reply" : x.outcome === "loss_unviewed" ? "not viewed" : "waiting");

/** Pure: the prompt section with up to 3 pairs, same field first (after the outcome order). */
export function editExamplesSection(pairs: EditPair[], field: string | null): string {
  const ranked = [...pairs].sort((a, b) => Number(!!field && b.field === field) - Number(!!field && a.field === field));
  // keep the outcome order inside the same-field group: stable sort above preserves buildEditPairs order
  const picked = ranked.slice(0, 3);
  if (!picked.length) return "";
  return "\n\nHow David corrects your drafts (your draft → what he actually sent; write the next draft the way he would have edited it - the structure and length rules above always win; never reuse their facts):\n" +
    picked.map((x, i) => [
      `--- correction ${i + 1}: ${x.jobTitle}${x.field ? ` (${x.field})` : ""} · result: ${RESULT(x)}`,
      `What changed: ${[
        x.summary.greetingChanged && "greeting", x.summary.openerChanged && "opener", x.summary.signoffChanged && "sign-off",
        `length ${x.summary.lengthBefore}→${x.summary.lengthAfter} chars`,
        x.summary.bidBefore !== x.summary.bidAfter && x.summary.bidAfter != null ? `bid ${x.summary.bidBefore ?? "?"}→${x.summary.bidAfter}` : null,
      ].filter(Boolean).join(", ")}`,
      `YOUR DRAFT:\n${x.draft.slice(0, 900)}`,
      `DAVID SENT:\n${x.final.slice(0, 900)}`,
    ].join("\n")).join("\n");
}

export async function editExamples(field: string | null): Promise<string> {
  return editExamplesSection(await editPairs(), field);
}
