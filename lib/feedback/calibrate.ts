import { getSettings, latestReport, listFeedback, saveReport, saveSettings } from "../db";

/*
 * The preference loop ("RLHF-lite"). No model is fine-tuned; instead David's signals tune the system:
 *   1. 👍/👎 on Telegram alerts (and dismiss reasons) → logistic regression over the ranking features
 *      (rules score, LLM fit, each red-flag code) → proposed blend weight, flag penalties and alert
 *      threshold, shown on Insights for David to apply or ignore;
 *   2. how much he edits drafts (lib/proposals/submit.ts) and which proposals he actually sends →
 *      few-shot style examples for the ProposalDraftAssistant (lib/agents/proposal.ts);
 *   3. recent thumbs are fed to the JobRankingAssistant prompt as calibration examples.
 */

export interface Calibration {
  builtAt: string;
  samples: number;
  positives: number;
  ok: boolean;
  message: string;
  coefficients: Record<string, number>;
  proposed: { weights: { rules: number; llm: number }; telegramMin: number; penalties: Record<string, number> } | null;
  accuracy: number | null;
}

type Sample = { x: Record<string, number>; y: number };

function features(d: Record<string, unknown>): Record<string, number> {
  const x: Record<string, number> = {
    bias: 1,
    rules: Number(d.rules ?? d.score ?? 0) / 100,
    llmFit: d.llmFit != null ? Number(d.llmFit) / 100 : 0.5,
  };
  for (const f of (d.flags as string[] | undefined) ?? []) x[`flag:${f}`] = 1;
  if (d.category) x[`cat:${d.category}`] = 1;
  return x;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function fitLogistic(samples: Sample[], iters = 2000, lr = 0.5, l2 = 0.01): Record<string, number> {
  const w: Record<string, number> = {};
  for (const s of samples) for (const k of Object.keys(s.x)) w[k] ??= 0;
  for (let it = 0; it < iters; it++) {
    const grad: Record<string, number> = {};
    for (const s of samples) {
      const p = sigmoid(Object.entries(s.x).reduce((a, [k, v]) => a + (w[k] ?? 0) * v, 0));
      for (const [k, v] of Object.entries(s.x)) grad[k] = (grad[k] ?? 0) + (p - s.y) * v;
    }
    for (const k of Object.keys(w)) w[k] -= lr * ((grad[k] ?? 0) / samples.length + (k === "bias" ? 0 : l2 * w[k]));
  }
  return w;
}

export async function calibrate(minSamples = 20): Promise<Calibration> {
  const fb = (await listFeedback("alert", 2000)).filter((f) => f.data && f.rating !== 0);
  const samples: Sample[] = fb.map((f) => ({ x: features(f.data!), y: f.rating > 0 ? 1 : 0 }));
  const positives = samples.filter((s) => s.y === 1).length;
  const base: Calibration = { builtAt: new Date().toISOString(), samples: samples.length, positives, ok: false, message: "", coefficients: {}, proposed: null, accuracy: null };
  if (samples.length < minSamples || positives < 3 || positives > samples.length - 3) {
    const r = { ...base, message: `Need at least ${minSamples} rated alerts with both 👍 and 👎 (have ${samples.length}, ${positives} 👍).` };
    await saveReport("calibration", r);
    return r;
  }
  const w = fitLogistic(samples);
  const acc = samples.filter((s) => (sigmoid(Object.entries(s.x).reduce((a, [k, v]) => a + (w[k] ?? 0) * v, 0)) >= 0.5 ? 1 : 0) === s.y).length / samples.length;
  const cur = await getSettings();
  const r = Math.max(0.05, w.rules ?? 0), l = Math.max(0.05, w.llmFit ?? 0);
  const rulesW = Math.round((r / (r + l)) * 100) / 100;
  // Score where P(👍) = 0.5 along the blended axis, as the proposed alert threshold.
  const slope = (w.rules ?? 0) * rulesW + (w.llmFit ?? 0) * (1 - rulesW);
  const thr = slope > 0 ? Math.round(Math.min(95, Math.max(40, (-(w.bias ?? 0) / slope) * 100))) : cur.telegramMin;
  const penalties: Record<string, number> = {};
  for (const [k, v] of Object.entries(w)) if (k.startsWith("flag:") && v < 0) penalties[k.slice(5)] = Math.round(Math.min(40, -v * 10));
  const out: Calibration = {
    ...base, ok: true, accuracy: Math.round(acc * 100) / 100,
    message: `Fitted on ${samples.length} rated alerts (${Math.round(acc * 100)}% agreement with your ratings).`,
    coefficients: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    proposed: { weights: { rules: rulesW, llm: Math.round((1 - rulesW) * 100) / 100 }, telegramMin: thr, penalties },
  };
  await saveReport("calibration", out);
  return out;
}

/** Apply the latest proposal (David clicked Apply on Insights). Penalties are informational for now. */
export async function applyCalibration(): Promise<boolean> {
  const c = (await latestReport<Calibration>("calibration"))?.data;
  if (!c?.ok || !c.proposed) return false;
  const s = await getSettings();
  await saveSettings({ telegramMin: c.proposed.telegramMin, rules: { ...s.rules, weights: c.proposed.weights } });
  return true;
}
