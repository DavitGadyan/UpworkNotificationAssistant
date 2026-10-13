import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { getTokens, saveTokens } from "@/lib/db";
import { exchangeCode } from "@/lib/upwork/oauth";
import { whoAmI } from "@/lib/upwork/queries";

export const dynamic = "force-dynamic";

/** The key's Callback URL: https://<host>/api/auth/callback */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${config.publicBaseUrl}/settings?${q}`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code) return back("error=missing_code");
  const expected = req.cookies.get("oauth_state")?.value;
  if (!expected || expected !== state) return back("error=state_mismatch");

  try {
    await exchangeCode(code);
    const account = await whoAmI();
    const t = await getTokens();
    if (t) await saveTokens({ ...t, account });
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
  const res = back("connected=1");
  res.cookies.delete("oauth_state");
  return res;
}
