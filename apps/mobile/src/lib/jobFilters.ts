/*
 * Jobs tab filters (same rules as the web app's lib/jobFilters.ts). Dates are when the job was posted on
 * Upwork; the tab opens on the last 24 hours. A calendar pick is a local-day range in epoch ms.
 */

export const DATE_PRESETS = [
  { value: "24h", label: "24 hours", ms: 864e5 },
  { value: "3d", label: "3 days", ms: 3 * 864e5 },
  { value: "7d", label: "7 days", ms: 7 * 864e5 },
  { value: "all", label: "Any date", ms: 0 },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]["value"];
export type DateFilter = { preset: DatePreset } | { since: number; until: number };

export const DEFAULT_DATE: DateFilter = { preset: "24h" };

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function dateLabel(f: DateFilter): string {
  if ("preset" in f) return DATE_PRESETS.find((p) => p.value === f.preset)!.label;
  const a = short.format(f.since), b = short.format(f.until);
  return a === b ? a : `${a} – ${b}`;
}

/** Posted time in ms, falling back to when the worker fetched the job. */
export const postedMs = (j: { publishedAt: string; fetchedAtMs: number }) => Date.parse(j.publishedAt) || j.fetchedAtMs;

export function inDateFilter(t: number, f: DateFilter, now = Date.now()): boolean {
  if ("preset" in f) {
    const ms = DATE_PRESETS.find((p) => p.value === f.preset)!.ms;
    return !ms || t >= now - ms;
  }
  return t >= f.since && t <= f.until;
}

export const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dayEnd = (t: number) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };
