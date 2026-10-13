import { closerInbox, suggestReply } from "@/lib/agents/closer";
import { listReports } from "@/lib/db";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** GET: conversations from Upwork (inbox) + recent advice. POST: Closer advice for one client. */
export async function GET(req: Request) {
  const withInbox = new URL(req.url).searchParams.get("inbox") === "1";
  let inbox: Awaited<ReturnType<typeof closerInbox>> = [];
  let inboxError: string | null = null;
  if (withInbox) { try { inbox = await closerInbox(); } catch (e) { inboxError = (e as Error).message; } }
  return json({ inbox, inboxError, history: await listReports("closer", 20) });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  try {
    return json(await suggestReply({ jobId: b.jobId || undefined, roomId: b.roomId || undefined, thread: b.thread, country: b.country || undefined, clientName: b.clientName || undefined, goal: b.goal || undefined }));
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
