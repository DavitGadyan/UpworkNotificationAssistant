import { kvGet, kvSet } from "../db";
import { llmReady } from "../agents/llm";
import { calibrate } from "../feedback/calibrate";
import { buildGhostReport } from "./ghosts";
import { buildIcp } from "./icp";
import { benchmarkPeers, monthlyReview, monthlySnapshot, syncProfile } from "./metrics";

/*
 * Slow jobs the worker runs between polls. Each records its last run in kv and is skipped until due:
 *   daily   - own profile sync
 *   monthly - (1st of the month or 30 days later) snapshot → review → client profile → peer benchmark →
 *             ranking-weight calibration proposal
 * One job per tick at most, so a slow month-end never delays job alerts by more than one step.
 */

const DAY = 864e5;
const due = async (key: string, every: number) => Date.now() - ((await kvGet<number>(`last_${key}`)) ?? 0) >= every;
const mark = async (key: string) => await kvSet(`last_${key}`, Date.now());

export async function runPeriodic(): Promise<string | null> {
  if (await due("profile_sync", DAY)) { await mark("profile_sync"); await syncProfile(); return "profile_sync"; }
  if (await due("ghosts", DAY)) { await mark("ghosts"); await buildGhostReport(); return "ghosts"; }
  const monthly = 30 * DAY;
  if (await due("snapshot", monthly)) { await mark("snapshot"); await monthlySnapshot(); return "snapshot"; }
  if (await due("icp", monthly)) { await mark("icp"); await buildIcp(); return "icp"; }
  if ((await llmReady()) && (await due("review", monthly))) { await mark("review"); await monthlyReview(); return "review"; }
  if ((await llmReady()) && (await due("coach", monthly))) { await mark("coach"); await benchmarkPeers(); return "coach"; }
  if (await due("calibrate", monthly)) { await mark("calibrate"); await calibrate(); return "calibrate"; }
  return null;
}
