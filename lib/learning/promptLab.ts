import { DEFAULT_PROMPTS, getPrompt } from "../agents/prompts";
import { getPromptVersion, kvGet, kvSet, listFeedback, listPromptVersions, listProposalOutcomesSafe, listProposals, saveReport, upsertPromptStats, type PromptStatRow } from "../db";
import { isHire, isOffer } from "./outcomes";
import type { ProposalOutcome } from "../types";

/*
 * Prompt lab: which version of the proposal-writer prompt gets clients to reply, per scenario.
 *
 * Signal (RLHF-style reward): every proposal David sent is read back from Upwork (lib/learning/outcomes.ts).
 * Reward = 1 when the client replied / interviewed / hired; 0 for viewed-no-reply and never-viewed (both negative,
 * kept apart in the view rate). Each app-written proposal records the prompt version (the "arm") that wrote it;
 * proposals he wrote by hand on Upwork are the baseline.
 *
 * Scenario = David's field × client tier. Cells are small, so each cell's Beta posterior is shrunk toward that
 * version's overall reply rate; P(best) comes from sampling the posteriors.
 *
 * Choosing a prompt for a new draft (pickProposalPrompt):
 *   - A/B test off (default): the version David pinned for the scenario, else the active prompt - as before.
 *   - A/B test on: Thompson sampling among the versions David put in the test (each one he approved), so the
 *     better version gets most drafts while the others keep getting a share. A pinned version is used except
 *     for the `explore` share of drafts.
 * Nothing here creates or edits prompts, and every draft still needs his Loom, approval and SUBMIT.
 */

export const HAND = -1; // proposals written by hand on Upwork (baseline, never picked)
export const BUILT_IN = 0; // the built-in default prompt (no saved version)
const PRIOR_WEIGHT = 3; // pseudo-proposals of the version's overall rate a scenario cell starts from
const DRAWS = 4000;

export type ClientTier = "new client" | "proven client" | "big spender";
export interface Scenario { key: string; field: string; client: ClientTier; label: string }

export function clientTier(spent: number | null | undefined): ClientTier {
  return spent == null || spent < 1000 ? "new client" : spent < 20_000 ? "proven client" : "big spender";
}
export function scenarioOf(x: { field?: string | null; clientSpent?: number | null }): Scenario {
  const field = x.field || "Other";
  const client = clientTier(x.clientSpent);
  return { key: `${field}|${client}`, field, client, label: `${field} · ${client}` };
}

export interface LabConfig {
  /** A/B test on: drafts are spread over `arms` by Thompson sampling. */
  enabled: boolean;
  /** Prompt version ids in the test (0 = built-in default). */
  arms: number[];
  /** Scenario key or "field:<field>" → version David chose as best there. */
  pinned: Record<string, number>;
  /** Share of drafts that still test other versions when a scenario has a pinned one (A/B on only). */
  explore: number;
  updatedAt: string | null;
}
export const DEFAULT_LAB: LabConfig = { enabled: false, arms: [], pinned: {}, explore: 0.2, updatedAt: null };

export async function labConfig(): Promise<LabConfig> {
  return { ...DEFAULT_LAB, ...(await kvGet<LabConfig>("prompt_lab")) };
}

/** David's changes from Insights (web or phone). Only versions of the proposal prompt are accepted. */
export async function updateLabConfig(patch: { enabled?: boolean; arms?: number[]; explore?: number; pin?: { key: string; version: number | null } }): Promise<LabConfig> {
  const cur = await labConfig();
  const valid = new Set([BUILT_IN, ...(await listPromptVersions("proposal")).map((v) => v.id)]);
  const next: LabConfig = { ...cur, pinned: { ...cur.pinned }, updatedAt: new Date().toISOString() };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (Array.isArray(patch.arms)) next.arms = [...new Set(patch.arms.map(Number).filter((a) => valid.has(a)))].slice(0, 6);
  if (patch.explore != null && Number.isFinite(Number(patch.explore))) next.explore = Math.min(0.5, Math.max(0, Number(patch.explore)));
  if (patch.pin?.key) {
    const key = String(patch.pin.key).slice(0, 200);
    if (patch.pin.version == null) delete next.pinned[key];
    else if (valid.has(Number(patch.pin.version))) next.pinned[key] = Number(patch.pin.version);
    else throw new Error("That prompt version doesn't exist");
  }
  if (next.enabled && next.arms.length < 2) throw new Error("Pick at least two prompt versions to test");
  await kvSet("prompt_lab", next);
  await saveLabReport().catch(() => undefined);
  return next;
}

