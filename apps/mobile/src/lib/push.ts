import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { config } from "./config";
import { registerDevice } from "./data";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushResult = { ok: true; token: string } | { ok: false; reason: string };

/** Ask permission, get the Expo push token and store it in public.devices (duplicates are fine). */
export async function registerForPush(): Promise<PushResult> {
  if (config.demo) return { ok: false, reason: "Demo mode - push registration skipped" };
  if (!Device.isDevice) return { ok: false, reason: "Push needs a physical device (simulators get no token)" };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Job alerts", importance: Notifications.AndroidImportance.HIGH, lightColor: "#1F6FEB" });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { ok: false, reason: "Notifications are turned off for Upwork Assistant" };
  if (!config.projectId) return { ok: false, reason: "No EAS projectId - set EXPO_PUBLIC_EAS_PROJECT_ID (run `eas init`)" };
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: config.projectId });
    await registerDevice(token, Platform.OS);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export function jobIdFrom(response: Notifications.NotificationResponse | null | undefined): string | null {
  const d = response?.notification.request.content.data as { jobId?: unknown } | undefined;
  return d?.jobId != null ? String(d.jobId) : null;
}
