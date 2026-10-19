import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { createSearch, getSettings, mcpCallCounts, resetDbForTests, saveSettings } from "@/lib/db";
import { mapApiDetail } from "@/lib/upwork/queries";

const node = {
  id: "~021", ciphertext: "~021", title: "Build an AI agent", description: "LangChain agent", experienceLevel: "EXPERT", category: "AI",
  totalApplicants: 4, publishedDateTime: new Date().toISOString(), amount: { rawValue: "3000" }, hourlyBudgetMin: null, hourlyBudgetMax: null,
  skills: [{ name: "langchain", prettyName: "LangChain" }],
  client: { totalHires: 8, totalPostedJobs: 10, totalSpent: { rawValue: "25000" }, verificationStatus: "VERIFIED", totalReviews: 6, totalFeedback: 4.9, hasFinancialPrivacy: false, location: { country: "United States" } },
};

/** Point the app at a fake gateway: answers come from `answer(query)`; every request is recorded. */
function fakeGateway(answer: (q: string) => { status?: number; body: unknown }) {
  config.upwork.gatewayUrl = "https://gw.test";
  config.upwork.gatewayToken = "app-token";
  const seen: { url: string; auth: string | null; query: string }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (u: string | URL, init?: RequestInit) => {
    const url = String(u);
    if (!url.startsWith("https://gw.test")) return real(u, init);
    const q = init?.body ? (JSON.parse(String(init.body)) as { query: string }).query : "";
    seen.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization ?? null, query: q });
    const a = answer(q);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as typeof fetch);
  return seen;
}

describe("official Upwork API through the gateway", () => {
  beforeEach(async () => {
    await resetDbForTests();
    const s = await getSettings();
    await saveSettings({ source: "graphql", upwork: { ...s.upwork, peak: { ...s.upwork.peak, enabled: false } } });
  });
  afterEach(() => { vi.restoreAllMocks(); config.upwork.gatewayUrl = ""; config.upwork.gatewayToken = ""; });

  it("searches a saved feed through the gateway, counted by the governor", async () => {
    const seen = fakeGateway(() => ({ body: { data: { marketplaceJobPostingsSearch: { edges: [{ node }] } } } }));
    const { activeSource, fetchFeed } = await import("@/lib/upwork/source");
    expect(await activeSource()).toBe("graphql");
    const feed = await createSearch({ kind: "search", name: "Search: AI", enabled: true, skills: [], query: "AI agent", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: true, maxProposals: 19, excludeKeywords: [], excludeCountries: [] });
    const jobs = await fetchFeed(feed);
    expect(jobs.map((j) => j.title)).toEqual(["Build an AI agent"]);
    expect(jobs[0].client).toMatchObject({ totalSpent: 25000, paymentVerified: true, country: "United States" });
    expect(seen[0]).toMatchObject({ url: "https://gw.test/graphql", auth: "Bearer app-token" });
    expect((await mcpCallCounts(Date.now() - 60_000)).search).toBe(1);
    // Best Matches has no API equivalent.
    expect(await fetchFeed({ ...feed, kind: "best_match" })).toEqual([]);
  });

  it("maps job details onto the same client record the MCP path gives", () => {
    const { enrichment, patch } = mapApiDetail({
      id: "~021", content: { description: "Full text" }, workFlowState: { status: "ACTIVE" },
      activityStat: { jobActivity: { invitesSent: 3, totalInvitedToInterview: 2, totalHired: 0, totalUnansweredInvites: 1, totalOffered: 0 } },
      clientCompanyPublic: { id: "c1", paymentVerification: { paymentVerified: true } },
    }, { description: "short", client: { paymentVerified: null, identityVerified: true, totalSpent: 25000, totalHires: 8, totalPostedJobs: 10, totalReviews: 6, totalFeedback: 4.9, country: "US", hasFinancialPrivacy: false } });
    expect(enrichment).toMatchObject({ description: "Full text", status: "ACTIVE", clientId: "c1", activity: { invitesSent: 3, interviewed: 2, hired: 0, offered: 0, unansweredInvites: 1 } });
    expect(enrichment.record).toMatchObject({ hires: 8, jobsPosted: 10, hireRatePercent: 80, totalSpent: 25000 });
    expect(patch.client?.paymentVerified).toBe(true);
  });

  it("falls back to the search row when the detail query doesn't match the live schema", async () => {
    fakeGateway(() => ({ body: { errors: [{ message: "Validation error: Cannot query field 'activityStat' on type 'MarketplaceJobPosting'" }] } }));
    const { fetchDetail } = await import("@/lib/upwork/source");
    expect(await fetchDetail("~021")).toBeNull();
  }, 30_000);

  it("stops every Upwork call when the gateway reports a restriction", async () => {
    fakeGateway(() => ({ status: 423, body: { error: "restricted", detail: "Upwork API access has been restricted: suspended" } }));
    const { searchJobs } = await import("@/lib/upwork/queries");
    const { isRestricted } = await import("@/lib/upwork/governor");
    const feed = await createSearch({ kind: "search", name: "s", enabled: true, skills: [], query: "AI", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
    await expect(searchJobs(feed)).rejects.toMatchObject({ kind: "restricted" });
    expect(await isRestricted()).toBe(true);
  }, 30_000);
});
