import { describe, expect, it } from "vitest";
import { repeatPoster, sameJob } from "@/lib/ranking/repeatPoster";

const wh = (titles: string[]) => ({ workHistory: titles.map((title) => ({ title, type: "FIXED", status: "CLOSED", started: null, ended: null, feedback: 5, open: false })), otherOpenJobs: [] });

describe("repeat poster red flag", () => {
  it("flags a client who keeps posting the same job (real SRS client, 2026-10-15)", () => {
    const r = repeatPoster({ title: "SRS document for the Enterprise Growth Automation Platform" }, wh([
      "SRS document for the Multi-Cloud Management Platform", "SRS document for the AI-Powered IT Service Management Platform",
      "SRS document for the Enterprise Analytics & Decision Intelligence Platform", "SRS document for the Enterprise Cloud FinOps Platform",
      "SRS document for the Enterprise AI Operations Platform",
    ]));
    expect(r?.count).toBe(5);
  });
  it("leaves varied clients alone", () => {
    expect(repeatPoster({ title: "RAG chatbot for our law firm" }, wh(["Logo for bakery", "RAG pipeline for search", "Shopify theme fixes", "Data cleanup in Excel"]))).toBeNull();
    expect(sameJob("Web3 Backend Developer", "Web3 Frontend Developer")).toBe(false);
  });
});
