import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { authorizeUrl } from "@/lib/upwork/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!config.upwork.clientId) {
    return NextResponse.redirect(`${config.publicBaseUrl}/settings?error=${encodeURIComponent("UPWORK_CLIENT_ID is not set")}`);
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("oauth_state", state, { httpOnly: true, secure: config.publicBaseUrl.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
