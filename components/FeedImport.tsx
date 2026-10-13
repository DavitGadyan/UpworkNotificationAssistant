"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconLink } from "@/components/icons";
import { Spinner } from "@/components/ui/bits";

/** Paste an Upwork URL (Most Recent, Best Matches or a job search) → POST /api/feeds/import. The page itself is never fetched. */
export function FeedImport() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await fetch("/api/feeds/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; name?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: body.error ?? "Import failed" }); return; }
    setMsg({ ok: true, text: `Added “${body.name}”. It is polled from the next run.` });
    setUrl(""); setName("");
    router.refresh();
  };

  return (
    <section className="card mb-6 p-5 md:p-6" aria-labelledby="imp">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--color-control)]"><IconLink size={18} /></span>
        <div className="min-w-0">
          <h2 id="imp" className="display text-[20px] font-semibold">Import from Upwork link</h2>
          <p className="text-[14px] text-[var(--color-muted)]">Paste the address of your Most Recent or Best Matches tab, or of any job search with filters.</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <label className="field"><span className="sr-only">Upwork link</span>
          <input className="input" type="url" required inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.upwork.com/nx/search/jobs/?q=…" />
        </label>
        <label className="field"><span className="sr-only">Feed name (optional)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={60} />
        </label>
        <button type="submit" className="btn btn-dark" disabled={busy || !url.trim()}>{busy ? <><Spinner />Importing…</> : "Import feed"}</button>
      </form>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 rounded-[12px] p-3 text-[14px] ${msg.ok ? "bg-[var(--color-good-soft)] text-[var(--color-good)]" : "bg-[var(--color-bad-soft)] text-[var(--color-bad)]"}`}>{msg.text}</p>}
    </section>
  );
}
