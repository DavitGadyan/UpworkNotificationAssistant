import { bad, json } from "@/lib/http";
import { approve, attachLoom, discard, GateError, markApplied, preview, setBoost, submit } from "@/lib/proposals/submit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * The submit gate, one step per call: loom → approve → preview → (optional boost) → submit (or discard).
 * boost rebuilds the Upwork preview with a Connects bid ({ connects: n }) or takes it off ({ connects: null }).
 * submit also requires the literal confirmation text "SUBMIT" from the UI's second tap.
 * applied records a proposal David pasted into Upwork and sent himself (no Upwork call).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id: raw, action } = await params;
  const id = Number(raw);
  const b = (await req.json().catch(() => ({}))) as { url?: string; confirm?: string; connects?: unknown };
  try {
    switch (action) {
      case "loom": return json(await attachLoom(id, String(b.url ?? "")));
      case "approve": return json(await approve(id));
      case "preview": return json(await preview(id));
      case "boost": return json(await setBoost(id, b.connects == null || b.connects === "" ? null : Number(b.connects)));
      case "submit": return json(await submit(id, String(b.confirm ?? "")));
      case "discard": return json(await discard(id));
      case "applied": return json(await markApplied(id));
      default: return bad("Unknown action", 404);
    }
  } catch (e) {
    return bad((e as Error).message, e instanceof GateError ? 409 : 502);
  }
}
