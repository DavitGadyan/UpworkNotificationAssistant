import { dueOutcomes, recordOutcome } from "./db";
import { fetchDetail } from "./upwork/source";

/*
 * Ground truth for the ghost-risk model: re-open tracked jobs ~2 days and ~7 days after posting (max 4 per
 * cycle, through the ban-safety guard) and record whether the client hired, closed without hiring, or is
 * still open. Final states update the client's track record (public.clients), which raises ghost risk
 * next time for clients that keep closing jobs without hiring.
 */
const DAY = 864e5;

export async function runOutcomeChecks(max = 4, now = Date.now()): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const o of await dueOutcomes(max, now)) {
    try {
      const d = await fetchDetail(o.jobId);
      if (!d) { out[o.jobId] = "no-source"; continue; }
      const e = d.enrichment;
      const hired = e.activity.hired > 0;
      const closed = !!e.status && e.status !== "ACTIVE";
      const status = hired ? "hired" : closed ? "closed_no_hire" : "open";
      // Second look at ~7 days; after that, weekly up to 4 checks, then stop polling.
      const next = status !== "open" ? now : o.checks >= 3 ? now + 365 * DAY : now + (o.checks === 0 ? 5 : 7) * DAY;
      await recordOutcome(o.jobId, { status, proposalsTier: null, invites: e.activity.invitesSent, interviewed: e.activity.interviewed, hired: e.activity.hired, nextCheckAt: next }, now);
      out[o.jobId] = status;
    } catch (err) {
      const msg = (err as Error).message;
      // Private/removed jobs: retry a day later, give up after a few tries (unknown outcome, not counted).
      await recordOutcome(o.jobId, { status: "open", proposalsTier: null, invites: 0, interviewed: 0, hired: 0, nextCheckAt: o.checks >= 3 ? now + 365 * DAY : now + DAY }, now);
      out[o.jobId] = `error ${msg.slice(0, 60)}`;
      if ((err as { kind?: string }).kind) break;
    }
  }
  return out;
}
