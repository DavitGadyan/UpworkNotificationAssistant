import { draftProposal } from "./agents/proposal";
import { llmReady } from "./agents/llm";
import { config } from "./config";
import { getSettings, kvGet, kvSet, listJobs, listProposals, setJobStatus } from "./db";
import { jobUrl } from "./format";
import { sendPush } from "./notify/push";
import { sendText } from "./notify/telegram";
import type { CachedJob } from "./types";

/*
 * Auto proposal drafts: every job ranked ≥ autoDraft.minRank (default 60) gets an Opus draft without a tap,
 * at most `perCycle` per worker cycle and `dailyCap` per day. Drafts wait as "needs_loom" - nothing is ever
 * submitted; the Loom → approve → preview → SUBMIT gate is unchanged. Only jobs with a loaded client record
 * and no existing draft qualify.
 */

const dayKey = () => `autodraft:${new Date().toISOString().slice(0, 10)}`;
export const autoDraftsToday = async () => await kvGet<number>(dayKey()) ?? 0;

export async function autoDraftCandidates(now = Date.now()): Promise<CachedJob[]> {
  const s = (await getSettings()).autoDraft;
  const drafted = new Set((await listProposals()).map((p) => p.jobId));
  return (await listJobs({ status: "all", minScore: s.minRank }))
    // High ghost risk (likely not hiring) never gets an automatic draft - rules unchanged, advisory only.
    .filter((j) => !j.score.excluded && j.enrichment && !drafted.has(j.id) && j.score.intent?.ghostRisk !== "high")
    .filter((j) => !["dismissed", "applied", "pending"].includes(j.status))
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
