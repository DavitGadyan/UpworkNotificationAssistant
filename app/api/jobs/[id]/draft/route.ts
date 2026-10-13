import { draftProposal } from "@/lib/agents/proposal";
import { setJobStatus } from "@/lib/db";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** ProposalDraftAssistant: research + big-fish diagnosis + draft. Never submits. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { guidance?: string; webSearch?: boolean };
  try {
    const p = await draftProposal(id, { guidance: body.guidance, webSearch: body.webSearch });
    await setJobStatus(id, "drafting");
    return json(p, 201);
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
