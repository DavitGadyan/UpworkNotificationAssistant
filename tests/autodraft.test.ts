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
