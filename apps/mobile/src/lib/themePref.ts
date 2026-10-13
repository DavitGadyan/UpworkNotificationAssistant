import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

/*
 * Manual colour-scheme choice (Settings → Appearance): "system" follows the OS, "light"/"dark" pin it.
 * Persisted in AsyncStorage and pushed into Appearance.setColorScheme so native pieces (keyboard, alerts,
 * Switch, date pickers) match too. useTheme() in src/theme.ts reads it as well, so it also works where
 * setColorScheme is a no-op (web).
 */
export type ThemePref = "system" | "light" | "dark";
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark"];
const KEY = "pulse.themePref";

let pref: ThemePref = "system";
let ready = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function apply(p: ThemePref) {
  try { Appearance.setColorScheme(p === "system" ? "unspecified" : p); } catch { /* unsupported platform */ }
}

// Load once at import; the root layout waits for `ready` so the first frame already has the right scheme.
AsyncStorage.getItem(KEY)
  .then((v) => { if (v === "light" || v === "dark" || v === "system") { pref = v; apply(v); } })
  .catch(() => {})
  .finally(() => { ready = true; emit(); });

export function setThemePref(p: ThemePref) {
  pref = p;
  apply(p);
  emit();
  AsyncStorage.setItem(KEY, p).catch(() => {});
}

export const useThemePref = () => useSyncExternalStore(subscribe, () => pref, () => pref);
export const useThemePrefReady = () => useSyncExternalStore(subscribe, () => ready, () => ready);
