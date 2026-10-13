import { config } from "../config";
import { budgetLabel, compactMoney } from "../format";
import type { Job, ScoreBreakdown } from "../types";
import type { SendResult } from "./telegram";

/*
 * Outbound call through Retell (POST /v2/create-phone-call). The agent's prompt reads the dynamic
 * variables below, e.g. "New {{score}} percent match: {{job_title}}, {{budget}}. Client: {{client_summary}}."
 * Only a short summary goes to Retell, and only for your own phone number.
 */
export function callVariables(job: Job, score: ScoreBreakdown): Record<string, string> {
  const c = job.client;
  return {
    job_title: job.title.slice(0, 120),
    budget: budgetLabel(job),
    score: String(score.total),
    proposals: String(job.totalApplicants),
    client_summary: [
      c.paymentVerified ? "payment verified" : null,
      `${compactMoney(c.totalSpent)} spent`,
      c.totalReviews ? `rated ${c.totalFeedback.toFixed(1)}` : "no reviews yet",
      c.country ? `in ${c.country}` : null,
    ].filter(Boolean).join(", "),
    matched_skills: score.matchedSkills.slice(0, 4).join(", "),
  };
}

export async function placeCall(vars: Record<string, string>, meta: Record<string, string> = {}): Promise<SendResult> {
  const r = config.retell;
  if (!r.apiKey || !r.fromNumber || !r.toNumber) return { ok: false, detail: "Retell not configured" };
  try {
    const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: { Authorization: `Bearer ${r.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from_number: r.fromNumber,
        to_number: r.toNumber,
        ...(r.agentId ? { override_agent_id: r.agentId } : {}),
        retell_llm_dynamic_variables: vars,
        metadata: meta,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { call_id?: string; message?: string; error_message?: string };
    return res.ok ? { ok: true, detail: `call ${json.call_id ?? ""}`.trim() } : { ok: false, detail: json.error_message ?? json.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

export const callAboutJob = (job: Job, score: ScoreBreakdown) => placeCall(callVariables(job, score), { job_id: job.id });
