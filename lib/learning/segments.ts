import type { OutcomeJob, OutcomeSegment, ProposalOutcome } from "../types";

/*
 * Finer split of a decided proposal for the nightly review (see OutcomeSegment in lib/types.ts). The point is to
 * stop blaming the opener for jobs that were never real: a client who opened nobody's proposal says nothing about
 * David's first lines, only about which jobs to skip.
 */

/** Did the client do anything on the job (invite, interview, offer, hire)? null = never read. */
export function clientActive(job: OutcomeJob | null | undefined): boolean | null {
  if (!job) return null;
  if (job.invited) return true;
  const xs = [job.interviewed, job.offered, job.hired, job.invites];
  if (xs.some((x) => (x ?? 0) > 0)) return true;
  return job.interviewed == null && job.hired == null ? null : false;
}

export function segmentOf(o: Pick<ProposalOutcome, "outcome" | "status" | "job">): OutcomeSegment {
  switch (o.outcome) {
    case "pending": case "void": return o.outcome;
    case "win": return o.status === "Offered" || o.status === "Hired" ? "hired" : "replied";
    case "loss_viewed": return "opener_worked";
    // Unknown activity is not proof of a ghost job: count it against the opener, as before the split.
    case "loss_unviewed": return clientActive(o.job) === false ? "ghost" : "opener_missed";
  }
}

export const SEGMENT_LABEL: Record<OutcomeSegment, { label: string; cls: string; hint: string }> = {
  ghost: { label: "Ghost job", cls: "pill-neutral", hint: "Never viewed, and the client invited, interviewed and hired nobody - likely not a real hiring job" },
  opener_missed: { label: "Opener missed", cls: "pill-warn", hint: "The client was active (interviewed / hired others) but never opened yours - the first lines lost" },
  opener_worked: { label: "Opener worked", cls: "pill-info", hint: "Viewed but no reply - the opener earned the click, the rest didn't convince" },
  replied: { label: "Client replied", cls: "pill-good", hint: "The client wrote back or interviewed you" },
  hired: { label: "Offer / hired", cls: "pill-good", hint: "Offer or contract - the whole conversation is studied" },
  pending: { label: "Waiting", cls: "pill-neutral", hint: "Sent less than 7 days ago, no reply yet" },
  void: { label: "No signal", cls: "pill-neutral", hint: "Withdrawn, or the client deleted the job" },
};

export const SEGMENTS: OutcomeSegment[] = ["hired", "replied", "opener_worked", "opener_missed", "ghost", "pending", "void"];

export function segmentCounts(rows: Pick<ProposalOutcome, "outcome" | "status" | "job">[]): Record<OutcomeSegment, number> {
  const c = Object.fromEntries(SEGMENTS.map((s) => [s, 0])) as Record<OutcomeSegment, number>;
  for (const o of rows) c[segmentOf(o)]++;
  return c;
}

/** Upwork client ids that never engaged with anyone on a job David applied to. */
export function ghostClientIds(rows: Pick<ProposalOutcome, "outcome" | "status" | "job">[]): Set<string> {
  return new Set(rows.filter((o) => segmentOf(o) === "ghost" && o.job?.clientId).map((o) => o.job!.clientId!));
}

/**
 * Reward used to rank few-shot examples for the writer (the "RLHF" loop, David 2026-10-20): a hire beats a reply,
 * a reply beats a view, a view beats nothing; a proposal skipped while the client hired someone else is negative.
 * Ghost jobs score 0 - they say nothing about the writing. A view on a still-pending proposal counts at once.
 */
export function reward(o: Pick<ProposalOutcome, "outcome" | "status" | "job" | "viewed">): number {
  switch (segmentOf(o)) {
    case "hired": return 3;
    case "replied": return 2;
    case "opener_worked": return 1;
    case "opener_missed": return -1;
    case "pending": return o.viewed ? 1 : 0;
    default: return 0;
  }
}
