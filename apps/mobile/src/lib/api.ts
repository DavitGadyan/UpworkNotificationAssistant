import { useSyncExternalStore } from "react";
import * as demo from "../demo";
import type { CloserAdvice, CloserInboxResponse, HealthFull, HealthSummary, Proposal, UsageReport } from "../types";
import { config } from "./config";
import { demoEmit } from "./data";
import { supabase } from "./supabase";

/*
 * Actions without a public server: every call becomes a row in public.action_requests (RLS: owner only).
 * The worker running at home claims it, runs it with the same code as the web API (Loom → approve →
 * preview → SUBMIT gate included) and writes the result back; we watch the row over realtime (with a
 * polling fallback). Health and usage are read straight from public.worker_status, which the worker
 * refreshes every minute. Paths keep the web API's shapes.
 */

export class ApiError extends Error {
  constructor(message: string, public status: number, public unreachable = false) { super(message); }
}

// ---------- reachability (drives the "home worker offline" banner) ----------
let reachable: boolean | null = null;
const listeners = new Set<() => void>();
function setReachable(v: boolean) {
  if (reachable === v) return;
  reachable = v;
  listeners.forEach((l) => l());
}
export function useApiReachable(): boolean | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => reachable);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STALE_MS = 3 * 60_000;

type ActionRow = { id: number; status: "queued" | "running" | "done" | "error"; result: unknown; error: string | null };

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  if (config.demo) return demoApi<T>(path, init.method ?? "GET", init.body);
  const { data: inserted, error } = await supabase.from("action_requests")
    .insert({ path, method: init.method ?? "GET", body: init.body ?? null }).select("id").single();
  if (error || !inserted) {
    throw new ApiError(error?.message?.includes("row-level security") ? "Not signed in as the owner" : `Could not queue the action: ${error?.message ?? "unknown error"}`, 401);
  }
  const id = (inserted as { id: number }).id;
  const deadline = Date.now() + (init.timeoutMs ?? 60_000);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const done = (row: ActionRow) => {
      if (settled || (row.status !== "done" && row.status !== "error")) return;
      settled = true;
      cleanup();
      setReachable(true);
      if (row.status === "done") resolve(row.result as T);
      else reject(new ApiError(row.error ?? "Action failed", 400));
    };
    const channel = supabase.channel(`action-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "action_requests", filter: `id=eq.${id}` }, (p) => done(p.new as ActionRow))
      .subscribe();
    const poll = setInterval(async () => {
      const { data } = await supabase.from("action_requests").select("id,status,result,error").eq("id", id).maybeSingle();
      if (data) done(data as ActionRow);
      if (!settled && Date.now() > deadline) {
        settled = true;
        cleanup();
        const queued = (data as ActionRow | null)?.status === "queued";
        if (queued) setReachable(false);
        reject(new ApiError(queued ? "The home worker hasn't picked this up - is it running?" : "The worker is still busy - check back in a minute", 0, queued));
      }
    }, 2500);
    function cleanup() { clearInterval(poll); void supabase.removeChannel(channel); }
  });
}

/** The worker's latest status row (health + usage), refreshed every minute by the worker. */
export async function getWorkerStatus(): Promise<{ health: HealthFull | null; usage: UsageReport | null; host: string | null; stale: boolean } | null> {
  if (config.demo) return null;
  const { data } = await supabase.from("worker_status").select("health,usage,host,updated_at").eq("id", 1).maybeSingle();
  if (!data) { setReachable(false); return null; }
  const stale = Date.now() - Number((data as { updated_at: number }).updated_at) > STALE_MS;
  setReachable(!stale);
  return { health: (data as { health: HealthFull | null }).health, usage: (data as { usage: UsageReport | null }).usage, host: (data as { host: string | null }).host, stale };
}

/** Health summary for the Overview pill; a stale status row means the home worker is down. */
export async function getHealth(): Promise<HealthSummary> {
  if (config.demo) return demo.demoHealth;
  const st = await getWorkerStatus();
  if (!st?.health) throw new ApiError("Home worker offline", 0, true);
  const h = st.health;
  return { ok: h.ok && !st.stale, workerStale: h.workerStale || st.stale, lateFeeds: h.feeds.filter((f) => f.late).length, feeds: h.feeds.length, lateAfterMin: h.lateAfterMin };
}

/** Per-feed health. Null when the worker hasn't published yet or demo mode is on. */
export async function getHealthFull(): Promise<HealthFull | null> {
  if (config.demo) return null;
  return (await getWorkerStatus())?.health ?? null;
}

// ---------- typed endpoints ----------
export const endpoints = {
  usage: async (): Promise<UsageReport> => {
    if (config.demo) return demoApi<UsageReport>("/api/usage", "GET", undefined);
    const st = await getWorkerStatus();
    if (!st?.usage) throw new ApiError("Home worker offline", 0, true);
    return st.usage;
  },
  draft: (jobId: string, body: { guidance?: string; webSearch?: boolean }) =>
    api<Proposal>(`/api/jobs/${encodeURIComponent(jobId)}/draft`, { method: "POST", body, timeoutMs: 300_000 }),
  editProposal: (id: number, body: { coverLetter: string; answers: { question: string; answer: string }[]; bid: number | null; estimatedDuration?: string }) =>
    api<Proposal>(`/api/proposals/${id}`, { method: "PATCH", body }),
  loom: (id: number, url: string) => api<Proposal>(`/api/proposals/${id}/loom`, { method: "POST", body: { url } }),
  approve: (id: number) => api<Proposal>(`/api/proposals/${id}/approve`, { method: "POST", body: {} }),
  preview: (id: number) => api<Proposal>(`/api/proposals/${id}/preview`, { method: "POST", body: {}, timeoutMs: 120_000 }),
  submit: (id: number) => api<Proposal>(`/api/proposals/${id}/submit`, { method: "POST", body: { confirm: "SUBMIT" }, timeoutMs: 120_000 }),
  discard: (id: number) => api<Proposal>(`/api/proposals/${id}/discard`, { method: "POST", body: {} }),
  /** Copy-and-paste route: David sent it on Upwork himself. Records it only - no Upwork call. */
  markApplied: (id: number) => api<Proposal>(`/api/proposals/${id}/applied`, { method: "POST", body: {} }),
  /** "Rewrite shorter": restructures the draft to ≤ 900 chars server-side. No body; ~30-60s. */
  rewrite: (id: number) => api<Proposal>(`/api/proposals/${id}/rewrite`, { method: "POST", timeoutMs: 180_000 }),
  closer: (body: { jobId?: string; roomId?: string; thread?: string; country?: string; clientName?: string; goal?: string }) =>
    api<CloserAdvice>("/api/closer", { method: "POST", body, timeoutMs: 200_000 }),
  closerInbox: () => api<CloserInboxResponse>("/api/closer?inbox=1", { timeoutMs: 60_000 }),
  fetchViaClaude: () => api<{ ok?: boolean; message?: string }>("/api/fetch/claude", { method: "POST", body: {}, timeoutMs: 300_000 }),
  insights: (action: "snapshot" | "review" | "coach" | "icp" | "calibrate" | "apply-calibration" | "ghosts" | "outcomes" | "lessons" | "approve-lessons" | "reject-lessons" | "lab" | "lab-refresh", body: Record<string, unknown> = {}) =>
    api<unknown>(`/api/insights/${action}`, { method: "POST", body, timeoutMs: 300_000 }),
};

// ---------- demo ----------
async function demoApi<T>(path: string, method: string, body: unknown): Promise<T> {
  await sleep(path.includes("/draft") ? 2500 : 500);
  setReachable(true);
  if (path.startsWith("/api/usage")) return demo.demoUsage as T;
  if (path.startsWith("/api/health")) return demo.demoHealth as T;
  if (path.startsWith("/api/closer") && method === "GET") return demo.demoInbox as T;
  if (path.startsWith("/api/closer")) return demo.demoAdvice as T;
  const m = path.match(/^\/api\/proposals\/(\d+)(?:\/(\w+))?/);
  if (m) {
    const p = demo.demoProposals.find((x) => x.id === Number(m[1]));
    if (!p) throw new ApiError("Proposal not found", 404);
    const next = { loom: "ready", approve: "approved", preview: "previewed", submit: "submitted", applied: "submitted", discard: "discarded" } as const;
    if (m[2] === "rewrite") {
      await sleep(1500);
      p.data = { ...p.data, coverLetter: p.data.coverLetter.slice(0, 900) };
      demoEmit();
      return { ...p.data, id: p.id, jobId: p.job_id, status: p.status, createdAt: p.created_at, updatedAt: new Date().toISOString() } as T;
    }
    const action = m[2] as keyof typeof next | undefined;
    if (action) p.status = next[action];
    if (action === "loom") p.data = { ...p.data, loomUrl: (body as { url: string }).url, coverLetter: p.data.coverLetter.replace("{{LOOM_URL}}", (body as { url: string }).url) };
    if (!action && body) p.data = { ...p.data, ...(body as object) };
    demoEmit();
    return { ...p.data, id: p.id, jobId: p.job_id, status: p.status, createdAt: p.created_at, updatedAt: new Date().toISOString() } as T;
  }
  if (path.includes("/draft")) {
    const p = demo.demoProposals[0];
    return { ...p.data, id: p.id, jobId: p.job_id, status: p.status, createdAt: p.created_at, updatedAt: p.updated_at } as T;
  }
  return { ok: true, message: "Done (demo)" } as T;
}
