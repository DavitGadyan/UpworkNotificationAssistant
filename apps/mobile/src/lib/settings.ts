import type { Settings } from "../types";
import { fetchSettings, useQuery } from "./data";

/** Settings row (null = not visible → this account is not the owner). Thresholds fall back to web defaults. */
export function useSettings() {
  const q = useQuery("settings", fetchSettings);
  const s = q.data ?? null;
  return {
    ...q,
    settings: s as Partial<Settings> | null,
    noAccess: !q.loading && !q.error && q.data === null,
    th: { callMin: s?.callMin ?? 85, telegramMin: s?.telegramMin ?? 65 },
  };
}
