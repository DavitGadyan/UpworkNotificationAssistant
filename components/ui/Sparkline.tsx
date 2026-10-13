/** Area sparkline (template health %). `tone` picks the stroke colour token. */
/** `stretch` lets the chart fill its box regardless of aspect ratio (strokes stay 2px). */
export function Sparkline({ values, tone = "good", width = 120, height = 36, className = "", stretch = false }: {
  values: number[]; tone?: "good" | "bad" | "warn" | "info"; width?: number; height?: number; className?: string; stretch?: boolean;
}) {
  const v = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const max = Math.max(...v, 1), min = Math.min(...v, 0);
  const pts = v.map((y, i) => [(i / (v.length - 1)) * width, height - 3 - ((y - min) / (max - min || 1)) * (height - 8)]);
  // Smooth curve through the points (Catmull-Rom → cubic Bézier).
  const d = pts.reduce((acc, [x, y], i, a) => {
    if (i === 0) return `M${x},${y}`;
    const [x0, y0] = a[i - 2] ?? a[i - 1], [x1, y1] = a[i - 1], [x3, y3] = a[i + 1] ?? [x, y];
    return `${acc} C${x1 + (x - x0) / 6},${y1 + (y - y0) / 6} ${x - (x3 - x1) / 6},${y - (y3 - y1) / 6} ${x},${y}`;
  }, "");
  const color = `var(--color-${tone})`;
  const id = `sg-${tone}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} style={stretch ? undefined : { maxWidth: "100%", height: "auto" }} preserveAspectRatio={stretch ? "none" : undefined} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
