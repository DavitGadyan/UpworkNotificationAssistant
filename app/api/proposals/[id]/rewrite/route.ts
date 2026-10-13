import { rewriteProposal } from "@/lib/agents/proposal";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** "Rewrite shorter": restructure an existing draft (greeting → opener → Loom → deliverables → budget → question), ≤ 900 chars. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await rewriteProposal(Number((await params).id))); } catch (e) { return bad((e as Error).message, 502); }
}
