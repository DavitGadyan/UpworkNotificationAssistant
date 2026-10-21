import { draftProposal } from "./agents/proposal";
import { llmReady } from "./agents/llm";
import { config } from "./config";
import { nightWindow, vouched } from "./autoapply";
import { getSettings, kvGet, kvSet, listJobs, listProposals, setJobStatus } from "./db";
import { jobUrl } from "./format";
import { sendPush } from "./notify/push";
import { sendText } from "./notify/telegram";
import { normTag, THREE_D_TAG } from "./ranking/fields";
import { repeatPoster } from "./ranking/repeatPoster";
import type { CachedJob } from "./types";
import { proposalsLow } from "./upwork/tiers";

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
 * at most `perCycle` per worker cycle and `dailyCap` per day. Drafts wait as "needs_loom" for the
 * Loom → approve → preview → SUBMIT gate - unless night auto-apply is on (lib/autoapply.ts), which may submit
 * the best of them without a Loom inside its own limits. Only jobs with a loaded client record,
 * an AI ranking verdict (never on rules alone) and no existing draft qualify. Drafts count against the daily
 * AI budget like the ranker (kind "auto"), so they can't run it dry unnoticed. Only tight AI fits qualify (below).
 */

/*
 * When drafts are written (David, 2026-10-19): never for old posts, and in the daytime only for the very best.
 *   - posted at most DRAFT_MAX_AGE_MS ago (by Upwork's publish time, not when we happened to see it);
 *   - 00:30-11:00 (his time zone): every tight AI fit, as before - these feed night auto-apply;
 *   - the rest of the day: rank ≥ DAY_MIN_RANK (or vouched by the watch loop) AND fewer than DAY_MAX_PROPOSALS.
 */
export const DRAFT_MAX_AGE_MS = 6 * 3600e3;
export const DAY_MIN_RANK = 80;
export const DAY_MAX_PROPOSALS = 15;
export const DRAFT_NIGHT = { start: "00:30", end: "11:00" };

export function draftTiming(j: CachedJob, tz: string, now = Date.now()): string | null {
  const posted = Date.parse(j.publishedAt || j.fetchedAt);
  if (!Number.isFinite(posted) || now - posted > DRAFT_MAX_AGE_MS) return "posted more than 6 h ago";
  if (nightWindow({ timezone: tz, ...DRAFT_NIGHT }, now).inside) return null;
  if (!vouched(j, AUTO_DRAFT_MIN_FIT) && j.score.total < DAY_MIN_RANK) return `daytime: rank ${j.score.total} < ${DAY_MIN_RANK}`;
  if (proposalsLow(j) >= DAY_MAX_PROPOSALS) return `daytime: ${j.proposalsTier ?? j.totalApplicants} proposals`;
  return null;
}

const dayKey = () => `autodraft:${new Date().toISOString().slice(0, 10)}`;
export const autoDraftsToday = async () => await kvGet<number>(dayKey()) ?? 0;

export async function autoDraftCandidates(now = Date.now()): Promise<CachedJob[]> {
  const settings = await getSettings();
  const s = settings.autoDraft;
  const onTime = (j: CachedJob) => draftTiming(j, settings.autoApply.timezone, now) === null;
  const drafted = new Set((await listProposals()).map((p) => p.jobId));
  const fresh = (j: CachedJob) => !j.score.excluded && !drafted.has(j.id) && !j.score.rules?.flags.some((f) => f.code === "malware_lure") && j.score.intent?.ghostRisk !== "high" && now - new Date(j.fetchedAt).getTime() < 864e5;
  // High ghost risk (likely not hiring) never gets an automatic draft - rules unchanged, advisory only.
  const ranked = (await listJobs({ status: "all", minScore: s.minRank }))
    .filter((j) => fresh(j) && j.score.llm && j.enrichment)
    .filter((j) => !["dismissed", "applied", "pending", "awaiting_ai", "awaiting_payment"].includes(j.status))
    .filter(tightAiFit);
  // Jobs the chat watch loop alerted on (David, 2026-10-19) are drafted even before the app could rank them;
  // draftProposal loads the client record itself.
  const watched = (await listJobs({ status: "all" }))
    .filter((j) => fresh(j) && vouched(j, AUTO_DRAFT_MIN_FIT) && !ranked.some((r) => r.id === j.id))
    .filter((j) => !["dismissed", "applied", "awaiting_payment"].includes(j.status) && !isThreeD(j) && !repeatPoster(j, j.enrichment));
  return [...watched, ...ranked].filter(onTime);
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
