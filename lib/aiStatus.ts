import { config } from "./config";
import { kvGet, kvSet } from "./db";
import { sendText } from "./notify/telegram";

/*
 * AI ranking availability. When the ranker can't run (daily budget reached), new jobs wait as "awaiting_ai"
 * and nothing is alerted on rules alone - so David gets one Telegram notice when ranking pauses and one when
 * it resumes, and the health report (Overview, phone) shows the state.
 */

export interface AiRankingState { paused: boolean; since: string | null; reason: string | null }
const KEY = "ai_ranking_state";
const telegramReady = () => !!(config.telegram.botToken && config.telegram.chatId);

export const aiRankingState = async (): Promise<AiRankingState> => await kvGet<AiRankingState>(KEY) ?? { paused: false, since: null, reason: null };

export async function markAiRankingPaused(reason: string, now = new Date()): Promise<void> {
  if ((await aiRankingState()).paused) return;
  await kvSet(KEY, { paused: true, since: now.toISOString(), reason });
  if (telegramReady()) {
    await sendText(`⏸ <b>AI ranking paused</b> - ${reason.replace(/</g, "&lt;")}.\nNew jobs wait for the AI check and nothing is alerted on rules alone. Ranking resumes at 00:00 UTC, or now if you raise the budget in Settings → AI models.`).catch(() => undefined);
  }
}

export async function markAiRankingResumed(): Promise<void> {
  if (!(await aiRankingState()).paused) return;
  await kvSet(KEY, { paused: false, since: null, reason: null });
  if (telegramReady()) await sendText("▶️ <b>AI ranking resumed</b> - jobs that waited are being ranked now.").catch(() => undefined);
}
