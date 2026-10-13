import { addFeedback, getProposal, setJobStatus, updateProposal } from "../db";
import type { Proposal } from "../types";
import { callTool } from "../upwork/mcp/client";
import { LOOM_PLACEHOLDER } from "../agents/proposal";

/*
 * The submit gate. Nothing reaches Upwork unless every step below happened, in order, by a person:
 *   1. attachLoom  - a real Loom share link replaces the {{LOOM_URL}} placeholder   → status "ready"
 *   2. approve     - David approves the final text                                  → status "approved"
 *   3. preview     - manage_proposals create (or accept_invitation) builds Upwork's preview
 *                    (Connects cost, balance, boost, unmet qualifications)         → status "previewed"
 *   4. submit      - confirm_preview with the stored preview_id (second tap)       → status "submitted"
 * The worker never calls any of these. Editing the text after approval drops back to "ready".
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
  if (p.status !== "ready") throw new GateError(`Can't approve a proposal in status "${p.status}"`);
  // Record how much David changed the draft - a strong preference signal for the writer prompt.
  const changed = similarity(p.originalDraft.replace(LOOM_PLACEHOLDER, p.loomUrl), p.coverLetter);
  await addFeedback({ kind: "draft", refId: String(id), rating: changed > 0.9 ? 1 : 0, reason: null, data: { similarity: changed, promptVersion: p.promptVersion, model: p.model } });
  return (await updateProposal(id, { status: "approved", approvedAt: new Date().toISOString() }))!;
}

export async function preview(id: number): Promise<Proposal> {
  const p = await must(id);
  if (p.status !== "approved" || !p.approvedAt || !p.loomUrl) throw new GateError("Approve the proposal (with its Loom video) first");
  if (p.bid == null || p.bid <= 0) throw new GateError("Set a bid amount first");

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
  const r = invitationId
    ? await callTool<Record<string, unknown>>("manage_proposals", "accept_invitation", { invitation_uid: invitationId, bid: p.bid, ...common })
    : await callTool<Record<string, unknown>>("manage_proposals", "create", {
      job_reference: p.jobId, charged_amount: p.bid, ...common,
      ...(p.estimatedDuration ? { estimated_duration: p.estimatedDuration } : {}),
    });
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
  if (!p.loomUrl || !p.approvedAt) throw new GateError("Loom video and approval are required");
  const type = (p.preview?.type as string | undefined) ?? "proposal";
  const r = await callTool<Record<string, unknown>>("confirm_preview", "confirm", { type, preview_id: p.previewId });
  await setJobStatus(p.jobId, "applied");
  return (await updateProposal(id, { status: "submitted", submittedAt: new Date().toISOString(), preview: { ...(p.preview ?? {}), submitResult: r } }))!;
}

export async function discard(id: number): Promise<Proposal> {
  const p = await must(id);
  if (p.status === "submitted") throw new GateError("Already submitted");
  return (await updateProposal(id, { status: "discarded" }))!;
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
