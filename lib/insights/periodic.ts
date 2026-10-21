import { getSettings, kvGet, kvSet, listProposalOutcomesSafe } from "../db";
import { replyLure } from "../ranking/scam";
import { mcpCallsToday } from "../upwork/guard";
import { llmReady } from "../agents/llm";
import { buildWorkHistory, workHistory } from "../agents/workHistory";
import { calibrate } from "../feedback/calibrate";
import { buildLessons } from "../learning/lessons";
import { syncProposalOutcomes } from "../learning/outcomes";
import { buildNightlyReview } from "../learning/review";
import { snapshotKpis } from "../learning/kpis";
import { isHire, isOffer } from "../learning/outcomes";
import { saveLabReport, snapshotPromptStats } from "../learning/promptLab";
import { esc as escapeHtml, sendText, telegramConfigured } from "../notify/telegram";
import { buildGhostReport } from "./ghosts";
import { buildIcp } from "./icp";
import { benchmarkPeers, monthlyReview, monthlySnapshot, syncProfile } from "./metrics";

/*
 * Slow jobs the worker runs between polls. Each records its last run in kv and is skipped until due:
 *   nightly  - 00:00 (auto-apply timezone): proposal review - ghost jobs / opener missed / opener worked / wins, with Telegram summary
 *   3-hourly - proposal outcomes (light; full once a day) (did clients view / reply to David's proposals?) + a Telegram note per new reply
 *   daily   - own profile sync
 *   weekly  - "What wins" lessons report (David approves before any prompt changes)
 *   monthly - (1st of the month or 30 days later) snapshot → review → client profile → peer benchmark →
 *             ranking-weight calibration proposal
 * One job per tick at most, so a slow month-end never delays job alerts by more than one step.
 */

const DAY = 864e5;
const OUTCOMES_EVERY = 3 * 3600_000; // 8x a day, light; one full pass a day
const due = async (key: string, every: number) => Date.now() - ((await kvGet<number>(`last_${key}`)) ?? 0) >= every;
const mark = async (key: string) => await kvSet(`last_${key}`, Date.now());

/** Local date in `tz` (YYYY-MM-DD): the nightly review runs on the first tick of each new local day, i.e. at 00:00. */
export const localDate = (tz: string, nowMs = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));

export async function runPeriodic(): Promise<string | null> {
  const today = localDate((await getSettings()).autoApply.timezone);
  if ((await kvGet<string>("nightly_review_date")) !== today) {
    await kvSet("nightly_review_date", today);
    // Re-read every proposal first (views and replies on yesterday's proposals land the next day), then snapshot
    // the 24-hour KPIs and run the review. The sync skips itself near the daily Upwork call cap.
    const cap = (await getSettings()).guard.dailyCallCap;
    if ((await mcpCallsToday()) < cap * 0.7) {
      await mark("proposal_outcomes"); await mark("proposal_outcomes_full");
      const r = await syncProposalOutcomes({ mode: "full", maxCalls: 60 }).catch((e) => { console.warn("nightly sync:", (e as Error).message); return null; });
      if (r) await notifyViews(r.newViews);
    }
    await snapshotKpis();
    await buildNightlyReview({ notify: true, log: (m) => console.warn(m) });
    return "nightly_review";
  }
  if (await due("profile_sync", DAY)) { await mark("profile_sync"); await syncProfile(); return "profile_sync"; }
  // Past contracts + client feedback for the writer (David, 2026-10-20). Never starts the index itself - David runs
  // `npm run work-history -- build` once; after that a weekly pass picks up new contracts (1 call when there are none).
  if ((await due("work_history", 7 * DAY)) && (await workHistory())?.complete) {
    await mark("work_history");
    await buildWorkHistory({ maxCalls: 12 }).catch((e) => console.warn("work history:", (e as Error).message));
    return "work_history";
  }
  if (await due("ghosts", DAY)) { await mark("ghosts"); await buildGhostReport(); return "ghosts"; }
  if (await due("proposal_outcomes", OUTCOMES_EVERY)) {
    await mark("proposal_outcomes");
    // Stay well inside Upwork's limits: skip while today's calls are past 70% of the daily cap (job polling comes first).
    const cap = (await getSettings()).guard.dailyCallCap;
    if ((await mcpCallsToday()) < cap * 0.7) {
      const full = await due("proposal_outcomes_full", DAY);
      if (full) await mark("proposal_outcomes_full");
      const r = await syncProposalOutcomes({ mode: full ? "full" : "light", maxCalls: full ? 60 : 25 });
      await notifyViews(r.newViews);
    }
    await notifyReplies();
    await saveLabReport();
    await snapshotPromptStats();
    return "proposal_outcomes";
  }
  if ((await llmReady()) && (await due("lessons", 7 * DAY))) {
    await mark("lessons");
    for (const target of ["writer", "ranker"] as const) {
      const r = await buildLessons(Date.now(), target);
      if (r.ok && r.lessons.length && telegramConfigured()) {
        await sendText(`🧠 <b>${target === "writer" ? "Writer" : "Ranker"} lessons</b> - ${r.lessons.length} from your proposal results are waiting for your approval in Insights.\n${escapeHtml(r.headline ?? "")}`).catch(() => undefined);
      }
    }
    return "lessons";
  }
  const monthly = 30 * DAY;
  if (await due("snapshot", monthly)) { await mark("snapshot"); await monthlySnapshot(); return "snapshot"; }
  if (await due("icp", monthly)) { await mark("icp"); await buildIcp(); return "icp"; }
  if ((await llmReady()) && (await due("review", monthly))) { await mark("review"); await monthlyReview(); return "review"; }
  if ((await llmReady()) && (await due("coach", monthly))) { await mark("coach"); await benchmarkPeers(); return "coach"; }
  if (await due("calibrate", monthly)) { await mark("calibrate"); await calibrate(); return "calibrate"; }
  return null;
}

