"use client";

import { UpworkLink } from "@/components/UpworkLink";
import Link from "next/link";
import { useState } from "react";
import { IconChevronDown, IconChevronUp, IconPhone, IconSend } from "@/components/icons";
import { Sparkline } from "@/components/ui/Sparkline";
import type { NotificationRow } from "@/lib/types";

/**
 * Nested "line" card (template: Mixing Line B): title + count right, UPD timestamp, big % + area
 * chart, two stats with a divider, then a gray inner panel with child cards and a View more/less toggle.
 */
export function LineCard({ title, channel, rows, sent, failed, rate, series, rule }: {
  title: string; channel: "telegram" | "call"; rows: NotificationRow[];
  sent: number; failed: number; rate: number; series: number[]; rule: string;
}) {
  const [open, setOpen] = useState(false);
  const tone = rows.length === 0 ? "info" : rate >= 90 ? "good" : rate >= 60 ? "warn" : "bad";
  const shown = open ? rows : rows.slice(0, 2);
  const Icon = channel === "call" ? IconPhone : IconSend;
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <section className="card p-5 md:p-6" aria-labelledby={`line-${channel}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={`line-${channel}`} className="display text-[22px] font-semibold">{title}</h2>
        <span className="display num text-[18px] text-[var(--color-muted)]">{sent}/{rows.length} sent</span>
      </div>
      <p className="mt-1 text-[var(--color-muted)]">{rows[0] ? `UPD: ${fmt(rows[0].createdAt)}` : "No deliveries in the last 24h"}</p>
      <div className="mt-3">
        <span className="display num block text-[40px] font-bold leading-none" style={{ color: rows.length ? `var(--color-${tone})` : "var(--color-faint)" }}>{rows.length ? `${rate}%` : "—"}</span>
        {rows.length > 0
          ? <Sparkline values={series} tone={tone} width={560} height={64} stretch className="mt-2 block h-16 w-full" />
          : <div aria-hidden className="mt-2 h-16 border-b border-dashed border-[var(--color-line)]" />}
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-muted)]">{rule}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 border-y border-[var(--color-line)] py-3">
        <div className="flex items-baseline gap-2"><dt className="stat-label">Delivered:</dt><dd className="num font-semibold">{sent}</dd></div>
        <div className="flex items-baseline gap-2"><dt className="stat-label">Failed:</dt><dd className="num font-semibold">{failed}</dd></div>
      </dl>

      <div className="mt-4 rounded-[16px] bg-[var(--color-sunken)] p-3 md:p-4">
        <p className="mb-3 font-medium">Recent:</p>
        {shown.length === 0 && <p className="px-1 pb-1 text-[14px] text-[var(--color-muted)]">Nothing yet.</p>}
        <ul className="grid gap-3">
          {shown.map((r) => (
            <li key={r.id} className="card min-w-0 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-chip)]" style={{ color: r.ok ? "var(--color-good)" : "var(--color-bad)" }}><Icon size={18} /></span>
                  <span className="text-[var(--color-muted)]">{r.ok ? "Delivered" : "Failed"}</span>
                </span>
                <span className="num font-semibold">{r.score}%</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-3">
                <div className="min-w-0">
                  <Link href={`/jobs/${encodeURIComponent(r.jobId)}`} className="display block truncate text-[17px] font-semibold hover:underline">{r.title}</Link>
                  <p className="mt-0.5 truncate text-[14px] text-[var(--color-muted)]">{r.detail} <span className="text-[var(--color-faint)]">/</span> {fmt(r.createdAt)}</p>
                  <UpworkLink jobId={r.jobId} className="mt-1" />
                </div>
                <span className={`pill shrink-0 ${r.ok ? "pill-good" : "pill-bad"}`}>{r.ok ? "Sent" : "Error"}</span>
              </div>
            </li>
          ))}
        </ul>
        {rows.length > 2 && (
          <button type="button" className="mt-3 flex w-full items-center justify-center gap-2 rounded-[12px] py-2 font-medium hover:bg-[var(--color-control)]" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}{open ? "View less" : `View all ${rows.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
