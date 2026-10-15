import { beforeEach, describe, expect, it } from "vitest";
import { callStats, createSearch, getSettings, insertJob, listJobs, listNotifications, logNotification, purgeExpired, resetDbForTests, saveSettings } from "@/lib/db";
import { demoJobs } from "@/lib/fixtures";
import { processResults } from "@/lib/pipeline";
import { scoreJob } from "@/lib/scoring";

describe("retention and pipeline", () => {
  beforeEach(() => resetDbForTests());

  it("purges Upwork data older than 24h and keeps our settings", async () => {
    const now = Date.now();
    const search = await createSearch({ kind: "search", name: "s", enabled: true, skills: ["Python"], query: "", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
    const [old, fresh] = demoJobs(now, "p");
    await insertJob(old, search.id, scoreJob(old, search), now - 25 * 36e5);
    await insertJob(fresh, search.id, scoreJob(fresh, search), now - 1 * 36e5);
    await logNotification({ jobId: old.id, channel: "telegram", ok: true, detail: "x", title: old.title, score: 1 }, now - 25 * 36e5);
    await logNotification({ jobId: fresh.id, channel: "call", ok: true, detail: "x", title: fresh.title, score: 1 }, now - 36e5);
    await saveSettings({ callMin: 77 });

    expect(await purgeExpired(now)).toEqual({ jobs: 1, notifications: 1 });
    expect((await listJobs()).map((j) => j.id)).toEqual([fresh.id]);
    expect(await listNotifications()).toHaveLength(1);
    expect((await getSettings()).callMin).toBe(77);
    expect(await callStats(now - 864e5)).toMatchObject({ count: 1 });
  });

  it("notifies once per job, calls only when the rules allow, and never twice for the same id", async () => {
    const search = await createSearch({ kind: "search", name: "voice", enabled: true, skills: ["Retell AI", "Python", "OpenAI API"], query: "", jobType: "ANY", minHourly: 50, minBudget: 1500, experienceLevel: "ANY", verifiedPaymentOnly: true, maxProposals: 30, excludeKeywords: ["wordpress"], excludeCountries: [] });
    await saveSettings({ callMode: "always", callMin: 75, telegramMin: 60, quietHours: { enabled: false, start: "23:00", end: "08:00" } });
    const sent: string[] = [], called: string[] = [];
    const notifiers = {
      telegram: async (j: { id: string }) => { sent.push(j.id); return { ok: true, detail: "m1" }; },
      call: async (j: { id: string }) => { called.push(j.id); return { ok: true, detail: "c1" }; },
      ready: { telegram: true, call: true },
    };
    const now = new Date();
    const jobs = demoJobs(now.getTime(), "q");
    const r1 = await processResults(search, jobs, { now, notifiers });
    expect(r1.fresh).toBe(jobs.length);
    expect(sent.length).toBeGreaterThan(0);
    expect(called.length).toBe(1); // cooldown stops a second call in the same loop
    expect(await listJobs({ status: "called" })).toHaveLength(1);

    const r2 = await processResults(search, jobs, { now, notifiers });
    expect(r2).toMatchObject({ fresh: 0, telegram: 0, calls: 0 });
  });
});

describe("proposal gate and preference loop", () => {
  beforeEach(() => resetDbForTests());

  it("never lets a draft through without a Loom link, approval, preview and the SUBMIT confirmation", async () => {
    const { createProposal } = await import("@/lib/db");
    const { approve, attachLoom, editDraft, preview, submit } = await import("@/lib/proposals/submit");
    const p = await createProposal({
      jobId: "j1", jobTitle: "AI agent", jobUrl: "https://www.upwork.com/jobs/~02j1", status: "needs_loom",
      coverLetter: "Hi Alan,\n\nLOOM VIDEO: {{LOOM_URL}}\nBUDGET: $5,000", research: null, answers: [], bid: 5000,
      estimatedDuration: null, portfolioProjectIds: [], loomUrl: null, approvedAt: null, preview: null, previewId: null,
      submittedAt: null, originalDraft: "Hi Alan,\n\nLOOM VIDEO: {{LOOM_URL}}\nBUDGET: $5,000", model: "m", promptVersion: null,
    });
    await expect(approve(p.id)).rejects.toThrow(/Loom/);
    await expect(preview(p.id)).rejects.toThrow(/Approve/);
    await expect(submit(p.id, "SUBMIT")).rejects.toThrow(/preview/);
    await expect(attachLoom(p.id, "https://youtube.com/watch?v=1")).rejects.toThrow(/Loom share link/);
    const withLoom = await attachLoom(p.id, "https://www.loom.com/share/abc123");
    expect(withLoom.status).toBe("ready");
    expect(withLoom.coverLetter).toContain("LOOM VIDEO: https://www.loom.com/share/abc123");
    expect((await approve(p.id)).status).toBe("approved");
    await expect(submit(p.id, "yes")).rejects.toThrow(/SUBMIT/);
    // Editing after approval drops it back to "ready" - approval has to be given again.
    expect((await editDraft(p.id, { coverLetter: withLoom.coverLetter + "\nP.S. Feel free to book a call" })).status).toBe("ready");
    await expect(preview(p.id)).rejects.toThrow(/Approve/);
  });

  it("learns David's taste from 👍/👎 and proposes weights only with enough data", async () => {
    const { addFeedback } = await import("@/lib/db");
    const { calibrate } = await import("@/lib/feedback/calibrate");
    expect((await calibrate()).ok).toBe(false);
    for (let i = 0; i < 30; i++) {
      const good = i % 2 === 0;
      await addFeedback({ kind: "alert", refId: `j${i}`, rating: good ? 1 : -1, reason: null, data: { rules: good ? 75 + (i % 10) : 40 + (i % 10), llmFit: good ? 85 : 35, flags: good ? [] : ["cheap_history"], category: "ai" } });
    }
    const c = await calibrate();
    expect(c.ok).toBe(true);
    expect(c.accuracy).toBeGreaterThan(0.9);
    expect(c.coefficients["flag:cheap_history"]).toBeLessThan(0);
    expect(c.proposed!.weights.rules + c.proposed!.weights.llm).toBeCloseTo(1, 5);
  });
});

describe("polling goal", () => {
  beforeEach(() => resetDbForTests());
  it("marks a feed late after 3 intervals without success and reports recovery once", async () => {
    const { healthReport, lateTransitions, recordFeedRun } = await import("@/lib/health");
    const { setWorkerHeartbeat } = await import("@/lib/db");
    const f = await createSearch({ kind: "most_recent", name: "Most Recent", enabled: true, skills: [], query: "", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
    const t0 = Date.now();
    await setWorkerHeartbeat({ at: t0, lastError: null, lastFetched: 0 });
    await recordFeedRun(f.id, f.name, true, { returned: 10 }, t0);
    expect((await healthReport(t0 + 60_000)).ok).toBe(true);
    await recordFeedRun(f.id, f.name, false, { error: "429" }, t0 + 5 * 60_000);
    await setWorkerHeartbeat({ at: t0 + 16 * 60_000, lastError: "429", lastFetched: 0 });
    const late = await healthReport(t0 + 16 * 60_000);
    expect(late.ok).toBe(false);
    expect(late.feeds[0]).toMatchObject({ late: true, failures: 1, successRate24h: 50 });
    expect(await lateTransitions(t0 + 16 * 60_000)).toEqual({ late: ["Most Recent"], recovered: [] });
    expect((await lateTransitions(t0 + 17 * 60_000)).late).toEqual([]); // alert only once
    await recordFeedRun(f.id, f.name, true, { returned: 8 }, t0 + 18 * 60_000);
    expect(await lateTransitions(t0 + 18 * 60_000)).toEqual({ late: [], recovered: ["Most Recent"] });
  });
});

describe("enrich before judging", () => {
  beforeEach(() => resetDbForTests());
  const feed = () => createSearch({ kind: "most_recent", name: "Most Recent", enabled: true, skills: [], query: "", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
  const notifiers = (sent: string[]) => ({
    telegram: async (j: { id: string }) => { sent.push(j.id); return { ok: true, detail: "m" }; },
    call: async () => ({ ok: false, detail: "off" }),
    ready: { telegram: true, call: false },
  });

  it("never alerts a job whose client record could not be loaded, and retries it next cycle", async () => {
    const { listJobs, saveSettings } = await import("@/lib/db");
    const { retryPending } = await import("@/lib/pipeline");
    await saveSettings({ telegramMin: 10, callMode: "off" });
    const f = await feed();
    const sent: string[] = [];
    const [j] = demoJobs(Date.now(), "e");
    const failing = { enrich: async () => { throw new Error("502 Bad Gateway"); } };
    const r = await processResults(f, [j], { notifiers: notifiers(sent), hooks: failing });
    expect(r.pending).toBe(1);
    expect(sent).toEqual([]);
    expect(await listJobs({ status: "pending" })).toHaveLength(1);
    const ok = { enrich: async () => null };
    const r2 = await retryPending({ notifiers: notifiers(sent), hooks: ok });
    expect(r2.pending).toBe(0);
    expect(sent).toEqual([j.id]);
  });

  it("alerts a strong AI fit without red flags even below the rank threshold", async () => {
    const { alertLane } = await import("@/lib/pipeline");
    const base = { total: 50, skills: 0, client: 0, budget: 0, competition: 0, excluded: null, matchedSkills: [] };
    const llm = { model: "m", category: "ai" as const, fit: 85, valuePotential: 40, summary: "", finalProduct: "", skillsWanted: [], reasons: [], redFlags: [] };
    expect(alertLane({ ...base, llm, rules: { score: 50, rejected: null, flags: [], passes: [], category: "ai", derived: { avgPaid: null, avgPerContract: null, lastHireDays: null, hireRate: null } } }, 60)).toBe("strong_fit");
    expect(alertLane({ ...base, llm, rules: { score: 50, rejected: null, flags: [{ code: "cheap_history", label: "", severity: "red", penalty: 20 }], passes: [], category: "ai", derived: { avgPaid: 12, avgPerContract: null, lastHireDays: null, hireRate: 16 } } }, 60)).toBeNull();
    expect(alertLane({ ...base, total: 70 }, 60, false)).toBe("rank"); // AI off in Settings: rules decide
    expect(alertLane({ ...base, total: 70 }, 60)).toBeNull(); // AI on: never alert without its verdict
    expect(alertLane({ ...base, total: 70, llm }, 60)).toBe("rank");
    expect(alertLane({ ...base, total: 90, excluded: "India" }, 60)).toBeNull();
  });

  const aiOn = async () => {
    const { getSettings, saveSettings } = await import("@/lib/db");
    // claude-cli makes the AI count as available without an API key; the rank hook stands in for the model.
    await saveSettings({ telegramMin: 10, callMode: "off", llm: { ...(await getSettings()).llm, provider: "claude-cli" } });
  };
  const verdict = { model: "m", category: "ai" as const, offProfile: false, field: "Voice AI agents", fit: 90, valuePotential: 80, summary: "s", finalProduct: "p", skillsWanted: [], reasons: [], redFlags: [], bigFish: "", similarProject: true };

  it("never ranks, alerts or lists work outside David's fields", async () => {
    const { listJobs } = await import("@/lib/db");
    await aiOn();
    const f = await feed();
    const sent: string[] = [];
    let ranked = 0;
    const [base] = demoJobs(Date.now(), "o");
    const j = { ...base, title: "Unreal Engine 5 Level Designer, greybox to encounter scripting", skills: ["Unreal Engine", "Game Development Skills"] };
    await processResults(f, [j], { notifiers: notifiers(sent), hooks: { enrich: async () => null, rank: async () => { ranked++; return verdict; } } });
    expect(sent).toEqual([]);
    expect(ranked).toBe(0);
    const [stored] = await listJobs({ status: "all" });
    expect(stored.score.excluded).toMatch(/^Not your field — Game development/);
    expect(stored.score.total).toBe(0);
    expect(await listJobs({ status: "all", offProfile: "hide" })).toHaveLength(0);
    expect(await listJobs({ status: "all", offProfile: "only" })).toHaveLength(1);
  });

  it("excludes a job the AI calls off-profile", async () => {
    const { listJobs } = await import("@/lib/db");
    await aiOn();
    const f = await feed();
    const sent: string[] = [];
    const [j] = demoJobs(Date.now(), "a");
    const rank = async () => ({ ...verdict, offProfile: true, field: "sales role", fit: 5 });
    await processResults(f, [j], { notifiers: notifiers(sent), hooks: { enrich: async () => null, rank } });
    expect(sent).toEqual([]);
    expect((await listJobs({ status: "all" }))[0].score.excluded).toBe("Not your field — sales role");
  });

  it("holds jobs the AI couldn't rank and alerts them once it can, without reopening the job", async () => {
    const { listJobs } = await import("@/lib/db");
    const { retryAwaitingAi } = await import("@/lib/pipeline");
    const { BudgetError } = await import("@/lib/agents/llm");
    const { aiRankingState } = await import("@/lib/aiStatus");
    await aiOn();
    const f = await feed();
    const sent: string[] = [];
    const [j] = demoJobs(Date.now(), "h");
    const broke = { enrich: async () => null, rank: async () => { throw new BudgetError("Daily LLM budget of $5 reached"); } };
    const r = await processResults(f, [j], { notifiers: notifiers(sent), hooks: broke });
    expect(r.awaitingAi).toBe(1);
    expect(sent).toEqual([]);
    expect(await listJobs({ status: "awaiting_ai" })).toHaveLength(1);
    expect((await aiRankingState()).paused).toBe(true);

    const opened: string[] = [];
    const ok = { enrich: async (id: string) => { opened.push(id); return null; }, rank: async () => verdict };
    const r2 = await retryAwaitingAi({ notifiers: notifiers(sent), hooks: ok });
    expect(r2.ranked).toBe(1);
    expect(sent).toEqual([j.id]);
    expect(opened).toEqual([]);
    expect((await aiRankingState()).paused).toBe(false);
    expect(await listJobs({ status: "awaiting_ai" })).toHaveLength(0);
  });
});

describe("AI spend ledger", () => {
  beforeEach(() => resetDbForTests());
  it("reads several days in one query and feeds the usage report", async () => {
    const { kvSet } = await import("@/lib/db");
    const { ledgerDays } = await import("@/lib/agents/llm");
    const { usageReport } = await import("@/lib/usage");
    const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    await kvSet(`llm_ledger:${day(0)}`, { date: day(0), total: 1.5, calls: 3, byAgent: { ranking: 1.5 }, byModel: { "claude-sonnet-5-5": 1.5 } });
    await kvSet(`llm_ledger:${day(2)}`, { date: day(2), total: 0.5, calls: 1, byAgent: { proposal: 0.5 }, byModel: { "claude-opus-5-5": 0.5 } });
    const m = await ledgerDays([day(0), day(1), day(2)]);
    expect([...m.keys()].sort()).toEqual([day(0), day(2)].sort());
    const u = await usageReport({ offline: true });
    expect(u.claude.last7).toBe(2);
    expect(u.claude.byAgent30).toMatchObject({ ranking: 1.5, proposal: 0.5 });
  });
});

describe("auto proposal drafts", () => {
  beforeEach(() => resetDbForTests());
  it("queues only enriched, non-excluded jobs ranked at or above minRank that have no draft yet", async () => {
    const { createProposal, insertJob } = await import("@/lib/db");
    const { autoDraftCandidates } = await import("@/lib/autodraft");
    const f = await createSearch({ kind: "most_recent", name: "MR", enabled: true, skills: [], query: "", jobType: "ANY", minHourly: null, minBudget: null, experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [] });
    const jobs = demoJobs(Date.now(), "a");
    const e = { fetchedAt: "", description: "", connectsCost: null, connectsBalance: null, canApply: true, applied: false, status: "ACTIVE", subcategory: null, clientState: null, clientTimezone: null,
      record: { hires: 1, contractsTotal: 1, contractsActive: 0, totalSpent: 1, feedbackScore: 5, feedbackCount: 1, hours: 1, jobsPosted: 1, hireRatePercent: 100, openJobs: 1 },
      activity: { invitesSent: 0, interviewed: 0, hired: 0, offered: 0, unansweredInvites: 0 }, bidStats: null, workHistory: [], reviews: [], otherOpenJobs: [], screeningQuestions: [], preferredQualifications: null };
    const llm = { model: "m", category: "ai" as const, fit: 80, valuePotential: 70, summary: "", finalProduct: "", skillsWanted: [], reasons: [], redFlags: [] };
    const sc = (total: number, excluded: string | null = null, ai: typeof llm | null = llm) => ({ total, skills: 0, client: 0, budget: 0, competition: 0, excluded, matchedSkills: [], llm: ai });
    await insertJob(jobs[0], f.id, sc(80), Date.now(), { enrichment: e });             // ✓
    await insertJob(jobs[5], f.id, sc(85, null, null), Date.now(), { enrichment: e }); // ranked on rules alone - no draft
    await insertJob(jobs[1], f.id, sc(59), Date.now(), { enrichment: e });             // below minRank
    await insertJob(jobs[2], f.id, sc(90), Date.now(), {});                            // no client record
    await insertJob(jobs[3], f.id, sc(95, "India"), Date.now(), { enrichment: e });    // excluded
    await insertJob(jobs[4], f.id, sc(70), Date.now(), { enrichment: e });             // already drafted
    await createProposal({ jobId: jobs[4].id, jobTitle: "x", jobUrl: "u", status: "needs_loom", coverLetter: "c", research: null, answers: [], bid: 1, estimatedDuration: null, portfolioProjectIds: [], loomUrl: null, approvedAt: null, preview: null, previewId: null, submittedAt: null, originalDraft: "c", model: null, promptVersion: null });
    expect((await autoDraftCandidates()).map((j) => j.id)).toEqual([jobs[0].id]);
  });
});

describe("phone actions via the Supabase queue", () => {
  beforeEach(() => resetDbForTests());
  it("runs queued requests, keeps the SUBMIT gate, rejects unknown paths and elects one polling leader", async () => {
    const { query } = await import("@/lib/pg");
    const { runActionQueue } = await import("@/lib/actions");
    const { acquireLease, createProposal } = await import("@/lib/db");
    const p = await createProposal({ jobId: "j9", jobTitle: "t", jobUrl: "u", status: "needs_loom", coverLetter: "Hi\n\nOpener\n\nLoom: {{LOOM_URL}}", research: null, answers: [], bid: 100, estimatedDuration: null, portfolioProjectIds: [], loomUrl: null, approvedAt: null, preview: null, previewId: null, submittedAt: null, originalDraft: "x", model: null, promptVersion: null });
    await query("insert into public.action_requests(path, method, body) values($1, 'POST', $2::text::jsonb), ($3, 'POST', $4::text::jsonb), ('/api/nope', 'POST', null)",
      [`/api/proposals/${p.id}/loom`, JSON.stringify({ url: "https://www.loom.com/share/abc" }), `/api/proposals/${p.id}/submit`, JSON.stringify({ confirm: "yes" })]);
    await runActionQueue(5);
    for (let i = 0; i < 50; i++) {
      const left = await query<{ n: number }>("select count(*)::int n from public.action_requests where status in ('queued','running')");
      if (left[0].n === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const rows = await query<{ path: string; status: string; error: string | null; result: { status?: string } | null }>("select path, status, error, result from public.action_requests order by id");
    expect(rows[0]).toMatchObject({ status: "done" });
    expect(rows[0].result?.status).toBe("ready");
    expect(rows[1].status).toBe("error");
    expect(rows[1].error).toMatch(/SUBMIT/);
    expect(rows[2].error).toMatch(/Unknown action/);
    expect(await acquireLease("mac:1", 60_000)).toBe(true);
    expect(await acquireLease("home:2", 60_000)).toBe(false);
    expect(await acquireLease("mac:1", 60_000)).toBe(true);
    expect(await acquireLease("home:2", 60_000, Date.now() + 120_000)).toBe(true); // lease expired → takeover
  });
});
