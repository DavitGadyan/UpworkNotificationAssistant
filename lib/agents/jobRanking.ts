import * as z from "zod/v4";
import { getSettings, listFeedback, listProposalOutcomesSafe } from "../db";
import { icpDigest } from "../insights/icp";
import type { Job, JobEnrichment, LlmRanking, RuleResult } from "../types";
import { structured, untrusted } from "./llm";
import { profileDigest, relevantProjects } from "./profile";
import { repeatPoster, repeatPosterNote } from "../ranking/repeatPoster";
import { knownHireRate, knownHires } from "../ranking/rules";
import { getPrompt } from "./prompts";

/* JobRankingAssistant, stage B: the LLM judgement on fit and client value. */

const RankingSchema = z.object({
  category: z.enum(["ai", "saas", "automation", "devops", "mlops", "data", "marketing", "other"]),
  offProfile: z.boolean(),
  field: z.string(),
  fit: z.number().int().min(0).max(100),
  valuePotential: z.number().int().min(0).max(100),
  summary: z.string(),
  finalProduct: z.string(),
  skillsWanted: z.array(z.string()),
  reasons: z.array(z.string()),
  redFlags: z.array(z.string()),
  bigFish: z.string(),
  similarProject: z.boolean(),
  intent: z.object({
    hireLikelihood: z.number().int().min(0).max(100),
    archetype: z.enum(["ghost_poster", "unfunded", "template_collector", "mass_poster", "identity_fronting", "data_harvest", "stale", "repeat_no_hire", "genuine"]),
    evidence: z.array(z.string()),
  }),
});

export function jobBrief(job: Job, e: JobEnrichment | null | undefined): string {
  const c = job.client;
  const lines = [
    `Title: ${job.title}`,
    `Type: ${job.jobType}${job.jobType === "HOURLY" ? ` ${job.hourlyMin ?? "?"}-${job.hourlyMax ?? "?"} USD/hr` : ` budget ${job.amount ?? "not set"} USD`}`,
    `Experience: ${job.experienceLevel ?? "any"} · Duration: ${job.duration ?? "?"} · Workload: ${job.workload ?? "?"}`,
    `Category: ${job.category ?? "?"}${e?.subcategory ? " › " + e.subcategory : ""}`,
    `Skills: ${job.skills.join(", ")}`,
    `Proposals: ${job.proposalsTier ?? job.totalApplicants} · Posted: ${job.publishedAt}`,
    `Client: ${c.country ?? "?"}${e?.clientState ? ", " + e.clientState : ""} · payment ${c.paymentVerified === true ? "verified" : c.paymentVerified === false ? "NOT verified" : "unknown"} · spent $${Math.round(e?.record.totalSpent ?? c.totalSpent)} · hires ${knownHires(job, e) ?? "not in this listing (unknown - do not treat as 0)"} · jobs posted ${e?.record.jobsPosted ?? c.totalPostedJobs} · hire rate ${knownHireRate(job, e) ?? "?"}% · hours ${e?.record.hours ?? "?"} · rating ${e?.record.feedbackScore ?? c.totalFeedback} (${e?.record.feedbackCount ?? c.totalReviews} reviews) · open jobs ${e?.record.openJobs ?? "?"}`,
  ];
  if (e) {
    lines.push(`This job: invites ${e.activity.invitesSent}, interviewing ${e.activity.interviewed}, offers ${e.activity.offered}, hired ${e.activity.hired}`);
    if (e.screeningQuestions.length) lines.push(`Screening questions: ${e.screeningQuestions.join(" | ")}`);
  }
  lines.push("", untrusted("job_post", (e?.description || job.description).slice(0, 8000)));
  if (e?.workHistory.length) {
    lines.push("", untrusted("client_history", e.workHistory.map((w) => `${w.open ? "OPEN" : "CLOSED"} ${w.type ?? ""} "${w.title}" started ${w.started?.slice(0, 10) ?? "?"}${w.feedback != null ? ` feedback ${w.feedback}` : ""}`).join("\n")));
  }
  if (e?.reviews.length) {
    lines.push("", untrusted("client_reviews", e.reviews.map((r) => `[${r.score ?? "?"}★ ${r.title ?? ""}] ${r.comment}`).join("\n")));
  }
  return lines.join("\n");
}

/** Recent thumbs from David on alerts, plus what clients did with proposals he sent, as calibration examples. */
async function calibrationExamples(): Promise<string> {
  const fb = (await listFeedback("alert", 40)).filter((f) => f.data && (f.rating !== 0));
  const out = (await listProposalOutcomesSafe({ limit: 60 })).filter((o) => o.outcome === "win" || o.outcome === "loss_viewed" || o.outcome === "loss_unviewed").slice(0, 12);
  const parts: string[] = [];
  if (fb.length) {
    parts.push("\nDavid's recent feedback on alerts (learn his taste; +1 = good alert, -1 = bad alert):\n" + fb.slice(0, 15)
      .map((f) => `${f.rating > 0 ? "+1" : "-1"} "${String(f.data?.title ?? "").slice(0, 90)}" (score ${f.data?.score ?? "?"})${f.reason ? ` - ${f.reason}` : ""}`)
      .join("\n"));
  }
  if (out.length) {
    const label = { win: "client replied", loss_viewed: "client viewed, never replied", loss_unviewed: "client never opened it" } as Record<string, string>;
    parts.push("\nJobs David applied to and what the client did (the real outcome - weigh this above taste):\n" + out
      .map((o) => `${o.outcome === "win" ? "+1" : "-1"} "${o.jobTitle.slice(0, 90)}" (${[o.job?.field, o.job?.clientCountry, o.insights?.proposalsTotal != null ? `${o.insights.proposalsTotal} applicants` : null].filter(Boolean).join(", ")}) - ${label[o.outcome]}`)
      .join("\n"));
  }
  return parts.join("\n");
}

export async function rankWithLlm(job: Job, e: JobEnrichment | null | undefined, rules: RuleResult): Promise<LlmRanking> {
  const s = await getSettings();
  const prompt = await getPrompt("job_ranking");
  const rel = relevantProjects(`${job.title} ${job.skills.join(" ")} ${(e?.description || job.description).slice(0, 2000)}`, 6);
  const own = [
    s.profileFit.alsoMine.length ? `Also his work: ${s.profileFit.alsoMine.join(", ")}` : "",
    s.profileFit.never.length ? `Never his work (offProfile): ${s.profileFit.never.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const system = `${prompt.body}\n\n## David's profile\n${await profileDigest({ projects: true })}${own ? `\n\n## David's own field notes\n${own}` : ""}\n\n## Ideal Client Profile\n${await icpDigest()}`;
  const user = [
    jobBrief(job, e),
    "",
    `Rule engine: score ${rules.score}, category guess ${rules.category}, derived ${JSON.stringify(rules.derived)}`,
    rules.flags.length ? `Flags: ${rules.flags.map((f) => `[${f.severity}] ${f.label}`).join("; ")}` : "Flags: none",
    rules.passes.length ? `Positives: ${rules.passes.join("; ")}` : "",
    (() => { const r = repeatPoster(job, e); return r ? repeatPosterNote(r) : ""; })(),
    rel.length ? `Most similar portfolio projects by keywords: ${rel.map((p) => `${p.id} (${p.title})`).join(", ")}` : "",
    await calibrationExamples(),
  ].filter(Boolean).join("\n");
  const { data, model } = await structured({ model: s.llm.rankingModel, system, user, schema: RankingSchema, effort: "low", agent: "ranking", maxTokens: 4000, kind: "auto" });
  return { ...data, model, promptVersion: prompt.version };
}
