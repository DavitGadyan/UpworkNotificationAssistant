import { NextResponse, type NextRequest } from "next/server";

/*
 * Single-user access control:
 *   - web dashboard: HTTP basic auth (DASHBOARD_USER / DASHBOARD_PASSWORD; localhost only without a password);
 *   - mobile app: `Authorization: Bearer <Supabase access token>` on /api/* - accepted only when Supabase
 *     confirms the token belongs to OWNER_EMAIL (checked against /auth/v1/user, cached for 5 minutes).
 * Public: the Telegram webhook (own secret), /about, PWA files and the /api/health summary.
 */

const verified = new Map<string, number>(); // token → expiry (ms)

async function ownerToken(token: string): Promise<boolean> {
  const hit = verified.get(token);
  if (hit && hit > Date.now()) return true;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY, owner = process.env.OWNER_EMAIL;
  if (!url || !key || !owner) return false;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const u = (await r.json()) as { email?: string };
    if (u.email?.toLowerCase() !== owner.toLowerCase()) return false;
    if (verified.size > 50) verified.clear();
    verified.set(token, Date.now() + 5 * 60_000);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  // PWA files must load without credentials (browsers fetch the manifest and service worker anonymously).
  if (p.startsWith("/api/telegram/webhook") || p === "/about" || p === "/manifest.webmanifest" || p === "/sw.js" || p === "/api/health" || p.startsWith("/icons/")) {
    return NextResponse.next();
  }
  const header = req.headers.get("authorization") ?? "";
  if (p.startsWith("/api/") && header.startsWith("Bearer ")) {
    return (await ownerToken(header.slice(7))) ? NextResponse.next() : NextResponse.json({ error: "Not signed in as the owner" }, { status: 401 });
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    const host = req.headers.get("host") ?? "";
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return NextResponse.next();
    return new NextResponse("Set DASHBOARD_PASSWORD to serve this dashboard publicly.", { status: 503 });
  }
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(":");
    const user = decoded.slice(0, i), pass = decoded.slice(i + 1);
    if (user === (process.env.DASHBOARD_USER ?? "admin") && pass === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Up Assistant", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
