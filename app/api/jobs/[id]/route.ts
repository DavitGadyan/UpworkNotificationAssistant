import { getJob, setJobStatus } from "@/lib/db";
import { bad, json } from "@/lib/http";
import type { JobStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const job = await getJob(decodeURIComponent((await params).id));
  return job ? json(job) : bad("Not found (jobs are deleted after 24h)", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const { status } = (await req.json().catch(() => ({}))) as { status?: JobStatus };
  if (!status || !["new", "notified", "called", "dismissed"].includes(status)) return bad("Invalid status");
  if (!await getJob(id)) return bad("Not found", 404);
  await setJobStatus(id, status);
  return json({ ok: true });
}
