"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui/bits";
import type { Lesson } from "@/lib/learning/lessons";

const AREA: Record<Lesson["area"], string> = {
  job_choice: "Job choice", timing: "Timing", first_line: "First line", cover_letter: "Cover letter", proof: "Proof", bid: "Bid", your_edits: "Your edits", other: "Other",
};

/** Per-lesson checkboxes; nothing changes in the prompts until David approves. */
export function LessonsApproval({ reportId, lessons, decided }: { reportId: number; lessons: Lesson[]; decided: { status: string; ids: string[]; at: string } | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set(lessons.filter((l) => l.confidence !== "low").map((l) => l.id)));
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (kind: "approve" | "reject") => {
    if (kind === "approve" && !confirm(`Add ${picked.size} lesson${picked.size === 1 ? "" : "s"} to the proposal writer / ranker prompts? You can roll back in Settings → Prompts.`)) return;
    setBusy(kind); setError(null);
    try {
      const res = await fetch(`/api/insights/${kind}-lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, ids: [...picked] }) });
      const r = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(r.error ?? `Failed (${res.status})`);
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {lessons.map((l) => {
          const on = decided ? decided.ids.includes(l.id) : picked.has(l.id);
          return (
            <li key={l.id} className="rounded-[14px] border border-[var(--color-line)] p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={on} disabled={!!decided}
                  onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="pill pill-neutral">{l.target === "writer" ? "Writer" : "Ranker"} · {AREA[l.area]}</span>
                    <span className={`pill ${l.confidence === "high" ? "pill-good" : l.confidence === "medium" ? "pill-info" : "pill-neutral"}`}>{l.confidence} · {l.support} proposals</span>
                  </span>
                  <span className="mt-1.5 block font-medium">{l.lesson}</span>
                  <span className="mt-0.5 block text-[13px] text-[var(--color-muted)]">{l.evidence}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {decided ? (
        <p className="text-[13px] text-[var(--color-muted)]">{decided.status === "approved" ? `Approved ${decided.ids.length} on ${decided.at.slice(0, 10)} - now part of the prompts (Settings → Prompts to roll back).` : `Rejected on ${decided.at.slice(0, 10)}.`}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm btn-dark" disabled={!!busy || !picked.size} onClick={() => send("approve")}>{busy === "approve" && <Spinner />}Approve {picked.size} selected</button>
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => send("reject")}>{busy === "reject" && <Spinner />}Reject all</button>
          {error && <span role="alert" className="text-[13px] text-[var(--color-bad)]">{error}</span>}
        </div>
      )}
    </div>
  );
}
