import { describe, expect, it } from "vitest";
import { autoApplyBlocker } from "@/lib/autoapply";
import { DEFAULT_RULES } from "@/lib/db";
import { scamAware } from "@/lib/learning/scamJobs";
import { evaluateRules } from "@/lib/ranking/rules";
import { malwareLure, replyLure } from "@/lib/ranking/scam";
import type { CachedJob, Job } from "@/lib/types";

const now = new Date("2026-10-20T19:00:00Z");
// The post David reported on 2026-10-20 (job 2112214027538569768): a clean-looking crypto job from a hollow client.
const crypto = (client: Partial<Job["client"]> = {}, over: Partial<Job> = {}): Job => ({
  id: "2112214027538569768", ciphertext: "~022112214027538569768", title: "Blockchain AI Developer for Crypto Tracker",
  description: "We are building an AI-powered crypto tracker system and need a developer to help design and implement the solution. The work includes developing the core tracking logic, integrating blockchain data sources, and supporting the overall system architecture.",
  skills: ["JavaScript", "Blockchain", "Artificial Intelligence", "Cryptocurrency", "Node.js"], jobType: "HOURLY", amount: null, hourlyMin: 50, hourlyMax: 90,
  experienceLevel: "EXPERT", totalApplicants: 4, proposalsTier: "Fewer than 5", publishedAt: "2026-10-19T16:00:00Z", category: null,
  ...over,
  client: { paymentVerified: true, identityVerified: false, totalSpent: 0, totalHires: 0, totalPostedJobs: 6, totalReviews: 0, totalFeedback: 0, country: "United States", hasFinancialPrivacy: false, ...client },
});

describe("fake-job malware lures", () => {
  it("flags the reported crypto job: 6 jobs posted, 0 hires", () => {
    const v = malwareLure(crypto());
    expect(v?.label).toMatch(/malware lure \(crypto\/web3\).*6 jobs posted, 0 hires.*never clone/);
    const r = evaluateRules(crypto(), DEFAULT_RULES, { now });
    const f = r.flags.find((x) => x.code === "malware_lure");
    expect(f?.severity).toBe("red");
    expect(r.score).toBeLessThan(evaluateRules(crypto({ totalPostedJobs: 1 }), DEFAULT_RULES, { now }).score);
  });

  it("still cautions on the reported job as it was stored: a Best Matches row without the jobs-posted count", () => {
    const v = malwareLure(crypto({ totalPostedJobs: 0 }));
    expect(v?.code).toBe("malware_lure_risk");
    expect(v?.severity).toBe("amber");
    expect(v?.label).toMatch(/no spend and no hires yet.*throwaway VM/);
    expect(evaluateRules(crypto({ totalPostedJobs: 0 }), DEFAULT_RULES, { now }).flags.find((f) => f.code === "malware_lure_risk")?.severity).toBe("amber");
  });

  it("leaves real crypto clients and non-crypto zero-hire clients alone", () => {
    expect(malwareLure(crypto({ totalSpent: 48_000, totalHires: 30 }))).toBeNull(); // has hired
    expect(malwareLure(crypto({ totalSpent: 0, totalHires: 0 }, { title: "AI chatbot for a dental clinic", description: "Build a support chatbot.", skills: ["Python"] }))).toBeNull();
  });

  it("flags a request to run the client's code: red from a crypto or no-history client, a caution from an established one", () => {
    const desc = "As a first step, clone our repo and run it locally, then tell us what breaks: github.com/acme-dev/dashboard";
    const established = malwareLure(crypto({ totalSpent: 90_000, totalHires: 40 }, { title: "React dashboard fixes", skills: ["React"], description: desc }));
    expect(established?.code).toBe("malware_lure_risk");
    expect(established?.reasons).toContain("asks you to clone or run their code");
    expect(malwareLure(crypto({ totalPostedJobs: 0 }, { description: desc }))?.code).toBe("malware_lure");
    expect(malwareLure(crypto({ totalSpent: 0, totalHires: 0, totalPostedJobs: 1 }, { title: "React dashboard fixes", skills: ["React"], description: desc }))?.code).toBe("malware_lure");
  });

  it("spots the second step in a client reply", () => {
    expect(replyLure("Hi, please review our project: https://github.com/foo-labs/tracker and run npm install")).toMatch(/github\.com/);
    expect(replyLure("Here is the test task, download the zip: task.zip")).toMatch(/\.zip/);
    expect(replyLure("Hi\nHow are you?")).toBeNull();
    expect(replyLure(null)).toBeNull();
  });

  it("keeps a reported job's outcome void, whatever the classifier says", () => {
    const scams = { "2112214027538569768": { reason: "malicious repo", at: "2026-10-20T19:00:00Z" } };
    expect(scamAware("2112214027538569768", "win", scams)).toBe("void");
    expect(scamAware("1", "win", scams)).toBe("win");
  });

  it("never auto-applies to a flagged job", () => {
    const rules = evaluateRules(crypto(), DEFAULT_RULES, { now });
    const j = { ...crypto(), status: "new", fetchedAt: now.toISOString(), enrichment: null,
      score: { total: 95, excluded: null, rules, llm: { fit: 90 } } } as unknown as CachedJob;
    const a = { minRank: 80, minFit: 75, maxProposals: 15, requireVerifiedPayment: true } as Parameters<typeof autoApplyBlocker>[1];
    expect(autoApplyBlocker(j, a, now.getTime())).toMatch(/malware lure/);
  });
});
