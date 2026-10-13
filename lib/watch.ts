import { dueWatches, getJob, getSettings, listSearches, updateJobData, updateWatch, type WatchRow } from "./db";
import { editJobAlert, sendText } from "./notify/telegram";
import { scoreJob } from "./scoring";
import type { CachedJob, Job } from "./types";
import { mapRow, mergeDetail } from "./upwork/mcp/jobs";
import { callTool } from "./upwork/mcp/client";
import { fetchDetail } from "./upwork/source";
import { proposalsLow } from "./upwork/tiers";

/*
 * Proposal-count watch. Every alerted job is re-checked every `watch.intervalMin` minutes until it
 * crosses `rules.maxProposals` (default 20), closes, hires, or `watch.maxHours` pass:
 *   - the original channel post is edited in place with the new count;
 *   - one ⚠️ reply when the count reaches `rules.watchWarnAt` (default 15);
 *   - one ⛔ reply when it passes the cap ("too crowded - skip"), then the watch ends;
 *   - one 🚩 reply if the client turns out to be ignoring the job (2+ days, no invites/interviews).
 * Counts come from the feed rows for free when the job is still in a feed (applyFeedCounts), else from
 * a narrow smart_search window around the publish time, else from find_jobs get (activity only).
 */

const label = (j: Pick<Job, "totalApplicants" | "proposalsTier">) => j.proposalsTier ?? String(j.totalApplicants);
const feedName = async (j: CachedJob) => (await listSearches()).find((s) => s.id === j.searchId)?.name ?? j.searchName;

/** Feed rows of already-known jobs carry fresh counts: record them without an extra call. */
export async function applyFeedCounts(jobs: Job[]) {
  for (const fresh of jobs) {
    const cur = await getJob(fresh.id);
    if (!cur) continue;
    if (fresh.totalApplicants !== cur.totalApplicants || (fresh.proposalsTier ?? null) !== (cur.proposalsTier ?? null)) {
      const { searchId: _s, searchName: _n, score: _sc, status: _st, fetchedAt: _f, enrichment: _e, feeds: _fd, ...base } = cur;
      await updateJobData(cur.id, { job: { ...base, totalApplicants: fresh.totalApplicants, proposalsTier: fresh.proposalsTier ?? null } });
    }
  }
}

/** Look the job up in a ±2 min Most Recent window around its publish time (one call, returns the count). */
async function countFromFeed(job: CachedJob): Promise<Job | null> {
  const t = new Date(job.publishedAt).getTime();
  const r = await callTool<{ jobs?: Record<string, unknown>[] }>("find_jobs", "smart_search", {
    mode: "most_recent", from_date: new Date(t - 120_000).toISOString(), to_date: new Date(t + 120_000).toISOString(), limit: 10,
  });
  const row = (r.jobs ?? []).find((x) => String(x.id) === job.id);
  return row ? mapRow(row as Parameters<typeof mapRow>[0]) : null;
}

export async function checkWatch(w: WatchRow, now = new Date()): Promise<string> {
  const s = await getSettings();
  const rules = s.rules;
  const job = await getJob(w.jobId);
  if (!job) { await updateWatch(w.jobId, { done: "expired" }); return "gone"; }
  if (now.getTime() - w.startedAt > s.watch.maxHours * 36e5) { await updateWatch(w.jobId, { done: "timeout" }); return "timeout"; }

  // 1) proposal count
  let current: Pick<Job, "totalApplicants" | "proposalsTier"> = job;
  try {
    const row = await countFromFeed(job);
    if (row) current = row;
  } catch (e) { console.warn("watch count failed", job.id, (e as Error).message); }

  // 2) liveness + client activity (closed? hired? ignored?)
  let enrichment = job.enrichment ?? null;
  let merged: Job = { ...job, totalApplicants: current.totalApplicants, proposalsTier: current.proposalsTier ?? null };
  try {
    const d = await fetchDetail(job.id);
    if (d) { enrichment = d.enrichment; merged = mergeDetail(merged, d.patch, d.enrichment); }
  } catch (e) { console.warn("watch detail failed", job.id, (e as Error).message); }

  const search = (await listSearches()).find((x) => x.id === job.searchId);
  const score = search ? scoreJob(merged, search, now, rules, { enrichment, llm: job.score.llm ?? null }) : job.score;
  const { searchId: _s, searchName: _n, score: _sc, status: _st, fetchedAt: _f, enrichment: _e, feeds: _fd, ...base } = merged as CachedJob;
  await updateJobData(job.id, { job: base, score, enrichment });

  const low = proposalsLow(current);
  const changed = label(current) !== (w.lastTier ?? String(w.lastCount));
  const name = await feedName(job);
  let footer = `🔄 checked ${now.toISOString().slice(11, 16)} UTC`;
  const patch: Parameters<typeof updateWatch>[1] = { lastCount: current.totalApplicants, lastTier: current.proposalsTier ?? null, nextAt: now.getTime() + s.watch.intervalMin * 60_000 };

  if (enrichment?.status && enrichment.status !== "ACTIVE") {
    patch.done = "closed"; footer = "⛔ Job closed";
  } else if (enrichment && enrichment.activity.hired > 0) {
    patch.done = "hired"; footer = "⛔ Client already hired";
  } else if (current.proposalsTier ? low >= rules.maxProposals : low > rules.maxProposals) {
    patch.done = "crowded"; footer = `⛔ ${label(current)} proposals - too crowded, skip`;
    await sendText(`⛔ <b>Skip:</b> now ${label(current)} proposals on “${job.title.replace(/</g, "&lt;")}” - over ${rules.maxProposals}, chances are very low.`, w.messageId ?? undefined);
  } else if (!w.warned && low >= rules.watchWarnAt) {
    patch.warned = true;
    await sendText(`⚠️ <b>Hurry:</b> ${label(current)} proposals already on “${job.title.replace(/</g, "&lt;")}”. Apply soon or skip.`, w.messageId ?? undefined);
  }
  const ignored = score.rules?.flags.find((f) => f.code === "ignored");
  if (ignored && !job.score.rules?.flags.some((f) => f.code === "ignored")) {
    await sendText(`🚩 ${ignored.label} - consider skipping “${job.title.replace(/</g, "&lt;")}”.`, w.messageId ?? undefined);
  }

  if (w.messageId && (changed || patch.done)) {
    await editJobAlert(w.messageId, merged, score, name, enrichment, label(current), footer);
  }
  await updateWatch(job.id, patch);
  return patch.done ?? (changed ? `count ${label(current)}` : "unchanged");
}

/** Run due watches, at most `max` per cycle (each costs 1-2 Upwork calls). */
export async function runWatches(max: number, now = new Date()) {
  const out: Record<string, string> = {};
  for (const w of (await dueWatches(now.getTime())).slice(0, max)) {
    try { out[w.jobId] = await checkWatch(w, now); } catch (e) {
      out[w.jobId] = `error ${(e as Error).message}`;
      await updateWatch(w.jobId, { nextAt: now.getTime() + (await getSettings()).watch.intervalMin * 60_000 });
      if ((e as { kind?: string }).kind) break;
    }
  }
  return out;
}
