"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DisconnectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={async () => {
      if (!confirm("Disconnect the account? Polling stops until you connect again.")) return;
      setBusy(true);
      await fetch("/api/auth/logout", { method: "POST" });
      setBusy(false);
      router.refresh();
    }}>Disconnect</button>
  );
}
