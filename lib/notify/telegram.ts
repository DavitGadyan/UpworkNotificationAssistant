import { config } from "../config";
import { budgetLabel, compactMoney, jobUrl } from "../format";
import type { Job, JobEnrichment, ScoreBreakdown } from "../types";

export interface SendResult { ok: boolean; detail: string; messageId?: number }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const badge = (n: number) => (n >= 85 ? "🟢" : n >= 70 ? "🟡" : "🟠");

/**
 * Channel post for one job. The job link is Upwork's universal link (https://www.upwork.com/jobs/~02…),
 * which the Upwork mobile app claims on iOS/Android, so tapping it opens the job in the app.
 */
export function formatJobMessage(job: Job, score: ScoreBreakdown, feedName: string, e?: JobEnrichment | null, proposalsNow?: string, lane: "rank" | "strong_fit" = "rank"): string {
  const c = job.client;
  const llm = score.llm;
  const r = score.rules;
  const hireRate = e?.record.hireRatePercent ?? r?.derived.hireRate;
  const clientBits = [
    c.paymentVerified ? "✅ payment verified" : c.paymentVerified === false ? "⚠️ payment NOT verified" : "payment ?",
    c.country,
    `${compactMoney(e?.record.totalSpent ?? c.totalSpent)} spent`,
    hireRate != null ? `${hireRate}% hire rate` : null,
    r?.derived.avgPaid != null ? `≈$${r.derived.avgPaid}/hr avg` : null,
    (e?.record.feedbackCount ?? c.totalReviews) ? `★${(e?.record.feedbackScore ?? c.totalFeedback).toFixed(1)}` : "no reviews",
  ].filter(Boolean).join(" · ");
  const flags = (r?.flags ?? []).filter((f) => f.severity !== "info").slice(0, 3).map((f) => `${f.severity === "red" ? "🚩" : "⚠️"} ${esc(f.label)}`);
  const reasons = (llm?.reasons ?? r?.passes ?? []).slice(0, 3).map((x) => `• ${esc(x)}`);
  const link = jobUrl(job.ciphertext);
  const it = score.intent;
  const ARCH: Record<string, string> = { ghost_poster: "posts but never hires", unfunded: "no payment attached", template_collector: "collects free plans/quotes", mass_poster: "mass poster, rarely hires", identity_fronting: "front/identity request", data_harvest: "harvests personal data", stale: "no client activity", repeat_no_hire: "past jobs closed without hiring", genuine: "looks genuine" };
  const intentLine = !it ? "" : it.ghostRisk === "high"
    ? `🚫 <b>Likely not hiring — skip</b> (${esc(ARCH[it.archetype] ?? it.archetype)}, hire chance ${it.hireLikelihood}%): ${esc(it.evidence.slice(0, 2).join("; "))}`
    : it.ghostRisk === "medium" ? `⚠️ Hire chance ${it.hireLikelihood}% · ${esc(ARCH[it.archetype] ?? it.archetype)}: ${esc(it.evidence[0] ?? "")}`
    : `✅ Hire chance ${it.hireLikelihood}%`;
  return [
    lane === "strong_fit"
      ? `💡 <b>Strong fit, weak signals</b> · AI fit ${llm?.fit ?? "?"}/100 · rank ${score.total} · ${esc(feedName)}`
      : `${badge(score.total)} <b>${score.total}/100</b> · ${esc(llm?.category ?? r?.category ?? "")} · ${esc(feedName)}`,
    `<a href="${link}"><b>${esc(job.title)}</b></a>`,
    intentLine,
    llm?.summary ? esc(llm.summary) : "",
    llm?.finalProduct ? `🎯 <b>Final product:</b> ${esc(llm.finalProduct)}` : "",
    `🛠 ${esc((llm?.skillsWanted?.length ? llm.skillsWanted : job.skills).slice(0, 6).join(", "))}`,
    `💰 ${esc(budgetLabel(job))} · 📨 ${esc(proposalsNow ?? (job.proposalsTier ?? `${job.totalApplicants}`))} proposals${e?.connectsCost != null ? ` · ${e.connectsCost} Connects` : ""}`,
    `👤 ${esc(clientBits)}`,
    reasons.length ? reasons.join("\n") : "",
    flags.length ? flags.join("\n") : "",
  ].filter(Boolean).join("\n");
}

