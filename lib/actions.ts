import { hostname } from "node:os";
import { closerInbox, suggestReply } from "./agents/closer";
import { draftProposal, rewriteProposal } from "./agents/proposal";
import { listReports, setJobStatus } from "./db";
import { applyCalibration, calibrate } from "./feedback/calibrate";
import { healthReport } from "./health";
import { buildGhostReport } from "./insights/ghosts";
import { buildIcp } from "./insights/icp";
import { benchmarkPeers, monthlyReview, monthlySnapshot, syncProfile } from "./insights/metrics";
import { query } from "./pg";
import { approve, attachLoom, discard, editDraft, preview, submit } from "./proposals/submit";
import { fetchViaClaude } from "./upwork/claudeFetch";
import { usageReport } from "./usage";

/*
 * Mobile actions without a public server. The app inserts rows into public.action_requests (RLS: owner
 * only); the worker at home claims them with `for update skip locked`, runs them with the SAME functions the
 * web API routes use (including the Loom → approve → preview → SUBMIT gate), and writes the result back.
 * The app watches its row over Supabase realtime. Paths mirror the web API so the app's client stays simple.
 * worker_status holds the latest health + usage so the app reads them directly.
 */

type Body = Record<string, unknown>;
interface Request { id: number; path: string; method: string; body: Body | null }

export class ActionError extends Error {}

/** Route one request. Only these paths exist; anything else is rejected. */
export async function dispatch(path: string, method: string, body: Body = {}): Promise<unknown> {
  const url = new URL(path, "http://x");
  const p = url.pathname;
  let m: RegExpMatchArray | null;

  if (p === "/api/usage") return usageReport({ refreshConnects: url.searchParams.get("refresh") === "1" });
  if (p === "/api/health" || p === "/api/health/full") return healthReport();

  if ((m = p.match(/^\/api\/jobs\/([^/]+)\/draft$/)) && method === "POST") {
    const id = decodeURIComponent(m[1]);
    const prop = await draftProposal(id, { guidance: body.guidance as string | undefined, webSearch: body.webSearch as boolean | undefined });
    await setJobStatus(id, "drafting");
    return prop;
  }
  if ((m = p.match(/^\/api\/proposals\/(\d+)$/)) && method === "PATCH") {
    const patch: Parameters<typeof editDraft>[1] = {};
    if (typeof body.coverLetter === "string") patch.coverLetter = body.coverLetter.slice(0, 5000);
    if (Array.isArray(body.answers)) patch.answers = (body.answers as { question: string; answer: string }[]).map((a) => ({ question: String(a.question), answer: String(a.answer) }));
    if (body.bid !== undefined) patch.bid = body.bid === null || body.bid === "" ? null : Number(body.bid);
    return editDraft(Number(m[1]), patch);
  }
  if ((m = p.match(/^\/api\/proposals\/(\d+)\/(loom|approve|preview|submit|discard|rewrite)$/)) && method === "POST") {
    const id = Number(m[1]);
    switch (m[2]) {
      case "loom": return attachLoom(id, String(body.url ?? ""));
      case "approve": return approve(id);
      case "preview": return preview(id);
      case "submit": return submit(id, String(body.confirm ?? "")); // still requires the literal "SUBMIT"
      case "discard": return discard(id);
      case "rewrite": return rewriteProposal(id);
    }
  }
  if (p === "/api/closer" && method === "GET") {
    let inbox: Awaited<ReturnType<typeof closerInbox>> = [];
    let inboxError: string | null = null;
    if (url.searchParams.get("inbox") === "1") { try { inbox = await closerInbox(); } catch (e) { inboxError = (e as Error).message; } }
    return { inbox, inboxError, history: await listReports("closer", 20) };
  }
  if (p === "/api/closer" && method === "POST") {
    const s = (k: string) => (typeof body[k] === "string" && body[k] ? (body[k] as string) : undefined);
    return suggestReply({ jobId: s("jobId"), roomId: s("roomId"), thread: s("thread"), country: s("country"), clientName: s("clientName"), goal: s("goal") });
  }
  if (p === "/api/fetch/claude" && method === "POST") return fetchViaClaude();
  if ((m = p.match(/^\/api\/insights\/([a-z-]+)$/)) && method === "POST") {
    switch (m[1]) {
      case "profile": return syncProfile();
      case "snapshot": return monthlySnapshot(body.period as string | undefined);
      case "review": return monthlyReview();
      case "coach": return benchmarkPeers(body.queries as string[] | undefined);
      case "icp": return buildIcp();
      case "calibrate": return calibrate();
      case "apply-calibration": return { applied: await applyCalibration() };
      case "ghosts": return buildGhostReport();
    }
  }
  throw new ActionError(`Unknown action ${method} ${p}`);
}

/** Claim the oldest queued request atomically (safe with several workers). */
async function claim(): Promise<Request | null> {
  const [r] = await query<Request>(
    `update public.action_requests set status = 'running', started_at = $1
     where id = (select id from public.action_requests where status = 'queued' order by id limit 1 for update skip locked)
     returning id, path, method, body`, [Date.now()],
  );
  return r ?? null;
}

async function finish(id: number, result: unknown, error: string | null) {
  await query("update public.action_requests set status = $1, result = $2::text::jsonb, error = $3, finished_at = $4 where id = $5",
    [error ? "error" : "done", error ? null : JSON.stringify(result ?? null), error, Date.now(), id]);
}

const running = new Set<number>();

/** Run queued requests, up to `parallel` at once (drafts take minutes; approvals take a second). */
export async function runActionQueue(parallel = 2): Promise<number> {
  let started = 0;
  while (running.size < parallel) {
    const r = await claim();
    if (!r) break;
    started++;
    running.add(r.id);
    void (async () => {
      try { await finish(r.id, await dispatch(r.path, r.method, r.body ?? {}), null); }
      catch (e) { await finish(r.id, null, (e as Error).message.slice(0, 500)).catch(() => undefined); }
      finally { running.delete(r.id); }
    })();
  }
  // Requests stuck in "running" for 15 min (worker restarted mid-action) are failed so the app stops waiting.
  await query("update public.action_requests set status = 'error', error = 'Worker restarted - please retry', finished_at = $1 where status = 'running' and started_at < $2",
    [Date.now(), Date.now() - 15 * 60_000]);
  await query("delete from public.action_requests where created_at < $1", [Date.now() - 7 * 864e5]);
  return started;
}

/** Publish health + usage for the app (one row, realtime). */
export async function publishWorkerStatus() {
  const health = await healthReport();
  const usage = await usageReport({ offline: true }).catch(() => null);
  await query(
    `insert into public.worker_status(id, host, health, usage, updated_at) values(1, $1, $2::text::jsonb, $3::text::jsonb, $4)
     on conflict(id) do update set host = excluded.host, health = excluded.health, usage = excluded.usage, updated_at = excluded.updated_at`,
    [hostname(), JSON.stringify(health), JSON.stringify(usage), Date.now()],
  );
}
