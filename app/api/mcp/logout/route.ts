import { json } from "@/lib/http";
import { logout } from "@/lib/upwork/mcp/client";

export const dynamic = "force-dynamic";

export async function POST() {
  await logout();
  return json({ ok: true });
}
