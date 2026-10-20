import { beforeEach, describe, expect, it, vi } from "vitest";

/* Upwork MCP is mocked: list_messages returns one short conversation. */
const calls: { tool: string; action: string; params: Record<string, unknown> }[] = [];
vi.mock("@/lib/upwork/mcp/client", () => ({
  callTool: async (tool: string, action: string, params: Record<string, unknown>) => {
    calls.push({ tool, action, params });
    return { messages: [
      { createdDateTime: "2026-10-02T10:00:00Z", from: "Sam", from_side: "client", message: "Can you start Monday?" },
      { createdDateTime: "2026-10-02T09:00:00Z", from: "David", from_self: true, message: "Happy to walk you through a demo." },
    ] };
  },
  unwrap: (v: unknown) => v,
}));

import { kvGet, resetDbForTests, saveProposalOutcome } from "@/lib/db";
import { buildNightlyReview } from "@/lib/learning/review";
import { clientActive, ghostClientIds, segmentCounts, segmentOf } from "@/lib/learning/segments";
import type { OutcomeJob, ProposalOutcome } from "@/lib/types";

const DAY = 864e5;
const NOW = Date.parse("2026-10-20T00:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

const job = (activity: Partial<OutcomeJob> = {}): OutcomeJob => ({
  category: null, subcategory: null, field: "AI agents & LLM apps", fitVerdict: "core", contractType: null, budget: null, clientCountry: "US", clientSpent: 5000,
  clientHires: 3, interviewed: 0, hired: 0, offered: 0, invites: 0, rank: 70, rulesScore: 60, llmFit: 80, flags: [], ruleCategory: "ai", description: "", ...activity,
});
const outcome = (id: string, label: ProposalOutcome["outcome"], j: OutcomeJob | null, extra: Partial<ProposalOutcome> = {}): ProposalOutcome => ({
  upworkProposalId: id, jobId: `j${id}`, jobTitle: `Job ${id}`, localProposalId: null, submittedAt: ago(20), status: "Archived", statusLabel: null, archiveReason: null,
  viewed: label === "loss_viewed", boosted: false, connectsBid: null, bid: 80, bidLabel: "$80/hr", coverLetter: "Hi Sam, what does a missed lead cost you?",
  insights: null, roomId: null, repliedAt: label === "win" ? ago(19) : null, firstReply: null, outcome: label, job: j, checks: 1, nextCheckAt: 0, updatedAt: NOW, ...extra,
});

describe("nightly review: ghost jobs, openers and wins", () => {
  beforeEach(async () => { calls.length = 0; await resetDbForTests(); });

  it("a never-viewed proposal is a ghost job only when the client engaged with nobody", () => {
    expect(segmentOf(outcome("1", "loss_unviewed", job()))).toBe("ghost");
    expect(segmentOf(outcome("2", "loss_unviewed", job({ interviewed: 2 })))).toBe("opener_missed");
    expect(segmentOf(outcome("3", "loss_unviewed", job({ hired: 1 })))).toBe("opener_missed");
    expect(segmentOf(outcome("4", "loss_unviewed", job({ invites: 5 })))).toBe("opener_missed");
    expect(segmentOf(outcome("5", "loss_unviewed", job({ invited: true })))).toBe("opener_missed");
    // Activity never read: not proof of a ghost job.
    expect(clientActive(job({ interviewed: null, hired: null, offered: null, invites: null }))).toBeNull();
    expect(segmentOf(outcome("6", "loss_unviewed", null))).toBe("opener_missed");
    expect(segmentOf(outcome("7", "loss_viewed", job()))).toBe("opener_worked");
    expect(segmentOf(outcome("8", "win", job({ hired: 1 }), { status: "Hired" }))).toBe("hired");
    expect(segmentOf(outcome("9", "win", job()))).toBe("replied");
  });

  it("collects the clients who ghosted David, for auto-apply", () => {
    const rows = [outcome("1", "loss_unviewed", job({ clientId: "c-ghost" })), outcome("2", "loss_unviewed", job({ clientId: "c-real", interviewed: 1 }))];
    expect([...ghostClientIds(rows)]).toEqual(["c-ghost"]);
    expect(segmentCounts(rows)).toMatchObject({ ghost: 1, opener_missed: 1, hired: 0 });
  });

  it("below the threshold it saves counts only - no AI call and no Upwork call", async () => {
    await saveProposalOutcome(outcome("1", "loss_unviewed", job()));
    await saveProposalOutcome(outcome("2", "win", job(), { status: "Hired", roomId: "r2" }));
    const r = await buildNightlyReview({ now: NOW });
    expect(r.ok).toBe(false);
    expect(r.counts).toMatchObject({ ghost: 1, hired: 1 });
    expect(r.message).toMatch(/Needs 10 decided proposals/);
    expect(calls).toHaveLength(0);
  });

  it("reads each winning conversation once and caches it", async () => {
    for (let i = 0; i < 10; i++) await saveProposalOutcome(outcome(`g${i}`, "loss_unviewed", job()));
    await saveProposalOutcome(outcome("w1", "win", job(), { status: "Hired", roomId: "room-1" }));
    await buildNightlyReview({ now: NOW });
    expect(calls.filter((c) => c.action === "list_messages")).toHaveLength(1);
    const conv = await kvGet<{ stories: { side: string; text: string }[] }>("conversation:w1");
    expect(conv?.stories.map((s) => s.side)).toEqual(["freelancer", "client"]); // oldest first
    await buildNightlyReview({ now: NOW + DAY });
    expect(calls.filter((c) => c.action === "list_messages")).toHaveLength(1);
  });
});

describe("24-hour KPIs, view tracking and reward", () => {
  beforeEach(async () => { calls.length = 0; await resetDbForTests(); });

  it("counts the last 24 h and the 24 h before, with views that came later", async () => {
    const { computeKpis } = await import("@/lib/learning/kpis");
    const rows = [
      outcome("a", "pending", job(), { submittedAt: new Date(NOW - 2 * 3600e3).toISOString(), viewed: true }),
      outcome("b", "pending", job(), { submittedAt: new Date(NOW - 5 * 3600e3).toISOString(), viewed: false }),
      outcome("c", "win", job(), { submittedAt: new Date(NOW - 30 * 3600e3).toISOString(), status: "Offered" }),
      outcome("d", "void", job(), { submittedAt: new Date(NOW - 3600e3).toISOString() }),
    ];
    const k = computeKpis(rows, { a: NOW - 3600e3, c: NOW - 40 * 3600e3 }, NOW);
    expect(k.last24).toMatchObject({ sent: 2, viewed: 1, viewRate: 50, replied: 0 });
    expect(k.prev24).toMatchObject({ sent: 1, viewed: 1, replied: 1, offers: 1 });
    expect(k.viewsLast24).toBe(1);
    expect(k.recentViews.map((v) => v.id)).toEqual(["a"]);
  });

  it("first sync records existing views silently, later ones are announced once", async () => {
    const { noteViews } = await import("@/lib/learning/kpis");
    const o = (id: string, viewed: boolean) => ({ upworkProposalId: id, viewed, outcome: "pending" as const });
    expect(await noteViews([o("x", true), o("y", false)], NOW)).toEqual([]);
    expect(await noteViews([o("x", true), o("y", true)], NOW + 1)).toEqual(["y"]);
    expect(await noteViews([o("x", true), o("y", true)], NOW + 2)).toEqual([]);
  });

  it("reward ranks hire > reply > view > nothing, and a skipped opener is negative", async () => {
    const { reward } = await import("@/lib/learning/segments");
    expect(reward(outcome("1", "win", job(), { status: "Hired" }))).toBe(3);
    expect(reward(outcome("2", "win", job()))).toBe(2);
    expect(reward(outcome("3", "loss_viewed", job()))).toBe(1);
    expect(reward(outcome("4", "pending", job(), { viewed: true }))).toBe(1);
    expect(reward(outcome("5", "loss_unviewed", job({ hired: 1 })))).toBe(-1);
    expect(reward(outcome("6", "loss_unviewed", job()))).toBe(0); // ghost job
  });
});
