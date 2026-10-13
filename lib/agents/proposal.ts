import * as z from "zod/v4";
import { createProposal, getJob, getProposal, getSettings, kvGet, kvSet, listProposals, updateJobData, updateProposal } from "../db";
import { jobUrl } from "../format";
import type { Proposal } from "../types";
import { callTool } from "../upwork/mcp/client";
import { mergeDetail } from "../upwork/mcp/jobs";
import { activeSource, fetchDetail } from "../upwork/source";
import { jobBrief } from "./jobRanking";
import { structured } from "./llm";
import { culturalProfile } from "./closer";
import { profileDigest, relevantProjects } from "./profile";
import { getPrompt } from "./prompts";

/*
 * ProposalDraftAssistant. Research → "big fish" diagnosis → draft in David's template.
 * Output is always a DRAFT with a {{LOOM_URL}} placeholder. Submission is a separate, gated flow
 * (lib/proposals/submit.ts): Loom link attached → David approves → Upwork preview → second tap.
 */

export const LOOM_PLACEHOLDER = "{{LOOM_URL}}";

const DraftSchema = z.object({
  research: z.object({
    contactName: z.string().nullable(),
    contactSource: z.string().nullable(),
    contactRole: z.enum(["hr_recruiter", "technical_lead", "founder_exec", "marketing_seo", "operations", "investor_shareholder", "unknown"]),
    roleEvidence: z.string().nullable(),
    company: z.string().nullable(),
    companyConfidence: z.enum(["confirmed", "likely", "unknown"]),
    companySignals: z.array(z.string()),
    bigFish: z.string(),
    hiddenProblems: z.array(z.string()),
    whyNotSolvedInternally: z.string(),
    assumptions: z.array(z.string()),
  }),
  coverLetter: z.string(),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  bid: z.number().nullable(),
  bidType: z.enum(["fixed", "hourly"]),
  estimatedDuration: z.enum(["less_than_1_month", "1_to_3_months", "3_to_6_months", "more_than_6_months"]).nullable(),
  portfolioProjectIds: z.array(z.string()),
  rationale: z.string(),
});

interface Highlights { fetchedAt: number; certificates: { id: string; name: string }[]; portfolio_projects: { id: string; title: string }[] }

/** Upwork portfolio items that can be attached to a proposal (cached for a day). */
export async function highlights(): Promise<Highlights | null> {
  const cached = await kvGet<Highlights>("upwork_highlights");
  if (cached && Date.now() - cached.fetchedAt < 864e5) return cached;
  if (await activeSource() !== "mcp") return cached;
  try {
    const r = await callTool<Omit<Highlights, "fetchedAt">>("get_profile", "list_highlights");
    const h = { fetchedAt: Date.now(), certificates: r.certificates ?? [], portfolio_projects: r.portfolio_projects ?? [] };
    await kvSet("upwork_highlights", h);
    return h;
  } catch { return cached; }
}

/** Distilled from knowledge_base/closer_playbook.md for the very first message. */
const FIRST_CONTACT_RULES = [
  "- Teach, don't pitch: lead with an insight about THEIR problem they may not have framed yet (Challenger).",
  "- Tailor to the reader's role and goals; one idea per sentence, no filler (Challenger).",
  "- Take control gently: propose one clear next step, never several options (Closing).",
  "- Value before price: the budget line follows the deliverables and is framed by outcome (B2B Negotiation).",
  "- Ask one easy, specific question that shows understanding and invites a reply (Closing).",
  "- No pressure, no fake urgency, no invented proof; everything stays on Upwork.",
].join("\n");

export const MAX_COVER_CHARS = 900;

