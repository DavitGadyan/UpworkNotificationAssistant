import type { ReactNode } from "react";

/* Small presentational pieces shared by server and client components. */

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`shrink-0 animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Note({ tone = "neutral", children, className = "" }: { tone?: "bad" | "good" | "warn" | "info" | "neutral"; children: ReactNode; className?: string }) {
  const cls = {
    bad: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]",
    good: "bg-[var(--color-good-soft)] text-[var(--color-good)]",
    warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
    info: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
    neutral: "bg-[var(--color-sunken)] text-[var(--color-muted)]",
  }[tone];
  return <p role={tone === "bad" ? "alert" : undefined} className={`rounded-[12px] p-3 text-[14px] ${cls} ${className}`}>{children}</p>;
}

/** Card section title row: display h2 + optional right-aligned slot. */
export function CardHead({ id, title, right, sub }: { id?: string; title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={id} className="display text-[20px] font-semibold">{title}</h2>
        {right}
      </div>
      {sub && <p className="mt-1 text-[14px] text-[var(--color-muted)]">{sub}</p>}
    </>
  );
}

/** Empty state block used inside cards and pages. */
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
      <h2 className="display text-[20px] font-semibold">{title}</h2>
      <div className="max-w-md text-[var(--color-muted)]">{children}</div>
      {action}
    </div>
  );
}

/** Bulleted list with hairline dividers; renders nothing for an empty list. */
export function Bullets({ items, tone }: { items: string[] | undefined | null; tone?: "bad" | "good" | "warn" }) {
  if (!items?.length) return null;
  const dot = tone ? `var(--color-${tone})` : "var(--color-faint)";
  return (
    <ul className="grid gap-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed">
          <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full" style={{ background: dot }} />
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  );
}
