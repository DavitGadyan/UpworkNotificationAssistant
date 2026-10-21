import { bad, json } from "@/lib/http";
import { portfolioChoices } from "@/lib/proposals/portfolio";

export const dynamic = "force-dynamic";

/**
 * Portfolio items the proposal editor can attach: Upwork portfolio items (real attachments) and portfolio-site
 * projects (links for the letter), ranked for ?jobId=. ?refresh=1 re-reads the Upwork list (one guarded call).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    return json(await portfolioChoices(u.searchParams.get("jobId"), { refresh: u.searchParams.get("refresh") === "1" }));
  } catch (e) {
    return bad(`Could not read your Upwork portfolio: ${(e as Error).message}`, 502);
  }
}
