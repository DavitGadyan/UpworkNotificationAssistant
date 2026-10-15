import { draftProposal } from "./agents/proposal";
import { llmReady } from "./agents/llm";
import { config } from "./config";
import { getSettings, kvGet, kvSet, listJobs, listProposals, setJobStatus } from "./db";
import { jobUrl } from "./format";
import { sendPush } from "./notify/push";
import { sendText } from "./notify/telegram";
import { normTag, THREE_D_TAG } from "./ranking/fields";
import { repeatPoster } from "./ranking/repeatPoster";
import type { CachedJob } from "./types";

/**
 * Only tight AI fits are drafted automatically (David, 2026-10-15): the AI ranker's fit must be at least
 * AUTO_DRAFT_MIN_FIT, and 3D work (Blender, 3ds Max, configurators...) is never auto-drafted - it still ranks
 * and alerts, and David can draft it with one tap.
 */
export const AUTO_DRAFT_MIN_FIT = 75;
const THREE_D_TITLE = /\b(3d|blender|cinema ?4d|c4d|3ds ?max|zbrush|keyshot|maya)\b/i;
export const isThreeD = (j: Pick<CachedJob, "title" | "skills">) => THREE_D_TITLE.test(j.title) || j.skills.some((t) => THREE_D_TAG.test(normTag(t)));
/** Repeat posters (same job again and again, same freelancers rehired) never get an automatic draft either. */
export const tightAiFit = (j: CachedJob) => (j.score.llm?.fit ?? 0) >= AUTO_DRAFT_MIN_FIT && j.score.profileFit?.verdict !== "off" && !isThreeD(j) && !repeatPoster(j, j.enrichment);

/*
 * Auto proposal drafts: every job ranked ≥ autoDraft.minRank (default 60) gets an Opus draft without a tap,
 * at most `perCycle` per worker cycle and `dailyCap` per day. Drafts wait as "needs_loom" - nothing is ever
 * submitted; the Loom → approve → preview → SUBMIT gate is unchanged. Only jobs with a loaded client record,
 * an AI ranking verdict (never on rules alone) and no existing draft qualify. Drafts count against the daily
 * AI budget like the ranker (kind "auto"), so they can't run it dry unnoticed. Only tight AI fits qualify (below).
 */

const dayKey = () => `autodraft:${new Date().toISOString().slice(0, 10)}`;
export const autoDraftsToday = async () => await kvGet<number>(dayKey()) ?? 0;

export async function autoDraftCandidates(now = Date.now()): Promise<CachedJob[]> {
  const s = (await getSettings()).autoDraft;
  const drafted = new Set((await listProposals()).map((p) => p.jobId));
  return (await listJobs({ status: "all", minScore: s.minRank }))
    // High ghost risk (likely not hiring) never gets an automatic draft - rules unchanged, advisory only.
    .filter((j) => !j.score.excluded && j.score.llm && j.enrichment && !drafted.has(j.id) && j.score.intent?.ghostRisk !== "high")
    .filter((j) => !["dismissed", "applied", "pending", "awaiting_ai"].includes(j.status))
    .filter(tightAiFit)
    .filter((j) => now - new Date(j.fetchedAt).getTime() < 864e5)
    .sort((a, b) => b.score.total - a.score.total);
}

export async function runAutoDrafts(opts: { notify?: boolean } = {}): Promise<{ drafted: string[]; skipped: string | null }> {
  const s = (await getSettings()).autoDraft;
  if (!s.enabled) return { drafted: [], skipped: "disabled" };
  if (!await llmReady()) return { drafted: [], skipped: "no LLM" };
  const left = Math.min(s.perCycle, s.dailyCap - await autoDraftsToday());
  if (left <= 0) return { drafted: [], skipped: "daily cap reached" };
  const drafted: string[] = [];
  for (const job of (await autoDraftCandidates()).slice(0, left)) {
    try {
      const p = await draftProposal(job.id, { webSearch: s.webSearch, agent: "autodraft" });
      await setJobStatus(job.id, "drafting");
      await kvSet(dayKey(), await autoDraftsToday() + 1);
      drafted.push(job.id);
      if (opts.notify !== false) {
        const app = /^https:\/\/(?!localhost|127\.)/.test(config.publicBaseUrl) ? `${config.publicBaseUrl.replace(/\/$/, "")}/proposals/${p.id}` : null;
        const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        void sendPush({ title: `✍️ Draft ready (rank ${job.score.total})`, body: job.title, data: { jobId: job.id, proposalId: p.id } });
        await sendText(`✍️ <b>Draft ready</b> (rank ${job.score.total}): <a href="${jobUrl(job.ciphertext)}">${esc(job.title)}</a>\nRecord your Loom, then approve${app ? ` → <a href="${app}">open draft</a>` : " in Proposals"}.`);
      }
    } catch (e) {
      console.warn("autodraft failed", job.id, (e as Error).message);
    }
  }
  return { drafted, skipped: null };
}
