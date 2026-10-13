"use client";

import { useSyncExternalStore } from "react";
import { tokens } from "@/lib/tokens";

/*
 * Colour-scheme preference: "system" follows prefers-color-scheme, "light"/"dark" pin it.
 * Stored in localStorage (instant on the next load) and a `theme` cookie (so the server renders the right
 * data-theme too). The inline script in app/layout.tsx applies it before first paint.
 */
export type ThemePref = "system" | "light" | "dark";
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark"];
const EVENT = "themepref";

const isPref = (v: unknown): v is ThemePref => v === "system" || v === "light" || v === "dark";

export function readPref(): ThemePref {
  if (typeof document === "undefined") return "system";
  const v = document.documentElement.dataset.theme;
  return isPref(v) ? v : "system";
}

export function syncThemeColor(pref: ThemePref) {
  // Two media-scoped <meta name="theme-color"> tags come from the viewport export. A pinned choice must win
  // over the OS, so point both at the chosen colour; "system" restores each tag to its own scheme.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const own = (m.media ?? "").includes("dark") ? tokens.dark.ground : tokens.color.ground;
    m.content = pref === "system" ? own : pref === "dark" ? tokens.dark.ground : tokens.color.ground;
  });
}

export function applyPref(pref: ThemePref) {
  document.documentElement.dataset.theme = pref;
  try { localStorage.setItem("theme", pref); } catch { /* private mode: cookie still persists it */ }
  document.cookie = `theme=${pref}; path=/; max-age=31536000; samesite=lax`;
  syncThemeColor(pref);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}

/** Current preference + setter, shared by every toggle on the page. */
export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as ThemePref);
  return [pref, applyPref];
}

