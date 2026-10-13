import { listProposals } from "@/lib/db";
import { json } from "@/lib/http";
import type { ProposalStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  return json(await listProposals({ jobId: p.get("job") ?? undefined, status: (p.get("status") as ProposalStatus) ?? undefined }));
}
