"use client";

import { useEffect, useState } from "react";

/** "$0.42 / $1.00 today" from GET /api/mcp/status (llmSpendToday). Renders a fallback until the backend reports it. */
export function LlmSpend({ budget, fallback = "—" }: { budget: number | null | undefined; fallback?: string }) {
  const [spend, setSpend] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch("/api/mcp/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { llmSpendToday?: number } | null) => alive && setSpend(typeof j?.llmSpendToday === "number" ? j.llmSpendToday : null))
      .catch(() => alive && setSpend(null));
    return () => { alive = false; };
  }, []);
  if (spend === undefined) return <span className="text-[var(--color-faint)]">…</span>;
  if (spend === null) return <span>{budget != null ? `budget $${budget.toFixed(2)}/day` : fallback}</span>;
  return <span className="num">${spend.toFixed(2)}{budget != null ? ` / $${budget.toFixed(2)}` : ""} today</span>;
}
