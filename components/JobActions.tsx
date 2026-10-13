"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconExternal } from "@/components/icons";
import { jobUrl } from "@/lib/format";
import type { JobStatus } from "@/lib/types";

/** Primary actions on job detail. Applying always happens on the marketplace itself. */
export function JobActions({ id, ciphertext, status }: { id: string; ciphertext: string; status: JobStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status === "dismissed" ? "new" : "dismissed" }),
    });
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="flex shrink-0 gap-2.5">
      <button type="button" className="btn" disabled={busy} onClick={toggle}>{status === "dismissed" ? "Restore" : "Dismiss"}</button>
      <a className="btn btn-dark" href={jobUrl(ciphertext)} target="_blank" rel="noopener noreferrer">Open in Upwork <IconExternal size={16} /></a>
    </div>
  );
}
