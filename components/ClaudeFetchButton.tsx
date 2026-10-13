"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui/bits";

type Result = { ms: number; costUsd: number; feeds: { name: string; returned: number; fresh: number; telegram: number; error?: string }[] };

/**
 * Manual refresh through your local Claude Code login + its Upwork connector (Most Recent + Best Matches).
 * Costs ~$0.15 per feed on the Claude subscription, so it asks once before running.
 */
export function ClaudeFetchButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function run() {
    setConfirm(false); setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/fetch/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feeds: ["most_recent", "best_match"] }) });
      const j = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const parts = j.feeds.map((f) => f.error ? `${f.name}: ${f.error}` : `${f.name}: ${f.returned} jobs, ${f.fresh} new, ${f.telegram} alerted`);
      setMsg({ tone: j.feeds.some((f) => f.error) ? "bad" : "good", text: `${parts.join(" · ")} · ${(j.ms / 1000).toFixed(0)}s · $${j.costUsd.toFixed(2)}` });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="relative flex flex-col items-start gap-2">
      <button type="button" className="btn" disabled={busy} onClick={() => setConfirm((c) => !c)} aria-expanded={confirm}>
        {busy ? <Spinner /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" /><path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        {busy ? "Loading via Claude…" : compact ? "Load via Claude" : "Load jobs via Claude"}
      </button>
      {confirm && !busy && (
        <div role="dialog" aria-label="Load jobs via Claude" className="card absolute right-0 top-full z-30 mt-2 w-[min(340px,calc(100vw-32px))] p-4 text-[14px] shadow-lg">
          <p className="font-semibold">Pull Most Recent + Best Matches now?</p>
          <p className="mt-1 text-[var(--color-muted)]">Runs your Claude Code login with its Upwork connector (≈$0.15 per feed on your Claude plan, ~1 min). New jobs go through ranking and alerts as usual.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-dark btn-sm" onClick={run}>Load now</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`max-w-[min(520px,calc(100vw-32px))] text-[13px] ${msg.tone === "bad" ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"}`}>{msg.text}</p>}
    </div>
  );
}
