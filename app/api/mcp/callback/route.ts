import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { finishLogin } from "@/lib/upwork/mcp/client";
import { resetBreaker } from "@/lib/upwork/guard";

export const dynamic = "force-dynamic";

/** OAuth redirect target registered with Upwork's MCP authorization server: $PUBLIC_BASE_URL/api/mcp/callback */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${config.publicBaseUrl}/settings?${q}`);
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code) return back("error=missing_code");
  try {
    await finishLogin(code, req.nextUrl.searchParams.get("state"));
    await resetBreaker();
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
  return back("mcp=connected");
}
