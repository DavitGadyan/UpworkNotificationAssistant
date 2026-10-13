"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconPause, IconPlay } from "@/components/icons";

export function AlertsToggle({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      aria-pressed={paused}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertsPaused: !paused }) });
        setBusy(false);
        router.refresh();
      }}
    >
      {paused ? <IconPlay size={18} /> : <IconPause size={18} />}
      {paused ? "Resume alerts" : "Pause alerts"}
    </button>
  );
}

export function DemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn" disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch("/api/demo", { method: "POST" });
      setBusy(false);
      router.refresh();
    }}>
      {busy ? "Loading…" : "Load demo jobs"}
    </button>
  );
}
