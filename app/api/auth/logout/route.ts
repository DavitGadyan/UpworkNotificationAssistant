import { clearTokens } from "@/lib/db";
import { json } from "@/lib/http";

export async function POST() {
  await clearTokens();
  return json({ ok: true });
}
