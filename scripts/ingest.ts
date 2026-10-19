/*
 * Hand the chat watch loop's search results to the app (David, 2026-10-18): when the Claude chat session is the
 * Upwork searcher, the worker no longer sees new jobs. The loop saves the rows of NEW jobs from its find_jobs call
 * to a JSON file and runs:
 *   npm run -s ingest -- <most_recent|best_match|saved_query|keyword> <file.json>
 * The rows go through the normal pipeline - rules, client lookup (governed), AI ranking, storage - so auto-drafts,
 * the proposal watch and night auto-apply work as before. No Telegram alerts here: the chat loop sends its own.
 * Accepts a JSON array of job rows or an object with a "jobs" array (find_jobs output as-is).
 */
import { readFileSync } from "node:fs";
import { listSearches } from "@/lib/db";
import { processResults } from "@/lib/pipeline";
import { mapRow } from "@/lib/upwork/mcp/jobs";
import type { SavedSearch } from "@/lib/types";

async function feedFor(category: string): Promise<SavedSearch> {
  const feeds = await listSearches();
  const kind = category === "most_recent" || category === "best_match" ? category : "search";
  const pick = (kind === "search" ? feeds.find((f) => f.kind === "search" && f.enabled && /^search/i.test(f.name)) : null)
    ?? feeds.find((f) => f.kind === kind && f.enabled) ?? feeds.find((f) => f.kind === kind);
  if (!pick) throw new Error(`No ${kind} feed - add one on the Feeds page`);
  return pick;
}

async function main(): Promise<number> {
  const [category, file] = process.argv.slice(2);
  if (!category || !file) { console.log("usage: ingest <category> <file.json>"); return 2; }
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const rows = (Array.isArray(raw) ? raw : (raw as { jobs?: unknown[] }).jobs ?? []) as Record<string, unknown>[];
  const jobs = rows.filter((r) => r && typeof r === "object" && "id" in r && "title" in r).map((r) => mapRow(r as Parameters<typeof mapRow>[0]));
  if (!jobs.length) { console.log("INGESTED 0"); return 0; }
  const silent = { telegram: async () => ({ ok: false, detail: "chat loop alerts itself" }), call: async () => ({ ok: false, detail: "chat loop" }), ready: { telegram: false, call: false } };
  const feed = await feedFor(category);
  const r = await processResults(feed, jobs, { notifiers: silent });
  console.log(`INGESTED ${jobs.length} into "${feed.name}": ${JSON.stringify(r)}`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(2); });
