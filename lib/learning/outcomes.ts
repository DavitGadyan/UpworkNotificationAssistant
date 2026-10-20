import { getJob, getProposalOutcome, listProposalOutcomes, listProposals, saveProposalOutcome, updateProposal, dueProposalOutcomes } from "../db";
import { currentFieldSpec } from "../ranking/fieldSpec";
import { noteViews } from "./kpis";
import { assessProfileFit } from "../ranking/profileFit";
import type { OutcomeJob, OutcomeLabel, ProposalOutcome } from "../types";
import { callTool } from "../upwork/mcp/client";
import { getJobDetailMcp } from "../upwork/mcp/jobs";
import { isClientReply, isInvite, parseProposalDetail, parseProposalList, parseStories, type UpworkProposalRow } from "../upwork/mcp/proposals";

/*
 * Proposal outcomes: what each client did after David sent a proposal (read-only MCP calls, never a message).
 *   win            client wrote in the proposal room (beyond an invitation), or Offered / Hired
 *   loss_viewed    viewed, but no reply within 7 days (or the job closed without one) - the letter didn't convince
 *   loss_unviewed  never viewed within 7 days (or closed unviewed) - job choice, timing or first line didn't earn a click
 *   pending        younger than 7 days, no reply yet
 *   (decided early) the client sent an offer or hired on the job without replying to David: loss_viewed if he
 *                  viewed the proposal, loss_unviewed if he never opened it (David, 2026-10-19).
 *   void           no signal about David: he withdrew, or the client deleted the job (accidental / inappropriate)
 * Freelancers cannot message first on a proposal, so a room with a client message means the client replied.
 * A late reply still flips a loss to a win: rooms are re-checked 1, 3, 7 and 14 days after sending.
 */

const DAY = 864e5;
export const DECIDE_AFTER_DAYS = 7;
const CHECK_AT_DAYS = [1, 3, 7, 14];
const STATUSES = ["Accepted", "Offered", "Hired", "Activated", "Declined", "Withdrawn", "Archived"] as const;
// Activated = David accepted an invitation; that alone says nothing about his letter, so it is not a win.
const WIN_STATUS = new Set(["Offered", "Hired"]);
const CLOSED = new Set(["Declined", "Archived"]);
const VOID_REASON = /accidental|inappropriate|duplicate|by mistake|spam/i;

/** Funnel stages beyond a reply (Upwork status). */
export const isOffer = (o: Pick<ProposalOutcome, "status">) => o.status === "Offered" || o.status === "Hired";
export const isHire = (o: Pick<ProposalOutcome, "status">) => o.status === "Hired";

/** The client already sent an offer to, or hired, someone on this job. */
export const choseSomeoneElse = (job: OutcomeJob | null | undefined) => !!job && ((job.offered ?? 0) > 0 || (job.hired ?? 0) > 0);

export function classifyOutcome(o: Pick<ProposalOutcome, "status" | "viewed" | "repliedAt" | "submittedAt" | "archiveReason"> & { job?: OutcomeJob | null }, now = Date.now()): OutcomeLabel {
  if (o.repliedAt || WIN_STATUS.has(o.status)) return "win";
  if (o.status === "Withdrawn") return "void";
  if (o.status === "Archived" && !o.viewed && o.archiveReason && VOID_REASON.test(o.archiveReason)) return "void";
  if (CLOSED.has(o.status) || now - Date.parse(o.submittedAt) >= DECIDE_AFTER_DAYS * DAY || choseSomeoneElse(o.job)) return o.viewed ? "loss_viewed" : "loss_unviewed";
  return "pending";
}

/** Next room check: the next of day 1/3/7/14 after sending; 0 = done (won, void, or past day 14). */
export function nextReplyCheck(o: Pick<ProposalOutcome, "submittedAt" | "outcome">, now = Date.now()): number {
  if (o.outcome === "win" || o.outcome === "void") return 0;
  const sent = Date.parse(o.submittedAt);
  for (const d of CHECK_AT_DAYS) if (sent + d * DAY > now) return sent + d * DAY;
  return 0;
}

