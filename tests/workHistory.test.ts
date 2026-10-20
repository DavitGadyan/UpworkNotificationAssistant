import { beforeEach, describe, expect, it, vi } from "vitest";

/* Upwork MCP is mocked; the contract shapes are guesses in the style of the other MCP tools (id + title + feedback). */
const calls: { tool: string; action: string; params: Record<string, unknown> }[] = [];
let responder: (tool: string, action: string, params: Record<string, unknown>) => unknown = () => ({});
vi.mock("@/lib/upwork/mcp/client", () => ({
  callTool: async (tool: string, action: string, params: Record<string, unknown>) => {
    calls.push({ tool, action, params });
    const r = responder(tool, action, params);
    if (r instanceof Error) throw r;
    return r;
  },
  unwrap: (v: unknown) => v,
}));

import { resetDbForTests } from "@/lib/db";
import { buildWorkHistory, contractRows, parseContract, relevantWork, workHistory, workHistoryDigest, type WorkItem } from "@/lib/agents/workHistory";

const contract = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, status: "closed", contractType: "FIXED", client: { name: `Client ${id}`, country: "US" },
  totalCharge: { rawValue: "4200", displayValue: "$4,200.00" }, startDate: "2025-03-01T00:00:00Z", endDate: "2025-05-10T00:00:00Z",
  skills: [{ prettyName: "Python" }, { prettyName: "LangChain" }],
  ...extra,
});
const fb = (score: number, comment: string) => ({ feedback: { clientFeedback: { score, comment }, freelancerFeedback: { score: 5, comment: "Great client" } } });

describe("work history index", () => {
  beforeEach(async () => { await resetDbForTests(); calls.length = 0; });

  it("parses a contract row: client's rating and words, never David's review of the client", () => {
    const it = parseContract(contract("c1", "RAG chatbot for a law firm", fb(5, "David built our RAG assistant in two weeks. Precise and fast.")))!;
    expect(it).toMatchObject({ contractId: "c1", title: "RAG chatbot for a law firm", client: "Client c1", type: "FIXED", status: "closed", earned: 4200, started: "2025-03-01", ended: "2025-05-10", rating: 5 });
    expect(it.skills).toEqual(["Python", "LangChain"]);
    expect(it.feedback).toContain("RAG assistant");
    expect(it.feedback).not.toContain("Great client");
    expect(parseContract({ foo: 1 })).toBeNull();
    expect(contractRows({ data: { contracts: { edges: [{ node: contract("x", "T") }] } } })).toHaveLength(1);
    expect(contractRows({ contracts: [contract("a", "A"), contract("b", "B")], total: 2 })).toHaveLength(2);
  });

  it("builds once through pages, opens only contracts without feedback text, resumes and then only looks for new ones", async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => contract(`p${i}`, `Project ${i}`, i % 2 ? fb(5, `Excellent work on project ${i}`) : {}));
    const page2 = [contract("q1", "ML pipeline on GCP", fb(4.9, "Solid MLOps work")), contract("q2", "Blender product configurator")];
    responder = (tool, action, params) => {
      if (tool === "list_contracts" && action === "search") return { contracts: params.offset === 0 ? page1 : page2 };
      if (tool === "list_contracts" && action === "get") return { contract: contract(String(params.contract_id), "detail", fb(5, `Detail feedback for ${params.contract_id}`)) };
      return {};
    };
    // Capped run: 2 search pages + 3 details, the rest pending.
    const first = await buildWorkHistory({ maxCalls: 5 });
    expect(first.complete).toBe(true);
    expect(first.items).toHaveLength(12);
    expect(first.detailsPending).toHaveLength(6 - 3);
    expect(calls.filter((c) => c.action === "get")).toHaveLength(3);
    expect(first.items.find((i) => i.contractId === "p0")?.feedback).toBe("Detail feedback for p0");
    expect(first.items.find((i) => i.contractId === "p1")?.feedback).toContain("Excellent work on project 1");
    // Second run: one first-page look (nothing new) + the pending details.
    calls.length = 0;
    const second = await buildWorkHistory({ maxCalls: 10 });
    expect(second.detailsPending).toHaveLength(0);
    expect(calls.filter((c) => c.action === "search")).toHaveLength(1);
    expect(calls.filter((c) => c.action === "get")).toHaveLength(3);
    expect(second.items.every((i) => i.feedback)).toBe(true);
    expect((await workHistory())?.items).toHaveLength(12);
    // An error on a detail call is noted and the contract stays pending; nothing throws.
    responder = (tool, action) => (action === "get" ? new Error("list_contracts: boom") : tool === "list_contracts" ? { contracts: [...page1, contract("new1", "New contract")] } : {});
    const third = await buildWorkHistory({ maxCalls: 3 });
    expect(third.items.map((i) => i.contractId)).toContain("new1");
    expect(third.detailsPending).toEqual(["new1"]);
    expect(third.notes[0]).toMatch(/boom/);
  });

  it("picks the most similar 5-star contracts with written feedback and writes the digest", async () => {
    const items: WorkItem[] = [
      { contractId: "1", title: "LangChain RAG chatbot for legal documents", client: "Acme Law", type: "FIXED", status: "closed", skills: ["Python", "LangChain", "RAG"], rating: 5, feedback: "David delivered a precise RAG chatbot ahead of schedule.", earned: 6000, started: "2025-01-01", ended: "2025-02-01" },
      { contractId: "2", title: "RAG chatbot with LangChain, no review", client: null, type: null, status: "closed", skills: ["LangChain", "RAG"], rating: null, feedback: null, earned: 9000, started: null, ended: null },
      { contractId: "3", title: "Shopify SEO audit", client: "Shop", type: "HOURLY", status: "closed", skills: ["SEO"], rating: 5, feedback: "Great SEO work", earned: 800, started: null, ended: "2024-06-01" },
      { contractId: "4", title: "Chatbot that went badly", client: "X", type: null, status: "closed", skills: ["Chatbot", "RAG"], rating: 3.2, feedback: "Late delivery", earned: 2000, started: null, ended: "2024-01-01" },
    ];
    const picks = relevantWork(items, "Build a RAG chatbot over legal contracts with LangChain", 3);
    expect(picks.map((p) => p.contractId)).toEqual(["1", "2"]);
    expect(relevantWork(items, "Unity game developer", 3)).toEqual([]);
    const { kvSet } = await import("@/lib/db");
    await kvSet("upwork_work_history", { builtAt: "x", complete: true, offset: 0, items, detailsPending: [], notes: [] });
    const digest = await workHistoryDigest("RAG chatbot LangChain legal");
    expect(digest).toContain('1. "LangChain RAG chatbot for legal documents" (Acme Law, $6,000, 2025) - ★5.0 - client wrote: "David delivered a precise RAG chatbot ahead of schedule."');
    expect(digest).toContain("at most one short phrase");
    expect(await workHistoryDigest("Unity game")).toBe("");
  });
});
