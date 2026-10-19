import { addFeedback, getJob, getProposal, setJobStatus, updateProposal } from "../db";
import type { Proposal } from "../types";
import { callTool } from "../upwork/mcp/client";
import { LOOM_PLACEHOLDER } from "../agents/proposal";
import { describeHits, normalizeHeadings, placeholderHits } from "./clean";

/*
 * The submit gate. Nothing reaches Upwork unless every step below happened, in order, by a person:
 *   1. attachLoom  - a real Loom share link replaces the {{LOOM_URL}} placeholder   → status "ready"
 *   2. approve     - David approves the final text                                  → status "approved"
 *   3. preview     - manage_proposals create (or accept_invitation) builds Upwork's preview
 *                    (Connects cost, balance, boost, unmet qualifications)         → status "previewed"
 *   4. submit      - confirm_preview with the stored preview_id (second tap)       → status "submitted"
 * Editing the text after approval drops back to "ready". approve, approveAuto and preview refuse a letter or answer
 * that still has a note to David or a fill-in slot ("[DAVID: add link]") - lib/proposals/clean.ts.
 * The one exception is night auto-apply (lib/autoapply.ts, off by default, David 2026-10-18): approveAuto() stands
 * in for steps 1-2 - the Loom line is removed and the proposal is marked preview.auto - and the worker then runs
 * preview and submit itself, inside the Settings → Auto-apply limits. Proposals approved by hand still need Loom.
 */

export class GateError extends Error {}

const LOOM_RE = /^https:\/\/(www\.)?loom\.com\/(share|embed)\/[a-zA-Z0-9]+/;

/**
 * A Loom share link, or a branded short link (Rebrandly, own domain…) that redirects to one. A branded link
 * is followed and counts only when it lands on a real loom.com video; the client sees the branded link.
 */
export async function isLoomLink(raw: string): Promise<boolean> {
  const url = raw.trim();
  if (LOOM_RE.test(url)) return true;
  if (!/^https:\/\/[^\s/]+\.[^\s/]+\/\S+$/.test(url)) return false;
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "Mozilla/5.0" } });
    void r.body?.cancel();
    return LOOM_RE.test(r.url);
  } catch {
    return false;
  }
}

export async function editDraft(id: number, patch: Partial<Pick<Proposal, "coverLetter" | "answers" | "bid" | "estimatedDuration" | "portfolioProjectIds">>): Promise<Proposal> {
  const p = await must(id);
  if (p.status === "submitted") throw new GateError("Already submitted");
  if (patch.coverLetter != null) patch = { ...patch, coverLetter: normalizeHeadings(patch.coverLetter) };
  // The editor autosaves as David types: a save that changes nothing must not undo an approval or a preview.
  if ((Object.keys(patch) as (keyof typeof patch)[]).every((k) => JSON.stringify(patch[k] ?? null) === JSON.stringify(p[k] ?? null))) return p;
  const status = p.status === "approved" || p.status === "previewed" ? (p.loomUrl ? "ready" : "needs_loom") : p.status;
  return (await updateProposal(id, { ...patch, status, approvedAt: status === "ready" ? null : p.approvedAt, previewId: null, preview: { ...(p.preview ?? {}), upwork: undefined } }))!;
}

export async function attachLoom(id: number, url: string): Promise<Proposal> {
  const p = await must(id);
  if (p.status === "submitted") throw new GateError("Already submitted");
  if (!(await isLoomLink(url))) throw new GateError("Paste a Loom share link (https://www.loom.com/share/…) or a short link that redirects to one");
  const loom = url.trim();
  const cover = p.coverLetter.includes(LOOM_PLACEHOLDER)
    ? p.coverLetter.replaceAll(LOOM_PLACEHOLDER, loom)
    : p.loomUrl ? p.coverLetter.replaceAll(p.loomUrl, loom) : `${p.coverLetter}\n\nLOOM VIDEO: ${loom}`;
  return (await updateProposal(id, { loomUrl: loom, coverLetter: cover, status: "ready", approvedAt: null, previewId: null }))!;
}

