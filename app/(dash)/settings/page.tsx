import { DisconnectButton } from "@/components/ConnectCard";
import { IconExternal } from "@/components/icons";
import { PageHead } from "@/components/ui/PageHead";
import { SettingsForm } from "@/components/SettingsForm";
import { McpCard } from "@/components/settings/McpCard";
import { PromptsEditor } from "@/components/settings/PromptsEditor";
import { ThemeSegmented } from "@/components/theme/ThemeToggle";
import { config, redirectUri } from "@/lib/config";
import { channelsReady } from "@/lib/pipeline";
import { getSettings, getTokens } from "@/lib/db";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; mcp?: string }> }) {
  const sp = await searchParams;
  const tokens = await getTokens();
  const settings = await getSettings();
  const timezones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const keyReady = !!(config.upwork.clientId && config.upwork.clientSecret);

  return (
    <>
      <PageHead title="Settings" subtitle="Upwork connection, alert channels, usage limits, AI models and the rules that decide what reaches you." />

      {sp.error && <p role="alert" className="mb-4 rounded-[14px] bg-[var(--color-bad-soft)] p-4 text-[14px] text-[var(--color-bad)]">Connection failed: {sp.error}</p>}
      {sp.mcp === "connected" && <p className="mb-4 rounded-[14px] bg-[var(--color-good-soft)] p-4 text-[14px] text-[var(--color-good)]">Upwork connected through the MCP connector. Jobs are read through it from the next poll.</p>}
      {sp.mcp === "already_connected" && <p className="mb-4 rounded-[14px] bg-[var(--color-info-soft)] p-4 text-[14px] text-[var(--color-info)]">Already connected to Upwork.</p>}
      {sp.connected && <p className="mb-4 rounded-[14px] bg-[var(--color-good-soft)] p-4 text-[14px] text-[var(--color-good)]">Account connected. The worker starts polling on its next run.</p>}

      <McpCard />

      <section className="card mb-4 p-5 md:p-6" aria-labelledby="acct">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="acct" className="display text-[20px] font-semibold">API key connection (fallback)</h2>
              <span className={`pill ${tokens ? "pill-good" : keyReady ? "pill-warn" : "pill-neutral"}`}>{tokens ? "Connected" : keyReady ? "Not connected" : "Waiting for API key"}</span>
            </div>
            <p className="mt-1 text-[14px] text-[var(--color-muted)]">
              {tokens
                ? <>Signed in{tokens.account ? ` as ${tokens.account}` : ""} · token refreshed {timeAgo(new Date(tokens.refreshedAt).toISOString())} · expires {timeAgo(new Date(tokens.expiresAt).toISOString()).replace(" ago", "")} from now</>
                : keyReady
                  ? "OAuth 2.0 (authorization code). You sign in on the marketplace site; only an access token is stored here, encrypted."
                  : <>Add <code>UPWORK_CLIENT_ID</code> and <code>UPWORK_CLIENT_SECRET</code> to <code>.env</code> once the key is approved. Callback URL on the key: <code>{redirectUri()}</code></>}
            </p>
          </div>
          <div className="flex shrink-0 gap-2.5">
            {tokens && <DisconnectButton />}
            <a className={`btn ${tokens || !keyReady ? "" : "btn-dark"} ${keyReady ? "" : "pointer-events-none opacity-60"}`} href="/api/auth/login" aria-disabled={!keyReady}>
              {tokens ? "Reconnect" : "Connect account"} <IconExternal size={16} />
            </a>
          </div>
        </div>
        {config.demoMode && !tokens && <p className="mt-4 rounded-[12px] bg-[var(--color-sunken)] p-3 text-[14px] text-[var(--color-muted)]">Demo mode is on: fixture jobs stand in for real results until the account is connected.</p>}
      </section>

      <SettingsForm initial={settings} timezones={timezones} configured={{ telegram: channelsReady().telegram, retell: channelsReady().call }} />

      <div className="mt-4 grid lg:grid-cols-2"><PromptsEditor /></div>

      <section className="card mt-4 flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6" aria-labelledby="appearance-h">
        <div>
          <h2 id="appearance-h" className="display text-[20px] font-semibold">Appearance</h2>
          <p className="mt-1 text-[14px] text-[var(--color-muted)]">System follows your device&apos;s light or dark setting. Saved in this browser.</p>
        </div>
        <ThemeSegmented />
      </section>

      <p className="mt-8 text-[13px] text-[var(--color-faint)]">
        Data policy: job and client details are deleted 24 hours after they were fetched; nothing is shared with anyone. <a className="underline" href="/about">About this app</a>
      </p>
    </>
  );
}
