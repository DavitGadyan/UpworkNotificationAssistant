/*
 * Upwork call history (David, 2026-10-19).
 *   npm run -s calls -- backfill [export.jsonl]   copy mcp_log (and an optional local export of it) into the permanent
 *                                                 public.upwork_calls table; safe to run again (keyed on mcp_log id)
 *   npm run -s calls -- report                    write docs/upwork-call-history.md: per-day volumes, peak rates, and
 *                                                 every throttle/restriction with the rates that led up to it
 * public.upwork_calls comes from supabase/migrations/011_upwork_calls.sql (run scripts/migrate.ts once).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { callReport, errorClass, type CallRow } from "@/lib/callHistory";
import { query } from "@/lib/pg";
import { dailyCap, getsPerDay, LIMITS } from "@/lib/upwork/governor";

type Logged = CallRow & { id: number; ms: number };

async function hasHistory(): Promise<boolean> {
  return (await query<{ t: string | null }>("select to_regclass('public.upwork_calls')::text t"))[0]?.t != null;
}

async function backfill(file?: string): Promise<number> {
  if (!await hasHistory()) { console.log("public.upwork_calls is missing - run migration 011 first (scripts/migrate.ts)"); return 1; }
  const rows = new Map<number, Logged>();
  if (file) for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(line) as Logged; rows.set(Number(r.id), r); }
  for (const r of await query<Logged>("select id, tool, action, ok, ms, detail, created_at from public.mcp_log")) rows.set(Number(r.id), r);
  const list = [...rows.values()].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  let added = 0;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const args: unknown[] = [];
    const values = chunk.map((r) => {
      args.push(Number(r.created_at), r.tool, r.action, r.tool === "find_jobs" && r.action === "get" ? "get" : null, r.ok, errorClass(r), r.ms ?? 0, r.detail, Number(r.id));
      const n = args.length;
      return `($${n - 8}, 'backfill', $${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
    });
    const res = await query<{ id: number }>(
      `insert into public.upwork_calls(created_at, source, tool, action, category, ok, error_class, ms, detail, mcp_log_id) values ${values.join(",")}
       on conflict (mcp_log_id) do nothing returning id`, args);
    added += res.length;
  }
  console.log(`BACKFILLED ${added} of ${list.length} calls (the rest were already there)`);
  return 0;
}

async function report(): Promise<number> {
  const src = await hasHistory() ? "upwork_calls" : "mcp_log";
  const rows = (await query<CallRow & { created_at: string | number }>(
    `select created_at, tool, action, ok, detail${src === "upwork_calls" ? ", error_class, source" : ""} from public.${src}`))
    .map((r) => ({ ...r, created_at: Number(r.created_at) }));
  const limits = {
    "Calls per day": `${await dailyCap()} (hard cap ${LIMITS.hardDailyCap})`,
    "Calls per hour": LIMITS.hourly,
    "Searches per day": LIMITS.searchPerDay,
    "Job opens per day": `${await getsPerDay()} (Settings, 60–300)`,
    "Same job re-opened": `at most once per ${LIMITS.sameJobMs / 36e5} h, never after a refusal`,
  };
  writeFileSync("docs/upwork-call-history.md", callReport(rows, limits) + "\n");
  console.log(`REPORT docs/upwork-call-history.md from ${rows.length} calls (${src})`);
  return 0;
}

const [cmd, arg] = process.argv.slice(2);
(cmd === "backfill" ? backfill(arg) : cmd === "report" ? report() : Promise.resolve((console.log("usage: calls backfill [file.jsonl] | report"), 2)))
  .then((c) => process.exit(c), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(2); });
