"use client";

import { useCallback, useEffect, useState } from "react";
import { IconExternal, IconRefresh } from "@/components/icons";
import { Note, Spinner } from "@/components/ui/bits";
import { fmtDateTime } from "@/lib/format";

interface McpStatus {
  connected: boolean;
  account: { name: string; orgUid: string } | null;
  source: string;
  callsToday: number;
  dailyCap: number;
  lastHour: { total: number; failed: number; byTool: Record<string, number> };
  breaker: { failures: number; openUntil: number; lastError: string | null };
}

/** Upwork connection through the official MCP connector: status, connect/disconnect, usage vs cap, circuit breaker. */
export function McpCard() {
  const [st, setSt] = useState<McpStatus | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await fetch("/api/mcp/status", { cache: "no-store" });
      if (!r.ok) throw new Error(`Status failed (${r.status})`);
      setSt((await r.json()) as McpStatus);
    } catch (e) { setLoadErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, url: string, method: string, ask?: string) => {
    if (ask && !confirm(ask)) return;
    setBusy(key); setActErr(null);
    const r = await fetch(url, { method });
    if (!r.ok) setActErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${r.status})`);
    setBusy(null);
    load();
  };

  const open = st && st.breaker.openUntil > Date.now();
  const pctUsed = st ? Math.min(100, Math.round((st.callsToday / Math.max(1, st.dailyCap)) * 100)) : 0;
  const tools = st ? Object.entries(st.lastHour.byTool).sort((a, b) => b[1] - a[1]) : [];

  return (
    <section className="card mb-4 p-5 md:p-6" aria-labelledby="mcp-h">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="mcp-h" className="display text-[20px] font-semibold">Upwork connection (MCP)</h2>
            {st ? <span className={`pill ${st.connected ? "pill-good" : "pill-warn"}`}>{st.connected ? "Connected" : "Not connected"}</span> : !loadErr && <Spinner />}
            {open && <span className="pill pill-bad">Paused by breaker</span>}
          </div>
          <p className="mt-1 text-[14px] text-[var(--color-muted)]">
            {st?.connected
              ? <>Signed in{st.account?.name ? ` as ${st.account.name}` : ""} through Upwork&apos;s official connector. Jobs come from <b>{st.source}</b>.</>
              : "Sign in on Upwork to let the assistant read jobs, client details and your messages through Upwork's official MCP connector. Read-mostly: it only writes when you submit a proposal yourself."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          <button type="button" className="btn btn-sm btn-ghost" aria-label="Refresh status" onClick={load}><IconRefresh size={16} /></button>
          {st?.connected && <button type="button" className="btn btn-sm btn-danger" disabled={busy === "logout"} onClick={() => act("logout", "/api/mcp/logout", "POST", "Disconnect from Upwork? Polling falls back to the API key (if any) until you connect again.")}>Disconnect</button>}
          <a className={`btn ${st?.connected ? "btn-sm" : "btn-dark"}`} href="/api/mcp/login">{st?.connected ? "Reconnect" : "Connect Upwork"} <IconExternal size={16} /></a>
        </div>
      </div>

      {loadErr && <Note tone="bad" className="mt-4">{loadErr}</Note>}
      {actErr && <Note tone="bad" className="mt-4">{actErr}</Note>}

      {st && (
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-[16px] bg-[var(--color-sunken)] p-4">
            <p className="text-[13px] font-medium text-[var(--color-muted)]">Calls today</p>
            <p className="display num mt-1 text-[26px] font-bold leading-none">{st.callsToday.toLocaleString()}<span className="text-[15px] font-medium text-[var(--color-muted)]"> / {st.dailyCap.toLocaleString()}</span></p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-line)]" role="img" aria-label={`${pctUsed}% of the daily cap used`}>
              <div className="h-full rounded-full" style={{ width: `${pctUsed}%`, background: pctUsed > 85 ? "var(--color-bad)" : pctUsed > 60 ? "var(--color-warn)" : "var(--color-good)" }} />
            </div>
          </div>
          <div className="rounded-[16px] bg-[var(--color-sunken)] p-4">
            <p className="text-[13px] font-medium text-[var(--color-muted)]">Last hour</p>
            <p className="display num mt-1 text-[26px] font-bold leading-none">{st.lastHour.total}<span className="text-[15px] font-medium text-[var(--color-muted)]"> calls{st.lastHour.failed ? `, ${st.lastHour.failed} failed` : ""}</span></p>
            {tools.length > 0 ? (
              <ul className="mt-3 grid gap-1 text-[13px]">
                {tools.slice(0, 5).map(([t, n]) => <li key={t} className="flex justify-between gap-2"><code className="truncate">{t}</code><span className="num font-semibold">{n}</span></li>)}
              </ul>
            ) : <p className="mt-3 text-[13px] text-[var(--color-muted)]">No calls in the last hour.</p>}
          </div>
          <div className={`rounded-[16px] p-4 ${open ? "bg-[var(--color-bad-soft)]" : "bg-[var(--color-sunken)]"}`}>
            <p className="text-[13px] font-medium text-[var(--color-muted)]">Circuit breaker</p>
            <p className="display mt-1 text-[20px] font-bold leading-tight">{open ? `Open until ${fmtDateTime(st.breaker.openUntil)}` : st.breaker.failures ? `${st.breaker.failures} recent failures` : "Closed (healthy)"}</p>
            {st.breaker.lastError && <p className="mt-1 line-clamp-3 break-words text-[13px] text-[var(--color-bad)]">{st.breaker.lastError}</p>}
            {(open || st.breaker.failures > 0) && (
              <button type="button" className="btn btn-sm mt-3 bg-[var(--color-surface)]" disabled={busy === "reset"} onClick={() => act("reset", "/api/mcp/status", "DELETE")}>{busy === "reset" ? <Spinner /> : null}Reset breaker</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