/** Structure problems the draft must not have: too long, Loom not right after the opener, extra sections. */
export function structureProblems(cover: string): string[] {
  const problems: string[] = [];
  if (cover.length > MAX_COVER_CHARS) problems.push(`${cover.length} characters - must be ≤ ${MAX_COVER_CHARS}`);
  const paras = cover.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const loomAt = paras.findIndex((p) => /^loom\b/i.test(p));
  if (loomAt === -1) problems.push("missing the Loom line");
  else if (loomAt !== 2) problems.push("the Loom line must be the third block: greeting, opener, Loom");
  if (/\bP\.?S\.?\b/.test(cover)) problems.push("remove the P.S.");
  if (/^proof\s*:/im.test(cover)) problems.push("no separate proof paragraph - fold proof into the opener");
  if (!/^deliverables\s*:/im.test(cover)) problems.push("missing the Deliverables block");
  if (!/^budget\s*:/im.test(cover)) problems.push("missing the Budget line");
  return problems;
}

const RewriteSchema = z.object({ coverLetter: z.string() });

/** One corrective pass when the draft breaks the structure or the length cap. */
async function enforceStructure(cover: string, model: string, system: string, agent: string): Promise<string> {
  let out = cover.includes(LOOM_PLACEHOLDER) || /^loom\s*:/im.test(cover) ? cover : cover.replace(/\n\s*\n/, `\n\nLoom: ${LOOM_PLACEHOLDER}\n\n`);
  const problems = structureProblems(out);
  if (!problems.length) return out;
  const { data } = await structured({
    model, system, schema: RewriteSchema, effort: "medium", agent, maxTokens: 4000,
    user: `Rewrite this proposal so it follows the required structure exactly and is at most ${MAX_COVER_CHARS} characters. Fix: ${problems.join("; ")}. Keep the meaning, the client's name, the Loom line (${LOOM_PLACEHOLDER} or the existing link) and the budget. Cut words, not substance.\n\n${out}`,
  });
  out = data.coverLetter;
  return out;
}

/** "Rewrite shorter" for an existing draft: same facts, new structure/length, Loom link kept. */
export async function rewriteProposal(id: number): Promise<Proposal> {
  const p = await getProposal(id);
  if (!p) throw new Error("Proposal not found");
  if (p.status === "submitted") throw new Error("Already submitted");
  const s = await getSettings();
  const prompt = await getPrompt("proposal");
  const job = await getJob(p.jobId);
  const culture = culturalProfile(job?.client.country);
  const system = [prompt.body, "## First-contact sales rules", FIRST_CONTACT_RULES, `## Cultural profile - ${culture.country} (hypothesis)`, culture.profile.summary].join("\n\n");
  const role = p.research?.contactRole ? `Reader role: ${p.research.contactRole}.` : "";
  const { data } = await structured({
    model: s.llm.writerModel, system, schema: RewriteSchema, effort: "medium", agent: "proposal", maxTokens: 4000,
    user: `${role} Rewrite this proposal 2-3x shorter in the exact required structure (greeting, opener with the big fish and proof folded in, Loom line, Deliverables, Budget, one open question, "David"). At most ${MAX_COVER_CHARS} characters. Keep the client's name, the Loom line as written and the budget figure.\n\n${p.coverLetter}`,
  });
  const cover = data.coverLetter.length > MAX_COVER_CHARS ? await enforceStructure(data.coverLetter, s.llm.writerModel, system, "proposal") : data.coverLetter;
  const status = p.status === "approved" || p.status === "previewed" ? "ready" : p.status;
  return (await updateProposal(id, { coverLetter: cover, status, approvedAt: status === "ready" ? null : p.approvedAt, previewId: null }))!;
}

/** Past drafts David approved and submitted (after his edits) - the best style examples. */
async function styleExamples(): Promise<string> {
  const done = (await listProposals({ status: "submitted" })).slice(0, 3);
  if (!done.length) return "";
  return "\n\nProposals David actually sent recently (match the voice only - the structure and length rules above always win; never reuse their facts):\n" +
    done.map((p, i) => `--- example ${i + 1}: ${p.jobTitle}\n${p.coverLetter.slice(0, 1500)}`).join("\n");
}

