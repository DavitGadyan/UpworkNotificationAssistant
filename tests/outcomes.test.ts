import { beforeEach, describe, expect, it, vi } from "vitest";

/* Upwork MCP is mocked: responses below copy the live shapes (2026-10-15) with made-up ids and text. */
const calls: { tool: string; action: string; params: Record<string, unknown> }[] = [];
let responder: (tool: string, action: string, params: Record<string, unknown>) => unknown = () => ({});
vi.mock("@/lib/upwork/mcp/client", () => ({
  callTool: async (tool: string, action: string, params: Record<string, unknown>) => {
    calls.push({ tool, action, params });
    const r = responder(tool, action, params);
    if (r instanceof Error) throw r;
    return r;
  },
  unwrap: (v: unknown) => v,
}));

import { activePrompt, getProposalOutcome, listProposalOutcomes, resetDbForTests, saveProposalOutcome, saveReport } from "@/lib/db";
import { styleExamples } from "@/lib/agents/proposal";
import { buildLessons, decideLessons, outcomeStats, withLessons, type LessonsReport } from "@/lib/learning/lessons";
import { classifyOutcome, syncProposalOutcomes } from "@/lib/learning/outcomes";
import type { ProposalOutcome } from "@/lib/types";
import { isClientReply, parseProposalList, parseStories } from "@/lib/upwork/mcp/proposals";

