import { spawn } from "node:child_process";
import { claudeBin, addSpend } from "../agents/llm";
import { config } from "../config";
import { getSettings, kvGet, kvSet, listSearches } from "../db";
import { recordFeedRun } from "../health";
import { processResults } from "../pipeline";
import type { SavedSearch } from "../types";
import { decide, record } from "./governor";
import { mapRow } from "./mcp/jobs";

/*
 * Manual "Load jobs via Claude": uses YOUR local Claude Code login and the Upwork connector you authorised
 * there (`claude mcp list` → upwork), instead of the backend's own MCP login. Claude calls find_jobs
 * smart_search for Most Recent and Best Matches and hands the rows back; they then go through the normal
 * pipeline (rules → enrichment → LLM ranking → Telegram → watch).
 *
 * Measured 2026-10-13: ~$0.15 per feed per run (Claude Code context + Upwork tool schemas), billed to the
 * Claude subscription - which is why the automatic 5-minute loop uses the backend MCP client instead.
 */

export type ClaudeFeed = "most_recent" | "best_match";
const LOCK = "claude_fetch_lock";

export interface ClaudeFetchResult {
  startedAt: string;
  ms: number;
  costUsd: number;
  feeds: { kind: ClaudeFeed; name: string; returned: number; fresh: number; telegram: number; error?: string }[];
}

function runClaude(prompt: string, timeoutMs = 240_000): Promise<{ result: string; cost: number }> {
  const args = [
    "-p", prompt, "--output-format", "json", "--model", "claude-haiku-5-5", "--no-session-persistence",
    "--tools", "", "--allowedTools", "mcp__upwork__upwork__find_jobs", "--effort", "low",
  ];
  return new Promise((resolve, reject) => {
    // Blank the API key so the CLI uses the Claude subscription login, not the backend's API key.
    const child = spawn(claudeBin(), args, { cwd: "/tmp", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Claude took too long (4 min)")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Claude Code CLI not available: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
      try {
        const j = JSON.parse(out) as { result?: string; total_cost_usd?: number; is_error?: boolean };
        if (j.is_error) return reject(new Error(`Claude error: ${String(j.result).slice(0, 300)}`));
        resolve({ result: j.result ?? "", cost: j.total_cost_usd ?? 0 });
      } catch (e) { reject(new Error(`Unreadable Claude output: ${(e as Error).message}`)); }
    });
  });
}

/** Pull the JSON array out of Claude's reply (it is asked for the raw "jobs" array only). */
export function extractJobs(text: string): Record<string, unknown>[] {
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Claude returned no job list");
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error("Claude returned no job list");
  return arr.filter((x) => x && typeof x === "object" && "id" in x && "title" in x);
}

async function feedFor(kind: ClaudeFeed): Promise<SavedSearch> {
  const f = (await listSearches()).find((s) => s.kind === kind && s.enabled) ?? (await listSearches()).find((s) => s.kind === kind);
  if (!f) throw new Error(`No ${kind === "most_recent" ? "Most Recent" : "Best Matches"} feed - add it on the Feeds page`);
  return f;
}

export const claudeFetchRunning = async () => (await kvGet<number>(LOCK) ?? 0) > Date.now();
export const lastClaudeFetch = async () => await kvGet<ClaudeFetchResult>("claude_fetch_last");

export async function fetchViaClaude(kinds: ClaudeFeed[] = ["most_recent", "best_match"]): Promise<ClaudeFetchResult> {
  if (await claudeFetchRunning()) throw new Error("A Claude fetch is already running");
  await kvSet(LOCK, Date.now() + 10 * 60_000);
  const started = Date.now();
  const res: ClaudeFetchResult = { startedAt: new Date(started).toISOString(), ms: 0, costUsd: 0, feeds: [] };
  try {
    const org = config.mcp.orgUid || await kvGet<string>("mcp_org") || "";
    if (!org) throw new Error("Set UPWORK_ORG_UID in .env (your freelancer org id)");
    const s = await getSettings();
    const budget = { enrich: s.guard.maxEnrichPerCycle, llm: s.llm.maxRankPerCycle };
    for (const kind of kinds) {
      const feed = await feedFor(kind);
      try {
        const prompt = `Call the upwork find_jobs tool exactly once with action "smart_search", org_uid "${org}", params {"mode":"${kind}","limit":10${kind === "most_recent" ? ',"days_posted":1' : ""}}. Then output ONLY the raw JSON array from the "jobs" field exactly as returned (every field, unchanged), with no commentary and no code fences.`;
        // This path uses the Claude CLI's own Upwork connector, outside guard.ts: ask the governor directly.
        const d = await decide("find_jobs.smart_search", { feed: true });
        if (!d.go) throw new Error(`Upwork pacing: ${d.reason}`);
        let ran: { result: string; cost: number };
        try { ran = await runClaude(prompt); } catch (e) {
          await record("find_jobs.smart_search", false, (e as Error).message, { feed: true }, { log: true });
          throw e;
        }
        await record("find_jobs.smart_search", true, null, { feed: true }, { log: true });
        const { result, cost } = ran;
        res.costUsd += cost;
        await addSpend(cost, "claude-haiku-5-5 (cli)", "claude_fetch");
        const jobs = extractJobs(result).map((r) => mapRow(r as Parameters<typeof mapRow>[0]));
        const r = await processResults(feed, jobs, { budget });
        await recordFeedRun(feed.id, feed.name, true, { returned: jobs.length });
        res.feeds.push({ kind, name: feed.name, returned: jobs.length, fresh: r.fresh, telegram: r.telegram });
      } catch (e) {
        await recordFeedRun(feed.id, feed.name, false, { error: (e as Error).message });
        res.feeds.push({ kind, name: feed.name, returned: 0, fresh: 0, telegram: 0, error: (e as Error).message });
      }
    }
  } finally {
    res.ms = Date.now() - started;
    res.costUsd = Math.round(res.costUsd * 1e4) / 1e4;
    await kvSet("claude_fetch_last", res);
    await kvSet(LOCK, 0);
  }
  return res;
}