/** One Telegram line per proposal a client opened since the last sync (the view is already learned from). */
async function notifyViews(ids: string[]) {
  if (!ids.length || !telegramConfigured()) return;
  const rows = await listProposalOutcomesSafe({ limit: 300 });
  for (const id of ids.slice(0, 10)) {
    const o = rows.find((x) => x.upworkProposalId === id);
    if (o && o.outcome !== "win") await sendText(`👀 <b>Client viewed your proposal</b>: ${escapeHtml(o.jobTitle)}\nThe opener counts as a win for the writer now. Open Upwork in case they message.`).catch(() => undefined);
  }
}

/** One Telegram line per client reply found in the last 2 days (each proposal once). */
async function notifyReplies() {
  if (!telegramConfigured()) return;
  const sent = new Set(await kvGet<string[]>("reply_notified") ?? []);
  const fresh = (await listProposalOutcomesSafe({ outcome: "win", limit: 50 }))
    .filter((o) => !sent.has(o.upworkProposalId) && Date.now() - Date.parse(o.repliedAt ?? o.submittedAt) < 2 * DAY);
  for (const o of fresh) {
    const lure = replyLure(o.firstReply) ?? (o.job?.flags ?? []).find((f) => /malware lure/i.test(f)) ?? null;
    const warn = lure ? `\n🚨 <b>Possible fake-job malware lure</b> (${escapeHtml(lure.slice(0, 80))}). Never clone, install or run their code or files; if it is one, report it with <code>npm run scam -- ${escapeHtml(o.jobId)} "reason"</code>.` : "";
    await sendText(`💬 <b>Client replied</b> to your proposal: ${escapeHtml(o.jobTitle)}${o.firstReply ? `\n“${escapeHtml(o.firstReply.slice(0, 200))}”` : ""}\nOpen Upwork messages to answer.${warn}`).catch(() => undefined);
    sent.add(o.upworkProposalId);
  }
  await kvSet("reply_notified", [...sent].slice(-300));
  // Offers and hires get their own line, once each.
  const prev = await kvGet<Record<string, string>>("stage_notified");
  const stage = prev ?? {}; // first run: record existing offers/hires silently
  for (const o of await listProposalOutcomesSafe({ outcome: "win", limit: 100 })) {
    const s = isHire(o) ? "hired" : isOffer(o) ? "offer" : null;
    if (!s || stage[o.upworkProposalId] === s || (s === "offer" && stage[o.upworkProposalId] === "hired")) continue;
    if (prev) await sendText(`🎉 <b>${s === "hired" ? "Hired" : "Offer"}</b>: ${escapeHtml(o.jobTitle)}`).catch(() => undefined);
    stage[o.upworkProposalId] = s;
  }
  await kvSet("stage_notified", stage);
}
