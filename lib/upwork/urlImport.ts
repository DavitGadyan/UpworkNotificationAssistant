import type { SavedSearch } from "../types";

export type FeedInput = Omit<SavedSearch, "id" | "createdAt">;

const blank = (name: string, kind: SavedSearch["kind"], url: string): FeedInput => ({
  name, enabled: true, kind, skills: [], query: "", jobType: "ANY", minHourly: null, minBudget: null,
  experienceLevel: "ANY", verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: [], excludeCountries: [],
  sourceUrl: url,
});

/** Lower bounds of "500-999,1000-4999,5000-" → smallest = 500. */
const minOfRanges = (v: string | null) => {
  if (!v) return null;
  const lows = v.split(",").map((r) => Number(r.split("-")[0])).filter((x) => Number.isFinite(x));
  return lows.length ? Math.min(...lows) : null;
};
/** Upper bounds of "0-4,5-9,10-14,15-19" → largest = 19 (open-ended "50-" → null = no cap). */
const maxOfRanges = (v: string | null) => {
  if (!v) return null;
  const highs = v.split(",").map((r) => r.split("-")[1]);
  if (highs.some((h) => h === "" || h == null)) return null;
  const nums = highs.map(Number).filter((x) => Number.isFinite(x));
  return nums.length ? Math.max(...nums) : null;
};

/**
 * Turn an Upwork web URL into a feed. Supported:
 *   /nx/find-work/most-recent   → Most Recent feed
 *   /nx/find-work/ (best-matches) → Best Matches feed
 *   /nx/search/jobs?…           → filtered search (amount, hourly_rate, payment_verified, proposals, q, t, contractor_tier)
 * The URL is only parsed here - the page itself is never fetched (no scraping).
 */
export function importUpworkUrl(raw: string): FeedInput | string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return "Not a valid URL"; }
  if (!/(^|\.)upwork\.com$/.test(u.hostname)) return "Only upwork.com links can be imported";
  const path = u.pathname.replace(/\/+$/, "");
  if (/\/find-work\/most-recent$/.test(path)) return blank("Most Recent", "most_recent", raw);
  if (/\/find-work(\/best-matches)?$/.test(path)) return blank("Best Matches", "best_match", raw);
  if (!/\/search\/jobs$/.test(path)) return "Unsupported Upwork page - use Most Recent, Best Matches or a job search link";

  const p = u.searchParams;
  const f = blank("Saved search", "search", raw);
  f.query = (p.get("q") ?? "").trim();
  f.minBudget = minOfRanges(p.get("amount"));
  f.minHourly = minOfRanges(p.get("hourly_rate"));
  f.verifiedPaymentOnly = p.get("payment_verified") === "1";
  f.maxProposals = maxOfRanges(p.get("proposals"));
  const t = (p.get("t") ?? "").split(",").filter(Boolean);
  f.jobType = t.length === 1 ? (t[0] === "0" ? "HOURLY" : "FIXED") : "ANY";
  const tier = (p.get("contractor_tier") ?? "").split(",").filter(Boolean);
  if (tier.length === 1) f.experienceLevel = (["ENTRY_LEVEL", "INTERMEDIATE", "EXPERT"] as const)[Number(tier[0]) - 1] ?? "ANY";
  const words = f.query.replace(/[()"]/g, " ").split(/\s+OR\s+|\s+/).filter((w) => w && w !== "OR");
  f.name = words.length ? `Search: ${[...new Set(words)].slice(0, 4).join(", ")}${words.length > 4 ? "…" : ""}` : "Saved search";
  return f;
}