/** Called when David approves lessons: the new version joins the test next to the one it improves on. */
export async function addLabArms(...ids: number[]): Promise<void> {
  const cur = await labConfig();
  const arms = [...new Set([...cur.arms, ...ids])].slice(-6);
  await kvSet("prompt_lab", { ...cur, arms, updatedAt: new Date().toISOString() });
}

// ---------- statistics ----------

/** Small seeded PRNG so boards are stable between refreshes and testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/** Marsaglia-Tsang gamma sampler (shape > 0, scale 1). */
function gamma(k: number, rng: () => number): number {
  if (k < 1) return gamma(k + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = gauss(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function betaSample(a: number, b: number, rng: () => number): number {
  const x = gamma(a, rng), y = gamma(b, rng);
  return x / (x + y);
}

export interface ArmStat {
  arm: number;
  label: string;
  n: number;
  wins: number;
  viewed: number;
  offers: number;
  hires: number;
  replyRate: number; // %
  viewRate: number; // %
  offerRate: number; // %
  hireRate: number; // %
  /** Posterior mean reply rate, % (shrunk toward the version's overall rate). */
  expected: number;
  /** Chance this version is the best of the app's versions in this scenario (null for the hand-written baseline). */
  pBest: number | null;
  /** How much of the AI draft David kept on average before sending (%), when known. */
  kept: number | null;
}
export type Verdict = "best" | "leading" | "single" | "not_enough_data";
export interface Board { key: string; label: string; n: number; arms: ArmStat[]; best: number | null; verdict: Verdict; pinned: number | null }
export type LabPrompt = "proposal" | "job_ranking";
export interface VersionInfo { id: number; label: string; note: string | null; createdAt: string | null; active: boolean }
export interface VersionProposal { upworkProposalId: string; localProposalId: number | null; jobId: string; jobTitle: string; submittedAt: string; outcome: ProposalOutcome["outcome"]; status: string; viewed: boolean; scenario: string; kept: number | null; rank: number | null; connects: number | null }
export interface LabBoard {
  builtAt: string;
  prompt: LabPrompt;
  config: LabConfig;
  versions: VersionInfo[];
  overall: Board;
  byField: Board[];
  byScenario: Board[];
  /** Ranker only: reply rate by the rank the job had when he applied. */
  byRank?: Board[];
  decided: number;
  /** Every proposal (decided or not) per arm, newest first - for the per-version pages. */
  proposals: Record<string, VersionProposal[]>;
  funnel: { sent: number; decided: number; viewed: number; replied: number; offers: number; hires: number; connects: number };
}

const DECIDED = new Set(["win", "loss_viewed", "loss_unviewed"]);
type Row = { arm: number; win: boolean; viewed: boolean; offer: boolean; hire: boolean; scenario: Scenario; kept: number | null; rank: number | null };

export const armLabel = (arm: number, prompt: LabPrompt = "proposal") =>
  arm === HAND ? (prompt === "proposal" ? "Written by hand" : "Not ranked by the AI") : arm === BUILT_IN ? "Built-in prompt" : `${prompt === "job_ranking" ? "Ranker" : "Prompt"} v${arm}`;
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function board(key: string, label: string, rows: Row[], global: Map<number, { a: number; b: number }>, pinned: number | null, rng: () => number, shrink: boolean, prompt: LabPrompt): Board {
  const byArm = new Map<number, Row[]>();
  for (const r of rows) byArm.set(r.arm, [...(byArm.get(r.arm) ?? []), r]);
  const post = new Map<number, { a: number; b: number }>();
  const arms: ArmStat[] = [...byArm.entries()].map(([arm, xs]) => {
    const wins = xs.filter((x) => x.win).length, viewed = xs.filter((x) => x.viewed || x.win).length;
    const offers = xs.filter((x) => x.offer).length, hires = xs.filter((x) => x.hire).length;
    const g = global.get(arm) ?? { a: 1, b: 1 };
    const p = g.a / (g.a + g.b);
    const prior = shrink ? { a: 1 + PRIOR_WEIGHT * p, b: 1 + PRIOR_WEIGHT * (1 - p) } : { a: 1, b: 1 };
    const ab = { a: prior.a + wins, b: prior.b + xs.length - wins };
    post.set(arm, ab);
    const k = xs.map((x) => x.kept).filter((v): v is number => v != null);
    return {
      arm, label: armLabel(arm, prompt), n: xs.length, wins, viewed, offers, hires,
      replyRate: pctOf(wins, xs.length), viewRate: pctOf(viewed, xs.length), offerRate: pctOf(offers, xs.length), hireRate: pctOf(hires, xs.length),
      expected: Math.round((ab.a / (ab.a + ab.b)) * 100), pBest: null,
      kept: k.length ? Math.round((k.reduce((s, v) => s + v, 0) / k.length) * 100) : null,
    };
  });
  const app = arms.filter((a) => a.arm !== HAND);
  if (app.length) {
    const winsCount = new Map<number, number>(app.map((a) => [a.arm, 0]));
    for (let i = 0; i < DRAWS; i++) {
      let best = app[0].arm, bv = -1;
      for (const a of app) { const ab = post.get(a.arm)!; const v = betaSample(ab.a, ab.b, rng); if (v > bv) { bv = v; best = a.arm; } }
      winsCount.set(best, winsCount.get(best)! + 1);
    }
    for (const a of app) a.pBest = Math.round((winsCount.get(a.arm)! / DRAWS) * 100);
  }
  arms.sort((x, y) => (y.pBest ?? -1) - (x.pBest ?? -1) || y.expected - x.expected);
  const top = app.length ? app.reduce((m, a) => ((a.pBest ?? 0) > (m.pBest ?? 0) ? a : m)) : null;
  const tried = app.filter((a) => a.n >= 3).length;
  const verdict: Verdict = !top ? "not_enough_data"
    : tried < 2 ? (top.n >= 5 ? "single" : "not_enough_data")
    : (top.pBest ?? 0) >= 80 && top.n >= 5 ? "best"
    : (top.pBest ?? 0) >= 60 && top.n >= 3 ? "leading" : "not_enough_data";
  return { key, label, n: rows.length, arms, best: verdict === "not_enough_data" ? null : top?.arm ?? null, verdict, pinned };
}

const rankBand = (r: number | null) => (r == null ? "not ranked" : r >= 80 ? "rank 80+" : r >= 70 ? "rank 70-79" : r >= 60 ? "rank 60-69" : "rank < 60");

/**
 * Pure: the leaderboard from outcomes. Writer ("proposal"): the arm is the prompt version that wrote the local
 * draft, proposals written on Upwork are the hand baseline. Ranker ("job_ranking"): the arm is the ranker version
 * that judged the job; jobs the AI never ranked are the baseline.
 */
export function buildBoard(
  outcomes: ProposalOutcome[],
  proposalVersion: Map<number, number | null>,
  config: LabConfig,
  opts: { prompt?: LabPrompt; kept?: Map<number, number>; versions?: VersionInfo[]; seed?: number; now?: number } = {},
): LabBoard {
  const prompt = opts.prompt ?? "proposal";
  const rng = mulberry32(opts.seed ?? 7);
  const armOf = (o: ProposalOutcome) => prompt === "job_ranking"
    ? (o.job?.rankerVersion === undefined ? HAND : o.job.rankerVersion ?? BUILT_IN)
    : o.localProposalId == null || !proposalVersion.has(o.localProposalId) ? HAND : proposalVersion.get(o.localProposalId) ?? BUILT_IN;
  const keptOf = (o: ProposalOutcome) => (o.localProposalId != null ? opts.kept?.get(o.localProposalId) ?? null : null);
  const live = outcomes.filter((o) => o.outcome !== "void");
  const rows: Row[] = live.filter((o) => DECIDED.has(o.outcome)).map((o) => ({
    arm: armOf(o),
    win: o.outcome === "win",
    viewed: o.viewed || o.outcome === "win",
    offer: isOffer(o),
    hire: isHire(o),
    scenario: scenarioOf({ field: o.job?.field, clientSpent: o.job?.clientSpent }),
    kept: keptOf(o),
    rank: o.job?.rank ?? null,
  }));
  const global = new Map<number, { a: number; b: number }>();
  for (const r of rows) { const g = global.get(r.arm) ?? { a: 1, b: 1 }; global.set(r.arm, r.win ? { ...g, a: g.a + 1 } : { ...g, b: g.b + 1 }); }
  const group = (f: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(f(r), [...(m.get(f(r)) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  const proposals: Record<string, VersionProposal[]> = {};
  for (const o of live) {
    const arm = String(armOf(o));
    (proposals[arm] ??= []).push({
      upworkProposalId: o.upworkProposalId, localProposalId: o.localProposalId, jobId: o.jobId, jobTitle: o.jobTitle, submittedAt: o.submittedAt,
      outcome: o.outcome, status: o.status, viewed: o.viewed, scenario: scenarioOf({ field: o.job?.field, clientSpent: o.job?.clientSpent }).label,
      kept: keptOf(o) != null ? Math.round(keptOf(o)! * 100) : null, rank: o.job?.rank ?? null, connects: o.connectsBid,
    });
  }
  for (const k of Object.keys(proposals)) proposals[k].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return {
    builtAt: new Date(opts.now ?? Date.now()).toISOString(),
    prompt,
    config,
    versions: opts.versions ?? [],
    decided: rows.length,
    overall: board("all", "All proposals", rows, global, null, rng, false, prompt),
    byField: group((r) => r.scenario.field).map(([f, xs]) => board(`field:${f}`, f, xs, global, config.pinned[`field:${f}`] ?? null, rng, true, prompt)),
    byScenario: group((r) => r.scenario.key).map(([k, xs]) => board(k, xs[0].scenario.label, xs, global, config.pinned[k] ?? null, rng, true, prompt)),
    ...(prompt === "job_ranking" ? { byRank: group((r) => rankBand(r.rank)).map(([k, xs]) => board(`rank:${k}`, k, xs, global, null, rng, true, prompt)) } : {}),
    proposals,
    funnel: {
      sent: live.length, decided: rows.length, viewed: rows.filter((r) => r.viewed).length, replied: rows.filter((r) => r.win).length,
      offers: rows.filter((r) => r.offer).length, hires: rows.filter((r) => r.hire).length,
      connects: live.reduce((s, o) => s + (o.connectsBid ?? 0), 0),
    },
  };
}

async function inputs() {
  const [outcomes, proposals, config, drafts] = await Promise.all([
    listProposalOutcomesSafe({ limit: 1000 }), listProposals(), labConfig(), listFeedback("draft", 1000).catch(() => []),
  ]);
  const proposalVersion = new Map(proposals.map((p) => [p.id, p.promptVersion]));
  const kept = new Map<number, number>();
  for (const f of drafts) { const s = Number((f.data as { similarity?: number } | null)?.similarity); if (Number.isFinite(s) && !kept.has(Number(f.refId))) kept.set(Number(f.refId), s); }
  return { outcomes, proposalVersion, config, kept };
}

async function versionsOf(prompt: LabPrompt): Promise<VersionInfo[]> {
  const vs = await listPromptVersions(prompt);
  return [
    ...vs.map((v) => ({ id: v.id, label: armLabel(v.id, prompt), note: v.note, createdAt: v.createdAt, active: v.active })),
    { id: BUILT_IN, label: armLabel(BUILT_IN, prompt), note: "the default prompt in code", createdAt: null, active: !vs.some((v) => v.active) },
  ];
}

export async function labBoard(prompt: LabPrompt = "proposal"): Promise<LabBoard> {
  const { outcomes, proposalVersion, config, kept } = await inputs();
  return buildBoard(outcomes, proposalVersion, config, { prompt, kept, versions: await versionsOf(prompt) });
}

/** Saved as reports so the phone app (Supabase only) can show the same boards. */
export async function saveLabReport(): Promise<LabBoard> {
  const b = await labBoard("proposal");
  await saveReport("prompt_lab", b);
  await saveReport("ranker_lab", await labBoard("job_ranking"));
  return b;
}

/** Pure: today's prompt_stats rows (one per prompt × version × scenario, plus scenario "all"). */
export function statsRows(b: LabBoard, day: string, now = Date.now()): PromptStatRow[] {
  const out: PromptStatRow[] = [];
  const add = (scenario: string, a: ArmStat) => out.push({
    day, prompt: b.prompt, version: a.arm, scenario, sent: a.n, viewed: a.viewed, replied: a.wins, offers: a.offers, hires: a.hires,
    kept: a.kept == null ? null : a.kept / 100, updatedAt: now,
  });
  for (const a of b.overall.arms) add("all", a);
  for (const s of b.byScenario) for (const a of s.arms) add(s.key, a);
  return out;
}

/** Daily trend snapshot for the analytics charts (no Upwork calls; same day is overwritten). */
export async function snapshotPromptStats(now = Date.now()): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  const rows = [...statsRows(await labBoard("proposal"), day, now), ...statsRows(await labBoard("job_ranking"), day, now)];
  await upsertPromptStats(rows).catch((e) => { if (!/prompt_stats" does not exist/.test(String((e as Error).message))) throw e; });
  return rows.length;
}

// ---------- choosing the prompt for a new draft ----------

export interface PromptPick { body: string; version: number | null; scenario: Scenario; reason: string }

export async function promptBody(version: number | null): Promise<string | null> {
  if (version == null || version === BUILT_IN) return DEFAULT_PROMPTS.proposal;
  return (await getPromptVersion(version))?.body ?? null;
}

/** Pure part of the choice (tested): which arm, and why. null = use the active prompt. */
export function chooseArm(config: LabConfig, scenario: Scenario, b: Pick<LabBoard, "byScenario" | "byField" | "overall"> | null, rng: () => number = Math.random): { arm: number | null; reason: string } {
  const pinned = config.pinned[scenario.key] ?? config.pinned[`field:${scenario.field}`] ?? null;
  const testing = config.enabled && config.arms.length >= 2;
  if (testing && (pinned == null || rng() < config.explore)) {
    // Thompson sampling: draw each arm's reply rate from its posterior for this scenario (or field, or overall).
    const cell = b?.byScenario.find((x) => x.key === scenario.key) ?? null;
    const field = b?.byField.find((x) => x.key === `field:${scenario.field}`) ?? null;
    let best = config.arms[0], bv = -1;
    for (const arm of config.arms) {
      const s = cell?.arms.find((a) => a.arm === arm) ?? field?.arms.find((a) => a.arm === arm) ?? b?.overall.arms.find((a) => a.arm === arm);
      const v = betaSample(1 + (s?.wins ?? 0), 1 + (s ? s.n - s.wins : 0), rng);
      if (v > bv) { bv = v; best = arm; }
    }
    return { arm: best, reason: `A/B test (${scenario.label})` };
  }
  if (pinned != null) return { arm: pinned, reason: `best for ${scenario.label} (chosen by David)` };
  return { arm: null, reason: "active prompt" };
}

export async function pickProposalPrompt(x: { field?: string | null; clientSpent?: number | null }): Promise<PromptPick> {
  const scenario = scenarioOf(x);
  const config = await labConfig();
  const needsBoard = config.enabled && config.arms.length >= 2;
  const { arm, reason } = chooseArm(config, scenario, needsBoard ? await labBoard() : null);
  if (arm != null) {
    const body = await promptBody(arm);
    if (body) return { body, version: arm === BUILT_IN ? null : arm, scenario, reason };
  }
  const p = await getPrompt("proposal");
  return { body: p.body, version: p.version, scenario, reason: arm != null ? "active prompt (chosen version was deleted)" : reason };
}
