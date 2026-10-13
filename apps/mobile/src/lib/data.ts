import { useCallback, useEffect, useRef, useState } from "react";
import * as demo from "../demo";
import type {
  CachedJob, FeedRow, JobRow, NotificationDbRow, Proposal, ProposalRow, ReportKind, ReportRow, Settings, SnapshotRow, WatchRow,
} from "../types";
import { config } from "./config";
import { supabase } from "./supabase";

/*
 * Data access. Reads go straight to Supabase (RLS: owner only); the client may only
 *   - UPDATE jobs.status (dismiss) and settings.data,
 *   - INSERT feedback and devices.
 * With EXPO_PUBLIC_DEMO=1 every call is served from src/demo.ts (and mutations change that in-memory copy).
 */

// ---------- demo store ----------
const store = {
  jobs: demo.demoJobs,
  proposals: demo.demoProposals,
  settings: { ...demo.demoSettings } as Partial<Settings>,
};
const demoListeners = new Set<() => void>();
export const demoEmit = () => demoListeners.forEach((l) => l());

// ---------- mapping ----------
export type JobView = CachedJob & { url: string; feedId: number; fetchedAtMs: number };

export function toJob(r: JobRow): JobView {
  return {
    ...r.data,
    id: r.id,
    title: r.title || r.data.title,
    url: r.url,
    feedId: r.feed_id,
    searchId: r.feed_id,
    searchName: r.feeds?.[0] ?? "",
    score: r.score,
    status: r.status,
    fetchedAt: new Date(r.fetched_at).toISOString(),
    fetchedAtMs: r.fetched_at,
    enrichment: r.enrichment,
    feeds: r.feeds ?? [],
  };
}

export function toProposal(r: ProposalRow): Proposal {
  return { ...r.data, id: r.id, jobId: r.job_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}

const JOB_COLS = "id,feed_id,title,url,total,status,published_at,fetched_at,keep,data,score,enrichment,feeds";

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// ---------- reads ----------
export async function fetchJobs(limit = 300): Promise<JobView[]> {
  if (config.demo) return store.jobs.map(toJob).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const rows = check(await supabase.from("jobs").select(JOB_COLS).order("published_at", { ascending: false }).limit(limit));
  return (rows as JobRow[]).map(toJob);
}

export async function fetchJob(id: string): Promise<JobView | null> {
  if (config.demo) { const r = store.jobs.find((j) => j.id === id); return r ? toJob(r) : null; }
  const rows = check(await supabase.from("jobs").select(JOB_COLS).eq("id", id).limit(1));
  return (rows as JobRow[])[0] ? toJob((rows as JobRow[])[0]) : null;
}

export async function fetchJobsByIds(ids: string[]): Promise<JobView[]> {
  if (!ids.length) return [];
  if (config.demo) return store.jobs.filter((j) => ids.includes(j.id)).map(toJob);
  return (check(await supabase.from("jobs").select(JOB_COLS).in("id", ids)) as JobRow[]).map(toJob);
}

export async function fetchProposals(jobId?: string): Promise<Proposal[]> {
  if (config.demo) return store.proposals.filter((p) => !jobId || p.job_id === jobId).map(toProposal);
  let q = supabase.from("proposals").select("*").order("id", { ascending: false }).limit(200);
  if (jobId) q = q.eq("job_id", jobId);
  return (check(await q) as ProposalRow[]).map(toProposal);
}

export async function fetchProposal(id: number): Promise<Proposal | null> {
  if (config.demo) { const r = store.proposals.find((p) => p.id === id); return r ? toProposal(r) : null; }
  const rows = check(await supabase.from("proposals").select("*").eq("id", id).limit(1)) as ProposalRow[];
  return rows[0] ? toProposal(rows[0]) : null;
}

export async function fetchFeeds(): Promise<FeedRow[]> {
  if (config.demo) return demo.demoFeeds;
  return check(await supabase.from("feeds").select("id,name,kind,enabled,data,created_at").order("id")) as FeedRow[];
}

export async function fetchWatch(): Promise<WatchRow[]> {
  if (config.demo) return demo.demoWatch;
  return check(await supabase.from("job_watch").select("*").order("started_at", { ascending: false }).limit(100)) as WatchRow[];
}

export async function fetchNotificationsSince(ms: number): Promise<NotificationDbRow[]> {
  if (config.demo) return demo.demoNotifications;
  return check(await supabase.from("notifications").select("*").gte("created_at", ms).order("created_at", { ascending: false }).limit(500)) as NotificationDbRow[];
}

/** null = no settings row visible, which for a signed-in user means RLS hid it (not the owner). */
export async function fetchSettings(): Promise<Partial<Settings> | null> {
  if (config.demo) return store.settings;
  const rows = check(await supabase.from("settings").select("data").eq("id", 1).limit(1)) as { data: Partial<Settings> }[];
  return rows[0]?.data ?? null;
}

export async function fetchSnapshots(limit = 12): Promise<SnapshotRow[]> {
  if (config.demo) return demo.demoSnapshots;
  return check(await supabase.from("metrics_snapshots").select("*").order("period", { ascending: false }).limit(limit)) as SnapshotRow[];
}

export async function fetchLatestReport<T>(kind: ReportKind): Promise<ReportRow<T> | null> {
  if (config.demo) return (demo.demoReports.find((r) => r.kind === kind) as ReportRow<T> | undefined) ?? null;
  const rows = check(await supabase.from("reports").select("*").eq("kind", kind).order("id", { ascending: false }).limit(1)) as ReportRow<T>[];
  return rows[0] ?? null;
}

// ---------- writes (the only ones RLS allows) ----------
export async function setJobStatus(id: string, status: "dismissed" | "new") {
  if (config.demo) { const j = store.jobs.find((x) => x.id === id); if (j) j.status = status; demoEmit(); return; }
  check(await supabase.from("jobs").update({ status }).eq("id", id).select("id"));
}

export async function addFeedback(f: { kind: "alert" | "draft" | "closer"; refId: string; rating: -1 | 1; reason?: string | null; data?: Record<string, unknown> | null }) {
  if (config.demo) return;
  check(await supabase.from("feedback").insert({ kind: f.kind, ref_id: f.refId, rating: f.rating, reason: f.reason ?? null, data: f.data ?? null, created_at: new Date().toISOString() }));
}

function isObj(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }

/** Deep merge for plain objects: only the keys in `patch` change; arrays and scalars are replaced. */
export function mergeDeep<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k] as Record<string, unknown>, v) : v;
  return out as T;
}

