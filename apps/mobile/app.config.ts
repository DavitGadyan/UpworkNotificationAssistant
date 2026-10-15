import type { ExpoConfig } from "expo/config";

/*
 * Display name "Up Assistant". Linked to EAS project "myupwork" (266fe118-…). Scheme and bundle id/package
 * stay "pulse".
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://odijvbiyojhklxffgufs.supabase.co";
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? "sb_publishable_VkNHm8vJSllWVZ8IzF7l5w_hhq2me-a";
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://jobs.s1mpleai.org";
const PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "266fe118-a610-4e68-82d5-580301abd2f4"; // EAS project "myupwork"

const config: ExpoConfig = {
  name: "Up Assistant",
  slug: "myupwork", // must match the EAS project
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "pulse",
  userInterfaceStyle: "automatic",
  description: "Job alerts, ranking and proposal drafting assistant.",
  ios: {
    bundleIdentifier: "org.s1mpleai.pulse",
    supportsTablet: false,
    infoPlist: { CADisableMinimumFrameDurationOnPhone: true, ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: "org.s1mpleai.pulse",
    // White "up" glyph inside the 66dp safe zone over the green gradient; the glyph doubles as the themed icon.
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundImage: "./assets/adaptive-background.png",
      monochromeImage: "./assets/adaptive-icon.png",
      backgroundColor: "#12B80D",
    },
    predictiveBackGestureEnabled: false,
  },
  web: { output: "static", favicon: "./assets/favicon.png" },
  plugins: [
    "expo-router",
    "expo-font",
    ["expo-splash-screen", { backgroundColor: "#191A1B", image: "./assets/splash-icon.png", imageWidth: 120 }],
    ["expo-notifications", { color: "#1F6FEB" }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
    apiUrl: API_URL,
    ...(PROJECT_ID ? { eas: { projectId: PROJECT_ID } } : {}),
  },
};

export default config;
