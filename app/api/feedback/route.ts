import { addFeedback, getJob } from "@/lib/db";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 👍/👎 (and an optional reason) on an alert, draft or Closer suggestion - the preference loop's input. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { kind?: string; refId?: string; rating?: number; reason?: string };
  if (!["alert", "draft", "closer", "profile"].includes(String(b.kind)) || !b.refId) return bad("kind and refId required");
  const job = b.kind === "alert" ? await getJob(b.refId) : null;
  const data = job ? { title: job.title, score: job.score.total, category: job.score.llm?.category ?? job.score.rules?.category, rules: job.score.rules?.score, llmFit: job.score.llm?.fit, flags: job.score.rules?.flags.map((f) => f.code) } : null;
  return json(await addFeedback({ kind: b.kind as "alert", refId: b.refId, rating: Math.max(-1, Math.min(1, Math.round(Number(b.rating) || 0))), reason: b.reason?.slice(0, 300) ?? null, data }), 201);
}
