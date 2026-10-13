/*
 * Hand-rolled SVG charts for Insights. Colours come from CSS variables (sequential ramp of the accent
 * for the funnel stages), every chart has a <title>/<desc>, per-mark <title> tooltips and a table view.
 */

export interface FunnelRow { period: string; sent: number; viewed: number; offers: number; hired: number }

const STAGES = [
  { key: "sent", label: "Sent", color: "color-mix(in srgb, var(--color-accent) 50%, var(--color-ink))" },
  { key: "viewed", label: "Viewed", color: "var(--color-accent)" },
  { key: "offers", label: "Offers", color: "color-mix(in srgb, var(--color-accent) 62%, var(--color-surface))" },
  { key: "hired", label: "Hired", color: "color-mix(in srgb, var(--color-accent) 40%, var(--color-surface))" },
] as const;

const monthLabel = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + (m === 1 ? ` ’${String(y).slice(2)}` : "");
};

function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (p / 2)) * (p / 2);
}

export function FunnelChart({ rows }: { rows: FunnelRow[] }) {
  const H = 220, padL = 30, padB = 26, padT = 18;
  const groupW = 54, barW = 9, gap = 2;
  const W = padL + rows.length * groupW + 8;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.sent)));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <figure className="m-0">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--color-muted)]" aria-hidden>
        {STAGES.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="mt-3 overflow-x-auto">
        <svg role="img" viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ minWidth: rows.length * 44, maxWidth: W * 1.3 }} aria-labelledby="fun-t fun-d">
          <title id="fun-t">Proposal funnel per month</title>
          <desc id="fun-d">{rows.map((r) => `${r.period}: ${r.sent} sent, ${r.viewed} viewed, ${r.offers} offers, ${r.hired} hired`).join("; ")}</desc>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)" className="num">{t}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x0 = padL + i * groupW + (groupW - (barW * 4 + gap * 3)) / 2;
            return (
              <g key={r.period}>
                {STAGES.map((s, j) => {
                  const v = r[s.key];
                  const h = Math.max(v > 0 ? 3 : 0, y(0) - y(v));
                  const x = x0 + j * (barW + gap);
                  return (
                    <g key={s.key}>
                      <title>{`${monthLabel(r.period)} · ${s.label}: ${v}`}</title>
                      <rect x={x - 1} y={padT} width={barW + 2} height={H - padT - padB} fill="transparent" />
                      {v > 0 && <path d={roundedTop(x, y(0) - h, barW, h, 3)} fill={s.color} />}
                    </g>
                  );
                })}
                <text x={x0 + (barW * 4 + gap * 3) / 2} y={y(r.sent) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-ink)" className="num">{r.sent}</text>
                <text x={padL + i * groupW + groupW / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-muted)">{monthLabel(r.period)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[13px] text-[var(--color-muted)]">Table view</summary>
        <DataTable head={["Month", "Sent", "Viewed", "Offers", "Hired"]} rows={rows.map((r) => [r.period, r.sent, r.viewed, r.offers, r.hired])} />
      </details>
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Win rate (hired / sent) across snapshots: one series, 2px line, 8px markers with tooltips. */
export function WinRateChart({ points }: { points: { period: string; rate: number | null }[] }) {
  const H = 170, padL = 34, padR = 12, padT = 16, padB = 26, W = 560;
  const vals = points.map((p) => p.rate).filter((v): v is number => v != null);
  const max = Math.max(10, Math.ceil(Math.max(0, ...vals) / 5) * 5);
  const n = points.length;
  const x = (i: number) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const pts = points.map((p, i) => (p.rate == null ? null : ([x(i), y(p.rate), p] as const))).filter(Boolean) as [number, number, (typeof points)[number]][];
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <figure className="m-0">
      <svg role="img" viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-labelledby="wr-t wr-d">
        <title id="wr-t">Win rate per month</title>
        <desc id="wr-d">{points.map((p) => `${p.period}: ${p.rate == null ? "no proposals" : p.rate.toFixed(1) + "%"}`).join("; ")}</desc>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)">{t}%</text>
          </g>
        ))}
        {pts.length > 1 && <path d={d} fill="none" stroke="var(--color-good)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map(([px, py, p]) => (
          <g key={p.period}>
            <title>{`${monthLabel(p.period)}: ${p.rate!.toFixed(1)}% win rate`}</title>
            <circle cx={px} cy={py} r="12" fill="transparent" />
            <circle cx={px} cy={py} r="4" fill="var(--color-good)" stroke="var(--color-surface)" strokeWidth="2" />
          </g>
        ))}
        {last && <text x={Math.min(last[0], W - padR - 4)} y={last[1] - 10} textAnchor="end" fontSize="12" fontWeight="600" fill="var(--color-ink)">{last[2].rate!.toFixed(1)}%</text>}
        {points.map((p, i) => (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) && (
          <text key={p.period} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-muted)">{monthLabel(p.period)}</text>
        ))}
      </svg>
    </figure>
  );
}

/** Horizontal share bars (revenue by country). Single hue, values as text. */
export function ShareBars({ items, format }: { items: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="grid gap-2.5" aria-label="Share by country">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_auto] items-center gap-3 text-[14px]">
          <span className="truncate">{it.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-[var(--color-control)]" title={`${it.label}: ${format(it.value)}`}>
            <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${(it.value / max) * 100}%` }} />
          </span>
          <span className="num font-semibold">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-[14px]">
        <thead><tr className="text-[var(--color-muted)]">{head.map((h) => <th key={h} className="py-1.5 pr-4 font-medium">{h}</th>)}</tr></thead>
        <tbody className="num">{rows.map((r, i) => <tr key={i} className="border-t border-[var(--color-line)]">{r.map((c, j) => <td key={j} className="py-1.5 pr-4">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
