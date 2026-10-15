import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth, useSignedIn } from "../lib/auth";
import { config } from "../lib/config";
import { jobIdFrom, registerForPush } from "../lib/push";
import { useThemePrefReady } from "../lib/themePref";
import { font, useTheme } from "../theme";

SplashScreen.preventAutoHideAsync();

function useNotificationRouting(enabled: boolean) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!enabled) return;
    const id = jobIdFrom(last);
    if (id) router.push({ pathname: "/job/[id]", params: { id } });
  }, [enabled, last]);
}

function RootStack() {
  const { ready, session } = useAuth();
  const signedIn = useSignedIn();
  const { c, dark } = useTheme();

  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  // Register this device for job pushes once signed in (silently; Settings shows the result).
  useEffect(() => { if (session && !config.demo) registerForPush().catch(() => {}); }, [session]);
  useNotificationRouting(signedIn);

  if (!ready) return null;
  const nav = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...nav, colors: { ...nav.colors, background: c.ground, card: c.frame, text: c.ink, border: c.line, primary: c.accent } }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerTintColor: c.ink,
          headerStyle: { backgroundColor: c.ground },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: font.displaySemi },
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: c.ground },
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="job/[id]" options={{ title: "Job" }} />
          <Stack.Screen name="proposal/[id]" options={{ title: "Proposal" }} />
          <Stack.Screen name="watchlist" options={{ title: "Watchlist" }} />
          <Stack.Screen name="insights" options={{ title: "Insights" }} />
          <Stack.Screen name="prompts" options={{ title: "Prompt analytics" }} />
          <Stack.Screen name="prompt/[id]" options={{ title: "Prompt version" }} />
          <Stack.Screen name="feeds" options={{ title: "Feeds" }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({ SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const themeReady = useThemePrefReady(); // saved Light/Dark/System choice, so the first frame is right
  if (!loaded || !themeReady) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
