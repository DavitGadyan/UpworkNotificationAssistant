import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/*
 * One tiny query interface over two engines:
 *   - Supabase Postgres (SUPABASE_DB_URL) in the web app and worker - server-side only, bypasses RLS;
 *   - PGlite (in-process Postgres) for tests, loaded with the same migration SQL.
 * Queries use positional $1… parameters; JSON values are passed as objects and cast with ::jsonb.
 */

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (q: Db["query"]) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let current: Db | null = null;

const MIGRATIONS = () => join(process.cwd(), "supabase", "migrations");
/** Plain-Postgres migrations (no Supabase roles) - loaded into PGlite for tests. */
export const tablesSql = () => ["001_tables.sql", "003_intent.sql", "005_actions.sql", "007_proposal_outcomes.sql", "009_prompt_stats.sql"].map((f) => readFileSync(join(MIGRATIONS(), f), "utf8")).join("\n");

/**
 * Supabase's transaction pooler (port 6543) leaves about half of concurrent queries from this app unanswered:
 * measured 2026-10-15, 6 of 12 parallel queries hung every time, while the session pooler (port 5432) answered
 * all 12 in about a second. Dashboard pages run several queries at once, so they stalled ~20 s and showed
 * "the database was slow to answer". Pooler URLs therefore use session mode unless DB_POOLER_MODE=transaction.
 */
export function sessionPoolerUrl(url: string): string {
  if (process.env.DB_POOLER_MODE === "transaction") return url;
  return url.replace(/(\.pooler\.supabase\.com):6543(?=\/|$)/, "$1:5432");
}

function fromPostgres(url: string): Db {
  const sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 3), // small per process: web + worker share the pooler
    idle_timeout: 30,
    connect_timeout: 15,
    prepare: false, // safe on both Supabase poolers (and required if DB_POOLER_MODE=transaction)
    // bigint (epoch ms, ids) comes back as a JS number - all values fit well within 2^53.
    types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
    transform: { undefined: null },
    onnotice: () => undefined,
  });
  // A reply lost in the pooler leaves that connection wedged: every later query queued on it would hang too.
  // So a query that times out fails AND retires this whole pool; the next query opens fresh connections.
  const timeoutMs = Number(process.env.DB_QUERY_TIMEOUT_MS ?? 20_000);
  let db: Db | null = null;
  const retire = () => {
    if (current !== db) return;
    current = null;
    console.warn("database connection stuck - reconnecting");
    void sql.end({ timeout: 1 }).catch(() => undefined);
  };
  const run = (s: typeof sql) => async <T>(text: string, params: unknown[] = []) => {
    const q = s.unsafe(text, params.map(pgParam) as never[]);
    // If the timeout wins the race, q still rejects later (pool retired, DNS gone) - never leave that unhandled.
    q.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void Promise.resolve().then(() => q.cancel()).catch(() => undefined);
        retire();
        reject(new Error(`query timed out after ${timeoutMs / 1000} s: ${text.slice(0, 60)}`));
      }, timeoutMs);
    });
    try {
      return (await Promise.race([q, timeout])) as unknown as T[];
    } catch (e) {
      // The pooler dropped the socket (2026-10-20: "write CONNECTION_DESTROYED" left the dashboard on an error page
      // for an hour). Those connections never come back by themselves, so retire the pool like a timeout.
      if (isConnectionDrop(e)) retire();
      throw e;
    } finally { clearTimeout(timer); }
  };
  db = {
    query: run(sql),
    tx: (fn) => sql.begin((t) => fn(run(t as unknown as typeof sql))) as never,
    close: () => sql.end({ timeout: 5 }),
  };
  return db;
}

/** postgres.js wants JSON as strings for ::jsonb params; numbers/strings/booleans/null pass through. */
const pgParam = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);

async function fromPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite({ parsers: { 20: (x: string) => Number(x) } });
  await pg.exec(tablesSql());
  const run = (p: { query: typeof pg.query }) => async <T>(text: string, params: unknown[] = []) =>
    ((await p.query(text, params.map(pgParam))).rows as T[]);
  return {
    query: run(pg),
    tx: (fn) => pg.transaction((t) => fn(run(t as never))) as never,
    close: () => pg.close(),
  };
}

let opening: Promise<Db> | null = null;

/** The process-wide connection. Throws if SUPABASE_DB_URL is missing outside tests. */
export async function getDb(): Promise<Db> {
  if (current) return current;
  if (!opening) {
    opening = (async () => {
      const url = process.env.SUPABASE_DB_URL;
      if (url) return fromPostgres(sessionPoolerUrl(url));
      if (process.env.VITEST || process.env.DB_DRIVER === "pglite") return fromPglite();
      throw new Error("SUPABASE_DB_URL is not set (see .env.example)");
    })().then((d) => (current = d)).finally(() => { opening = null; });
  }
  return opening;
}

/** A dead socket, not a bad query: postgres.js connection errors and the OS-level resets underneath them. */
const isConnectionDrop = (e: unknown) =>
  /CONNECTION_DESTROYED|CONNECTION_CLOSED|CONNECTION_ENDED|CONNECT_TIMEOUT|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i
    .test(`${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? ""}`);

/** Reads are safe to repeat: one that hung or lost its socket (and retired the pool) is retried once on fresh connections. */
const isRead = (text: string) => /^\s*(select|with)\b/i.test(text) && !/\b(insert|update|delete)\b/i.test(text);
export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  try {
    return await (await getDb()).query<T>(text, params);
  } catch (e) {
    if (!isRead(text) || !(/query timed out/.test((e as Error).message) || isConnectionDrop(e))) throw e;
    return (await getDb()).query<T>(text, params);
  }
}
export async function one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}
export async function tx<T>(fn: (q: Db["query"]) => Promise<T>): Promise<T> {
  return (await getDb()).tx(fn);
}

/** Tests only: a fresh in-memory database with the schema loaded. */
export async function resetDbForTests() {
  if (current) await current.close().catch(() => undefined);
  current = await fromPglite();
}
