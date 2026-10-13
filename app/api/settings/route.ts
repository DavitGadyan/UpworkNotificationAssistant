import { getSettings, saveSettings } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { cleanSettings } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getSettings());
}

export async function PUT(req: Request) {
  const next = cleanSettings(await req.json().catch(() => ({})), await getSettings());
  if (typeof next === "string") return bad(next);
  return json(await saveSettings(next));
}
