import type { CachedJob, NotificationRow, SavedSearch, Settings } from "./types";

/** Average score per bucket of publish time over the last 24h (oldest → newest), for sparklines. */
export function scoreSeries(jobs: CachedJob[], now = Date.now(), buckets = 12): number[] {
  const span = 864e5 / buckets;
  const sums = Array(buckets).fill(0), counts = Array(buckets).fill(0);
  for (const j of jobs) {
    const age = Math.max(0, now - new Date(j.publishedAt).getTime());
    const b = buckets - 1 - Math.min(buckets - 1, Math.floor(age / span));
    sums[b] += j.score.total; counts[b]++;
  }
  let last = 0;
  return sums.map((s, i) => (counts[i] ? (last = Math.round(s / counts[i])) : last));
}

export function countSeries(rows: { createdAt: string }[], now = Date.now(), buckets = 12): number[] {
  const span = 864e5 / buckets;
  const out = Array(buckets).fill(0);
  for (const r of rows) {
    const age = now - new Date(r.createdAt).getTime();
    if (age <= 864e5) out[buckets - 1 - Math.min(buckets - 1, Math.floor(age / span))]++;
  }
  return out;
}

export function searchStats(search: SavedSearch, jobs: CachedJob[], settings: Settings) {
  const mine = jobs.filter((j) => j.searchId === search.id);
  const scored = mine.filter((j) => !j.score.excluded);
  const matches = scored.filter((j) => j.score.total >= settings.telegramMin);
  const countries = new Map<string, number>();
  mine.forEach((j) => j.client.country && countries.set(j.client.country, (countries.get(j.client.country) ?? 0) + 1));
  const topCountry = [...countries.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    jobs: mine,
    total: mine.length,
    matchRate: mine.length ? Math.round((matches.length / mine.length) * 100) : 0,
    notified: mine.filter((j) => j.status === "notified" || j.status === "called").length,
    called: mine.filter((j) => j.status === "called").length,
    dismissed: mine.filter((j) => j.status === "dismissed").length,
    avg: scored.length ? Math.round(scored.reduce((a, j) => a + j.score.total, 0) / scored.length) : 0,
    top: scored.reduce((a, j) => Math.max(a, j.score.total), 0),
    lastAt: mine.reduce<string | null>((a, j) => (!a || j.fetchedAt > a ? j.fetchedAt : a), null),
    topCountry,
    series: scoreSeries(mine),
  };
}

export function channelStats(rows: NotificationRow[]) {
  const ok = rows.filter((r) => r.ok).length;
  return { sent: ok, failed: rows.length - ok, rate: rows.length ? Math.round((ok / rows.length) * 100) : 0, series: countSeries(rows) };
}
