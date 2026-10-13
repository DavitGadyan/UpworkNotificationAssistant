import { useColorScheme } from "react-native";
import { cubicBezier } from "react-native-reanimated";
import { useThemePref } from "./lib/themePref";

/*
 * Design tokens - mirrors the web app's app/globals.css (neutral theme) and lib/tokens.ts.
 * Light values are copied 1:1; dark values keep the same roles (the web dark palette is close to these).
 * The scheme follows the OS unless the user pins Light or Dark in Settings → Appearance (lib/themePref.ts).
 */
const light = {
  ground: "#F0F2F4",
  frame: "#FFFFFF",
  surface: "#FFFFFF",
  sunken: "#F5F6F8",
  control: "#F0F2F4",
  track: "#E4E7EB",
  raised: "#FFFFFF",
  line: "#E6E8EB",
  ink: "#191A1B",
  muted: "#6F7175",
  faint: "#A3A5A8",
  accent: "#1F6FEB",
  accentStrong: "#1858BC",
  accentSoft: "#E8F0FD",
  onAccent: "#FFFFFF",
  good: "#178A43",
  goodSoft: "#E6F5EC",
  warn: "#9A7020",
  warnSoft: "#F7EFDC",
  bad: "#D23A3A",
  badSoft: "#FBE8E8",
  info: "#1858BC",
  infoSoft: "#E8F0FD",
};

export type Palette = typeof light;

const dark: Palette = {
  ground: "#0E0F11",
  frame: "#151619",
  surface: "#17181B",
  sunken: "#1C1D21",
  control: "#24262A",
  track: "#202226",
  raised: "#34373D",
  line: "#2A2C31",
  ink: "#EDEEF0",
  muted: "#9A9CA1",
  faint: "#6B6E73",
  accent: "#4C8DF6",
  accentStrong: "#6FA3F7",
  accentSoft: "#17263F",
  onAccent: "#FFFFFF",
  good: "#4CC27A",
  goodSoft: "#14301F",
  warn: "#DDAA4A",
  warnSoft: "#33290F",
  bad: "#F06A6A",
  badSoft: "#3A1818",
  info: "#7AAAF8",
  infoSoft: "#17263F",
};

export const radius = { card: 20, control: 12, pill: 6, seg: 14 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const font = {
  display: "SpaceGrotesk_700Bold",
  displaySemi: "SpaceGrotesk_600SemiBold",
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;

/** Motion constants (see animate-expo skill): strong ease-out for UI, never ease-in. */
export const motion = {
  easeOutCss: cubicBezier(0.23, 1, 0.32, 1),
  press: "120ms",
  state: "180ms",
} as const;

export type Tone = "good" | "warn" | "bad" | "info" | "neutral";

export function useTheme() {
  const system = useColorScheme();
  const pref = useThemePref();
  const isDark = (pref === "system" ? system : pref) === "dark";
  return { c: isDark ? dark : light, dark: isDark };
}

export function toneColors(c: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "good": return { fg: c.good, bg: c.goodSoft };
    case "warn": return { fg: c.warn, bg: c.warnSoft };
    case "bad": return { fg: c.bad, bg: c.badSoft };
    case "info": return { fg: c.info, bg: c.infoSoft };
    default: return { fg: c.muted, bg: c.control };
  }
}

export const palettes = { light, dark };
