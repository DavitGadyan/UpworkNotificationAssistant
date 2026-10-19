/*
 * Worker. One loop every `pollIntervalSec` (at least 300 s, + jitter):
 *   purge stale Upwork data → poll every enabled feed (Most Recent, Best Matches, saved searches), but only
 *   when Settings → "Who searches Upwork" is the worker (otherwise the Claude chat loop searches and the
 *   worker never does) → rank (rules → enrichment → LLM) → notify → re-check watched jobs → periodic jobs
 *   (daily profile sync, monthly client-profile rebuild + performance snapshot).
 * Every Upwork call is decided by the pacing governor (lib/upwork/governor.ts); once Upwork says access is
 * "restricted" the worker makes no Upwork calls at all until `npm run governor -- resume`.
 * Settings are re-read every loop, so dashboard changes apply without a restart.
 * Flags: --once (single tick, then exit), --dry-run (rank and store, but send no alerts/calls).
 */
import { config } from "@/lib/config";
import { acquireLease, currentLease, getSettings, kvGet, kvSet, listJobs, listSearches, purgeExpired, setWorkerHeartbeat } from "@/lib/db";
import { runDemo } from "@/lib/demo";
import { lateTransitions, recordFeedRun } from "@/lib/health";
import { runPeriodic } from "@/lib/insights/periodic";
import { runAutoDrafts } from "@/lib/autodraft";
import { runAutoApply } from "@/lib/autoapply";
import { runOutcomeChecks } from "@/lib/outcomes";
import { publishWorkerStatus, runActionQueue } from "@/lib/actions";
import { connectsBalance } from "@/lib/usage";
import { hostname } from "node:os";
import { sendText } from "@/lib/notify/telegram";
import { pollCallbacks } from "@/lib/notify/telegramActions";
import { checkPaymentWatches, processResults, retryAwaitingAi, retryPending, type CycleBudget } from "@/lib/pipeline";
import { RateLimitError } from "@/lib/ratelimit";
import { GuardError, jitteredInterval } from "@/lib/upwork/guard";
import { isRestricted, setCaller } from "@/lib/upwork/governor";
import { activeSource, fetchFeed } from "@/lib/upwork/source";
import { mcpConnected } from "@/lib/upwork/mcp/client";
import { runWatches } from "@/lib/watch";

const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const DRY = args.has("--dry-run");
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
let stopping = false;
let lastError: string | null = null;
let lastFetched = 0;

/** Tell David once (per kind, per 6 h) when the worker is blocked - login expired, breaker open, cap hit. */
async function alertOnce(kind: string, text: string) {
  const key = `alert_${kind}`;
  const last = await kvGet<number>(key) ?? 0;
  if (Date.now() - last < 6 * 36e5 || DRY) return;
  await kvSet(key, Date.now());
  await sendText(`🛑 <b>Assistant paused</b>: ${text}`);
}

async function tick() {
  const purged = await purgeExpired();
  if (purged.jobs || purged.notifications) log("purged", purged);

  // Only one machine polls Upwork (Mac vs home server): the lease outlives one interval plus slack.
  const lease = Math.max(120, (await getSettings()).pollIntervalSec) * 1000 * 3;
  if (!DRY && !(await acquireLease(OWNER, lease))) {
    const l = await currentLease();
    lastError = `Standby - ${l?.owner ?? "another worker"} is polling`;
    return;
  }
  const src = await activeSource();
  // Same "send nothing" notifiers for every path when --dry-run is on.
  const dryNotifiers = { telegram: async () => ({ ok: false, detail: "dry run" }), call: async () => ({ ok: false, detail: "dry run" }), ready: { telegram: false, call: false } };
  if (config.demoMode && src === "none") {
    if ((await listJobs()).length) return;
    const r = await runDemo(new Date(), DRY ? dryNotifiers : undefined);
    lastFetched = r.fresh;
    log("demo tick", r);
    return;
  }
  if (src === "none") { lastError = "Not connected - open Settings and connect Upwork"; return; }
  if (await isRestricted()) { lastError = "Upwork restricted access - all Upwork calls stopped (npm run governor -- resume)"; return; }

  const s = await getSettings();
  const polls = s.upwork.poller === "worker";
  const budget: CycleBudget = { enrich: s.guard.maxEnrichPerCycle, llm: s.llm.maxRankPerCycle };
  lastFetched = 0;
  lastError = null;
  // Jobs parked last cycle without a client record go first, so none waits long.
  if (polls) try {
    const p = await retryPending({ budget, ...(DRY ? { notifiers: dryNotifiers } : {}) });
    if (p.enriched || p.pending) log("pending retried", p);
  } catch (e) { log("pending retry error", (e as Error).message); }
  // Then jobs that missed their AI check (budget/outage): they alert once the AI has ranked them.
  try {
    const a = await retryAwaitingAi({ budget, ...(DRY ? { notifiers: dryNotifiers } : {}) });
    if (a.ranked || a.awaitingAi) log("awaiting AI retried", a);
  } catch (e) { log("awaiting AI retry error", (e as Error).message); }
  for (const feed of polls ? (await listSearches()).filter((f) => f.enabled) : []) {
    if (stopping) break;
    try {
      const jobs = await fetchFeed(feed);
      const r = await processResults(feed, jobs, { budget, ...(DRY ? { notifiers: dryNotifiers } : {}) });
      lastFetched += r.fresh;
      await recordFeedRun(feed.id, feed.name, true, { returned: jobs.length });
      log(`feed "${feed.name}" (${src})`, { returned: jobs.length, ...r });
    } catch (e) {
      lastError = `${feed.name}: ${(e as Error).message}`;
      await recordFeedRun(feed.id, feed.name, false, { error: (e as Error).message });
      log("error", lastError);
      if (e instanceof GuardError) { if (e.kind !== "restricted" && e.kind !== "throttled") await alertOnce(e.kind, e.message); break; }
      if (e instanceof RateLimitError) break;
    }
  }
  // Restricted mid-tick (the governor already sent the Telegram alert): no watch, payment or outcome calls either.
  if (await isRestricted()) return;

  // Polling goal: alert once when a feed misses its window, and once when it recovers.
  const t = polls ? await lateTransitions() : { late: [], recovered: [] };
  if (t.late.length && !DRY) await sendText(`⏰ <b>Polling behind</b>: no successful fetch for ${t.late.join(", ")} in the last ${Math.round((3 * s.pollIntervalSec) / 60)} min. Last error: ${(lastError ?? "none").replace(/</g, "&lt;")}`);
  if (t.recovered.length && !DRY) await sendText(`✅ Polling recovered: ${t.recovered.join(", ")}`);

  if (s.watch.enabled && src === "mcp" && !DRY) {
    try {
      const w = await runWatches(2);
      if (Object.keys(w).length) log("watch", w);
    } catch (e) { log("watch error", (e as Error).message); }
  }

  // Good fits held until the client verifies payment (one Upwork call per due check).
  if (src === "mcp" && !DRY) {
    try {
      const pw = await checkPaymentWatches(4, { budget });
      if (Object.keys(pw).length) log("payment watch", pw);
    } catch (e) { log("payment watch error", (e as Error).message); }
  }

  if (src === "mcp" && !DRY) {
    try {
      const o = await runOutcomeChecks(4);
      if (Object.keys(o).length) log("outcomes", o);
    } catch (e) { log("outcome error", (e as Error).message); }
  }

  if (!DRY) {
    try {
      const d = await runAutoDrafts();
      if (d.drafted.length) log("auto-drafted", d.drafted);
    } catch (e) { log("autodraft error", (e as Error).message); }
  }

  // Night auto-apply (Settings → Auto-apply at night, off by default): at most one submission per cycle.
  // Submitting goes through the MCP connector even when searching uses the official API.
  if (!DRY && (src === "mcp" || await mcpConnected())) {
    try {
      const r = await runAutoApply();
      if (r.submitted || (r.skipped && !/disabled|outside|no qualifying/.test(r.skipped))) log("auto-apply", r);
    } catch (e) { log("auto-apply error", (e as Error).message); }
  }

  if (src === "mcp") {
    try { const job = await runPeriodic(); if (job) log("periodic", job); } catch (e) { log("periodic error", (e as Error).message); }
  }
}

