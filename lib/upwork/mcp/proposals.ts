/*
 * Parsers for the freelancer's own proposals and message rooms, as the Upwork MCP connector returns them
 * (verified against live responses 2026-10-15):
 *   list_freelancer_proposals list → data.vendorProposals.edges[].node, paged by pageInfo.endCursor
 *   list_freelancer_proposals get  → data.vendorProposal (+ proposalCoverLetter) and top-level insights
 *   get_messages find_room         → data.proposalRoom (NOT_FOUND error when the client never wrote)
 *   get_messages list_messages     → data.roomStories.edges[].node, newest first
 * Older shapes (proposals / items / messages / stories at the top level) are still accepted.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

export interface UpworkProposalRow {
  id: string;
  jobId: string;
  jobTitle: string;
  createdAt: string; // ISO
  modifiedAt: string | null;
  status: string; // Accepted (= submitted), Offered, Hired, Activated, Declined, Withdrawn, Archived, Pending
  statusLabel: string | null;
  archiveReason: string | null;
  viewed: boolean;
  boosted: boolean;
  connectsBid: number | null;
  bid: number | null;
  /** "$80/hr" or "$2,000 fixed · 1 to 3 months". */
  bidLabel: string | null;
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (v: Obj | string | undefined | null): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v.displayValue) return String(v.displayValue);
  if (v.rawValue && Number.isFinite(Number(v.rawValue))) return new Date(Number(v.rawValue)).toISOString();
  return null;
};

export function mapProposalNode(n: Obj): UpworkProposalRow | null {
  const id = n.id ?? n.proposal_id;
  if (!id) return null;
  const job: Obj = n.marketplaceJobPosting ?? n.jobPosting ?? n.job ?? {};
  const st = n.status;
  const status = typeof st === "string" ? st : String(st?.status ?? "Accepted");
  const terms: Obj = n.terms ?? {};
  const bid = num(terms.chargeRate?.rawValue ?? terms.chargeRate);
  const duration: string | null = terms.estimatedDuration?.label ?? null;
  // Upwork returns the hourly rate for hourly bids and the total for fixed-price bids (which carry a duration).
  const bidLabel = bid == null ? null : duration ? `$${bid.toLocaleString("en-US")} fixed · ${duration}` : `$${bid}/hr`;
  return {
    id: String(id),
    jobId: String(job.id ?? ""),
    jobTitle: String(job.content?.title ?? job.title ?? ""),
    createdAt: iso(n.auditDetails?.createdDateTime) ?? iso(n.createdDateTime) ?? iso(n.created) ?? new Date(0).toISOString(),
    modifiedAt: iso(n.auditDetails?.modifiedDateTime) ?? iso(n.modifiedDateTime),
    status,
    statusLabel: typeof st === "object" ? st?.status_label ?? null : null,
    archiveReason: typeof st === "object" ? st?.reason?.reason ?? null : null,
    viewed: !!(n.viewedByClient ?? n.viewed_by_client),
    boosted: !!n.boosted,
    connectsBid: num(terms.connectsBid),
    bid,
    bidLabel,
  };
}

export function parseProposalList(r: Obj): { rows: UpworkProposalRow[]; cursor: string | null; hasMore: boolean } {
  const vp: Obj | undefined = r.data?.vendorProposals;
  const nodes: Obj[] = vp?.edges?.map((e: Obj) => e.node) ?? r.proposals ?? r.data?.proposals ?? r.items ?? [];
  const page: Obj = vp?.pageInfo ?? r.pageInfo ?? {};
  return {
    rows: nodes.map(mapProposalNode).filter((x): x is UpworkProposalRow => !!x),
    cursor: page.endCursor ?? r.next_cursor ?? null,
    hasMore: !!(r.hasMore ?? page.hasNextPage),
  };
}

export interface ProposalDetail { coverLetter: string | null; insights: { proposalsTotal: number | null; opened: number | null; messaged: number | null; shortlisted: number | null } | null }

export function parseProposalDetail(r: Obj): ProposalDetail {
  const p: Obj = r.data?.vendorProposal ?? r.proposal ?? {};
  const i: Obj | undefined = r.insights;
  return {
    coverLetter: p.proposalCoverLetter ?? p.coverLetter ?? null,
    insights: i ? { proposalsTotal: num(i.proposals_total), opened: num(i.proposals_opened), messaged: num(i.messaged), shortlisted: num(i.shortlisted) } : null,
  };
}

export interface RoomStory { at: string | null; from: string; side: "client" | "freelancer" | "other"; self: boolean; org: string | null; text: string }

export function parseStories(r: Obj): RoomStory[] {
  const nodes: Obj[] = r.data?.roomStories?.edges?.map((e: Obj) => e.node) ?? r.messages ?? r.stories ?? [];
  return nodes.map((m) => ({
    at: m.createdDateTime ?? m.created ?? null,
    from: String(m.from ?? "?"),
    side: m.from_self ? "freelancer" : m.from_side === "client" ? "client" : m.from_side === "freelancer" ? "freelancer" : "other",
    self: !!m.from_self,
    org: m.from_organization ?? null,
    text: String(m.message ?? m.text ?? "").trim(),
  }));
}

/** Upwork's invitation template - the client asked David to apply; it comes before his proposal. */
export const isInvite = (s: RoomStory) => s.side === "client" && /invite you to (take a look at|apply to) the job|I'd like to invite you/i.test(s.text);

/** A real answer from the client: not a system notice, not Upwork staff, not the invitation that preceded the proposal. */
export const isClientReply = (s: RoomStory) =>
  s.side === "client" && !s.self && !isInvite(s) && !/^System event:|video meeting starts|^Your message was blocked/i.test(s.text) && !/\bUpwork\b/i.test(`${s.from} ${s.org ?? ""}`);
