import { healthReport } from "@/lib/health";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Polling SLO for Docker / uptime monitors (public, so it reveals no feed names or errors):
 * 200 when the worker is alive, Upwork calls aren't stopped, and (when the worker searches) every feed fetched on time; 503 otherwise.
 * Details are on the dashboard Overview.
 */
export async function GET() {
  const r = await healthReport();
  // Feed lateness counts only when the worker is the searcher; the pacing state (normal / slow / stopped) always shows.
  const workerSearches = r.pacing.poller === "worker";
  return json({
    ok: r.ok, workerStale: r.workerStale, pacing: r.pacing.state,
    lateFeeds: workerSearches ? r.feeds.filter((f) => f.late).length : 0, feeds: r.feeds.length, lateAfterMin: r.lateAfterMin,
  }, r.ok ? 200 : 503);
}
