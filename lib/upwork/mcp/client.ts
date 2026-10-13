import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { config, mcpRedirectUri } from "../../config";
import { decrypt, encrypt } from "../../crypto";
import { kvDel, kvGet, kvSet } from "../../db";
import { GuardError, guarded } from "../guard";

/*
 * Client for Upwork's official MCP server (https://mcp.upwork.com/mcp).
 * OAuth 2.1 with dynamic client registration + PKCE, the same flow Claude/ChatGPT use. Everything the
 * OAuth flow needs to remember (client registration, tokens, PKCE verifier) is stored encrypted in kv,
 * so the web process (login/callback routes) and the worker share one connection identity.
 */

const K = { client: "mcp_client", tokens: "mcp_tokens", verifier: "mcp_verifier", authUrl: "mcp_auth_url", state: "mcp_state", org: "mcp_org", account: "mcp_account" };

const getEnc = async <T>(key: string): Promise<T | undefined> => {
  const v = await kvGet<string>(key);
  if (!v) return undefined;
  try { return JSON.parse(decrypt(v)) as T; } catch { return undefined; }
};
const setEnc = async (key: string, value: unknown) => await kvSet(key, encrypt(JSON.stringify(value)));
const del = async (...keys: string[]) => await kvDel(...keys);

class DbOAuthProvider implements OAuthClientProvider {
  get redirectUrl() { return mcpRedirectUri(); }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: config.appName, // neutral brand: never "Upwork"
      redirect_uris: [mcpRedirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  async state() {
    const s = randomBytes(16).toString("hex");
    await kvSet(K.state, s);
    return s;
  }
  async clientInformation() {
    // A registration is tied to its redirect URI: moving from localhost to the VM re-registers.
    if ((await kvGet<string>("mcp_client_redirect")) !== mcpRedirectUri()) return undefined;
    return getEnc<OAuthClientInformationMixed>(K.client);
  }
  async saveClientInformation(info: OAuthClientInformationMixed) {
    await setEnc(K.client, info);
    await kvSet("mcp_client_redirect", mcpRedirectUri());
  }
  tokens() { return getEnc<OAuthTokens>(K.tokens); }
  async saveTokens(tokens: OAuthTokens) {
    await setEnc(K.tokens, tokens);
    await kvSet("mcp_tokens_saved_at", Date.now());
  }
  async redirectToAuthorization(url: URL) { await kvSet(K.authUrl, url.toString()); }
  async saveCodeVerifier(v: string) { await setEnc(K.verifier, v); }
  async codeVerifier() {
    const v = await getEnc<string>(K.verifier);
    if (!v) throw new Error("No PKCE verifier - start the Upwork login again");
    return v;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") await del(K.client, K.tokens, K.verifier);
    if (scope === "client") await del(K.client);
    if (scope === "tokens") await del(K.tokens);
    if (scope === "verifier") await del(K.verifier);
  }
}

const provider = new DbOAuthProvider();
const newTransport = () => new StreamableHTTPClientTransport(new URL(config.mcp.url), { authProvider: provider });

let client: Client | null = null;
let toolNames: Map<string, string> | null = null;
let connecting: Promise<Client> | null = null;

export const mcpConnected = async () => !!(await provider.tokens());
export const mcpAccount = async () => await kvGet<{ name: string; orgUid: string } | null>(K.account);

async function connect(): Promise<Client> {
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      const c = new Client({ name: config.appName, version: "1.0.0" });
      try {
        await c.connect(newTransport());
      } catch (e) {
        if (e instanceof UnauthorizedError) throw new GuardError("Upwork is not connected - open Settings → Connect Upwork", "auth");
        throw e;
      }
      c.onclose = () => { client = null; };
      // Tool names may carry a server prefix (e.g. "upwork__find_jobs"); map short names to real ones.
      const tools = await c.listTools();
      toolNames = new Map(tools.tools.map((t) => [t.name.replace(/^.*__/, ""), t.name]));
      client = c;
      return c;
    })().finally(() => { connecting = null; });
  }
  return connecting;
}

