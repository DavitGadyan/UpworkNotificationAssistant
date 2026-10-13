import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { config } from "./config";
import { supabase } from "./supabase";

type AuthState = { session: Session | null; ready: boolean; email: string | null; signOut: () => Promise<void> };
const Ctx = createContext<AuthState>({ session: null, ready: false, email: null, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(config.demo);

  useEffect(() => {
    if (config.demo) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session,
    ready,
    email: config.demo ? "demo@pulse.app" : session?.user.email ?? null,
    signOut: async () => { if (!config.demo) await supabase.auth.signOut(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
/** Demo mode is always "signed in". */
export const useSignedIn = () => { const a = useAuth(); return config.demo || !!a.session; };
