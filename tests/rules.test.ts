import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@/lib/db";
import { blend, detectCategory, evaluateRules } from "@/lib/ranking/rules";
import type { Job, JobEnrichment, LlmRanking } from "@/lib/types";
import { mapDetail, mapRow, mergeDetail } from "@/lib/upwork/mcp/jobs";
import { unwrap } from "@/lib/upwork/mcp/client";
import { irishDataRow, mcpEngineerRow, seniorLivingDetail, seniorLivingRow } from "./fixtures/upwork";

const now = new Date("2026-10-13T00:00:00Z");
const R = DEFAULT_RULES;
const detail = mapDetail(unwrap(seniorLivingDetail));
const enr = (patch: Partial<JobEnrichment> = {}, rec: Partial<JobEnrichment["record"]> = {}): JobEnrichment =>
  ({ ...detail.enrichment, ...patch, record: { ...detail.enrichment.record, ...rec } });
const job = (over: Partial<Job> = {}, client: Partial<Job["client"]> = {}): Job => {
  const base = mapRow(seniorLivingRow);
  return { ...base, proposalsTier: "5 to 10", totalApplicants: 10, ...over, client: { ...base.client, ...client } };
};
const llm = (fit: number): LlmRanking => ({ model: "m", category: "ai", fit, valuePotential: 80, summary: "", finalProduct: "", skillsWanted: [], reasons: [], redFlags: [] });

describe("hard rejects", () => {
  it("rejects excluded countries (India, Pakistan, Turkey, Azerbaijan)", () => {
    for (const c of ["India", "Pakistan", "Turkey", "Azerbaijan"]) {
      expect(evaluateRules(job({}, { country: c }), R, { now }).rejected).toMatch(/exclude list/);
    }
    expect(evaluateRules(job({}, { country: "United States" }), R, { now }).rejected).toBeNull();
  });
  it("rejects jobs over 20 proposals, including the '20 to 50' and '50+' tiers", () => {
    expect(evaluateRules(mapRow(mcpEngineerRow), R, { now }).rejected).toMatch(/20 to 50/);
    expect(evaluateRules(mapRow(seniorLivingRow), R, { now }).rejected).toMatch(/50\+/);
    expect(evaluateRules(job({ proposalsTier: null, totalApplicants: 21 }), R, { now }).rejected).toMatch(/21/);
    expect(evaluateRules(job({ proposalsTier: null, totalApplicants: 20 }), R, { now }).rejected).toBeNull();
  });
  it("rejects applied, closed and already-hired jobs", () => {
    expect(evaluateRules(job({ applied: true }), R, { now }).rejected).toBe("Already applied");
    expect(evaluateRules(job(), R, { now, enrichment: enr({ status: "CLOSED" }) }).rejected).toMatch(/closed/);
    expect(evaluateRules(job(), R, { now, enrichment: enr({ activity: { ...detail.enrichment.activity, hired: 1 } }) }).rejected).toMatch(/hired/);
  });
});

describe("red flags", () => {
  it("flags unverified payment red, but forgives a brand-new client on a very tight fit", () => {
    const irish = mapRow(irishDataRow);
    const plain = evaluateRules(irish, R, { now, enrichment: enr({}, { hires: 0, hours: 0, contractsTotal: 0, totalSpent: 0, hireRatePercent: null }) });
    expect(plain.flags.find((f) => f.code === "unverified")?.severity).toBe("red");
    const forgiven = evaluateRules(irish, R, { now, llm: llm(90), enrichment: enr({}, { hires: 0, hours: 0, contractsTotal: 0, totalSpent: 0, hireRatePercent: null }) });
    expect(forgiven.flags.some((f) => f.code === "unverified")).toBe(false);
    expect(forgiven.flags.some((f) => f.code === "unverified_new")).toBe(true);
    expect(forgiven.score).toBeGreaterThan(plain.score);
  });
  it("flags cheap-labour agencies and clients who mostly post tiny jobs", () => {
    const cheap = evaluateRules(job(), R, { now, enrichment: enr({}, { totalSpent: 30_000, hours: 2_000 }) }); // ≈$15/hr
    expect(cheap.flags.find((f) => f.code === "cheap_history")?.severity).toBe("red");
    const tiny = evaluateRules(job(), R, { now, enrichment: enr({}, { totalSpent: 4_000, contractsTotal: 40, hours: 10 }) }); // $100/contract
    expect(tiny.flags.some((f) => f.code === "small_jobs")).toBe(true);
  });
  it("needs a 90%+ hire rate for AI work and 75%+ for DevOps/MLOps", () => {
    const ai = evaluateRules(job(), R, { now, enrichment: enr() }); // senior-living client: 72%
    expect(ai.category).toBe("ai");
    expect(ai.flags.find((f) => f.code === "hire_rate")?.label).toMatch(/72%.*90%/);
    const ops = job({ title: "Kubernetes and Terraform DevOps engineer", skills: ["Kubernetes", "Terraform"], description: "CI/CD" });
    expect(detectCategory(ops)).toBe("devops");
    expect(evaluateRules(ops, R, { now, enrichment: enr({}, { hireRatePercent: 78 }) }).flags.some((f) => f.code === "hire_rate")).toBe(false);
    expect(evaluateRules(ops, R, { now, enrichment: enr({}, { hireRatePercent: 70 }) }).flags.find((f) => f.code === "hire_rate")?.severity).toBe("red");
  });
  it("flags a client ignoring several open jobs for 2+ days", () => {
    const old = job({ publishedAt: "2026-10-10T00:00:00Z" });
    const r = evaluateRules(old, R, { now, enrichment: enr({}, { openJobs: 4 }) });
    expect(r.flags.find((f) => f.code === "ignored")?.label).toMatch(/4 open jobs/);
    expect(evaluateRules(job(), R, { now, enrichment: enr({}, { openJobs: 4 }) }).flags.some((f) => f.code === "ignored")).toBe(false);
  });
});