export interface SyncResult { listed: number; added: number; changed: number; detailed: number; roomChecks: number; newWins: string[]; newViews: string[]; calls: number; stoppedAtCap: boolean }

/**
 * One sync pass. Lists every status (sorted by last change), fills cover letters + job snapshots for new rows,
 * then runs the due room checks. Stops cleanly at `maxCalls`; whatever is left is picked up next run.
 */
/**
 * mode "light" (several times a day): first page of each status + up to 5 new cover letters + due room checks -
 * about 12-20 calls. "full" (daily / backfill): `pages` pages per status and every missing detail.
 */
export async function syncProposalOutcomes(opts: { mode?: "light" | "full"; pages?: number; sinceDays?: number; maxCalls?: number; now?: number; log?: (m: string) => void } = {}): Promise<SyncResult> {
  const now = opts.now ?? Date.now();
  const light = opts.mode === "light";
  const pages = light ? 1 : opts.pages ?? 2;
  const since = new Date(now - (opts.sinceDays ?? 120) * DAY).toISOString();
  const maxCalls = opts.maxCalls ?? 40;
  const res: SyncResult = { listed: 0, added: 0, changed: 0, detailed: 0, roomChecks: 0, newWins: [], newViews: [], calls: 0, stoppedAtCap: false };
  const call = async <T,>(tool: string, action: string, params: Record<string, unknown>): Promise<T> => {
    if (res.calls >= maxCalls) { res.stoppedAtCap = true; throw new CapReached(); }
    res.calls++;
    return await callTool<T>(tool, action, params);
  };

  try {
    // 1. Lists: one row per proposal (each one sits under exactly one status).
    const seen = new Map<string, UpworkProposalRow>();
    for (const status of STATUSES) {
      let cursor: string | null = null;
      for (let p = 0; p < pages; p++) {
        const r = parseProposalList(await call("list_freelancer_proposals", "list", { status, limit: 10, sort_field: "MODIFIEDDATETIME", sort_order: "DESC", ...(cursor ? { cursor } : {}) }));
        const fresh = r.rows.filter((x) => (x.modifiedAt ?? x.createdAt) >= since);
        for (const x of fresh) if (x.createdAt >= since && x.jobId) seen.set(x.id, x);
        cursor = r.cursor;
        // The connector filters other statuses out of a page, so an empty page is not the end - an all-old page is.
        if (!r.hasMore || !cursor || (r.rows.length > 0 && fresh.length === 0)) break;
      }
    }
    res.listed = seen.size;
    const local = new Map((await listProposals()).filter((p) => p.status === "submitted").map((p) => [p.jobId, p]));
    for (const x of seen.values()) {
      const cur = await getProposalOutcome(x.id);
      const lp = local.get(x.jobId) ?? null;
      if (lp && lp.upworkProposalId !== x.id) await updateProposal(lp.id, { upworkProposalId: x.id });
      const base: ProposalOutcome = cur ?? {
        upworkProposalId: x.id, jobId: x.jobId, jobTitle: x.jobTitle, localProposalId: null, submittedAt: x.createdAt, status: x.status,
        statusLabel: null, archiveReason: null, viewed: false, boosted: false, connectsBid: null, bid: null, bidLabel: null, coverLetter: null,
        insights: null, roomId: null, repliedAt: null, firstReply: null, outcome: "pending", job: null, checks: 0, nextCheckAt: now, updatedAt: now,
      };
      const changed = !cur || cur.status !== x.status || cur.viewed !== x.viewed;
      const next: ProposalOutcome = {
        ...base, jobTitle: x.jobTitle || base.jobTitle, localProposalId: lp?.id ?? base.localProposalId, status: x.status, statusLabel: x.statusLabel,
        archiveReason: x.archiveReason, viewed: x.viewed || base.viewed, boosted: x.boosted, connectsBid: x.connectsBid, bid: x.bid, bidLabel: x.bidLabel, updatedAt: now,
      };
      next.outcome = classifyOutcome(next, now);
      // A status or "viewed" change is worth a room check now (an interview invite opens a room).
      next.nextCheckAt = changed && next.outcome !== "void" && !next.repliedAt ? now : cur ? cur.nextCheckAt : now;
      if (!cur) res.added++; else if (changed) res.changed++;
      if (next.outcome === "win" && cur?.outcome !== "win") res.newWins.push(next.jobTitle);
      await saveProposalOutcome(next);
    }

    // 2. Cover letter + job snapshot for rows that don't have them yet (newest first).
    const spec = await currentFieldSpec();
    for (const o of (await listProposalOutcomes({ limit: 500 })).filter((o) => o.coverLetter == null || o.job == null).slice(0, light ? 5 : 500)) {
      const d = o.coverLetter == null ? parseProposalDetail(await call("list_freelancer_proposals", "get", { id: o.upworkProposalId })) : null;
      const job = o.job ?? await jobSnapshot(o.jobId, o.jobTitle, spec, () => { if (res.calls >= maxCalls) { res.stoppedAtCap = true; throw new CapReached(); } res.calls++; });
      await saveProposalOutcome({ ...o, coverLetter: d ? d.coverLetter ?? "" : o.coverLetter, insights: d?.insights ?? o.insights, job, updatedAt: now });
      res.detailed++;
    }

    // 3. Due room checks: did the client write? Unanswered ones also re-read the job's activity (one governed job
    //    open): an offer or hire to someone else decides the outcome now instead of after 7 days.
    for (const o of await dueProposalOutcomes(50, now)) {
      const room = await roomReply(o.upworkProposalId, call);
      res.roomChecks++;
      const reply = room?.reply ?? null;
      let job = o.job && room?.invited ? { ...o.job, invited: true } : o.job;
      if (!reply && job && o.outcome === "pending") job = await refreshActivity(o.jobId, job, () => { if (res.calls >= maxCalls) { res.stoppedAtCap = true; throw new CapReached(); } res.calls++; });
      const next: ProposalOutcome = {
        ...o, checks: o.checks + 1, updatedAt: now, roomId: room?.roomId ?? o.roomId, job,
        ...(reply ? { repliedAt: reply.at, firstReply: reply.text } : {}),
      };
      next.outcome = classifyOutcome(next, now);
      next.nextCheckAt = nextReplyCheck(next, now);
      if (next.outcome === "win" && o.outcome !== "win") res.newWins.push(next.jobTitle);
      await saveProposalOutcome(next);
    }
  } catch (e) {
    if (!(e instanceof CapReached)) throw e;
    opts.log?.(`proposal outcomes: stopped at the ${maxCalls}-call cap, continuing next run`);
  }
  // When each proposal was first seen viewed - feeds the 24-hour KPIs and the "client viewed" notice.
  res.newViews = await noteViews(await listProposalOutcomes({ limit: 1000 }), now);
  return res;
}

