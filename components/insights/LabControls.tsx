"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui/bits";
import type { LabBoard, LabConfig } from "@/lib/learning/promptLab";

async function post(body: object) {
  const res = await fetch("/api/insights/lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const r = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(r.error ?? `Failed (${res.status})`);
}

/** A/B test switch and which prompt versions take part. Only versions David saved or approved can be picked. */
export function LabControls({ config, versions }: { config: LabConfig; versions: LabBoard["versions"] }) {
  const router = useRouter();
  const [arms, setArms] = useState<Set<number>>(new Set(config.arms));
  const [explore, setExplore] = useState(Math.round(config.explore * 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (enabled: boolean) => {
    setBusy(true); setError(null);
    try { await post({ enabled, arms: [...arms], explore: explore / 100 }); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 rounded-[14px] bg-[var(--color-sunken)] p-3">
      <p className="text-[14px]">
        <b>A/B test {config.enabled ? "on" : "off"}.</b>{" "}
        {config.enabled
          ? "New drafts are spread over the versions below; the one getting more replies gets more drafts (Thompson sampling)."
          : "New drafts use the version you pinned for their scenario, otherwise the active prompt."}
      </p>
      <ul className="mt-2 grid gap-1">
        {versions.map((v) => (
          <li key={v.id}>
            <label className="flex cursor-pointer items-start gap-2 text-[14px]">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={arms.has(v.id)}
                onChange={(e) => setArms((s) => { const n = new Set(s); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n; })} />
              <span>{v.label}{v.active ? " (active)" : ""}{v.note ? <span className="text-[var(--color-muted)]"> · {v.note}</span> : null}{v.createdAt ? <span className="text-[var(--color-muted)]"> · {v.createdAt.slice(0, 10)}</span> : null}</span>
            </label>
          </li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 text-[14px]">
        Keep testing in pinned scenarios <input type="number" min={0} max={50} className="input w-20" value={explore} onChange={(e) => setExplore(Number(e.target.value))} />% of drafts
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm btn-dark" disabled={busy || arms.size < 2} onClick={() => save(true)}>{busy && <Spinner />}{config.enabled ? "Save test" : "Start A/B test"}</button>
        {config.enabled && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => save(false)}>Stop test</button>}
        {arms.size < 2 && <span className="text-[13px] text-[var(--color-muted)]">Tick at least two versions.</span>}
        {error && <span role="alert" className="text-[13px] text-[var(--color-bad)]">{error}</span>}
      </div>
    </div>
  );
}

export function PinButton({ scenario, version, label }: { scenario: string; version: number | null; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn btn-sm" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await post({ pin: { key: scenario, version } }); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>{busy && <Spinner />}{label}</button>
      {error && <span role="alert" className="text-[13px] text-[var(--color-bad)]">{error}</span>}
    </span>
  );
}
