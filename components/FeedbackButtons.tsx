"use client";

import { useState } from "react";
import { IconThumbDown, IconThumbUp } from "@/components/icons";

/** 👍/👎 for an alert, draft or Closer suggestion → POST /api/feedback. A 👎 asks for an optional reason. */
export function FeedbackButtons({ kind, refId, label = "Was this useful?" }: { kind: "alert" | "draft" | "closer"; refId: string; label?: string }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async (r: 1 | -1, why?: string) => {
    setError(null);
    const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, refId, rating: r, reason: why || undefined }) });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save feedback"); return; }
    setRating(r); setSent(true); setAsking(false);
  };
  const btn = (on: boolean) => `grid size-11 place-items-center rounded-[var(--radius-control)] transition-colors ${on ? "bg-[var(--color-ink)] text-[var(--color-surface)]" : "bg-[var(--color-control)] hover:bg-[var(--color-line)]"}`;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[14px] text-[var(--color-muted)]">{label}</span>
        <button type="button" aria-label="Good" aria-pressed={rating === 1} className={btn(rating === 1)} onClick={() => send(1)}><IconThumbUp size={18} /></button>
        <button type="button" aria-label="Not good" aria-pressed={rating === -1} className={btn(rating === -1)} onClick={() => setAsking(true)}><IconThumbDown size={18} /></button>
        {sent && <span className="text-[14px] text-[var(--color-good)]">Thanks, noted</span>}
      </div>
      {asking && (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); send(-1, reason.trim()); }}>
          <input className="input" autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Why not? (optional)" aria-label="Reason" />
          <button type="submit" className="btn btn-dark shrink-0">Send</button>
        </form>
      )}
      {error && <p role="alert" className="text-[14px] text-[var(--color-bad)]">{error}</p>}
    </div>
  );
}
