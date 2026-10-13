import { DEFAULT_PROMPTS, getPrompt, type PromptName } from "@/lib/agents/prompts";
import { activatePromptVersion, listPromptVersions, savePromptVersion } from "@/lib/db";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";

const NAMES = Object.keys(DEFAULT_PROMPTS) as PromptName[];

export async function GET() {
  return json(await Promise.all(NAMES.map(async (name) => ({ name, active: await getPrompt(name), versions: (await listPromptVersions(name)).map(({ body: _b, ...v }) => v), default: DEFAULT_PROMPTS[name] }))));
}

/** Save a new version (becomes active). */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; body?: string; note?: string };
  if (!NAMES.includes(b.name as PromptName)) return bad("Unknown prompt");
  if (!b.body || b.body.trim().length < 50) return bad("Prompt is too short");
  return json(await savePromptVersion(b.name!, b.body.slice(0, 40_000), b.note?.slice(0, 200) ?? null), 201);
}

/** Roll back / forward to a stored version. */
export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: number };
  if (!b.id) return bad("id required");
  await activatePromptVersion(Number(b.id));
  return json({ ok: true });
}
