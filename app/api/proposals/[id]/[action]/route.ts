import { bad, json } from "@/lib/http";
import { approve, attachLoom, discard, GateError, preview, submit } from "@/lib/proposals/submit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * The submit gate, one step per call: loom → approve → preview → submit (or discard).
 * submit also requires the literal confirmation text "SUBMIT" from the UI's second tap.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id: raw, action } = await params;
  const id = Number(raw);
  const b = (await req.json().catch(() => ({}))) as { url?: string; confirm?: string };
  try {
    switch (action) {
      case "loom": return json(attachLoom(id, String(b.url ?? "")));
      case "approve": return json(approve(id));
      case "preview": return json(await preview(id));
      case "submit": return json(await submit(id, String(b.confirm ?? "")));
      case "discard": return json(discard(id));
      default: return bad("Unknown action", 404);
    }
  } catch (e) {
    return bad((e as Error).message, e instanceof GateError ? 409 : 502);
  }
}
