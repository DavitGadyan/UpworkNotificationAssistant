import { config } from "../config";
import { addFeedback, getJob, kvGet, kvSet, setJobStatus } from "../db";
import { answerCallback } from "./telegram";

/*
 * Inline-button actions (Dismiss, 👍/👎), shared by the webhook route (public deploy) and the worker's
 * getUpdates poller (local / before the webhook is registered). 👍/👎 feed the preference loop.
 */
export interface CallbackQuery { id: string; data?: string; message?: { chat?: { id: number } } }

export async function handleCallback(cq: CallbackQuery) {
  if (!cq.data || String(cq.message?.chat?.id) !== config.telegram.chatId) return;
  const parts = cq.data.split(":");
  if (parts[0] === "dismiss") {
    const id = parts.slice(1).join(":");
    if (await getJob(id)) { await setJobStatus(id, "dismissed"); await answerCallback(cq.id, "Dismissed"); }
    else await answerCallback(cq.id, "Job no longer cached");
  } else if (parts[0] === "fb") {
    const rating = Number(parts[1]) > 0 ? 1 : -1;
    const id = parts.slice(2).join(":");
    const job = await getJob(id);
    await addFeedback({
      kind: "alert", refId: id, rating, reason: null,
      data: job ? { title: job.title, score: job.score.total, category: job.score.llm?.category ?? job.score.rules?.category, rules: job.score.rules?.score, llmFit: job.score.llm?.fit, flags: job.score.rules?.flags.map((f) => f.code) } : null,
    });
    if (rating < 0 && job) await setJobStatus(id, "dismissed");
    await answerCallback(cq.id, rating > 0 ? "Thanks - more like this" : "Noted - fewer like this");
  } else {
    await answerCallback(cq.id, "Unknown action");
  }
}

/** One long-poll round of getUpdates for button taps. No-op while a webhook is registered (Telegram refuses). */
export async function pollCallbacks(timeoutSec = 25): Promise<number> {
  if (!config.telegram.botToken) return 0;
  const offset = await kvGet<number>("tg_offset") ?? 0;
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/getUpdates?timeout=${timeoutSec}&offset=${offset}&allowed_updates=${encodeURIComponent('["callback_query"]')}`;
  const res = await fetch(url, { signal: AbortSignal.timeout((timeoutSec + 10) * 1000) });
  const json = (await res.json()) as { ok: boolean; error_code?: number; result?: { update_id: number; callback_query?: CallbackQuery }[] };
  if (!json.ok) return json.error_code === 409 ? -1 : 0; // 409 = webhook set: the route handles taps
  for (const u of json.result ?? []) {
    await kvSet("tg_offset", u.update_id + 1);
    if (u.callback_query) await handleCallback(u.callback_query).catch((e) => console.warn("callback failed", e));
  }
  return json.result?.length ?? 0;
}
