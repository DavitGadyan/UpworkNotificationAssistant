import { upworkProfile } from "../agents/profile";
import { getSettings } from "../db";
import { buildFieldSpec, type FieldSpec } from "./fields";

/* The field lists the worker uses: built-in + Settings → Your fields + skills synced from his Upwork profile. */
let cache: { at: number; spec: FieldSpec } | null = null;

export async function currentFieldSpec(now = Date.now()): Promise<FieldSpec> {
  if (cache && now - cache.at < 5 * 60_000) return cache.spec;
  const [s, profile] = await Promise.all([getSettings(), upworkProfile()]);
  const spec = buildFieldSpec(s.profileFit, profile?.skills ?? []);
  cache = { at: now, spec };
  return spec;
}

/** Settings were saved or the profile re-synced: rebuild on next use. */
export const resetFieldSpecCache = () => { cache = null; };