export async function draftProposal(jobId: string, opts: { webSearch?: boolean; guidance?: string; agent?: string } = {}): Promise<Proposal> {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found (it may have expired from the cache)");
  let enrichment = job.enrichment ?? null;
  if (!enrichment) {
    const d = await fetchDetail(jobId).catch(() => null);
    if (d) {
      enrichment = d.enrichment;
      const { searchId: _s, searchName: _n, score: _sc, status: _st, fetchedAt: _f, enrichment: _e, feeds: _fd, ...base } = job;
      await updateJobData(jobId, { job: mergeDetail(base, d.patch, d.enrichment), enrichment });
    }
  }
  const s = await getSettings();
  const prompt = await getPrompt("proposal");
  const h = await highlights();
  const rel = relevantProjects(`${job.title} ${job.skills.join(" ")} ${(enrichment?.description || job.description).slice(0, 3000)}`, 5);
  const culture = culturalProfile(job.client.country);
  const system = [
    prompt.body,
    "## First-contact sales rules (from David's sales playbook)",
    FIRST_CONTACT_RULES,
    `## Cultural profile - ${culture.country} (hypothesis; the person's own wording overrides it)`,
    `${culture.profile.summary}\nDo: ${culture.profile.do.join("; ")}\nAvoid: ${culture.profile.avoid.join("; ")}`,
    "## David's profile and portfolio (the only facts you may claim)",
    await profileDigest({ projects: true }),
    await styleExamples(),
  ].join("\n\n");
  const user = [
    jobBrief(job, enrichment),
    "",
    job.score.llm ? `Ranking notes: ${job.score.llm.summary} Big fish guess: ${job.score.llm.bigFish ?? "-"}` : "",
    rel.length ? `Most relevant portfolio projects: ${rel.map((p) => `${p.id} "${p.title}" - ${p.summary} Outcomes: ${p.outcomes.slice(0, 2).join("; ")}`).join(" | ")}` : "",
    h?.portfolio_projects.length ? `Upwork portfolio items attachable to the proposal (use these ids in portfolioProjectIds): ${h.portfolio_projects.map((p) => `${p.id}="${p.title}"`).join(", ")}` : "No attachable Upwork portfolio items available - return an empty portfolioProjectIds.",
    enrichment?.screeningQuestions.length ? `Screening questions to answer: ${enrichment.screeningQuestions.map((q, i) => `${i + 1}. ${q}`).join(" ")}` : "No screening questions.",
    enrichment?.bidStats ? `Other bids so far (unit unspecified): avg ${enrichment.bidStats.avg}, min ${enrichment.bidStats.min}, max ${enrichment.bidStats.max}` : "",
    opts.guidance ? `David's guidance for this draft: ${opts.guidance}` : "",
    `Keep the literal placeholder ${LOOM_PLACEHOLDER} on the "Loom:" line right after the opener. 600-900 characters total.`,
  ].filter(Boolean).join("\n");

  const { data, model } = await structured({
    model: s.llm.writerModel, system, user, schema: DraftSchema, effort: "high", agent: opts.agent ?? "proposal", maxTokens: 16000,
    ...(opts.webSearch !== false ? { webSearch: { maxUses: 3 } } : {}),
  });

  const cover = await enforceStructure(data.coverLetter, s.llm.writerModel, system, opts.agent ?? "proposal");
  return await createProposal({
    jobId,
    jobTitle: job.title,
    jobUrl: jobUrl(job.ciphertext),
    status: "needs_loom",
    coverLetter: cover,
    research: data.research,
    answers: data.answers,
    bid: data.bid,
    estimatedDuration: data.estimatedDuration,
    portfolioProjectIds: data.portfolioProjectIds.filter((id) => h?.portfolio_projects.some((p) => p.id === id)),
    loomUrl: null,
    approvedAt: null,
    preview: { rationale: data.rationale, bidType: data.bidType },
    previewId: null,
    submittedAt: null,
    originalDraft: cover,
    model,
    promptVersion: prompt.version,
  });
}
