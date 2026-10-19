import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway, decrypt, type GatewayConfig } from "@/gateway/server";

/** The gateway on a random local port, with Upwork's token and GraphQL endpoints mocked. */
async function start(upstream: (url: string, init: RequestInit) => Response | Promise<Response>, over: Partial<GatewayConfig> = {}) {
  let clock = Date.parse("2026-10-18T10:00:00Z");
  const cfg: GatewayConfig = {
    clientId: "cid", clientSecret: "secret", tenantId: "org1", publicUrl: "https://gw.example.org",
    gatewayToken: "app-token", adminToken: "admin-token", encKey: "k", dataDir: mkdtempSync(join(tmpdir(), "gw-")),
    perMinute: 250, dailyCap: 5000, authorizeUrl: "https://upwork.test/authorize", tokenUrl: "https://upwork.test/token", graphqlUrl: "https://upwork.test/graphql",
    ...over,
  };
  const seen: { url: string; init: RequestInit }[] = [];
  const gw = createGateway(cfg, { fetch: (async (u: string, i: RequestInit) => { seen.push({ url: u, init: i }); return upstream(u, i); }) as typeof fetch, now: () => clock });
  const server: Server = createServer((q, s) => void gw.handle(q, s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  servers.push(server);
  return { cfg, gw, base, seen, tick: (ms: number) => { clock += ms; } };
}
const servers: Server[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.close()); });

const tokenOk = (access = "AT1", refresh = "RT1") => new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: 86400 }), { status: 200 });
const gqlOk = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

async function connect(g: Awaited<ReturnType<typeof start>>) {
  const r = await fetch(`${g.base}/oauth/start?t=admin-token`, { redirect: "manual" });
  expect(r.status).toBe(302);
  const loc = new URL(r.headers.get("location")!);
  expect(loc.searchParams.get("redirect_uri")).toBe("https://gw.example.org/oauth/callback");
  const cb = await fetch(`${g.base}/oauth/callback?code=abc&state=${loc.searchParams.get("state")}`);
  expect(cb.status).toBe(200);
  return cb.text();
}

describe("Upwork API gateway", () => {
  it("connects once through OAuth, stores tokens encrypted, and shows the account", async () => {
    const g = await start((u) => (u.endsWith("/token") ? tokenOk() : gqlOk({ user: { id: "1", nid: "davidg", name: "David G." } })));
    expect((await fetch(`${g.base}/oauth/start?t=wrong`)).status).toBe(401);
    expect(await connect(g)).toContain("David G.");
    const { readFileSync } = await import("node:fs");
    const stored = JSON.parse(readFileSync(join(g.cfg.dataDir, "tokens.json"), "utf8"));
    expect(stored.accessToken).not.toContain("AT1");
    expect(decrypt(stored.accessToken, "k")).toBe("AT1");
    const st = await (await fetch(`${g.base}/status`, { headers: { Authorization: "Bearer app-token" } })).json();
    expect(st).toMatchObject({ connected: true, account: "David G. (davidg)" });
    // A replayed or unknown state is refused.
    expect((await fetch(`${g.base}/oauth/callback?code=abc&state=nope`)).status).toBe(400);
  });

  it("forwards GraphQL only with the app's token, adding the bearer and tenant headers", async () => {
    const g = await start((u) => (u.endsWith("/token") ? tokenOk() : gqlOk({ ok: 1 })));
    await connect(g);
    expect((await fetch(`${g.base}/graphql`, { method: "POST", body: "{}" })).status).toBe(401);
    const r = await fetch(`${g.base}/graphql`, { method: "POST", headers: { Authorization: "Bearer app-token" }, body: JSON.stringify({ query: "query search { x }" }) });
    expect(await r.json()).toEqual({ data: { ok: 1 } });
    const last = g.seen.at(-1)!;
    expect(last.url).toBe("https://upwork.test/graphql");
    expect((last.init.headers as Record<string, string>).Authorization).toBe("bearer AT1");
    expect((last.init.headers as Record<string, string>)["X-Upwork-API-TenantId"]).toBe("org1");
  });

  it("refreshes the access token before it expires and keeps the refresh token alive", async () => {
    let n = 0;
    const g = await start((u, i) => {
      if (u.endsWith("/token")) { n++; return String(i.body).includes("refresh_token=RT1") ? tokenOk("AT2", "") : tokenOk(); }
      return gqlOk({ user: { name: "D" } });
    });
    await connect(g);
    g.tick(23.5 * 36e5); // expires in 30 min
    expect(await g.gw.accessToken()).toBe("AT2");
    expect(n).toBe(2);
    g.tick(21 * 36e5);
    await g.gw.keepAlive();
    expect(n).toBe(3);
  });

  it("enforces the per-minute and daily caps", async () => {
    const g = await start((u) => (u.endsWith("/token") ? tokenOk() : gqlOk({ ok: 1 })), { perMinute: 3, dailyCap: 4 });
    await connect(g); // whoAmI used one call
    const call = () => fetch(`${g.base}/graphql`, { method: "POST", headers: { Authorization: "Bearer app-token" }, body: JSON.stringify({ query: "query q { x }" }) });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429); // 3 in the last minute
    g.tick(61_000);
    expect((await call()).status).toBe(200);
    const r = await call();
    expect(r.status).toBe(429);
    expect((await r.json()).detail).toMatch(/daily cap 4/);
  });

  it("stops forwarding when Upwork says access is restricted, until an admin resumes", async () => {
    let restricted = true;
    const g = await start((u) => {
      if (u.endsWith("/token")) return tokenOk();
      return restricted ? new Response(JSON.stringify({ errors: [{ message: "Your access has been restricted due to violations of our Terms of Service" }] }), { status: 403 }) : gqlOk({ ok: 1 });
    });
    await connect(g);
    const call = () => fetch(`${g.base}/graphql`, { method: "POST", headers: { Authorization: "Bearer app-token" }, body: JSON.stringify({ query: "query q { x }" }) });
    const r = await call();
    expect(r.status).toBe(423);
    expect((await r.json()).detail).toMatch(/has been restricted/);
    restricted = false;
    const before = g.seen.length;
    expect((await call()).status).toBe(423);
    expect(g.seen.length).toBe(before); // nothing sent to Upwork while stopped
    expect((await fetch(`${g.base}/admin/resume?t=admin-token`, { method: "POST" })).status).toBe(200);
    expect((await call()).status).toBe(200);
  });
});
