/*
 * Connect the Upwork MCP connector from a terminal (same flow as Settings → Connect Upwork).
 * The web app must be running at PUBLIC_BASE_URL, because Upwork redirects the browser to
 * $PUBLIC_BASE_URL/api/mcp/callback. Usage: npm run dev (other terminal) && npm run mcp:login
 */
import { config, mcpRedirectUri } from "@/lib/config";
import { beginLogin, mcpAccount, mcpConnected } from "@/lib/upwork/mcp/client";

async function main() {
  if (await mcpConnected()) { console.log("Already connected:", await mcpAccount()); return; }
  const { url } = await beginLogin();
  if (!url) { console.log("Already connected"); return; }
  console.log(`Open this URL, log in to Upwork and approve access:\n\n${url}\n\nCallback: ${mcpRedirectUri()} (web app at ${config.publicBaseUrl} must be running)`);
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    if (await mcpConnected()) { console.log("Connected:", await mcpAccount()); return; }
  }
  console.log("Timed out waiting for the callback");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
