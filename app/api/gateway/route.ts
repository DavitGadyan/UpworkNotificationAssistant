import { config } from "@/lib/config";
import { json } from "@/lib/http";
import { gatewayStatus, viaGateway } from "@/lib/upwork/graphql";

export const dynamic = "force-dynamic";

/** Settings → Upwork connection: is the official-API gateway configured, connected, and how busy (no Upwork call). */
export async function GET() {
  return json({ configured: viaGateway(), url: config.upwork.gatewayUrl || null, status: await gatewayStatus() });
}