describe("value gates and blend", () => {
  it("passes $80+/hr, flags low caps, and judges rate-less jobs by what the client paid before", () => {
    const hi = evaluateRules(job({ jobType: "HOURLY", hourlyMin: 60, hourlyMax: 100, amount: null }), R, { now });
    expect(hi.passes.some((p) => p.includes("$100/hr"))).toBe(true);
    const lo = evaluateRules(job({ jobType: "HOURLY", hourlyMin: 20, hourlyMax: 40, amount: null }), R, { now });
    expect(lo.flags.find((f) => f.code === "low_rate")?.severity).toBe("red");
    const noRate = evaluateRules(job({ jobType: "HOURLY", hourlyMin: null, hourlyMax: null, amount: null }), R, { now, enrichment: enr({}, { totalSpent: 500_000, hours: 4_000 }) });
    expect(noRate.passes.some((p) => p.includes("≈$125/hr"))).toBe(true);
  });
  it("blends rules and LLM, keeps hard rejects at 0, and is deterministic", () => {
    const good = evaluateRules(job({ jobType: "HOURLY", hourlyMax: 120, hourlyMin: 90, amount: null }), R, { now, enrichment: enr({}, { hireRatePercent: 95 }) });
    expect(blend(good, llm(95), R.weights)).toBeGreaterThan(blend(good, llm(30), R.weights));
    const rej = evaluateRules(job({}, { country: "India" }), R, { now });
    expect(blend(rej, llm(100), R.weights)).toBe(0);
    expect(evaluateRules(job(), R, { now, enrichment: enr() })).toEqual(evaluateRules(job(), R, { now, enrichment: enr() }));
  });
  it("ranks the real senior-living client above the unverified Irish brief once both are under 20 proposals", () => {
    const senior = mergeDetail(job(), detail.patch, detail.enrichment);
    const s = evaluateRules(senior, R, { now, enrichment: detail.enrichment });
    const irish = evaluateRules(mapRow(irishDataRow), R, { now, enrichment: enr({}, { hires: 0, hours: 0, contractsTotal: 0, totalSpent: 0, hireRatePercent: null, openJobs: 1 }) });
    expect(s.score).toBeGreaterThan(irish.score);
  });
});

describe("Swedish client from David's report (16% hire rate, ~$8-13/hr avg paid)", () => {
  const swede = job({ title: "We're Hiring: AI Growth Manager & GTM Engineer", skills: ["AI", "Growth"], proposalsTier: "5 to 10", totalApplicants: 10 },
    { country: "Sweden", totalSpent: 10468, totalHires: 26, paymentVerified: true });
  const rec = enr({ workHistory: [], reviews: [] }, { totalSpent: 10468, hours: 811, hireRatePercent: 16, hires: 26, jobsPosted: 159, openJobs: 16, contractsTotal: 34 });
  it("gets hire-rate and cheap-labour red flags once the client record is loaded", () => {
    const r = evaluateRules(swede, R, { now, enrichment: rec });
    expect(r.flags.find((f) => f.code === "hire_rate")?.severity).toBe("red");
    expect(r.flags.find((f) => f.code === "cheap_history")?.severity).toBe("red");
    expect(r.score).toBeLessThan(40);
  });
  it("says the record is missing instead of 'no flags' when it isn't loaded", () => {
    const r = evaluateRules(swede, R, { now });
    expect(r.flags.some((f) => f.code === "no_record")).toBe(true);
  });
  it("flags a low hire rate for non-AI work too", () => {
    const mkt = job({ title: "Social media manager for a fashion brand", skills: ["Instagram"], description: "content calendar" });
    expect(evaluateRules(mkt, R, { now, enrichment: enr({}, { hireRatePercent: 25 }) }).flags.find((f) => f.code === "hire_rate")?.severity).toBe("red");
    expect(evaluateRules(mkt, R, { now, enrichment: enr({}, { hireRatePercent: 45 }) }).flags.find((f) => f.code === "hire_rate")?.severity).toBe("amber");
  });
});
