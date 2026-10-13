import Constants from "expo-constants";

type Extra = { supabaseUrl?: string; supabaseKey?: string; apiUrl?: string; eas?: { projectId?: string } };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || "",
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY || extra.supabaseKey || "",
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || "https://jobs.s1mpleai.org").replace(/\/$/, ""),
  demo: process.env.EXPO_PUBLIC_DEMO === "1",
  projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || extra.eas?.projectId || Constants.easConfig?.projectId || null,
};
