"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui/bits";

const FIELDS = [
  { key: "profileViews", label: "Profile views" },
  { key: "searchAppearances", label: "Search appearances" },
  { key: "invites", label: "Invites received" },
];

/** Numbers Upwork's connector does not expose, typed in from the Upwork "My stats" page. */
export function ManualMetricsForm() {
  const router = useRouter();
  const now = new Date();
  const [period, setPeriod] = useState(new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
    if (!Object.keys(values).length) { setMsg({ ok: false, text: "Enter at least one number" }); return; }
    setBusy(true); setMsg(null);
    const res = await fetch("/api/insights/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period, values }) });
    const r = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: r.error ?? "Could not save" }); return; }
    setMsg({ ok: true, text: `Saved for ${period}. Included in the next snapshot of that month.` });
    setVals({});
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <label className="field"><span>Month</span><input className="input num" type="month" required value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        {FIELDS.map((f) => (
          <label key={f.key} className="field"><span>{f.label}</span>
            <input className="input num" type="number" min="0" inputMode="numeric" value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} /></label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? <><Spinner />Saving…</> : "Save numbers"}</button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[14px] ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
