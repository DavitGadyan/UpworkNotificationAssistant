"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/types";

type Gw = { configured: boolean; url: string | null; status: Record<string, unknown> | null };

/**
 * Settings → Upwork connection: one switch between the official Upwork API (through the gateway on the GCP VM)
 * and the Upwork MCP connector, plus the gateway's state and a link to connect it. Searching, client details and
 * the pacing governor work on either; Best Matches and submitting proposals stay on MCP.
 */
export function UpworkConnection({ value, onChange }: { value: Settings["source"]; onChange: (v: Settings["source"]) => void }) {
  const [gw, setGw] = useState<Gw | null>(null);
  useEffect(() => {
    fetch("/api/gateway").then((r) => (r.ok ? r.json() : null)).then(setGw).catch(() => setGw(null));
  }, []);
  const current = value === "graphql" ? "graphql" : "mcp"; // older "auto" reads as MCP
  const st = gw?.status as { connected?: boolean; account?: string | null; tokenExpiresAt?: string | null; callsToday?: number; dailyCap?: number; restricted?: { detail?: string } | null; error?: string } | null | undefined;

  return (
    <div className="grid gap-3">
      <span className="text-[14px] font-medium">Upwork connection</span>
      <div className="seg" role="radiogroup" aria-label="Upwork connection">
        {([["graphql", "Official API"], ["mcp", "MCP connector"]] as const).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={current === v} aria-pressed={current === v} className="seg-item flex-1 justify-center" onClick={() => onChange(v)}>{label}</button>
        ))}
      </div>
      <p className="text-[13px] text-[var(--color-muted)]">
        {current === "graphql"
          ? "Searches and client details through your Upwork API key (via the gateway). Best Matches isn't in the API; proposals are still submitted through MCP. Set “Who searches Upwork” to Worker - the chat session always uses MCP."
          : "Searches, Best Matches, client details and proposals through the Upwork MCP connector."}
      </p>
      <div className="rounded-[12px] bg-[var(--color-sunken)] p-3 text-[13px]">
        {!gw ? <span className="text-[var(--color-muted)]">Checking the API gateway…</span>
          : !gw.configured ? <span className="text-[var(--color-muted)]">API gateway not set up - add UPWORK_GATEWAY_URL and UPWORK_GATEWAY_TOKEN to .env (see deploy/gateway/README.md).</span>
          : st?.error ? <span className="text-[var(--color-bad)]">Gateway {gw.url} unreachable: {st.error}</span>
          : st?.restricted ? <span className="text-[var(--color-bad)]">⛔ Upwork restricted API access - the gateway stopped. {st.restricted.detail}</span>
          : st?.connected ? <span>✅ API connected as <b>{st.account ?? "?"}</b> · calls today {st.callsToday}/{st.dailyCap} · token valid until {st.tokenExpiresAt ? new Date(st.tokenExpiresAt).toLocaleString() : "?"}</span>
          : <span>Gateway {gw.url} is up but not connected to Upwork yet.</span>}
        {gw?.configured && gw.url && (
          <a className="btn btn-sm mt-2 inline-flex" href={`${gw.url}/oauth/start`} target="_blank" rel="noreferrer">{st?.connected ? "Reconnect Upwork API" : "Connect Upwork API"}</a>
        )}
      </div>
    </div>
  );
}