async function api<T = { message_id: number }>(method: string, body: Record<string, unknown>): Promise<SendResult & { result?: T }> {
  if (!config.telegram.botToken || !config.telegram.chatId) return { ok: false, detail: "Telegram not configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.telegram.chatId, ...body }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string; result?: T & { message_id?: number } };
    if (!json.ok) return { ok: false, detail: json.description ?? `HTTP ${res.status}` };
    const id = (json.result as { message_id?: number } | undefined)?.message_id;
    return { ok: true, detail: id ? `message ${id}` : "ok", messageId: id, result: json.result };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** Telegram rejects localhost/http button URLs, so app links only appear once the dashboard is public. */
const publicApp = () => /^https:\/\/(?!localhost|127\.)/.test(config.publicBaseUrl) ? config.publicBaseUrl.replace(/\/$/, "") : null;

const keyboard = (job: Job) => {
  const app = publicApp();
  const page = app ? `${app}/jobs/${encodeURIComponent(job.id)}` : null;
  return {
    inline_keyboard: [
      [
        { text: "📱 Open in Upwork", url: jobUrl(job.ciphertext) },
        ...(page ? [{ text: "✍️ Draft proposal", url: `${page}?draft=1` }] : []),
      ],
      [
        { text: "👍", callback_data: `fb:1:${job.id}`.slice(0, 64) },
        { text: "👎", callback_data: `fb:-1:${job.id}`.slice(0, 64) },
        ...(page ? [{ text: "Details", url: page }] : []),
        { text: "Dismiss", callback_data: `dismiss:${job.id}`.slice(0, 64) },
      ],
    ],
  };
};

export function sendJobAlert(job: Job, score: ScoreBreakdown, feedName: string, e?: JobEnrichment | null, lane: "rank" | "strong_fit" = "rank"): Promise<SendResult> {
  return api("sendMessage", {
    text: formatJobMessage(job, score, feedName, e, undefined, lane),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard(job),
  });
}

/** Re-render an alert in place (proposal count changed). */
export function editJobAlert(messageId: number, job: Job, score: ScoreBreakdown, feedName: string, e: JobEnrichment | null | undefined, proposalsNow: string, footer?: string): Promise<SendResult> {
  return api("editMessageText", {
    message_id: messageId,
    text: formatJobMessage(job, score, feedName, e, proposalsNow) + (footer ? `\n${footer}` : ""),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard(job),
  });
}

export const sendText = (text: string, replyTo?: number) =>
  api("sendMessage", { text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) });

export async function answerCallback(callbackQueryId: string, text: string) {
  if (!config.telegram.botToken) return;
  await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => undefined);
}

/** Setup helper: find the numeric id of the channel the bot is admin in (from recent channel posts). */
export async function discoverChats(): Promise<{ id: number; title: string; type: string }[]> {
  if (!config.telegram.botToken) return [];
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getUpdates?allowed_updates=${encodeURIComponent('["channel_post","my_chat_member","message"]')}`);
  const json = (await res.json()) as { ok: boolean; result?: Record<string, { chat?: { id: number; title?: string; type: string } }>[] };
  const chats = new Map<number, { id: number; title: string; type: string }>();
  for (const u of json.result ?? []) {
    for (const v of Object.values(u)) {
      const chat = (v as { chat?: { id: number; title?: string; type: string } })?.chat;
      if (chat?.id) chats.set(chat.id, { id: chat.id, title: chat.title ?? "", type: chat.type });
    }
  }
  return [...chats.values()];
}
