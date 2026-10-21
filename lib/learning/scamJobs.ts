import { kvGet, kvSet } from "../db";
import type { OutcomeLabel } from "../types";

/*
 * Jobs David reported as scams (fake-job malware lures and the like). Their proposals carry no signal about his
 * writing or job choice - a scammer "replies" to everyone - so every outcome on them is forced to "void", which the
 * KPIs, nightly review, prompt lab, writer examples, ranker examples and calibration all skip. Sticky: the outcome
 * sync re-applies it on every pass, so a later client message can't turn it back into a "win".
 */

export const SCAM_JOBS_KEY = "scam_jobs";
export interface ScamMark { reason: string; at: string }

export async function scamJobs(): Promise<Record<string, ScamMark>> {
  return (await kvGet<Record<string, ScamMark>>(SCAM_JOBS_KEY)) ?? {};
}

export async function markScamJob(jobId: string, reason: string, now = new Date()): Promise<Record<string, ScamMark>> {
  const all = await scamJobs();
  all[jobId] = { reason, at: now.toISOString() };
  await kvSet(SCAM_JOBS_KEY, all);
  return all;
}

/** The outcome to store: "void" for a reported scam job, else the classified label. */
export const scamAware = (jobId: string, outcome: OutcomeLabel, scams: Record<string, ScamMark>): OutcomeLabel =>
  scams[jobId] ? "void" : outcome;
