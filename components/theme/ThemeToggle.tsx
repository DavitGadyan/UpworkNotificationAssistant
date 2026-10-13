"use client";

import { useEffect } from "react";
import { IconMonitor, IconMoon, IconSun } from "@/components/icons";
import { syncThemeColor, THEME_PREFS, useThemePref, type ThemePref } from "./theme";

const META: Record<ThemePref, { label: string; Icon: typeof IconSun }> = {
  system: { label: "System", Icon: IconMonitor },
  light: { label: "Light", Icon: IconSun },
  dark: { label: "Dark", Icon: IconMoon },
};

/** Top-bar icon button: cycles System → Light → Dark. The icon shows the current choice. */
export function ThemeCycleButton() {
  const [pref, setPref] = useThemePref();
  useEffect(() => syncThemeColor(pref), [pref]);
  const next = THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];
  const { Icon, label } = META[pref];
  return (
    <button type="button" onClick={() => setPref(next)} className="icon-btn hover:bg-[var(--color-control)]"
      aria-label={`Theme: ${label}. Switch to ${META[next].label}`} title={`Theme: ${label}`}>
      <Icon size={21} />
    </button>
  );
}

/** Settings → Appearance: System / Light / Dark segmented control. */
export function ThemeSegmented() {
  const [pref, setPref] = useThemePref();
  return (
    <div role="radiogroup" aria-label="Colour theme" className="seg">
      {THEME_PREFS.map((p) => {
        const { Icon, label } = META[p];
        return (
          <button key={p} type="button" role="radio" aria-checked={pref === p} aria-pressed={pref === p}
            className="seg-item" onClick={() => setPref(p)}>
            <Icon size={17} />{label}
          </button>
        );
      })}
    </div>
  );
}
