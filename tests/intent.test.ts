import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@/lib/db";
import { assessIntent } from "@/lib/ranking/intent";
import { evaluateRules } from "@/lib/ranking/rules";
import { scoreJob } from "@/lib/scoring";
import type { Job, JobEnrichment } from "@/lib/types";
import { mapDetail, mapRow, mergeDetail } from "@/lib/upwork/mcp/jobs";
import { unwrap } from "@/lib/upwork/mcp/client";
import { seniorLivingDetail, seniorLivingRow } from "./fixtures/upwork";

const now = new Date("2026-10-13T09:00:00Z");
const base = mapDetail(unwrap(seniorLivingDetail));
const enr = (rec: Partial<JobEnrichment["record"]>, extra: Partial<JobEnrichment> = {}): JobEnrichment =>
  ({ ...base.enrichment, workHistory: [], reviews: [], ...extra, record: { ...base.enrichment.record, ...rec } });
const job = (over: Partial<Job>, client: Partial<Job["client"]> = {}): Job => {
  const b = mapRow(seniorLivingRow);
  return { ...b, proposalsTier: "5 to 10", publishedAt: "2026-10-13T08:00:00Z", ...over, client: { ...b.client, ...client } };
};

describe("hire likelihood / ghost risk (advisory)", () => {
  it("flags the $0-spend 'US-only senior engineer' posts from a non-US account as identity fronting", () => {
    const j = job({ title: "Senior Software Engineer | C#, .NET (US Only)", description: "We are looking for a Senior Software Engineer based in the United States... Must be based in the US. You will represent our team in client meetings." }, { country: "Ukraine", totalSpent: 0, totalHires: 0, paymentVerified: true });
    const i = assessIntent(j, enr({ totalSpent: 0, hires: 0, jobsPosted: 3, hireRatePercent: 0, openJobs: 3, hours: 0, contractsTotal: 0 }, { description: j.description }), { now });
    expect(i.archetype).toBe("identity_fronting");
    expect(i.ghostRisk).toBe("high");
  });
  it("flags spec/quote collection posts as template collectors", () => {
    const desc = "CRITICAL BEFORE QUOTING: Read BOTH candidate attachments. PRICE SHOPPING: $500 is a PRIVATE Upwork budget placeholder, not a proposed price; quote your true price. No job offer, credential access or spending is authorized at this stage. " + "Scope ".repeat(700);
    const j = job({ title: "Senior PostgreSQL / Database Reliability Engineer", description: desc, amount: 500, jobType: "FIXED" }, { country: "United States" });
    const i = assessIntent(j, enr({ totalSpent: 523, hires: 4, jobsPosted: 11, hireRatePercent: 36, openJobs: 3, hours: 10 }, { description: desc }), { now });
    expect(i.archetype).toBe("template_collector");
    expect(i.ghostRisk).toBe("high");
  });
  it("flags clients with hundreds of posts and almost no hires as mass posters", () => {
    const i = assessIntent(job({ title: "Principal AI Scientist" }), enr({ totalSpent: 12587, hires: 9, jobsPosted: 968, hireRatePercent: 1, openJobs: 30, hours: 300 }), { now });
    expect(i.archetype).toBe("mass_poster");
    expect(i.ghostRisk).not.toBe("low");
  });
  it("flags zero-spend clients who keep posting and never hire", () => {
    const i = assessIntent(job({}, { totalSpent: 0, totalHires: 0 }), enr({ totalSpent: 0, hires: 0, jobsPosted: 6, hireRatePercent: 0, openJobs: 1, hours: 0, contractsTotal: 0 }), { now });
    expect(i.archetype).toBe("ghost_poster");
    expect(i.ghostRisk).toBe("high");
  });
  it("says 'new client' only for an account at most 2 days old, never for a dormant zero-hire account", () => {
    const empty = { totalSpent: 0, hires: 0, jobsPosted: 1, hireRatePercent: null, openJobs: 1, hours: 0, contractsTotal: 0 };
    const j = job({}, { totalSpent: 0, totalHires: 0 });
    const dormant = assessIntent(j, enr(empty, { clientSince: "2025-08-13T00:00:00Z" }), { now });
    expect(dormant.evidence.join(" ")).not.toMatch(/new client/i);
    expect(dormant.evidence.join(" ")).toMatch(/No hiring history/);
    expect(assessIntent(j, enr(empty), { now }).evidence.join(" ")).not.toMatch(/new client/i);
    expect(assessIntent(j, enr(empty, { clientSince: "2026-10-12T12:00:00Z" }), { now }).evidence.join(" ")).toMatch(/New client: account created ≤ 2 days ago/);
  });
  it("rates the established senior-living client as genuine / low risk", () => {
    const j = mergeDetail(job({}), base.patch, base.enrichment);
    const i = assessIntent(j, base.enrichment, { now });
    expect(i.ghostRisk).toBe("low");
    expect(i.hireLikelihood).toBeGreaterThan(55);
  });
  it("uses this client's own track record of closing jobs without hiring", () => {
    const j = mergeDetail(job({}), base.patch, base.enrichment);
    const i = assessIntent(j, base.enrichment, { now, history: { jobsSeen: 3, hired: 0, closedNoHire: 3 } });
    expect(i.archetype).toBe("repeat_no_hire");
  });
  it("never changes the rank or the rules - intent is advisory", () => {
    const feed = { id: 1, name: "f", enabled: true, kind: "most_recent" as const, skills: [], query: "", jobType: "ANY" as const, minHourly: null, minBudget: null, experienceLevel: "ANY" as const, verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [], createdAt: "" };
    const j = job({}, { totalSpent: 0, totalHires: 0 });
    const e = enr({ totalSpent: 0, hires: 0, jobsPosted: 6, hireRatePercent: 0 });
    const s = scoreJob(j, feed, now, DEFAULT_RULES, { enrichment: e });
    expect(s.intent?.ghostRisk).toBe("high");
    expect(s.rules).toEqual(evaluateRules(j, DEFAULT_RULES, { enrichment: e, now }));
    const { intent: _i, ...withoutIntent } = s;
    expect(withoutIntent.total).toBe(s.total);
  });
});

