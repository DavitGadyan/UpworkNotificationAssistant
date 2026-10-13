import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { beginLogin } from "@/lib/upwork/mcp/client";

export const dynamic = "force-dynamic";

/** Start the Upwork MCP OAuth flow (dynamic client registration + PKCE) and send the browser to Upwork. */
export async function GET() {
  const back = (q: string) => NextResponse.redirect(`${config.publicBaseUrl}/settings?${q}`);
  if (!config.tokenEncKey) return back(`error=${encodeURIComponent("TOKEN_ENC_KEY is not set")}`);
  try {
    const { url } = await beginLogin();
    if (!url) return back("mcp=already_connected");
    return NextResponse.redirect(url);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
