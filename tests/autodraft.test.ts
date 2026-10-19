import { describe, expect, it } from "vitest";
import { isThreeD, tightAiFit } from "@/lib/autodraft";
import type { CachedJob } from "@/lib/types";

const job = (title: string, skills: string[], fit: number | null, verdict: "core" | "adjacent" | "off" = "core") =>
  ({ title, skills, score: { llm: fit == null ? null : { fit }, profileFit: { verdict } } }) as unknown as CachedJob;

describe("auto-draft gate: tight AI fits only, never 3D", () => {
  it("drafts tight AI fits", () => {
    expect(tightAiFit(job("RAG chatbot for a law firm", ["LangChain", "OpenAI API"], 85))).toBe(true);
  });
  it("skips loose fits and 3D work (it still alerts; David drafts it by hand)", () => {
    expect(tightAiFit(job("RAG chatbot for a law firm", ["LangChain"], 70))).toBe(false);
    expect(tightAiFit(job("3D Artist / Blender Modeler", ["Blender", "3D Modeling"], 90))).toBe(false);
    expect(tightAiFit(job("AI product visuals", ["Cinema 4D", "Midjourney"], 88))).toBe(false);
    expect(tightAiFit(job("Ai agent", [], null))).toBe(false);
    expect(isThreeD(job("Three-tier SaaS", ["Python"], 80))).toBe(false);
  });
});

describe("auto-draft timing (David, 2026-10-19)", () => {
  // 2026-10-19 14:00 and 03:00 in Yerevan (UTC+4).
  const day = Date.parse("2026-10-19T10:00:00Z"), night = Date.parse("2026-10-18T23:00:00Z");
  const j = (rank: number, hoursOld: number, tier: string, now: number, watchFit?: number) =>
    ({ publishedAt: new Date(now - hoursOld * 3600e3).toISOString(), fetchedAt: new Date(now).toISOString(), proposalsTier: tier, totalApplicants: null,
      score: { total: rank, watch: watchFit ? { fit: watchFit, at: "" } : null } }) as unknown as CachedJob;
  const tz = "Asia/Yerevan";

  it("never drafts posts older than 6 hours", async () => {
    const { draftTiming } = await import("@/lib/autodraft");
    expect(draftTiming(j(95, 16, "Less than 5", night), tz, night)).toMatch(/6 h/);
    expect(draftTiming(j(95, 16, "Less than 5", day), tz, day)).toMatch(/6 h/);
  });

  it("at night (00:30-11:00) drafts every tight fit; by day only rank ≥ 80 with fewer than 15 proposals", async () => {
    const { draftTiming } = await import("@/lib/autodraft");
    expect(draftTiming(j(65, 1, "15 to 20", night), tz, night)).toBeNull();
    expect(draftTiming(j(65, 1, "Less than 5", day), tz, day)).toMatch(/rank 65/);
    expect(draftTiming(j(85, 1, "15 to 20", day), tz, day)).toMatch(/proposals/);
    expect(draftTiming(j(85, 1, "5 to 10", day), tz, day)).toBeNull();
    expect(draftTiming(j(59, 1, "Less than 5", day, 76), tz, day)).toBeNull(); // vouched by the watch loop
  });
});