/** Re-reads the current row and merges the patch into it, so unrelated keys are never overwritten. */
export async function saveSettings(patch: Record<string, unknown>): Promise<Partial<Settings>> {
  if (config.demo) { store.settings = mergeDeep(store.settings as Record<string, unknown>, patch) as Partial<Settings>; demoEmit(); return store.settings; }
  const current = await fetchSettings();
  if (!current) throw new Error("Settings are not readable with this account");
  const next = mergeDeep(current as Record<string, unknown>, patch);
  check(await supabase.from("settings").update({ data: next }).eq("id", 1).select("id"));
  return next as Partial<Settings>;
}

export async function registerDevice(token: string, platform: string) {
  if (config.demo) return;
  const r = await supabase.from("devices").insert({ token, platform });
  // 23505 = already registered (primary key on token) - fine.
  if (r.error && r.error.code !== "23505" && !/duplicate/i.test(r.error.message)) throw new Error(r.error.message);
}

// ---------- hook ----------
type Table = "jobs" | "proposals" | "notifications" | "job_watch";

/**
 * Fetch + refresh + live updates. `tables` lists the realtime-enabled tables whose changes should trigger
 * a refetch (debounced, so a burst of worker writes costs one query).
 */
export function useQuery<T>(key: string, fetcher: () => Promise<T>, tables: Table[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetchRef = useRef(fetcher);
  useEffect(() => { fetchRef.current = fetcher; });

  const load = useCallback(async (mode: "initial" | "refresh" | "silent") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      setData(await fetchRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => load("initial"));
    if (config.demo) {
      const l = () => load("silent");
      demoListeners.add(l);
      return () => { demoListeners.delete(l); };
    }
    if (!tables.length) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase.channel(`rt:${key}:${Math.random().toString(36).slice(2, 8)}`);
    for (const table of tables) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => load("silent"), 400);
      });
    }
    ch.subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);

  return { data, error, loading, refreshing, refresh: () => load("refresh"), reload: () => load("silent"), setData };
}
