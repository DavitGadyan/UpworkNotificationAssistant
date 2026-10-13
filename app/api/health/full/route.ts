import { healthReport } from "@/lib/health";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Full polling-health report (per feed) for the signed-in dashboard and mobile app. Not public. */
export async function GET() {
  return json(await healthReport());
}
