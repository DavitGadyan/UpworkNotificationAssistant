/*
 * Jobs list filters shared by the server page and the client controls. Dates are when the job was posted on
 * Upwork. With no date params the list shows the last 24 hours; a calendar pick is sent as since/until (epoch ms,
 * computed in the browser's timezone) so the server never has to guess the viewer's timezone.
 */

export const DATE_PRESETS = [
  { value: "24h", label: "Last 24 hours", ms: 864e5 },
  { value: "3d", label: "Last 3 days", ms: 3 * 864e5 },
  { value: "7d", label: "Last 7 days", ms: 7 * 864e5 },
  { value: "all", label: "Any date", ms: 0 },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]["value"];

export interface DateWindow { since: number | null; until: number | null; preset: DatePreset | null }

export function dateWindow(p: { range?: string; since?: string; until?: string }, now = Date.now()): DateWindow {
  const since = Number(p.since), until = Number(p.until);
  if (Number.isFinite(since) && since > 0) return { since, until: Number.isFinite(until) && until > since ? until : null, preset: null };
  const preset = DATE_PRESETS.find((d) => d.value === p.range) ?? DATE_PRESETS[0];
  return { since: preset.ms ? now - preset.ms : null, until: null, preset: preset.value };
}

/** Score range from URL params: 0–100, min ≤ max. */
export function scoreWindow(p: { min?: string; max?: string }): { min: number; max: number } {
  const read = (v: string | undefined, fallback: number) => {
    const n = v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
  };
  const min = read(p.min, 0), max = read(p.max, 100);
  return min <= max ? { min, max } : { min: max, max: min };
}

/** Posted time in ms, falling back to when the assistant fetched the job. */
export const postedMs = (j: { publishedAt: string; fetchedAt?: string }) => Date.parse(j.publishedAt) || (j.fetchedAt ? Date.parse(j.fetchedAt) : 0);