describe("proposal structure guard", () => {
  it("accepts the short structure and rejects long or misordered drafts", async () => {
    const { structureProblems } = await import("@/lib/agents/proposal");
    const good = "Hi Aleksandr,\n\nLaunching market #3 without a developer is the real job; I solved this for a 116-page site.\n\nLoom: {{LOOM_URL}}\n\nDeliverables:\n• Next.js site from Figma\n• Sanity per-country overrides\n\nBudget: $2,200 fixed, 3 milestones.\n\nAre integrations a fixed list per country?\n\nDavid";
    expect(structureProblems(good)).toEqual([]);
    const late = good.replace("Loom: {{LOOM_URL}}\n\n", "") + "\n\nLoom: {{LOOM_URL}}";
    expect(structureProblems(late).join()).toMatch(/third block/);
    expect(structureProblems(good + "\n\nP.S. Book a call" + " x".repeat(400)).join()).toMatch(/characters|P\.S\./);
  });
});

describe("hire count missing from a search row (David, 2026-10-19)", () => {
  it("treats a missing hire count next to real spend as unknown, never as a 0% mass poster", async () => {
    const { assessIntent } = await import("@/lib/ranking/intent");
    const { knownHires, knownHireRate } = await import("@/lib/ranking/rules");
    const { demoJobs } = await import("@/lib/fixtures");
    const job = { ...demoJobs(Date.now(), "h")[0], client: { paymentVerified: true, identityVerified: true, totalSpent: 4_080_336, totalHires: 0, totalPostedJobs: 280, totalReviews: 120, totalFeedback: 4.81, country: "United States", hasFinancialPrivacy: false } };
    expect(knownHires(job, null)).toBeNull();
    expect(knownHireRate(job, null)).toBeNull();
    const i = assessIntent(job, null);
    expect(i.archetype).not.toBe("mass_poster");
    expect(i.evidence.join(" ")).not.toMatch(/0% hired/);
    // A genuinely unspent client still counts as 0 hires; hires above posts cap at 100%.
    expect(knownHires({ client: { ...job.client, totalSpent: 0 } }, null)).toBe(0);
    expect(knownHireRate({ client: { ...job.client, totalHires: 331 } }, null)).toBe(100);
  });
});
