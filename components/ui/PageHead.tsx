import type { ReactNode } from "react";

/** Uppercase display title + muted subtitle, actions right-aligned (template "EXPLORER" / "DEVICES" head). */
export function PageHead({ title, subtitle, actions, meta, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {children}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] text-[var(--color-muted)]">{subtitle}</p>}
        {meta && <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-[var(--color-muted)]">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </header>
  );
}
