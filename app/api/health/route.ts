import { healthReport } from "@/lib/health";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Polling SLO for Docker / uptime monitors (public, so it reveals no feed names or errors):
 * 200 when every enabled feed fetched on time and the worker is alive, 503 otherwise.
 * Details are on the dashboard Overview.
 */
export async function GET() {
  const r = await healthReport();
  return json({ ok: r.ok, workerStale: r.workerStale, lateFeeds: r.feeds.filter((f) => f.late).length, feeds: r.feeds.length, lateAfterMin: r.lateAfterMin }, r.ok ? 200 : 503);
}
