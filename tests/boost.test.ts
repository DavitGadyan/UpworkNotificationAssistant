import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProposal, getProposal, resetDbForTests, updateProposal } from "@/lib/db";
import { boostInfo, editDraft, GateError, preview, setBoost, submit } from "@/lib/proposals/submit";

const BOOST = { available: true, recommended_connects: 3, max_boost_connects: 120, current_top_bids: [5, { connects: 2 }], note: "4 paid slots", recommendation: "boost" };

async function approved() {
  const p = await createProposal({
    jobId: "2112000000000000001", jobTitle: "RAG build", jobUrl: "u", status: "ready", coverLetter: "Hi Ann,\n\nI built this before.\n\nBUDGET: $3,000", research: null, answers: [], bid: 3000,
    estimatedDuration: null, portfolioProjectIds: ["pf1"], loomUrl: null, approvedAt: null, preview: null, previewId: null, submittedAt: null, originalDraft: "x", model: null, promptVersion: null,
  });
  return (await updateProposal(p.id, { status: "approved", approvedAt: new Date().toISOString() }))!;
}

/** Upwork stub: records every call; manage_proposals returns a preview with a boost block. */
async function stubUpwork(opts: { confirm?: () => unknown } = {}) {
  const client = await import("@/lib/upwork/mcp/client");
  const calls: { tool: string; action: string | null; params?: Record<string, unknown> }[] = [];
  let n = 0;
  const spy = vi.spyOn(client, "callTool").mockImplementation(async (tool: string, action: string | null, params?: Record<string, unknown>) => {
    calls.push({ tool, action, params });
    if (action === "invitations") return { invitations: [] } as never;
    if (tool === "list_freelancer_proposals") return { proposals: [] } as never;
    if (tool === "manage_proposals") return { preview_id: `pv${++n}`, connects_cost: 16, connects_balance: 136, boost: BOOST } as never;
    if (tool === "confirm_preview") return (opts.confirm ? opts.confirm() : { ok: true }) as never;
    return {} as never;
  });
  return { calls, spy };
}

describe("proposal boost", () => {
  beforeEach(() => resetDbForTests());

  it("reads Upwork's boost block", () => {
    expect(boostInfo({ boost: BOOST })).toEqual({ available: true, reason: null, skip: false, recommended: 3, max: 120, topBids: [5, 2], note: "4 paid slots" });
    expect(boostInfo({ preview: { boost: { available: false, reason: "unmet preferred qualifications" } } })).toMatchObject({ available: false, reason: "unmet preferred qualifications" });
    expect(boostInfo({ boost: { ...BOOST, current_top_bids_available: false } })?.topBids).toBeNull();
    expect(boostInfo({ boost: { ...BOOST, recommendation: "skip" } })?.skip).toBe(true);
    expect(boostInfo({ connects_cost: 16 })).toBeNull();
  });

  it("previews without a boost, then rebuilds the preview with the bid David picked, within Upwork's bounds", async () => {
    const p = await approved();
    const { calls, spy } = await stubUpwork();
    const pv = await preview(p.id);
    expect(calls.find((c) => c.tool === "manage_proposals")!.params).not.toHaveProperty("boost_connects");
    expect(pv.preview?.boost).toMatchObject({ recommended: 3, max: 120 });
    expect(pv.previewId).toBe("pv1");

    await expect(setBoost(p.id, 2)).rejects.toThrow(/at least 3/);
    await expect(setBoost(p.id, 121)).rejects.toThrow(/At most 120/);
    await expect(setBoost(p.id, 2.5)).rejects.toThrow(GateError);

    const listCalls = calls.filter((c) => c.tool === "list_freelancer_proposals").length;
    const boosted = await setBoost(p.id, 6);
    const create = calls.filter((c) => c.tool === "manage_proposals").at(-1)!;
    expect(create.params).toMatchObject({ boost_connects: 6, portfolio_project_ids: ["pf1"] });
    expect(calls.filter((c) => c.tool === "list_freelancer_proposals").length).toBe(listCalls); // checks not repeated
    expect(boosted.status).toBe("previewed");
    expect(boosted.previewId).toBe("pv2");
    expect(boosted.preview?.boostConnects).toBe(6);

    const off = await setBoost(p.id, null);
    expect(calls.filter((c) => c.tool === "manage_proposals").at(-1)!.params).not.toHaveProperty("boost_connects");
    expect(off.preview?.boostConnects).toBeNull();
    spy.mockRestore();
  });

  it("refuses a boost before the preview or when Upwork says boosting is unavailable", async () => {
    const p = await approved();
    await expect(setBoost(p.id, 5)).rejects.toThrow(/preview first/);
    await updateProposal(p.id, { status: "previewed", previewId: "pvx", preview: { upwork: {}, type: "proposal", invitationId: null, boost: boostInfo({ boost: { available: false, reason: "client already hired" } }) } });
    await expect(setBoost(p.id, 5)).rejects.toThrow(/isn't available.*client already hired/);
  });

  it("an edit after the preview drops the boost with the preview", async () => {
    const p = await approved();
    const { spy } = await stubUpwork();
    await preview(p.id);
    await setBoost(p.id, 4);
    const edited = await editDraft(p.id, { bid: 3200 });
    expect(edited.status).toBe("ready");
    expect(edited.preview?.boostConnects).toBeUndefined();
    expect(edited.preview?.boost).toBeUndefined();
    spy.mockRestore();
  });

  it("keeps a boosted proposal unsent when Upwork refuses the bid on confirm", async () => {
    const p = await approved();
    const { spy } = await stubUpwork({ confirm: () => { throw new Error("confirm_preview: bid no longer takes a paid slot"); } });
    await preview(p.id);
    await setBoost(p.id, 4);
    await expect(submit(p.id, "SUBMIT")).rejects.toThrow(/4-Connect boost/);
    expect((await getProposal(p.id))!.status).toBe("previewed");
    spy.mockRestore();
  });
});
