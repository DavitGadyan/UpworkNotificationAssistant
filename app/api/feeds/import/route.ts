import { createSearch, listSearches } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { importUpworkUrl } from "@/lib/upwork/urlImport";

export const dynamic = "force-dynamic";

/** Paste an Upwork URL (Most Recent, Best Matches or a job search) → a feed. The page itself is never fetched. */
export async function POST(req: Request) {
  const { url, name } = (await req.json().catch(() => ({}))) as { url?: string; name?: string };
  if (!url) return bad("Paste an Upwork link");
  const f = importUpworkUrl(url);
  if (typeof f === "string") return bad(f);
  if ((await listSearches()).length >= 10) return bad("Up to 10 feeds (keeps usage far below Upwork's limits)");
  if (f.kind !== "search" && (await listSearches()).some((s) => s.kind === f.kind)) return bad(`A ${f.name} feed already exists`);
  return json(await createSearch({ ...f, name: name?.trim() || f.name }), 201);
}
