import { beforeEach, describe, expect, it } from "vitest";
import { createSearch, insertJob, listJobs, resetDbForTests } from "@/lib/db";
import { demoJobs } from "@/lib/fixtures";
import { dateWindow, scoreWindow } from "@/lib/jobFilters";
import { scoreJob } from "@/lib/scoring";

const H = 36e5;

describe("jobs list filters", () => {
  it("defaults to the last 24 hours and reads presets and calendar picks", () => {
    const now = Date.UTC(2026, 9, 13, 12);
    expect(dateWindow({}, now)).toEqual({ since: now - 24 * H, until: null, preset: "24h" });
    expect(dateWindow({ range: "7d" }, now)).toMatchObject({ since: now - 7 * 24 * H, preset: "7d" });
    expect(dateWindow({ range: "all" }, now)).toEqual({ since: null, until: null, preset: "all" });
    expect(dateWindow({ range: "bogus" }, now).preset).toBe("24h");
    expect(dateWindow({ since: "1000", until: "5000" }, now)).toEqual({ since: 1000, until: 5000, preset: null });
    expect(dateWindow({ since: "1000", until: "500" }, now)).toEqual({ since: 1000, until: null, preset: null });
  });

  it("clamps the score range and keeps min ≤ max", () => {
    expect(scoreWindow({})).toEqual({ min: 0, max: 100 });
    expect(scoreWindow({ min: "40", max: "85" })).toEqual({ min: 40, max: 85 });
    expect(scoreWindow({ min: "-5", max: "250" })).toEqual({ min: 0, max: 100 });
    expect(scoreWindow({ min: "90", max: "30" })).toEqual({ min: 30, max: 90 });
    expect(scoreWindow({ min: "abc", max: "" })).toEqual({ min: 0, max: 100 });
  });

  describe("listJobs", () => {
    beforeEach(() => resetDbForTests());

    it("filters by posting time and by a score range", async () => {
      const now = Date.now();
      const search = await createSearch({ kind: "search", name: "s", enabled: true, skills: ["Python"], query: "", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
      const [a, b, c] = demoJobs(now, "f");
      const posted = [now - 2 * H, now - 30 * H, now - 50 * H];
      const totals = [80, 55, 20];
      for (const [i, j] of [a, b, c].entries()) {
        const job = { ...j, publishedAt: new Date(posted[i]).toISOString() };
        await insertJob(job, search.id, { ...scoreJob(job, search), total: totals[i] }, now);
      }
      const ids = async (o: Parameters<typeof listJobs>[0]) => (await listJobs(o)).map((j) => j.id);
      expect(await ids({ since: now - 24 * H })).toEqual([a.id]);
      expect(await ids({ since: now - 72 * H, until: now - 24 * H })).toEqual([b.id, c.id]);
      expect(await ids({ minScore: 50, maxScore: 60 })).toEqual([b.id]);
      expect(await ids({ maxScore: 100 })).toHaveLength(3);
    });
  });
});
