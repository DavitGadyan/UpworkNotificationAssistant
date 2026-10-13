import { deleteSearch, getSearch, updateSearch } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { cleanSearch } from "@/lib/validate";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const cur = await getSearch(id);
  if (!cur) return bad("Not found", 404);
  const input = cleanSearch({ ...cur, ...(await req.json().catch(() => ({}))) });
  if (typeof input === "string") return bad(input);
  return json(await updateSearch(id, input));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  await deleteSearch(Number((await params).id));
  return json({ ok: true });
}
