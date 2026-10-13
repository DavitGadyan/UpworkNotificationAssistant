import { getWorkerHeartbeat } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** When the worker last finished a cycle - the dashboard re-renders when this changes. */
export async function GET() {
  const hb = await getWorkerHeartbeat();
  return json({ at: hb?.at ?? null, lastFetched: hb?.lastFetched ?? 0 });
}
