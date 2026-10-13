import { bad, json } from "@/lib/http";
import { claudeFetchRunning, fetchViaClaude, lastClaudeFetch, type ClaudeFeed } from "@/lib/upwork/claudeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** GET: last run + whether one is running. POST {feeds?: ["most_recent","best_match"]}: run now. */
export async function GET() {
  return json({ running: await claudeFetchRunning(), last: await lastClaudeFetch() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { feeds?: string[] };
  const kinds = (b.feeds ?? ["most_recent", "best_match"]).filter((k): k is ClaudeFeed => k === "most_recent" || k === "best_match");
  if (!kinds.length) return bad("Pick most_recent and/or best_match");
  try { return json(await fetchViaClaude(kinds)); } catch (e) { return bad((e as Error).message, 502); }
}
