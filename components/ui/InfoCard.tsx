import type { ReactNode } from "react";

/**
 * Status card from the drill-down grid: TAG + status right, title, muted sub-line, divider,
 * icon tile + label + value. Used for score parts, client facts and alert deliveries.
 */
export function InfoCard({ tag, status, statusCls = "", title, sub, icon, footLabel, footValue }: {
  tag: string; status?: ReactNode; statusCls?: string; title: ReactNode; sub?: ReactNode;
  icon: ReactNode; footLabel: string; footValue: ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="tag">{tag}</span>
        {status != null && <span className={`pill ${statusCls}`}>{status}</span>}
      </div>
      <h3 className="mt-3 text-[17px] font-semibold leading-snug">{title}</h3>
      {sub && <p className="mt-1 text-[14px] text-[var(--color-muted)]">{sub}</p>}
      <div className="mt-4 flex items-center gap-3 border-t border-[var(--color-line)] pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-chip)]">{icon}</span>
        <span className="text-[14px] text-[var(--color-muted)]">{footLabel}</span>
        <span className="num ml-auto text-right font-semibold">{footValue}</span>
      </div>
    </div>
  );
}
