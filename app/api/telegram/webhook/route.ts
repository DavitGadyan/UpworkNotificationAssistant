import { config } from "@/lib/config";
import { bad, json } from "@/lib/http";
import { handleCallback, type CallbackQuery } from "@/lib/notify/telegramActions";

/*
 * Telegram inline-button handler (Dismiss, 👍 / 👎 feedback). Register it once on the public deploy:
 *   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=$PUBLIC_BASE_URL/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET"
 * Without a webhook the worker long-polls getUpdates instead (lib/notify/telegramActions.ts).
 * Excluded from basic auth (middleware); protected by Telegram's secret-token header instead.
 */
export async function POST(req: Request) {
  if (!config.telegram.webhookSecret || req.headers.get("x-telegram-bot-api-secret-token") !== config.telegram.webhookSecret) {
    return bad("Forbidden", 403);
  }
  const update = (await req.json().catch(() => ({}))) as { callback_query?: CallbackQuery };
  if (update.callback_query) await handleCallback(update.callback_query);
  return json({ ok: true });
}
