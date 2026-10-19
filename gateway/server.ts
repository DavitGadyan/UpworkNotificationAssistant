/*
 * gw - a small gateway around the official Upwork GraphQL API, for one freelancer account (David, 2026-10-18).
 * It runs on the GCP VM behind Caddy at https://gw.s1mpleai.org and is the API key's Callback URL.
 *
 *   GET  /oauth/start[?t=<GATEWAY_ADMIN_TOKEN>] begin the OAuth2 authorization-code flow (once, in your browser);
 *                                               without ?t it shows a form asking for the admin token
 *   GET  /oauth/callback                        Upwork redirects here with ?code&state; tokens are stored encrypted
 *   POST /graphql            Bearer GATEWAY_TOKEN   forward {query, variables} to Upwork with a fresh access token
 *   GET  /status             Bearer GATEWAY_TOKEN   connected?, account, token expiry, calls today / last minute
 *   POST /admin/resume?t=<GATEWAY_ADMIN_TOKEN>   clear a "restricted" stop after Upwork support restored access
 *   GET  /health                                 "ok"
 *
 * Tokens never leave the VM. Limits: PER_MINUTE (250) and DAILY_CAP (5,000) - Upwork allows 40,000/day.
 * If Upwork answers with a restriction / suspension, the gateway stops forwarding (HTTP 423) until /admin/resume,
 * and the app's pacing governor stops too. Node ≥ 22.18 runs this file directly: `node gateway/server.ts`.
 * Only Node built-ins are used, so the VM needs nothing but Node.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface GatewayConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  publicUrl: string; // https://gw.s1mpleai.org
  gatewayToken: string; // the app's bearer token
  adminToken: string; // for /oauth/start and /admin/resume
  encKey: string; // TOKEN_ENC_KEY
  dataDir: string; // /var/lib/gw
  perMinute: number;
  dailyCap: number;
  authorizeUrl: string;
  tokenUrl: string;
  graphqlUrl: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
  return {
    clientId: need("UPWORK_CLIENT_ID"),
    clientSecret: need("UPWORK_CLIENT_SECRET"),
    tenantId: env.UPWORK_TENANT_ID ?? "",
    publicUrl: need("PUBLIC_URL").replace(/\/$/, ""),
    gatewayToken: need("GATEWAY_TOKEN"),
    adminToken: need("GATEWAY_ADMIN_TOKEN"),
    encKey: need("TOKEN_ENC_KEY"),
    dataDir: env.DATA_DIR ?? "/var/lib/gw",
    perMinute: Number(env.PER_MINUTE ?? 250),
    dailyCap: Number(env.DAILY_CAP ?? 5000),
    authorizeUrl: "https://www.upwork.com/ab/account-security/oauth2/authorize",
    tokenUrl: "https://www.upwork.com/api/v3/oauth2/token",
    graphqlUrl: "https://api.upwork.com/graphql",
  };
}

// ---------- encrypted token store (AES-256-GCM, same format as the app's lib/crypto.ts) ----------
const keyOf = (k: string) => createHash("sha256").update(k).digest();
export function encrypt(plain: string, k: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(k), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
export function decrypt(payload: string, k: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", keyOf(k), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

interface Tokens { accessToken: string; refreshToken: string; expiresAt: number; refreshedAt: number; account: string | null }
interface Counters { day: string; count: number }
interface Restricted { at: number; detail: string }
type Fetch = typeof fetch;

const RESTRICTED = /restrict|suspend|Terms of Service|account.*(disabled|blocked)/i;
const sameSecret = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function createGateway(cfg: GatewayConfig, deps: { fetch?: Fetch; now?: () => number } = {}) {
  const f: Fetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  mkdirSync(cfg.dataDir, { recursive: true });
  const file = (n: string) => join(cfg.dataDir, n);
  const read = <T>(n: string): T | null => (existsSync(file(n)) ? JSON.parse(readFileSync(file(n), "utf8")) as T : null);
  const write = (n: string, v: unknown) => writeFileSync(file(n), JSON.stringify(v), { mode: 0o600 });
  const states = new Map<string, number>(); // OAuth state → created at
  let minute: number[] = [];

  // ---------- OAuth ----------
  const redirectUri = `${cfg.publicUrl}/oauth/callback`;
  async function tokenRequest(params: Record<string, string>) {
    const res = await f(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Token endpoint ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in?: number };
  }
  function store(t: { access_token: string; refresh_token?: string; expires_in?: number }, prev: Tokens | null, account?: string | null): Tokens {
    const v: Tokens = {
      accessToken: encrypt(t.access_token, cfg.encKey),
      refreshToken: t.refresh_token ? encrypt(t.refresh_token, cfg.encKey) : prev?.refreshToken ?? "",
      expiresAt: now() + (t.expires_in ?? 86_400) * 1000,
      refreshedAt: now(),
      account: account ?? prev?.account ?? null,
    };
    write("tokens.json", v);
    return v;
  }
  async function refresh(): Promise<Tokens> {
    const cur = read<Tokens>("tokens.json");
    if (!cur?.refreshToken) throw new Error("Not connected - open /oauth/start");
    return store(await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(cur.refreshToken, cfg.encKey) }), cur);
  }
  /** A valid access token, refreshed when it expires within the hour. */
  async function accessToken(): Promise<string> {
    let cur = read<Tokens>("tokens.json");
    if (!cur) throw new Error("Not connected - open /oauth/start");
    if (cur.expiresAt - now() < 36e5) cur = await refresh();
    return decrypt(cur.accessToken, cfg.encKey);
  }
  /** Keep the 2-week refresh token alive: refresh at least once a day even when idle. */
  async function keepAlive() {
    const cur = read<Tokens>("tokens.json");
    if (cur && (now() - cur.refreshedAt > 20 * 36e5 || cur.expiresAt - now() < 2 * 36e5)) await refresh();
  }

  // ---------- limits ----------
  const today = () => new Date(now()).toISOString().slice(0, 10);
  function countToday(): Counters {
    const c = read<Counters>("counters.json");
    return c && c.day === today() ? c : { day: today(), count: 0 };
  }
  function take(): string | null {
    const t = now();
    minute = minute.filter((x) => t - x < 60_000);
    if (minute.length >= cfg.perMinute) return `per-minute limit ${cfg.perMinute}`;
    const c = countToday();
    if (c.count >= cfg.dailyCap) return `daily cap ${cfg.dailyCap}`;
    minute.push(t);
    write("counters.json", { day: c.day, count: c.count + 1 });
    return null;
  }

  async function forward(body: string): Promise<{ status: number; json: unknown }> {
    const stop = read<Restricted>("restricted.json");
    if (stop) return { status: 423, json: { error: "restricted", detail: `Upwork API access has been restricted: ${stop.detail}` } };
    const limited = take();
    if (limited) return { status: 429, json: { error: "rate_limited", detail: `Gateway ${limited} reached` } };
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `bearer ${await accessToken()}`, "Content-Type": "application/json" };
      if (cfg.tenantId) headers["X-Upwork-API-TenantId"] = cfg.tenantId;
      const res = await f(cfg.graphqlUrl, { method: "POST", headers, body });
      if ((res.status === 429 || res.status >= 500) && attempt < 1) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 3_000;
        await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
        continue;
      }
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { errors?: { message?: string }[] };
      const text = JSON.stringify(json.errors ?? (res.ok ? "" : json));
      if ((res.status === 403 || json.errors?.length) && RESTRICTED.test(text)) {
        write("restricted.json", { at: now(), detail: text.slice(0, 300) });
        return { status: 423, json: { error: "restricted", detail: `Upwork API access has been restricted: ${text.slice(0, 300)}` } };
      }
      return { status: res.status, json };
    }
  }

  async function whoAmI(): Promise<string | null> {
    try {
      const r = await forward(JSON.stringify({ query: "query me { user { id nid name } }" }));
      const u = (r.json as { data?: { user?: { name?: string; nid?: string } } }).data?.user;
      return u ? `${u.name ?? ""} (${u.nid ?? ""})`.trim() : null;
    } catch { return null; }
  }

  // ---------- HTTP ----------
  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json", "Cache-Control": "no-store", ...headers });
    res.end(text);
  };
  const bearer = (req: IncomingMessage) => sameSecret((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""), cfg.gatewayToken);
  const readBody = (req: IncomingMessage) => new Promise<string>((ok, fail) => {
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e6) { fail(new Error("too large")); req.destroy(); } }); req.on("end", () => ok(b)); req.on("error", fail);
  });
  const page = (title: string, msg: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 16px"><h1 style="font-size:22px">${title}</h1><p>${msg}</p></body>`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", cfg.publicUrl);
    const p = url.pathname;
    try {
      if (p === "/health") return send(res, 200, { ok: true });
      if (p === "/oauth/start" && req.method === "GET") {
        const t = url.searchParams.get("t");
        // Without a token, ask for it (so the app's Settings page never has to hold the admin token).
        if (t == null) return send(res, 200, page("Connect Upwork API", `<form method="get" action="/oauth/start"><label>Gateway admin token<br><input name="t" type="password" autocomplete="current-password" required style="font:inherit;width:100%;padding:8px;margin:8px 0"></label><button style="font:inherit;padding:8px 16px">Continue to Upwork</button></form>`));
        if (!sameSecret(t, cfg.adminToken)) return send(res, 401, page("Not allowed", "Wrong admin token."));
        const state = randomBytes(16).toString("hex");
        states.set(state, now());
        const u = new URL(cfg.authorizeUrl);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("client_id", cfg.clientId);
        u.searchParams.set("redirect_uri", redirectUri);
        u.searchParams.set("state", state);
        return send(res, 302, "", { Location: u.toString() });
      }
      if (p === "/oauth/callback" && req.method === "GET") {
        const state = url.searchParams.get("state") ?? "", code = url.searchParams.get("code") ?? "";
        const at = states.get(state);
        states.delete(state);
        if (!at || now() - at > 10 * 60_000) return send(res, 400, page("Link expired", "Start again from /oauth/start."));
        if (!code) return send(res, 400, page("Not connected", esc(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "No code from Upwork.")));
        store(await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }), null);
        const account = await whoAmI();
        const cur = read<Tokens>("tokens.json");
        if (cur) write("tokens.json", { ...cur, account });
        return send(res, 200, page("Connected", `The gateway is connected${account ? ` as <b>${esc(account)}</b>` : ""}. You can close this tab.`));
      }
      if (p === "/graphql" && req.method === "POST") {
        if (!bearer(req)) return send(res, 401, { error: "unauthorized" });
        const body = await readBody(req);
        let op = "?";
        try { op = (JSON.parse(body) as { query?: string }).query?.match(/(query|mutation)\s+(\w+)/)?.[2] ?? "anonymous"; } catch { return send(res, 400, { error: "bad_json" }); }
        const t0 = now();
        const r = await forward(body);
        console.log(`${new Date(t0).toISOString()} ${op} ${r.status} ${now() - t0}ms`);
        return send(res, r.status, r.json);
      }
      if (p === "/status" && req.method === "GET") {
        if (!bearer(req)) return send(res, 401, { error: "unauthorized" });
        const t = read<Tokens>("tokens.json");
        return send(res, 200, {
          connected: !!t, account: t?.account ?? null, tokenExpiresAt: t ? new Date(t.expiresAt).toISOString() : null,
          refreshedAt: t ? new Date(t.refreshedAt).toISOString() : null, restricted: read<Restricted>("restricted.json"),
          callsToday: countToday().count, dailyCap: cfg.dailyCap, lastMinute: minute.filter((x) => now() - x < 60_000).length, perMinute: cfg.perMinute,
        });
      }
      if (p === "/admin/resume" && req.method === "POST") {
        if (!sameSecret(url.searchParams.get("t") ?? "", cfg.adminToken)) return send(res, 401, { error: "unauthorized" });
        write("restricted.json", null); // a file holding null means "not restricted"
        return send(res, 200, { resumed: true });
      }
      return send(res, 404, { error: "not_found" });
    } catch (e) {
      console.error(`${p} failed: ${(e as Error).message}`);
      return send(res, 502, { error: "gateway_error", detail: (e as Error).message.slice(0, 300) });
    }
  }
  return { handle, keepAlive, refresh, accessToken, forward };
}

async function main() {
  const cfg = configFromEnv();
  const gw = createGateway(cfg);
  const port = Number(process.env.PORT ?? 8787);
  createServer((req, res) => void gw.handle(req, res)).listen(port, "127.0.0.1", () => console.log(`gw listening on 127.0.0.1:${port} for ${cfg.publicUrl}`));
  setInterval(() => void gw.keepAlive().catch((e) => console.error(`keep-alive refresh failed: ${(e as Error).message}`)), 3 * 36e5);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