class CapReached extends Error {}

/** Re-read interviewed / offered / hired for a job. Any failure (job-open budget spent, job gone) keeps the old snapshot. */
async function refreshActivity(jobId: string, job: OutcomeJob, countCall: () => void): Promise<OutcomeJob> {
  countCall(); // throws CapReached at this run's call cap
  try {
    const { enrichment: e } = await getJobDetailMcp(jobId);
    return { ...job, interviewed: e.activity.interviewed, hired: e.activity.hired, offered: e.activity.offered, invites: e.activity.invitesSent, activityAt: Date.now() };
  } catch {
    return job;
  }
}

async function roomReply(upworkProposalId: string, call: <T>(tool: string, action: string, params: Record<string, unknown>) => Promise<T>): Promise<{ roomId: string; invited: boolean; reply: { at: string; text: string } | null } | null> {
  let room: { id?: string; createdAtDateTime?: string } | undefined;
  try {
    const r = await call<{ data?: { proposalRoom?: { id?: string; createdAtDateTime?: string } } }>("get_messages", "find_room", { context_type: "proposal", context_id: upworkProposalId });
    room = r.data?.proposalRoom;
  } catch (e) {
    if (e instanceof CapReached) throw e;
    if (/NOT_FOUND|not found|No proposal room/i.test((e as Error).message)) return null;
    throw e;
  }
  if (!room?.id) return null;
  const stories = parseStories(await call("get_messages", "list_messages", { room_id: room.id, limit: 50 }));
  const invited = stories.some(isInvite);
  const client = stories.filter(isClientReply);
  if (!client.length) return { roomId: room.id, invited, reply: null }; // only the invitation, staff or system notices
  const first = client[client.length - 1]; // newest first upstream
  return { roomId: room.id, invited, reply: { at: first.at ?? room.createdAtDateTime ?? new Date().toISOString(), text: first.text.slice(0, 400) } };
}

