"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconSpark } from "@/components/icons";
import { Spinner } from "@/components/ui/bits";

const STEPS = ["Reading the job and client history", "Researching the client", "Diagnosing the real problem", "Writing the cover letter", "Answering screening questions"];

/**
 * "Generate proposal draft" → POST /api/jobs/[id]/draft. Takes 1–3 minutes, so it shows elapsed time and
 * a rough step hint. Never auto-runs: the Telegram link (?draft=1) only highlights this panel.
 */
export function DraftPanel({ jobId, highlight = false, existing = 0 }: { jobId: string; highlight?: boolean; existing?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(highlight);
  const [guidance, setGuidance] = useState("");
  const [web, setWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const run = async () => {
    setBusy(true); setError(null); setElapsed(0);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guidance: guidance.trim() || undefined, webSearch: web }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? `Draft failed (${res.status})`);
      router.push(`/proposals/${body.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const step = STEPS[Math.min(STEPS.length - 1, Math.floor(elapsed / 25))];

  return (
    <section id="draft" aria-labelledby="draft-h"
      className={`card p-5 md:p-6 ${highlight ? "border-[var(--color-ink)] ring-2 ring-[var(--color-ink)]/10" : ""}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--color-ink)] text-[var(--color-surface)]"><IconSpark size={18} /></span>
          <div className="min-w-0">
            <h2 id="draft-h" className="display text-[20px] font-semibold">{highlight ? "Draft a proposal for this job?" : "Proposal draft"}</h2>
            <p className="text-[14px] text-[var(--color-muted)]">
              Researches the client, finds the bigger problem behind the post and writes a draft for you to edit. {existing > 0 ? `${existing} draft${existing > 1 ? "s" : ""} already exist below.` : ""} Nothing is sent to Upwork.
            </p>
          </div>
        </div>
        {!open && !busy && <button type="button" className="btn btn-dark shrink-0" onClick={() => setOpen(true)}><IconSpark size={16} />Generate proposal draft</button>}
      </div>

      {(open || busy) && (
        <div className="mt-5 grid gap-4">
          <label className="field"><span>Guidance for the writer (optional)</span>
            <textarea className="input min-h-[96px] py-3" value={guidance} onChange={(e) => setGuidance(e.target.value)} disabled={busy} maxLength={20000}
              placeholder="e.g. Lead with the RAG pipeline I built for a legal client; propose a paid discovery week. Paste the text of any files attached to the job post here so the writer has the full brief." />
          </label>
          <label className="flex items-center gap-3 text-[15px]"><input type="checkbox" className="size-4" checked={web} disabled={busy} onChange={(e) => setWeb(e.target.checked)} />Research the client on the web (slower, finds company and contact)</label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-dark" disabled={busy} onClick={run}>{busy ? <><Spinner />Drafting…</> : <><IconSpark size={16} />Generate proposal draft</>}</button>
            {!busy && <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>}
          </div>
          {busy && (
            <div role="status" className="rounded-[14px] bg-[var(--color-sunken)] p-4">
              <div className="flex items-center justify-between gap-3 text-[14px]">
                <span className="font-medium">{step}…</span>
                <span className="num text-[var(--color-muted)]">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
                <div className="h-full rounded-full bg-[var(--color-ink)] transition-[width] duration-1000" style={{ width: `${Math.min(95, (elapsed / 150) * 100)}%` }} />
              </div>
              <p className="mt-2 text-[13px] text-[var(--color-muted)]">Usually 1–3 minutes. Keep this page open; you will be taken to the draft when it is ready.</p>
            </div>
          )}
          {error && <p role="alert" className="rounded-[12px] bg-[var(--color-bad-soft)] p-3 text-[14px] text-[var(--color-bad)]">{error}</p>}
        </div>
      )}
    </section>
  );
}
