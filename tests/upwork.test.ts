import { describe, expect, it } from "vitest";
import { mapDetail, mapRow, mergeDetail, parseBudget } from "@/lib/upwork/mcp/jobs";
import { unwrap } from "@/lib/upwork/mcp/client";
import { proposalsLow } from "@/lib/upwork/tiers";
import { importUpworkUrl } from "@/lib/upwork/urlImport";
import { davidSearchUrl, irishDataRow, mcpEngineerRow, searchRow, seniorLivingDetail, seniorLivingRow } from "./fixtures/upwork";

describe("URL importer (no page fetch - parse only)", () => {
  it("turns David's saved search into the same filters used by hand", () => {
    const f = importUpworkUrl(davidSearchUrl);
    if (typeof f === "string") throw new Error(f);
    expect(f.kind).toBe("search");
    expect(f.minBudget).toBe(500);
    expect(f.minHourly).toBe(70);
    expect(f.verifiedPaymentOnly).toBe(true);
    expect(f.maxProposals).toBe(19);
    expect(f.jobType).toBe("ANY");
    expect(f.query).toContain("LLM OR");
    expect(f.sourceUrl).toBe(davidSearchUrl);
  });
  it("recognises the two find-work feeds and rejects other sites", () => {
    expect(importUpworkUrl("https://www.upwork.com/nx/find-work/most-recent")).toMatchObject({ kind: "most_recent" });
    expect(importUpworkUrl("https://www.upwork.com/nx/find-work/")).toMatchObject({ kind: "best_match" });
    expect(importUpworkUrl("https://evil.example.com/nx/find-work/")).toMatch(/upwork\.com/);
    expect(importUpworkUrl("not a url")).toMatch(/valid/);
  });
});

describe("MCP payload mapping", () => {
  it("parses budgets in every format the connector uses", () => {
    expect(parseBudget("$70.00–$110.00/hr", "hourly")).toMatchObject({ hourly: true, min: 70, max: 110 });
    expect(parseBudget("10.00–15.00/hr", "hourly")).toMatchObject({ min: 10, max: 15 });
    expect(parseBudget("4,000.00", "fixed")).toMatchObject({ hourly: false, amount: 4000 });
    expect(parseBudget("$1,500.00", "fixed")).toMatchObject({ amount: 1500 });
    expect(parseBudget(undefined, "hourly")).toMatchObject({ hourly: true, min: null, max: null });
  });
  it("maps smart_search rows (tiers) and search rows (exact counts)", () => {
    const a = mapRow(irishDataRow);
    expect(a).toMatchObject({ id: "2109759271844237374", ciphertext: "~022109759271844237374", jobType: "FIXED", amount: 4000, proposalsTier: "5 to 10" });
    expect(a.client.paymentVerified).toBe(false);
    expect(proposalsLow(a)).toBe(5);
    const b = mapRow(mcpEngineerRow);
    expect(b).toMatchObject({ jobType: "HOURLY", hourlyMin: 70, hourlyMax: 110 });
    expect(proposalsLow(b)).toBe(20);
    const c = mapRow(searchRow);
    expect(c.totalApplicants).toBe(0);
    expect(c.proposalsTier).toBeNull();
    expect(c.client.paymentVerified).toBe(true);
    expect(c.experienceLevel).toBe("EXPERT");
  });
  it("maps find_jobs get into client intelligence and strips untrusted wrappers", () => {
    const { enrichment: e, patch } = mapDetail(unwrap(seniorLivingDetail));
    expect(e.record).toMatchObject({ hireRatePercent: 72, totalSpent: 605910.88, hours: 14280.33, contractsTotal: 67, hires: 55, openJobs: 1 });
    expect(e.connectsCost).toBe(27);
    expect(e.status).toBe("ACTIVE");
    expect(e.workHistory).toHaveLength(3);
    expect(e.workHistory[0]).toMatchObject({ open: true, type: "HOURLY" });
    expect(e.reviews[0].comment.startsWith("Alan was great")).toBe(true);
    expect(e.reviews[0].comment).not.toContain("untrusted");
    expect(e.subcategory).toBe("AI & Machine Learning");
    expect(patch.category).toBe("Data Science & Analytics");
    const merged = mergeDetail(mapRow(seniorLivingRow), patch, e);
    expect(merged.client.totalHires).toBe(55);
    expect(merged.client.country).toBe("United States");
    expect(merged.description).toContain("Senior Living");
  });
});

describe("search feed paging", () => {
  it("stops paging once it reaches a job already stored", async () => {
    const { vi } = await import("vitest");
    const client = await import("@/lib/upwork/mcp/client");
    const pages = [
      { jobs: [{ ...searchRow, id: "n1" }, { ...searchRow, id: "n2" }], pageInfo: { hasNextPage: true, endCursor: "10" } },
      { jobs: [{ ...searchRow, id: "n3" }, { ...searchRow, id: "old" }], pageInfo: { hasNextPage: true, endCursor: "20" } },
      { jobs: [{ ...searchRow, id: "never" }], pageInfo: { hasNextPage: false } },
    ];
    let call = 0;
    const spy = vi.spyOn(client, "callTool").mockImplementation(async () => pages[call++] as never);
    const { fetchFeedMcp } = await import("@/lib/upwork/mcp/jobs");
    const feed = { id: 1, name: "s", enabled: true, kind: "search" as const, skills: [], query: "AI", jobType: "HOURLY" as const, minHourly: null, minBudget: null, experienceLevel: "ANY" as const, verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [], createdAt: "" };
    const jobs = await fetchFeedMcp(feed, { isKnown: (id) => id === "old", maxPages: 3 });
    expect(call).toBe(2);
    expect(jobs.map((j) => j.id).sort()).toEqual(["n1", "n2", "n3", "old"]);
    spy.mockRestore();
  });
});