const DAY = 864e5;
const NOW = Date.parse("2026-10-15T00:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

const node = (id: string, jobId: string, title: string, created: string, extra: Record<string, unknown> = {}) => ({
  node: {
    auditDetails: { createdDateTime: { displayValue: created, rawValue: String(Date.parse(created)) }, modifiedDateTime: { displayValue: created, rawValue: String(Date.parse(created)) } },
    boosted: false, id, marketplaceJobPosting: { content: { title }, id: jobId, url: `https://www.upwork.com/jobs/~02${jobId}` },
    status: { status: "Accepted", status_label: "Submitted" }, terms: { chargeRate: { currency: "USD", displayValue: "USD 80.0", rawValue: "80.0" } }, viewedByClient: false,
    ...extra,
  },
});
const list = (edges: unknown[], hasNextPage = false) => ({ data: { vendorProposals: { edges, pageInfo: { endCursor: "c1", hasNextPage }, totalCount: edges.length } }, hasMore: hasNextPage, status: "ok" });
const story = (side: "client" | "freelancer", text: string, from = "Sam K.", org = "Acme") => ({ node: { createdDateTime: ago(1), from, from_organization: org, from_side: side, from_self: side === "freelancer", message: text } });

describe("Upwork proposal parsers", () => {
  it("reads the vendorProposals list shape, fixed vs hourly bids and archive reasons", () => {
    const r = parseProposalList(list([
      node("p1", "j1", "Polymarket bot", ago(30), { viewedByClient: true }),
      node("p2", "j2", "Next.js site", ago(3), { terms: { chargeRate: { rawValue: "2000.0" }, estimatedDuration: { label: "1 to 3 months" } }, boosted: true }),
      node("p3", "j3", "Law firm automation", ago(20), { status: { status: "Archived", status_label: "Archived (job closed)", reason: { reason: "Accidental job posting creation" } } }),
    ], true));
    expect(r.hasMore).toBe(true);
    expect(r.cursor).toBe("c1");
    expect(r.rows.map((x) => [x.id, x.jobId, x.viewed, x.bidLabel, x.status, x.archiveReason])).toEqual([
      ["p1", "j1", true, "$80/hr", "Accepted", null],
      ["p2", "j2", false, "$2,000 fixed · 1 to 3 months", "Accepted", null],
      ["p3", "j3", false, "$80/hr", "Archived", "Accidental job posting creation"],
    ]);
  });

  it("counts real client messages, not system notices or Upwork staff", () => {
    const s = parseStories({ data: { roomStories: { edges: [
      story("client", "System event: ended. View this conversation on upwork.com for full context."),
      story("client", "We need more details on the screening questions", "Upwork Administrator", "Billings Clinic - Upwork Talent Group"),
      story("freelancer", "Thanks!"),
      story("client", "Hello! I'd like to invite you to take a look at the job I've posted. Please submit a proposal if you're available and interested."),
      story("client", "Hi David, can you start Monday?"),
    ] } } });
    expect(s.filter(isClientReply).map((x) => x.text)).toEqual(["Hi David, can you start Monday?"]);
  });
});

describe("outcome labels", () => {
  const o = (p: Partial<ProposalOutcome>) => ({ status: "Accepted", viewed: false, repliedAt: null, submittedAt: ago(10), archiveReason: null, ...p });
  it("win, the two kinds of loss, pending and no-signal", () => {
    expect(classifyOutcome(o({ repliedAt: ago(9) }), NOW)).toBe("win");
    expect(classifyOutcome(o({ status: "Hired" }), NOW)).toBe("win");
    expect(classifyOutcome(o({ status: "Activated", viewed: true }), NOW)).toBe("loss_viewed"); // accepted invite, client never wrote again
    expect(classifyOutcome(o({ viewed: true }), NOW)).toBe("loss_viewed");
    expect(classifyOutcome(o({}), NOW)).toBe("loss_unviewed");
    expect(classifyOutcome(o({ submittedAt: ago(2), viewed: true }), NOW)).toBe("pending");
    expect(classifyOutcome(o({ submittedAt: ago(2), status: "Archived", archiveReason: "Job Posting Expired" }), NOW)).toBe("loss_unviewed");
    expect(classifyOutcome(o({ status: "Archived", archiveReason: "Accidental job posting creation" }), NOW)).toBe("void");
    expect(classifyOutcome(o({ status: "Withdrawn" }), NOW)).toBe("void");
  });
  it("decides early when the client already offered or hired someone else", () => {
    const job = { offered: 1, hired: 0 } as unknown as ProposalOutcome["job"];
    expect(classifyOutcome({ ...o({ submittedAt: ago(1) }), job }, NOW)).toBe("loss_unviewed");
    expect(classifyOutcome({ ...o({ submittedAt: ago(1), viewed: true }), job }, NOW)).toBe("loss_viewed");
    expect(classifyOutcome({ ...o({ submittedAt: ago(1) }), job: { offered: 0, hired: 0 } as unknown as ProposalOutcome["job"] }, NOW)).toBe("pending");
    expect(classifyOutcome({ ...o({ submittedAt: ago(1), repliedAt: ago(0) }), job }, NOW)).toBe("win");
  });
  it("reads the opener a client sees in the list", async () => {
    const { openerText } = await import("@/lib/agents/proposal");
    expect(openerText("Hi Alan,\n\nYour app already works; what blocks November is the payment flow and store review. I took two apps through that last month.\n\nLoom: x"))
      .toBe("Your app already works; what blocks November is the payment flow and store review. I took two apps through that last month.");
  });
});

describe("syncProposalOutcomes", () => {
  beforeEach(async () => { await resetDbForTests(); calls.length = 0; });

  it("labels replied, viewed-no-reply and not-viewed proposals from read-only calls", async () => {
    responder = (tool, action, p) => {
      if (tool === "list_freelancer_proposals" && action === "list") {
        return p.status === "Accepted" ? list([
          node("p-win", "j-win", "AI agent build", ago(10), { viewedByClient: true }),
          node("p-seen", "j-seen", "Polymarket bot", ago(20), { viewedByClient: true }),
          node("p-none", "j-none", "Senior AI Workflow Architect", ago(9)),
          node("p-new", "j-new", "Fresh job", ago(1)),
        ]) : list([]);
      }
      if (action === "get" && tool === "list_freelancer_proposals") return { data: { vendorProposal: { proposalCoverLetter: `Hi, letter for ${p.id}` } }, insights: { proposals_total: 12, messaged: 1 } };
      if (tool === "find_jobs") return { data: { marketplaceJobPosting: { classification: { category: { preferredLabel: "Web, Mobile & Software Dev" }, subCategory: { preferredLabel: "AI Apps & Integration" } }, clientCompanyPublic: { country: { name: "United States" } }, content: { description: "Build it" } } }, client_record: { spend_total: 25000, jobs_with_hires: 4 } };
      if (action === "find_room") return p.context_id === "p-win" ? { data: { proposalRoom: { id: "room1", createdAtDateTime: ago(9) } } } : new Error('{"error_code":"NOT_FOUND","reason":"No proposal room was found"}');
      if (action === "list_messages") return { data: { roomStories: { edges: [story("client", "Hi David, let's talk tomorrow"), story("client", "System event: posted.")] } } };
      return {};
    };
    const r = await syncProposalOutcomes({ now: NOW, maxCalls: 100 });
    expect(r).toMatchObject({ listed: 4, added: 4, stoppedAtCap: false });
    expect(calls.every((c) => ["list", "get", "find_room", "list_messages"].includes(c.action))).toBe(true); // read-only only
    const by = Object.fromEntries((await listProposalOutcomes()).map((o) => [o.upworkProposalId, o]));
    expect(by["p-win"]).toMatchObject({ outcome: "win", roomId: "room1", firstReply: "Hi David, let's talk tomorrow", coverLetter: "Hi, letter for p-win" });
    expect(by["p-seen"].outcome).toBe("loss_viewed");
    expect(by["p-none"].outcome).toBe("loss_unviewed");
    expect(by["p-new"].outcome).toBe("pending");
    expect(by["p-new"].nextCheckAt).toBe(NOW - DAY + 3 * DAY); // next room check on day 3
    expect(by["p-seen"].job).toMatchObject({ category: "Web, Mobile & Software Dev", clientCountry: "United States", clientSpent: 25000, fitVerdict: "core" });
    expect(by["p-seen"].insights).toMatchObject({ proposalsTotal: 12 });
  });

  it("stops at the call cap and finishes on the next run", async () => {
    responder = (tool, action, p) => action === "list" ? (p.status === "Accepted" ? list([node("p1", "j1", "Job", ago(10))]) : list([]))
      : action === "get" ? { data: { vendorProposal: { proposalCoverLetter: "x" } } } : action === "find_room" ? new Error("NOT_FOUND") : { data: { marketplaceJobPosting: {} } };
    const first = await syncProposalOutcomes({ now: NOW, maxCalls: 8 });
    expect(first.stoppedAtCap).toBe(true);
    const second = await syncProposalOutcomes({ now: NOW, maxCalls: 50 });
    expect(second.stoppedAtCap).toBe(false);
    expect((await getProposalOutcome("p1"))).toMatchObject({ outcome: "loss_unviewed", coverLetter: "x" });
  });
});

const outcome = (id: string, label: ProposalOutcome["outcome"], letter: string, field = "AI agents & LLM apps"): ProposalOutcome => ({
  upworkProposalId: id, jobId: `j${id}`, jobTitle: `Job ${id}`, localProposalId: null, submittedAt: ago(20), status: "Accepted", statusLabel: null, archiveReason: null,
  viewed: label !== "loss_unviewed", boosted: false, connectsBid: null, bid: 80, bidLabel: "$80/hr", coverLetter: letter, insights: { proposalsTotal: 8, opened: null, messaged: null, shortlisted: null },
  roomId: null, repliedAt: label === "win" ? ago(19) : null, firstReply: null, outcome: label,
  job: { category: null, subcategory: null, field, fitVerdict: "core", contractType: null, budget: null, clientCountry: "US", clientSpent: 5000, clientHires: 3, interviewed: null, hired: null, rank: 70, rulesScore: 60, llmFit: 80, flags: [], ruleCategory: "ai", description: "" },
  checks: 1, nextCheckAt: 0, updatedAt: NOW,
});

describe("What wins: stats, lessons and approval", () => {
  beforeEach(() => resetDbForTests());

  it("reply rate by opener separates question-first from credentials-first letters", () => {
    const st = outcomeStats([
      outcome("1", "win", "Hi Sam, what does a missed lead cost you today?"),
      outcome("2", "win", "Hi Ana, which CRM do you use?"),
      outcome("3", "loss_viewed", "As an Expert-Vetted data scientist with 8+ years of experience..."),
      outcome("4", "loss_unviewed", "As an Expert-Vetted data scientist with 8+ years of experience..."),
      outcome("5", "pending", "Hi"),
    ]);
    expect(st).toMatchObject({ decided: 4, wins: 2, lossViewed: 1, lossUnviewed: 1, pending: 1, replyRate: 50 });
    expect(st.by.opener.find((b) => b.key === "question first")).toMatchObject({ n: 2, replyRate: 100 });
    expect(st.by.opener.find((b) => b.key === "credentials first")).toMatchObject({ n: 2, replyRate: 0 });
  });

  it("needs enough replies before suggesting changes (no AI call below the threshold)", async () => {
    await saveProposalOutcome(outcome("1", "win", "Hi?"));
    await saveProposalOutcome(outcome("2", "loss_viewed", "As an expert"));
    const r = await buildLessons(NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/at least 3 replies and 10 no-replies/);
  });

  it("changes prompts only after approval, once per report, and keeps one lessons section", async () => {
    const lessons = [
      { id: "ask-question", target: "writer", area: "first_line", lesson: "Open with one question about their goal.", evidence: "2 of 2 question openers got replies", support: 4, confidence: "medium" },
      { id: "skip-crowded", target: "ranker", area: "job_choice", lesson: "Rank jobs with 20+ applicants lower.", evidence: "0 of 9 replied", support: 9, confidence: "high" },
    ] as const;
    const rep: LessonsReport = { builtAt: ago(0), ok: true, message: "", stats: outcomeStats([]), headline: "h", convinces: "c", earnsClick: "e", lessons: [...lessons], model: "m" };
    const id = await saveReport("lessons", rep);
    expect(await activePrompt("proposal")).toBeNull(); // nothing changed yet

    const d = await decideLessons(id, "approved", ["ask-question"]);
    expect(d.promptVersions.proposal).toBeTypeOf("number");
    expect(d.promptVersions.job_ranking).toBeUndefined(); // ranker lesson not chosen
    const body = (await activePrompt("proposal"))!.body;
    expect(body).toContain("## Lessons from your results");
    expect(body).toContain("Open with one question about their goal.");
    expect(await activePrompt("job_ranking")).toBeNull();
    await expect(decideLessons(id, "approved")).rejects.toThrow(/already decided/);

    const twice = withLessons(withLessons("Base prompt", [lessons[0]], "2026-10-01"), [lessons[1]], "2026-10-08");
    expect(twice.match(/## Lessons from your results/g)).toHaveLength(1);
    expect(twice).toContain("Rank jobs with 20+ applicants lower.");
    expect(twice).not.toContain("Open with one question");
  });

  it("the proposal writer copies only letters that got a reply, same field first", async () => {
    await saveProposalOutcome(outcome("1", "win", "WINNER-DATA letter text that the client answered, long enough to be used as an example.", "Data science & engineering"));
    await saveProposalOutcome(outcome("2", "win", "WINNER-AGENT letter text that the client answered, long enough to be used as an example."));
    await saveProposalOutcome(outcome("3", "loss_viewed", "LOSER letter text that the client read and ignored, long enough to be used as an example."));
    const ex = await styleExamples("AI agents & LLM apps");
    expect(ex).toContain("REPLIED");
    expect(ex.indexOf("WINNER-AGENT")).toBeLessThan(ex.indexOf("WINNER-DATA"));
    expect(ex).not.toContain("LOSER");
  });
});
