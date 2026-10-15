import type { Job, JobEnrichment } from "../types";

/*
 * Repeat poster (David, 2026-10-15): a client who keeps posting the same job ("SRS document for the X
 * Platform", 50 times) and hands each one to the same one or two freelancers is a red flag - a new applicant
 * mostly pads their shortlist. Upwork's connector doesn't name past freelancers, so the signal is the job
 * itself: 3+ of the client's recent contracts (up to 10 shown) are near-identical to this one.
 * Advisory for the AI ranker (a red flag it must weigh) and a hard stop for automatic drafts; David's rule
 * points are unchanged.
 */

export const REPEAT_MIN = 3;
const STOP = new Set(["the", "a", "an", "for", "of", "and", "to", "in", "on", "with", "our", "my", "-", "&", "needed", "need", "looking"]);
const words = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));

/** Same opening words ("srs document ...") or most words shared. */
export function sameJob(a: string, b: string): boolean {
  const wa = words(a), wb = words(b);
  if (wa.length >= 2 && wb.length >= 2 && wa[0] === wb[0] && wa[1] === wb[1]) return true;
  const sa = new Set(wa), sb = new Set(wb);
  const inter = [...sa].filter((w) => sb.has(w)).length;
  return sa.size + sb.size > 0 && (2 * inter) / (sa.size + sb.size) >= 0.7;
}

export interface RepeatPoster { count: number; shown: number; titles: string[] }

export function repeatPoster(job: Pick<Job, "title">, e: Pick<JobEnrichment, "workHistory" | "otherOpenJobs"> | null | undefined): RepeatPoster | null {
  if (!e) return null;
  const past = e.workHistory.map((w) => w.title).filter(Boolean);
  const open = e.otherOpenJobs.map((o) => o.title).filter(Boolean);
  const similar = [...past, ...open].filter((t) => t !== job.title && sameJob(job.title, t));
  const pastSimilar = past.filter((t) => sameJob(job.title, t)).length;
  if (pastSimilar < REPEAT_MIN) return null;
  return { count: similar.length, shown: past.length + open.length, titles: similar.slice(0, 4) };
}

export const repeatPosterNote = (r: RepeatPoster) =>
  `REPEAT POSTER: ${r.count} of the client's ${r.shown} recent/open jobs are near-identical to this one (e.g. "${r.titles[0]}"). They re-post the same job and usually rehire the same freelancers - add a red flag and keep valuePotential low unless the post says they want new people.`;
