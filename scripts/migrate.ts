/*
 * Apply pending SQL migrations (supabase/migrations/*.sql) to the Supabase project through the Management API.
 * The app's own role (pulse_app) can't create tables, so this needs a personal access token - put it in .env
 * only for the run, then delete it and revoke it (supabase.com/dashboard/account/tokens).
 *
 * Usage: SUPABASE_ACCESS_TOKEN=sbp_... npx tsx --env-file=.env scripts/migrate.ts [--dry-run]
 * Tracks what ran in public.schema_migrations. 001-006 predate it: they are recorded as applied when their
 * tables already exist.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = (process.env.SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const dry = process.argv.includes("--dry-run");

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as T[]) : [];
}

/** Tables each pre-tracking migration created - present means it ran. */
const LEGACY: Record<string, string[]> = {
  "001_tables.sql": ["jobs", "proposals", "feedback"],
  "002_supabase.sql": [],
  "003_intent.sql": ["job_outcomes"],
  "004_intent_rls.sql": [],
  "005_actions.sql": ["action_requests"],
  "006_actions_rls.sql": [],
};

async function main() {
  if (!token || !ref) throw new Error("Set SUPABASE_ACCESS_TOKEN (and SUPABASE_URL in .env)");
  const files = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  await sql("create table if not exists public.schema_migrations (name text primary key, applied_at text not null); alter table public.schema_migrations enable row level security");
  const done = new Set((await sql<{ name: string }>("select name from public.schema_migrations")).map((r) => r.name));
  const tables = new Set((await sql<{ t: string }>("select table_name t from information_schema.tables where table_schema = 'public'")).map((r) => r.t));
  const legacyRan = Object.values(LEGACY).flat().every((t) => tables.has(t));
  const pending: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    if (f in LEGACY && legacyRan) {
      console.log(`record  ${f} (already in the database)`);
      if (!dry) await sql(`insert into public.schema_migrations values ('${f}', '${new Date().toISOString()}') on conflict do nothing`);
      continue;
    }
    pending.push(f);
  }
  if (!pending.length) { console.log("Nothing to apply - database is up to date."); return; }
  for (const f of pending) {
    console.log(`${dry ? "would apply" : "apply"}  ${f}`);
    if (dry) continue;
    await sql(readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8"));
    await sql(`insert into public.schema_migrations values ('${f}', '${new Date().toISOString()}')`);
  }
  if (!dry) {
    const now = await sql<{ t: string }>("select table_name t from information_schema.tables where table_schema = 'public' order by 1");
    console.log("public tables:", now.map((r) => r.t).join(", "));
  }
}
main().then(() => process.exit(0), (e) => { console.error((e as Error).message); process.exit(1); });
