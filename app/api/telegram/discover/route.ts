import { config } from "@/lib/config";
import { json } from "@/lib/http";
import { discoverChats } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

/**
 * Setup helper: post any message in the channel (the bot must be admin), then open this to read the
 * channel's numeric id for TELEGRAM_CHAT_ID. Only works while no webhook is set (getUpdates).
 */
export async function GET() {
  return json({ configuredChatId: config.telegram.chatId || null, chats: await discoverChats().catch(() => []) });
}
