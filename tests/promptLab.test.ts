import { describe, expect, it } from "vitest";
import { BUILT_IN, buildBoard, chooseArm, DEFAULT_LAB, HAND, mulberry32, scenarioOf } from "@/lib/learning/promptLab";
import type { OutcomeLabel, ProposalOutcome } from "@/lib/types";

let n = 0;
const o = (outcome: OutcomeLabel, localProposalId: number | null, field = "AI agents & LLM apps", clientSpent: number | null = 5000, viewed = outcome !== "loss_unviewed"): ProposalOutcome => ({
  upworkProposalId: String(++n), jobId: `j${n}`, jobTitle: `Job ${n}`, localProposalId, submittedAt: "2026-10-01T00:00:00Z", status: "Accepted",
  statusLabel: null, archiveReason: null, viewed, boosted: false, connectsBid: null, bid: null, bidLabel: null, coverLetter: "Hi", insights: null,
  roomId: null, repliedAt: null, firstReply: null, outcome,
  job: { field, clientSpent, category: null, subcategory: null, fitVerdict: "core", contractType: null, budget: null, clientCountry: null, clientHires: null, interviewed: null, hired: null, rank: null, rulesScore: null, llmFit: null, flags: [], ruleCategory: null, description: "" },
  checks: 0, nextCheckAt: 0, updatedAt: 0,
});

describe("prompt lab", () => {
  it("puts proposals in field × client-tier scenarios", () => {
    expect(scenarioOf({ field: "AI agents & LLM apps", clientSpent: 0 }).label).toBe("AI agents & LLM apps · new client");
    expect(scenarioOf({ field: null, clientSpent: 50_000 }).key).toBe("Other|big spender");
  });

  it("credits replies to the prompt version that wrote the draft and finds the winner", () => {
    // proposals 1-10 by v5 (7 replies), 11-20 by v9 (1 reply), plus hand-written ones as the baseline
    const versions = new Map<number, number | null>();
    const rows: ProposalOutcome[] = [];
    for (let i = 1; i <= 10; i++) { versions.set(i, 5); rows.push(o(i <= 7 ? "win" : "loss_viewed", i)); }
    for (let i = 11; i <= 20; i++) { versions.set(i, 9); rows.push(o(i === 11 ? "win" : i % 2 ? "loss_unviewed" : "loss_viewed", i)); }
    rows.push(o("win", null), o("loss_viewed", null), o("pending", 1), o("void", 2));
    const b = buildBoard(rows, versions, DEFAULT_LAB);
    expect(b.decided).toBe(22);
    const v5 = b.overall.arms.find((a) => a.arm === 5)!, v9 = b.overall.arms.find((a) => a.arm === 9)!, hand = b.overall.arms.find((a) => a.arm === HAND)!;
    expect([v5.n, v5.wins, v9.n, v9.wins, hand.n, hand.pBest]).toEqual([10, 7, 10, 1, 2, null]);
    expect(v5.pBest!).toBeGreaterThan(95);
    expect(b.overall).toMatchObject({ verdict: "best", best: 5 });
    expect(b.byScenario[0]).toMatchObject({ label: "AI agents & LLM apps · proven client", best: 5 });
  });

  it("says when there is too little data, and treats null versions as the built-in prompt", () => {
    const b = buildBoard([o("win", 1), o("loss_viewed", 2)], new Map([[1, null], [2, 3]]), DEFAULT_LAB);
    expect(b.overall.arms.map((a) => a.arm).sort()).toEqual([BUILT_IN, 3]);
    expect(b.overall.verdict).toBe("not_enough_data");
  });

  it("chooses: active prompt by default, David's pinned version, Thompson sampling only when the A/B test is on", () => {
    const sc = scenarioOf({ field: "AI agents & LLM apps", clientSpent: 5000 });
    expect(chooseArm(DEFAULT_LAB, sc, null).arm).toBeNull();
    const pinned = { ...DEFAULT_LAB, pinned: { [sc.key]: 9 } };
    expect(chooseArm(pinned, sc, null)).toMatchObject({ arm: 9 });
    const versions = new Map<number, number | null>();
    const rows: ProposalOutcome[] = [];
    for (let i = 1; i <= 10; i++) { versions.set(i, 5); rows.push(o(i <= 7 ? "win" : "loss_viewed", i)); }
    for (let i = 11; i <= 20; i++) { versions.set(i, 9); rows.push(o(i <= 14 ? "win" : "loss_viewed", i)); }
    const b = buildBoard(rows, versions, DEFAULT_LAB);
    const on = { ...DEFAULT_LAB, enabled: true, arms: [5, 9] };
    const rng = mulberry32(1);
    const picks = Array.from({ length: 200 }, () => chooseArm(on, sc, b, rng).arm);
    const share5 = picks.filter((a) => a === 5).length / picks.length;
    expect(share5).toBeGreaterThan(0.6); // mostly the winner…
    expect(share5).toBeLessThan(1); // …but the other version still gets tried
  });
});
