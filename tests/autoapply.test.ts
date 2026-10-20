import { beforeEach, describe, expect, it, vi } from "vitest";
import { autoApplyBlocker, findNumber, nightWindow, runAutoApply } from "@/lib/autoapply";
import { createProposal, createSearch, getJob, getProposal, getSettings, insertJob, resetDbForTests, saveSettings } from "@/lib/db";
import { demoJobs } from "@/lib/fixtures";
import { stripLoomLine } from "@/lib/proposals/submit";
import { scoreJob } from "@/lib/scoring";
import type { ScoreBreakdown } from "@/lib/types";

const yerevan = (iso: string) => Date.parse(`${iso}+04:00`);

describe("night auto-apply", () => {
  beforeEach(() => resetDbForTests());

  it("knows the night window and names it by the evening it started", () => {
    const a = { timezone: "Asia/Yerevan", start: "00:00", end: "11:00" };
    expect(nightWindow(a, yerevan("2026-10-18T02:30:00"))).toEqual({ inside: true, night: "2026-10-18" });
    expect(nightWindow(a, yerevan("2026-10-18T11:30:00")).inside).toBe(false);
    const late = { timezone: "Asia/Yerevan", start: "23:00", end: "07:00" };
    expect(nightWindow(late, yerevan("2026-10-18T01:00:00"))).toEqual({ inside: true, night: "2026-10-17" });
    expect(nightWindow(late, yerevan("2026-10-18T23:30:00"))).toEqual({ inside: true, night: "2026-10-18" });
  });

  it("removes the Loom line and finds Connects in Upwork's preview", () => {
    expect(stripLoomLine("Hi Ann,\n\nI built this before.\n\nLoom: {{LOOM_URL}}\n\nBUDGET: $5k")).toBe("Hi Ann,\n\nI built this before.\n\nBUDGET: $5k");
    expect(findNumber({ preview: { connects: { connects_cost: "16", connects_balance: 120 } } }, /connects?_?(cost|required)/i)).toBe(16);
    expect(findNumber({ a: 1 }, /connects_cost/)).toBeNull();
  });

  async function setup(over: { total?: number; fit?: number; applicants?: number; verified?: boolean } = {}) {
    const search = await createSearch({ kind: "search", name: "Search: AI", enabled: true, skills: ["Python"], query: "", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
    const [base] = demoJobs(Date.now(), "aa");
    const job = { ...base, totalApplicants: over.applicants ?? 3, proposalsTier: null, client: { ...base.client, paymentVerified: over.verified ?? true } };
    const real = scoreJob(job, search);
    const score = { ...real, excluded: false, total: over.total ?? 90, llm: { fit: over.fit ?? 85 } } as unknown as ScoreBreakdown;
    await insertJob(job, search.id, score, Date.now());
    const p = await createProposal({
      jobId: job.id, jobTitle: job.title, jobUrl: "u", status: "needs_loom", coverLetter: "Hi Ann,\n\nOpener.\n\nLoom: {{LOOM_URL}}\n\nBUDGET: $3,000", research: null, answers: [], bid: 3000,
      estimatedDuration: null, portfolioProjectIds: [], loomUrl: null, approvedAt: null, preview: null, previewId: null, submittedAt: null, originalDraft: "x", model: null, promptVersion: null,
    });
    const s = await getSettings();
    await saveSettings({ autoApply: { ...s.autoApply, enabled: true, start: "00:00", end: "23:59" } });
    return { job, p };
  }

  it("applies the bars: rank, AI fit, proposals, verified payment", async () => {
    const { job } = await setup({ total: 70 });
    const a = (await getSettings()).autoApply;
    expect(autoApplyBlocker((await getJob(job.id))!, a)).toMatch(/rank 70/);
    expect(autoApplyBlocker({ ...(await getJob(job.id))!, score: { ...(await getJob(job.id))!.score, total: 95 } }, a)).toBeNull();
    expect(autoApplyBlocker({ ...(await getJob(job.id))!, score: { ...(await getJob(job.id))!.score, total: 95 }, totalApplicants: 15 }, a)).toMatch(/15 proposals/);
    expect(autoApplyBlocker({ ...(await getJob(job.id))!, score: { ...(await getJob(job.id))!.score, total: 95 }, client: { ...job.client, paymentVerified: false } }, a)).toMatch(/payment/);
    // A client who engaged with nobody on an earlier job David applied to (nightly review) is skipped.
    const ok = { ...(await getJob(job.id))!, score: { ...(await getJob(job.id))!.score, total: 95 } };
    const withClient = { ...ok, enrichment: { activity: { invitesSent: 0, interviewed: 0, hired: 0, offered: 0, unansweredInvites: 0 }, ...ok.enrichment, clientId: "c-ghost" } as NonNullable<typeof ok.enrichment> };
    expect(autoApplyBlocker(withClient, a, Date.now(), new Set(["c-ghost"]))).toMatch(/ignored all proposals/);
    expect(autoApplyBlocker(withClient, a, Date.now(), new Set(["c-other"]))).toBeNull();
  });

  it("lets a job the watch loop vouched for (fit ≥ minFit) past rank and AI fit, but not the other bars", async () => {
    const { job } = await setup({ total: 47, fit: 60 });
    const a = (await getSettings()).autoApply;
    const j = (await getJob(job.id))!;
    const watch = (fit: number) => ({ ...j, score: { ...j.score, watch: { fit, at: new Date().toISOString() } } });
    expect(autoApplyBlocker(watch(74), a)).toMatch(/rank 47/);
    expect(autoApplyBlocker(watch(82), a)).toBeNull();
    expect(autoApplyBlocker({ ...watch(82), totalApplicants: 20 }, a)).toMatch(/20 proposals/);
    expect(autoApplyBlocker({ ...watch(82), client: { ...job.client, paymentVerified: false } }, a)).toMatch(/payment/);
    expect(autoApplyBlocker({ ...watch(82), score: { ...watch(82).score, excluded: "Not your field" } }, a)).toBe("excluded");
  });

  it("submits a qualifying auto-draft without Loom, inside the night and Connects limits", async () => {
    const { job, p } = await setup();
    const client = await import("@/lib/upwork/mcp/client");
    const calls: string[] = [];
    const spy = vi.spyOn(client, "callTool").mockImplementation(async (tool: string, action: string | null) => {
      calls.push(`${tool}.${action}`);
      if (action === "invitations") return { invitations: [] } as never;
      if (tool === "list_freelancer_proposals") return { proposals: [] } as never;
      if (tool === "manage_proposals") return { preview_id: "pv1", connects_cost: 16, connects_balance: 200 } as never;
      return { ok: true } as never;
    });
    const r = await runAutoApply({ notify: false });
    expect(r).toEqual({ submitted: job.id, skipped: null });
    expect(calls).toContain("manage_proposals.create");
    expect(calls).toContain("confirm_preview.confirm");
    const sent = (await getProposal(p.id))!;
    expect(sent.status).toBe("submitted");
    expect(sent.coverLetter).not.toContain("Loom");
    // One try per job per night - nothing left to send.
    expect((await runAutoApply({ notify: false })).skipped).toBe("no qualifying draft");
    spy.mockRestore();
  });

  it("holds the proposal when Connects would break the limits, and is off by default", async () => {
    expect((await getSettings()).autoApply.enabled).toBe(false);
    const { p } = await setup();
    const s = await getSettings();
    await saveSettings({ autoApply: { ...s.autoApply, minConnectsBalance: 190 } });
    const client = await import("@/lib/upwork/mcp/client");
    const spy = vi.spyOn(client, "callTool").mockImplementation(async (tool: string, action: string | null) => {
      if (action === "invitations") return { invitations: [] } as never;
      if (tool === "list_freelancer_proposals") return { proposals: [] } as never;
      if (tool === "manage_proposals") return { preview_id: "pv1", connects_cost: 16, connects_balance: 200 } as never;
      throw new Error("must not submit");
    });
    const r = await runAutoApply({ notify: false });
    expect(r.skipped).toMatch(/balance would drop below 190/);
    expect((await getProposal(p.id))!.status).toBe("previewed");
    spy.mockRestore();
  });
});
