"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconRefresh } from "@/components/icons";
import { Spinner } from "@/components/ui/bits";

/** Runs one of the slow Insights jobs (POST /api/insights/[action]); shows elapsed time and any error inline. */
export function RunButton({ action, label, body, dark = false, confirmText, done }: {
  action: string; label: string; body?: object; dark?: boolean; confirmText?: string; done?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [t, setT] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const i = setInterval(() => setT(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(i);
  }, [busy]);

  const run = async () => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true); setError(null); setOk(false); setT(0);
    try {
      const res = await fetch(`/api/insights/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const r = (await res.json().catch(() => ({}))) as { error?: string; applied?: boolean };
      if (!res.ok) throw new Error(r.error ?? `Failed (${res.status})`);
      if (r.applied === false) throw new Error("Nothing to apply: the latest calibration has no proposal.");
      setOk(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <button type="button" className={`btn btn-sm ${dark ? "btn-dark" : ""}`} disabled={busy} onClick={run}>
        {busy ? <Spinner /> : <IconRefresh size={15} />}{busy ? `Running… ${t}s` : label}
      </button>
      {busy && t > 8 && <span className="text-[12px] text-[var(--color-muted)]">This can take a few minutes.</span>}
      {ok && !busy && <span role="status" className="text-[13px] text-[var(--color-good)]">{done ?? "Done"}</span>}
      {error && <span role="alert" className="max-w-[320px] text-[13px] text-[var(--color-bad)]">{error}</span>}
    </div>
  );
}