/** Start the browser login. Returns the Upwork authorize URL to redirect to (null = already connected). */
export async function beginLogin(): Promise<{ url: string | null; state: string | null }> {
  await del(K.authUrl);
  const c = new Client({ name: config.appName, version: "1.0.0" });
  try {
    await c.connect(newTransport());
    await c.close();
    return { url: null, state: null };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    return { url: await kvGet<string>(K.authUrl), state: await kvGet<string>(K.state) };
  }
}

/** OAuth callback: exchange the code, then resolve the freelancer org once. */
export async function finishLogin(code: string, state: string | null) {
  const expected = await kvGet<string>(K.state);
  if (expected && state !== expected) throw new Error("OAuth state mismatch - start the login again");
  const t = newTransport();
  await t.finishAuth(code);
  await del(K.verifier, K.authUrl, K.state);
  client = null;
  await resolveOrg(true);
}

export async function logout() {
  await del(K.tokens, K.verifier, K.authUrl, K.org, K.account);
  if (client) await client.close().catch(() => undefined);
  client = null;
}

/** Strip the connector's untrusted-content wrappers; prompts re-wrap job text themselves. */
export function unwrap<T>(v: T): T {
  if (typeof v === "string") return v.replace(/<\/?untrusted_participant_content>/g, "").trim() as T;
  if (Array.isArray(v)) return v.map(unwrap) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)])) as T;
  return v;
}

/** Call an Upwork MCP tool under the ban-safety guard and return its parsed JSON payload. */
export async function callTool<T = Record<string, unknown>>(tool: string, action: string | null, params?: Record<string, unknown>, opts: { org?: boolean; orgUid?: string } = {}): Promise<T> {
  const args: Record<string, unknown> = {};
  if (action) args.action = action;
  if (opts.org !== false) args.org_uid = opts.orgUid ?? (await resolveOrg());
  if (params) args.params = params;
  return guarded(`${tool}${action ? "." + action : ""}`, async () => {
    const c = await connect();
    let res;
    try {
      res = await c.callTool({ name: toolNames?.get(tool) ?? tool, arguments: args }, undefined, { timeout: 60_000 });
    } catch (e) {
      if (e instanceof UnauthorizedError) { client = null; throw new GuardError("Upwork login expired - reconnect in Settings", "auth"); }
      client = null; // transport may be dead; reconnect next call
      throw e;
    }
    const text = (res.content as { type: string; text?: string }[] | undefined)?.find((p) => p.type === "text")?.text ?? "";
    let json: Record<string, unknown>;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (res.isError || json.status === "error" || json.error) {
      throw new Error(`${tool}: ${String(json.error ?? json.message ?? text).slice(0, 300)}`);
    }
    return unwrap(json) as T;
  });
}

/** The freelancer org_uid (TALENT account), cached in kv. */
export async function resolveOrg(force = false): Promise<string> {
  if (config.mcp.orgUid) return config.mcp.orgUid;
  const cached = await kvGet<string>(K.org);
  if (cached && !force) return cached;
  const r = await callTool<{ accounts: { name: string; org_uid: string; role: string }[] }>("list_accounts", null, undefined, { org: false });
  const talent = r.accounts.find((a) => a.role === "TALENT") ?? r.accounts[0];
  if (!talent) throw new Error("No Upwork account found");
  await kvSet(K.org, talent.org_uid);
  await kvSet(K.account, { name: talent.name, orgUid: talent.org_uid });
  return talent.org_uid;
}

/** The client (hiring) org, needed for client-only tools such as find_freelancers. Null if none. */
export async function resolveClientOrg(): Promise<string | null> {
  const cached = await kvGet<string>("mcp_client_org");
  if (cached) return cached;
  const r = await callTool<{ accounts: { org_uid: string; role: string }[] }>("list_accounts", null, undefined, { org: false });
  const c = r.accounts.find((a) => a.role === "CLIENT");
  if (c) await kvSet("mcp_client_org", c.org_uid);
  return c?.org_uid ?? null;
}

export async function listTools(): Promise<string[]> {
  const c = await connect();
  const r = await c.listTools();
  return r.tools.map((t) => t.name);
}
