import { getProposal } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { editDraft, GateError } from "@/lib/proposals/submit";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await getProposal(Number((await params).id));
  return p ? json(p) : bad("Not found", 404);
}

/** Edit text / answers / bid (the editor autosaves). A real change after approval drops the proposal back to "ready". */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Parameters<typeof editDraft>[1] = {};
  if (typeof b.coverLetter === "string") patch.coverLetter = b.coverLetter.slice(0, 5000);
  if (Array.isArray(b.answers)) patch.answers = (b.answers as { question: string; answer: string }[]).map((a) => ({ question: String(a.question), answer: String(a.answer) }));
  if (b.bid !== undefined) {
    const bid = b.bid === null || b.bid === "" ? null : Number(b.bid);
    if (bid !== null && !Number.isFinite(bid)) return bad("Bid must be a number", 400);
    patch.bid = bid;
  }
  if (typeof b.estimatedDuration === "string") patch.estimatedDuration = b.estimatedDuration;
  if (Array.isArray(b.portfolioProjectIds)) patch.portfolioProjectIds = b.portfolioProjectIds.map(String);
  try { return json(await editDraft(id, patch)); } catch (e) { return bad((e as Error).message, e instanceof GateError ? 409 : 500); }
}
