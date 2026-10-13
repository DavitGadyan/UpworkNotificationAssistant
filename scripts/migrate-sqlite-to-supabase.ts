/*
 * One-time move of the local SQLite data (data/jobpulse.db) into Supabase Postgres.
 *   1. applies supabase/migrations/001_tables.sql and 002_supabase.sql (idempotent);
 *   2. registers OWNER_EMAIL as the only account allowed to read through the API (RLS);
 *   3. copies settings, feeds, jobs, notifications, proposals, watches, feedback, prompts, reports,
 *      counters and private kv (encrypted MCP tokens included - no Upwork re-login needed);
 *   4. resets id sequences. Safe to re-run: existing rows are kept (on conflict do nothing).
 * Usage: SQLITE_PATH=./data/jobpulse.db npx tsx --env-file=.env scripts/migrate-sqlite-to-supabase.ts
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not set");
const owner = process.env.OWNER_EMAIL;
const lite = new Database(process.env.SQLITE_PATH ?? "./data/jobpulse.db", { readonly: true });
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
const J = (s: string | null) => (s == null ? null : JSON.parse(s));
const rows = <T>(q: string) => lite.prepare(q).all() as T[];
const has = (t: string) => !!lite.prepare("select 1 from sqlite_master where type='table' and name=?").get(t);

async function main() {
  // Schema is applied separately when the app's role can't run DDL (APPLY_MIGRATIONS=1 to apply here).
  if (process.env.APPLY_MIGRATIONS === "1") for (const f of ["001_tables.sql", "002_supabase.sql"]) {
    await sql.unsafe(readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8"));
    console.log("applied", f);
  }
  if (owner && process.env.APPLY_MIGRATIONS === "1") { await sql`insert into private.owners(email) values(${owner}) on conflict do nothing`; console.log("owner", owner); }

  // kv: settings → public.settings, everything else → private.kv
  for (const r of rows<{ key: string; value: string }>("select key, value from kv")) {
    if (r.key === "settings") await sql`insert into public.settings(id, data) values(1, ${sql.json(J(r.value))}) on conflict(id) do update set data = excluded.data`;
    else await sql`insert into private.kv(key, value) values(${r.key}, ${sql.json(J(r.value))}) on conflict(key) do update set value = excluded.value`;
  }
  const feeds = rows<{ id: number; data: string; created_at: string }>("select * from searches");
  for (const r of feeds) {
    const d = J(r.data);
    await sql`insert into public.feeds(id, name, kind, enabled, data, created_at) values(${r.id}, ${d.name}, ${d.kind ?? "search"}, ${d.enabled !== false}, ${sql.json(d)}, ${r.created_at}) on conflict(id) do nothing`;
  }
  const jobs = rows<{ id: string; search_id: number; data: string; score: string; total: number; status: string; published_at: string; fetched_at: number; enrichment: string | null; feeds: string | null; keep: number }>("select * from jobs_cache");
  for (const r of jobs) {
    const d = J(r.data);
    const c = String(d.ciphertext ?? `~02${r.id}`);
    await sql`insert into public.jobs(id, feed_id, title, url, total, status, published_at, fetched_at, keep, data, score, enrichment, feeds)
      values(${r.id}, ${r.search_id}, ${d.title}, ${`https://www.upwork.com/jobs/${c.startsWith("~") ? c : "~" + c}`}, ${r.total}, ${r.status}, ${r.published_at}, ${r.fetched_at}, ${!!r.keep},
             ${sql.json(d)}, ${sql.json(J(r.score))}, ${r.enrichment ? sql.json(J(r.enrichment)) : null}, ${sql.json(J(r.feeds) ?? [])}) on conflict(id) do nothing`;
  }
  for (const r of rows<{ job_id: string; channel: string; ok: number; detail: string; title: string; score: number; created_at: number }>("select * from notifications"))
    await sql`insert into public.notifications(job_id, channel, ok, detail, title, score, created_at) values(${r.job_id}, ${r.channel}, ${!!r.ok}, ${r.detail}, ${r.title}, ${r.score}, ${r.created_at})`;
  for (const r of rows<{ day: string; requests: number }>("select * from counters"))
    await sql`insert into public.counters(day, requests) values(${r.day}, ${r.requests}) on conflict(day) do nothing`;
  if (has("proposals")) for (const r of rows<{ id: number; job_id: string; status: string; data: string; created_at: string; updated_at: string }>("select * from proposals"))
    await sql`insert into public.proposals(id, job_id, status, data, created_at, updated_at) values(${r.id}, ${r.job_id}, ${r.status}, ${sql.json(J(r.data))}, ${r.created_at}, ${r.updated_at}) on conflict(id) do nothing`;
  if (has("job_watch")) for (const r of rows<{ job_id: string; message_id: number | null; last_count: number; last_tier: string | null; warned: number; started_at: number; next_at: number; done: string | null }>("select * from job_watch"))
    await sql`insert into public.job_watch values(${r.job_id}, ${r.message_id}, ${r.last_count}, ${r.last_tier}, ${!!r.warned}, ${r.started_at}, ${r.next_at}, ${r.done}) on conflict(job_id) do nothing`;
  if (has("feedback")) for (const r of rows<{ id: number; kind: string; ref_id: string; rating: number; reason: string | null; data: string | null; created_at: string }>("select * from feedback"))
    await sql`insert into public.feedback(id, kind, ref_id, rating, reason, data, created_at) values(${r.id}, ${r.kind}, ${r.ref_id}, ${r.rating}, ${r.reason}, ${r.data ? sql.json(J(r.data)) : null}, ${r.created_at}) on conflict(id) do nothing`;
  if (has("prompt_versions")) for (const r of rows<{ id: number; name: string; body: string; note: string | null; active: number; created_at: string }>("select * from prompt_versions"))
    await sql`insert into public.prompt_versions(id, name, body, note, active, created_at) values(${r.id}, ${r.name}, ${r.body}, ${r.note}, ${!!r.active}, ${r.created_at}) on conflict(id) do nothing`;
  for (const t of ["metrics_snapshots", "reports"] as const) {
    if (!has(t)) continue;
    for (const r of rows<{ id: number; period?: string; kind?: string; data: string; created_at: string }>(`select * from ${t}`)) {
      if (t === "reports") await sql`insert into public.reports(id, kind, data, created_at) values(${r.id}, ${r.kind!}, ${sql.json(J(r.data))}, ${r.created_at}) on conflict(id) do nothing`;
      else await sql`insert into public.metrics_snapshots(id, period, data, created_at) values(${r.id}, ${r.period!}, ${sql.json(J(r.data))}, ${r.created_at}) on conflict(id) do nothing`;
    }
  }
  for (const t of ["feeds", "notifications", "proposals", "feedback", "prompt_versions", "metrics_snapshots", "reports", "mcp_log"])
    await sql.unsafe(`select setval(pg_get_serial_sequence('public.${t}', 'id'), greatest(coalesce((select max(id) from public.${t}), 0), 1))`);
  const [c] = await sql`select (select count(*) from public.jobs)::int jobs, (select count(*) from public.feeds)::int feeds, (select count(*) from public.proposals)::int proposals, (select count(*) from private.kv)::int kv`;
  console.log("copied:", { sqlite: { jobs: jobs.length, feeds: feeds.length }, postgres: c });
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
