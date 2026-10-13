import { json } from "@/lib/http";
import { sendText } from "@/lib/notify/telegram";

export async function POST() {
  return json(await sendText("<b>Upwork Assistant</b> test - alerts will arrive in this chat."));
}