/** What the job looked like: from our cache when we still have it (with our rank), else one find_jobs get. */
async function jobSnapshot(jobId: string, title: string, spec: Awaited<ReturnType<typeof currentFieldSpec>>, countCall: () => void): Promise<OutcomeJob | null> {
  const cached = await getJob(jobId);
  if (cached) {
    const fit = cached.score.profileFit ?? assessProfileFit(cached, spec);
    const budget = cached.amount != null ? `$${cached.amount} fixed` : cached.hourlyMin != null || cached.hourlyMax != null ? `$${cached.hourlyMin ?? "?"}-${cached.hourlyMax ?? "?"}/hr` : null;
    return {
      category: cached.category, subcategory: cached.subcategory ?? cached.enrichment?.subcategory ?? null, field: fit.field, fitVerdict: fit.verdict,
      contractType: cached.jobType ?? null, budget, clientCountry: cached.client.country, clientSpent: cached.client.totalSpent, clientHires: cached.client.totalHires,
      interviewed: cached.enrichment?.activity.interviewed ?? null, hired: cached.enrichment?.activity.hired ?? null,
      offered: cached.enrichment?.activity.offered ?? null, invites: cached.enrichment?.activity.invitesSent ?? null,
      clientId: cached.enrichment?.clientId ?? null,
      rank: cached.score.total, rulesScore: cached.score.rules?.score ?? null, llmFit: cached.score.llm?.fit ?? null,
      flags: cached.score.rules?.flags.map((f) => f.code) ?? [], ruleCategory: cached.score.rules?.category ?? null,
      description: (cached.enrichment?.description || cached.description).slice(0, 1500),
      ...(cached.score.llm ? { rankerVersion: cached.score.llm.promptVersion ?? null } : {}),
    };
  }
  countCall();
  try {
    const { enrichment: e, patch } = await getJobDetailMcp(jobId);
    const category = patch.category ?? null, subcategory = e.subcategory ?? null;
    const fit = assessProfileFit({ title, skills: [], category, subcategory }, spec);
    const hourly = patch.hourlyMin != null || patch.hourlyMax != null;
    return {
      category, subcategory, field: fit.field, fitVerdict: fit.verdict, contractType: hourly ? "hourly" : null,
      budget: hourly ? `$${patch.hourlyMin ?? "?"}-${patch.hourlyMax ?? "?"}/hr` : null,
      clientCountry: patch.client?.country ?? null, clientSpent: e.record.totalSpent, clientHires: e.record.hires,
      interviewed: e.activity.interviewed, hired: e.activity.hired, offered: e.activity.offered, invites: e.activity.invitesSent,
      clientId: e.clientId ?? null, activityAt: Date.now(), rank: null, rulesScore: null, llmFit: null, flags: [], ruleCategory: null,
      description: e.description.slice(0, 1500),
    };
  } catch (e) {
    if (/not found|NOT_FOUND|no longer available/i.test((e as Error).message)) return { ...EMPTY_JOB, ...fitOnly(title, spec) };
    throw e;
  }
}

const EMPTY_JOB: OutcomeJob = {
  category: null, subcategory: null, field: null, fitVerdict: null, contractType: null, budget: null, clientCountry: null, clientSpent: null,
  clientHires: null, interviewed: null, hired: null, rank: null, rulesScore: null, llmFit: null, flags: [], ruleCategory: null, description: "",
};
const fitOnly = (title: string, spec: Awaited<ReturnType<typeof currentFieldSpec>>) => {
  const f = assessProfileFit({ title, skills: [], category: null, subcategory: null }, spec);
  return { field: f.field, fitVerdict: f.verdict };
};
