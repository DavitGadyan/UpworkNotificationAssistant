/** "Assets: 11 / Lines: 2 / Orders: 17" label-value grid. Every row has a hairline above it, as in the template card. */
export function StatGrid({ items, cols = 3 }: { items: { label: string; value: React.ReactNode }[]; cols?: 2 | 3 }) {
  return (
    <dl className={`grid ${cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 items-baseline gap-2 border-t border-[var(--color-line)] py-2.5 pr-3">
          <dt className="stat-label truncate">{it.label}:</dt>
          <dd className="num font-semibold">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
