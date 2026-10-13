import { describe, expect, it } from "vitest";
import { demoJobs, demoSearches } from "@/lib/fixtures";
import { hardExclude, matchedSkills, scoreJob } from "@/lib/scoring";
import type { SavedSearch } from "@/lib/types";

const now = new Date("2026-10-09T12:00:00Z");
const jobs = demoJobs(now.getTime(), "t");
const voice: SavedSearch = { ...demoSearches[0], id: 1, createdAt: now.toISOString() };
const web: SavedSearch = { ...demoSearches[1], id: 2, createdAt: now.toISOString() };

describe("scoreJob (feed filters + rules)", () => {
  it("ranks the strong voice-agent job above a weak writing gig", () => {
    const strong = scoreJob(jobs[0], voice, now); // Retell/Python, verified, $184k spent, 4 proposals, up to $95/hr
    const weak = scoreJob(jobs[6], web, now); // SEO blog posts
    expect(strong.total).toBeGreaterThan(60);
    expect(strong.excluded).toBeNull();
    expect(weak.excluded).toMatch(/seo|blog/i);
    expect(weak.total).toBe(0);
  });
  it("is deterministic and bounded", () => {
    for (const j of jobs) {
      const a = scoreJob(j, voice, now), b = scoreJob(j, voice, now);
      expect(a).toEqual(b);
      expect(a.total).toBeGreaterThanOrEqual(0);
      expect(a.total).toBeLessThanOrEqual(100);
    }
  });
});

describe("feed-level filters", () => {
  it("fire on keyword, country, unverified payment and too many proposals", () => {
    const wp = jobs[3]; // WordPress, unverified, 38 proposals
    expect(hardExclude(wp, voice)).toMatch(/wordpress/i);
    expect(hardExclude(wp, { ...voice, excludeKeywords: [] })).toBe("Payment not verified");
    expect(hardExclude(wp, { ...voice, excludeKeywords: [], verifiedPaymentOnly: false })).toMatch(/proposals/);
    expect(hardExclude(jobs[1], { ...web, excludeCountries: ["Germany"] })).toMatch(/Germany/);
    expect(hardExclude(jobs[1], web)).toBeNull();
  });
  it("matches skills case-insensitively", () => {
    expect(matchedSkills(jobs[0], voice)).toEqual(expect.arrayContaining(["Retell AI", "Python", "OpenAI API"]));
    expect(matchedSkills(jobs[6], voice)).toEqual([]);
  });
});
