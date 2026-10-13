"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconDots } from "@/components/icons";
import { jobUrl } from "@/lib/format";
import type { JobStatus } from "@/lib/types";

/** The "..." menu on a job card: open on the marketplace, dismiss / restore. */
export function JobMenu({ id, ciphertext, status }: { id: string; ciphertext: string; status: JobStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const setStatus = async (next: JobStatus) => {
    setOpen(false);
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    router.refresh();
  };
  const item = "block w-full rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[var(--color-control)]";

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Job actions" aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        className="grid size-10 place-items-center rounded-lg text-[var(--color-ink)] hover:bg-[var(--color-control)] md:size-8">
        <IconDots size={18} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-10 w-44 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-pop)]">
          <a role="menuitem" className={item} href={jobUrl(ciphertext)} target="_blank" rel="noopener noreferrer">Open job ↗</a>
          {status === "dismissed"
            ? <button role="menuitem" className={item} onClick={() => setStatus("new")}>Restore</button>
            : <button role="menuitem" className={item} onClick={() => setStatus("dismissed")}>Dismiss</button>}
        </div>
      )}
    </div>
  );
}
