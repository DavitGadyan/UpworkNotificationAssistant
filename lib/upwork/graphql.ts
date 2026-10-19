import { config } from "../config";
import { acquire, RateLimitError } from "../ratelimit";
import type { CallMeta } from "./governor";
import { guarded } from "./guard";
import { accessToken } from "./oauth";

export class UpworkApiError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

/** The official API goes through the gateway on the GCP VM when one is configured (gateway/server.ts). */
export const viaGateway = () => !!(config.upwork.gatewayUrl && config.upwork.gatewayToken);

/**
 * POST a GraphQL operation to Upwork - through the gateway when configured, else directly with the local OAuth
 * token. Every call goes through the pacing governor (guard.ts) under `label` ("api.search", "api.job", …), so the
 * same budgets, slow-down and "restricted" stop apply as for the MCP connector.
 */
export async function gql<T>(query: string, variables: Record<string, unknown> = {}, opts: { label?: string; meta?: CallMeta } = {}): Promise<T> {
  return guarded(opts.label ?? "api.query", () => (viaGateway() ? viaGatewayOnce<T>(query, variables) : direct<T>(query, variables)), opts.meta);
}

async function viaGatewayOnce<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.upwork.gatewayUrl}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.upwork.gatewayToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[]; error?: string; detail?: string } | null;
  // The gateway says 423 once Upwork restricted access: the message makes the governor stop everything.
  if (res.status === 423) throw new UpworkApiError(`api: ${body?.detail ?? "Upwork API access has been restricted"}`, 423);
  if (res.status === 429) throw new RateLimitError(`api: 429 ${body?.detail ?? "rate limited"}`);
  if (res.status === 401) throw new UpworkApiError("api: gateway refused the app token (UPWORK_GATEWAY_TOKEN) - unauthorized", 401);
  if (!res.ok) throw new UpworkApiError(`api: HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, res.status);
  if (body?.errors?.length) throw new UpworkApiError(`api: ${body.errors.map((e) => e.message).join("; ")}`);
  if (!body?.data) throw new UpworkApiError("api: empty GraphQL response");
  return body.data;
}

/** Without a gateway: straight to Upwork with the token from Settings → Connect (retries 429 / 5xx a few times). */
async function direct<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let delay = 2_000;
  for (let attempt = 1; ; attempt++) {
    await acquire();
    const headers: Record<string, string> = {
      Authorization: `bearer ${await accessToken()}`,
      "Content-Type": "application/json",
    };
    if (config.upwork.tenantId) headers["X-Upwork-API-TenantId"] = config.upwork.tenantId;

    const res = await fetch(config.upwork.graphqlUrl, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      await new Promise((r) => setTimeout(r, retryAfter || delay));
      delay *= 2;
      continue;
    }
    if (res.status === 429) throw new RateLimitError("api: Upwork returned 429 after retries");
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
    if (!res.ok) throw new UpworkApiError(`api: GraphQL HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, res.status);
    if (body?.errors?.length) throw new UpworkApiError(`api: ${body.errors.map((e) => e.message).join("; ")}`);
    if (!body?.data) throw new UpworkApiError("api: empty GraphQL response");
    return body.data;
  }
}

/** Gateway health for Settings (not an Upwork call, not counted). */
export async function gatewayStatus(): Promise<Record<string, unknown> | null> {
  if (!viaGateway()) return null;
  try {
    const r = await fetch(`${config.upwork.gatewayUrl}/status`, { headers: { Authorization: `Bearer ${config.upwork.gatewayToken}` }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() as Record<string, unknown> : { error: `HTTP ${r.status}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
