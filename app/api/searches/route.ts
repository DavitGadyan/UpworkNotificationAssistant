import { createSearch, listSearches } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { cleanSearch } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await listSearches());
}

export async function POST(req: Request) {
  const input = cleanSearch(await req.json().catch(() => ({})));
  if (typeof input === "string") return bad(input);
  if ((await listSearches()).length >= 10) return bad("Up to 10 saved searches (keeps usage far below the API limit)");
  return json(await createSearch(input), 201);
}
