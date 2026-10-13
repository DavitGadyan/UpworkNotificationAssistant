import { config, redirectUri } from "../config";
import { decrypt, encrypt } from "../crypto";
import { getTokens, saveTokens, type StoredTokens } from "../db";

/* OAuth 2.0 Authorization Code grant (RFC 6749), per the Upwork GraphQL docs.
 * Access token TTL 24h; refresh token TTL 2 weeks since last use - the worker refreshes daily,
 * so the refresh token never ages out while the worker runs. */

export function authorizeUrl(state: string): string {
  const u = new URL(config.upwork.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.upwork.clientId);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", state);
  return u.toString();
}

interface TokenResponse { access_token: string; refresh_token: string; expires_in: number; token_type: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(config.upwork.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.upwork.clientId,
      client_secret: config.upwork.clientSecret,
      ...params,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token endpoint ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as TokenResponse;
}

async function store(t: TokenResponse, prev?: StoredTokens | null): Promise<StoredTokens> {
  const stored: StoredTokens = {
    accessToken: encrypt(t.access_token),
    refreshToken: encrypt(t.refresh_token || (prev ? decrypt(prev.refreshToken) : "")),
    expiresAt: Date.now() + (t.expires_in ?? 86_400) * 1000,
    refreshedAt: Date.now(),
    account: prev?.account ?? null,
  };
  await saveTokens(stored);
  return stored;
}

export async function exchangeCode(code: string) {
  return store(await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }));
}

export async function refresh(): Promise<StoredTokens> {
  const cur = await getTokens();
  if (!cur) throw new Error("Not connected - open Settings and connect your account");
  return store(await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(cur.refreshToken) }), cur);
}

/** A valid access token, refreshed when it expires within the hour. */
export async function accessToken(): Promise<string> {
  let cur = await getTokens();
  if (!cur) throw new Error("Not connected - open Settings and connect your account");
  if (cur.expiresAt - Date.now() < 60 * 60 * 1000) cur = await refresh();
  return decrypt(cur.accessToken);
}