/** Button taps without a public webhook: long-poll getUpdates in the background. Stops if a webhook is set. */
async function callbackLoop() {
  while (!stopping && !ONCE && config.telegram.botToken) {
    try {
      if ((await pollCallbacks()) === -1) { log("telegram webhook is set - button taps go to /api/telegram/webhook"); return; }
    } catch { await new Promise((r) => setTimeout(r, 10_000)); }
  }
}

// One worker per machine (launchd/systemd), so the host name is the lease owner: a restart takes the lease
// straight back instead of waiting for its own previous process's lease to expire.
const OWNER = hostname();

/** Phone actions (public.action_requests) every 3 s, and the status row for the app every minute. */
async function actionLoop() {
  while (!stopping && !ONCE) {
    try { await runActionQueue(2); } catch (e) { log("action loop error", (e as Error).message); }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

/** Status row for the app; separate from the action loop so a slow usage lookup never delays phone actions. */
const publishStatus = () => Promise.race([
  publishWorkerStatus(),
  new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 60 s")), 60_000)),
]).catch((e) => log("worker status not published", (e as Error).message));
async function statusLoop() {
  while (!stopping && !ONCE) {
    await publishStatus();
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

async function main() {
  setCaller("worker");
  void callbackLoop();
  void actionLoop();
  void statusLoop();
  log(`worker started (demo=${config.demoMode}, db=${process.env.SUPABASE_DB_URL ? "supabase" : "none"}, once=${ONCE}, dry=${DRY})`);
  while (!stopping) {
    const started = Date.now();
    const watchdog = setTimeout(() => { log("watchdog: tick stuck for 15 min - exiting so the supervisor restarts the worker"); process.exit(1); }, 15 * 60_000);
    try { await tick(); } catch (e) { lastError = (e as Error).message; log("tick failed", lastError); }
    // Connects balance for the status row: one Upwork call per hour at most (cached), made here in the poll slot.
    if (!DRY) await connectsBalance().catch(() => undefined);
    clearTimeout(watchdog);
    await setWorkerHeartbeat({ at: Date.now(), lastError, lastFetched });
    void publishStatus();
    if (ONCE) break;
    const s = await getSettings();
    const interval = jitteredInterval(Math.max(60, s.pollIntervalSec), s.guard.jitterSec);
    const wait = Math.max(5_000, interval - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  process.exit(0);
}

// Network blips (Wi-Fi switch, DNS, pooler resets) must not kill the worker: log them and keep polling.
const TRANSIENT = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|CONNECTION_DESTROYED|CONNECT_TIMEOUT|CONNECTION_CLOSED|socket hang up|fetch failed|timed out/i;
process.on("unhandledRejection", (e) => {
  const msg = String((e as Error)?.message ?? e);
  if (TRANSIENT.test(msg) || TRANSIENT.test(String((e as { code?: string })?.code ?? ""))) { log(`network blip (ignored): ${msg.slice(0, 160)}`); return; }
  log(`unhandled rejection - exiting so the supervisor restarts the worker: ${msg.slice(0, 300)}`);
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; log("stopping"); process.exit(0); });
main();