export async function approve(id: number): Promise<Proposal> {
  const p = await must(id);
  if (!p.loomUrl || !(await isLoomLink(p.loomUrl))) throw new GateError("Attach the Loom video first (the link must open a Loom video)");
  if (p.coverLetter.includes(LOOM_PLACEHOLDER)) throw new GateError("The cover letter still has the Loom placeholder");
  assertClientReady(p);
  if (p.status !== "ready") throw new GateError(`Can't approve a proposal in status "${p.status}"`);
  // Record how much David changed the draft - a strong preference signal for the writer prompt.
  const changed = similarity(p.originalDraft.replace(LOOM_PLACEHOLDER, p.loomUrl), p.coverLetter);
  await addFeedback({ kind: "draft", refId: String(id), rating: changed > 0.9 ? 1 : 0, reason: null, data: { similarity: changed, promptVersion: p.promptVersion, model: p.model } });
  return (await updateProposal(id, { status: "approved", approvedAt: new Date().toISOString() }))!;
}

/** Night auto-apply only: approve an auto-drafted proposal without a Loom video (the "Loom:" line is removed). */
export async function approveAuto(id: number): Promise<Proposal> {
  const p = await must(id);
  if (p.status !== "needs_loom" && p.status !== "ready") throw new GateError(`Can't auto-approve a proposal in status "${p.status}"`);
  const cover = p.loomUrl ? p.coverLetter : stripLoomLine(p.coverLetter);
  if (cover.includes(LOOM_PLACEHOLDER)) throw new GateError("The cover letter still has the Loom placeholder");
  assertClientReady({ coverLetter: cover, answers: p.answers });
  return (await updateProposal(id, { coverLetter: cover, status: "approved", approvedAt: new Date().toISOString(), previewId: null, preview: { ...(p.preview ?? {}), auto: true } }))!;
}
/** Remove the "Loom: {{LOOM_URL}}" line (and the blank line it leaves) from a draft. */
export const stripLoomLine = (cover: string) =>
  cover.split("\n").filter((l) => !l.includes(LOOM_PLACEHOLDER)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
const autoApproved = (p: Proposal) => p.preview?.auto === true;

export async function preview(id: number): Promise<Proposal> {
  const p = await must(id);
  if (p.status !== "approved" || !p.approvedAt || (!p.loomUrl && !autoApproved(p))) throw new GateError("Approve the proposal (with its Loom video) first");
  if (p.bid == null || p.bid <= 0) throw new GateError("Set a bid amount first");
  assertClientReady(p);

  // Upwork rejects create when an invitation or a proposal already exists for the job - check both.
  const inv = await callTool<{ invitations?: { id: string }[]; data?: unknown }>("list_freelancer_proposals", "invitations", { job_posting_id: p.jobId, limit: 1 });
  const invitationId = inv.invitations?.[0]?.id ?? null;
  const existing = await callTool<{ proposals?: { job?: { id?: string }; jobPosting?: { id?: string } }[] }>("list_freelancer_proposals", "list", { status: "Accepted", limit: 10 });
  if ((existing.proposals ?? []).some((x) => (x.job?.id ?? x.jobPosting?.id) === p.jobId)) throw new GateError("You already have a proposal on this job");

  const common = {
    cover_letter: p.coverLetter,
    ...(p.answers.length ? { answers: p.answers } : {}),
    ...(p.portfolioProjectIds.length ? { portfolio_project_ids: p.portfolioProjectIds } : {}),
  };
  // Hourly jobs refuse estimated_duration / payment_mode / milestones; fixed-price jobs require estimated_duration and
  // payment_mode. The job type comes from our job record (the draft's bidType is only the writer's guess); if Upwork
  // says it is the other kind, rebuild once with the right fields.
  const job = await getJob(p.jobId);
  const create = async (fixed: boolean) => {
    const terms: Record<string, unknown> = {};
    if (fixed) {
      const duration = durationEnum(p.estimatedDuration);
      if (!duration) throw new GateError("This is a fixed-price job: set the estimated duration (e.g. 1 to 3 months) first");
      terms.estimated_duration = duration;
      terms.payment_mode = "by_project"; // the whole amount on delivery; milestones are set with the client later
    }
    try {
      return await callTool<Record<string, unknown>>("manage_proposals", "create", { job_reference: p.jobId, charged_amount: p.bid, ...common, ...terms });
    } catch (e) {
      return { error: (e as Error).message } as Record<string, unknown>;
    }
  };
  const kindMismatch = (r: Record<string, unknown>) => {
    const t = JSON.stringify(r);
    return /This is a fixed-price job/i.test(t) ? "fixed" : /This is an hourly job/i.test(t) ? "hourly" : null;
  };
  let r: Record<string, unknown>;
  if (invitationId) {
    r = await callTool<Record<string, unknown>>("manage_proposals", "accept_invitation", { invitation_uid: invitationId, bid: p.bid, ...common });
  } else {
    let fixed = job ? job.jobType === "FIXED" : (p.preview?.bidType as string | undefined) === "fixed";
    r = await create(fixed);
    const actual = kindMismatch(r);
    if (actual && (actual === "fixed") !== fixed) { fixed = actual === "fixed"; r = await create(fixed); }
    if (typeof r.error === "string") throw new GateError(r.error);
  }
  const previewId = (r.preview_id ?? (r.preview as Record<string, unknown> | undefined)?.preview_id ?? r.draft_id) as string | undefined;
  if (!previewId) throw new GateError(`Upwork did not return a preview: ${JSON.stringify(r).slice(0, 400)}`);
  return (await updateProposal(id, {
    status: "previewed", previewId,
    preview: { ...(p.preview ?? {}), upwork: r, type: invitationId ? "proposal_accept_invitation" : "proposal" },
  }))!;
}

export async function submit(id: number, confirmText: string): Promise<Proposal> {
  const p = await must(id);
  if (confirmText !== "SUBMIT") throw new GateError('Type SUBMIT to confirm');
  if (p.status !== "previewed" || !p.previewId) throw new GateError("Build the Upwork preview first");
  if ((!p.loomUrl && !autoApproved(p)) || !p.approvedAt) throw new GateError("Loom video and approval are required");
  const type = (p.preview?.type as string | undefined) ?? "proposal";
  const r = await callTool<Record<string, unknown>>("confirm_preview", "confirm", { type, preview_id: p.previewId });
  await setJobStatus(p.jobId, "applied");
  return (await updateProposal(id, { status: "submitted", submittedAt: new Date().toISOString(), preview: { ...(p.preview ?? {}), submitResult: r } }))!;
}

/**
 * Copy-paste route (David, 2026-10-19): David pasted the text into Upwork himself and sent it there. Nothing is
 * called on Upwork - this only records that he applied. The text must still be client-ready.
 */
export async function markApplied(id: number): Promise<Proposal> {
  const p = await must(id);
  if (p.status === "submitted") throw new GateError("Already submitted");
  if (p.status === "discarded") throw new GateError("This proposal was discarded");
  if (p.coverLetter.includes(LOOM_PLACEHOLDER) && !p.loomUrl) throw new GateError("The cover letter still has the Loom placeholder");
  assertClientReady(p);
  await setJobStatus(p.jobId, "applied");
  return (await updateProposal(id, { status: "submitted", submittedAt: new Date().toISOString(), preview: { ...(p.preview ?? {}), manual: true } }))!;
}

export async function discard(id: number): Promise<Proposal> {
  const p = await must(id);
  if (p.status === "submitted") throw new GateError("Already submitted");
  return (await updateProposal(id, { status: "discarded" }))!;
}

/** Upwork's duration values from what the draft or David wrote ("1 to 3 months", "1_to_3_months", "6+ months"…). */
export function durationEnum(v: string | null | undefined): string | null {
  const t = (v ?? "").toLowerCase().replace(/_/g, " ");
  if (!t.trim()) return null;
  if (/less than 1|< ?1 ?month|under a month|week/.test(t)) return "less_than_1_month";
  if (/1 ?(to|-) ?3/.test(t)) return "1_to_3_months";
  if (/3 ?(to|-) ?6/.test(t)) return "3_to_6_months";
  if (/more than 6|6\+|over 6|> ?6/.test(t)) return "more_than_6_months";
  return null;
}

/** No note to David, fill-in slot or TODO may reach the client - in the letter or in any screening answer. */
function assertClientReady(p: { coverLetter: string; answers: { answer: string }[] }) {
  const hits = placeholderHits(p);
  if (hits.length) throw new GateError(`${describeHits(hits)}. Remove it before sending.`);
}

async function must(id: number): Promise<Proposal> {
  const p = await getProposal(id);
  if (!p) throw new GateError("Proposal not found");
  return p;
}

/** Token-set similarity 0..1 between the AI draft and what David approved. */
export function similarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().match(/\w+/g) ?? []), tb = new Set(b.toLowerCase().match(/\w+/g) ?? []);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return ta.size + tb.size ? (2 * inter) / (ta.size + tb.size) : 1;
}
