import { listDeviceTokens, removeDeviceToken } from "../db";

/*
 * Expo push notifications to the mobile app. Tokens are registered by the app in public.devices.
 * Sent alongside Telegram (job alerts, draft ready, polling warnings). Tokens Expo reports as
 * DeviceNotRegistered are removed.
 */

export interface PushMessage { title: string; body: string; data?: Record<string, unknown> }

export async function sendPush(m: PushMessage): Promise<{ sent: number }> {
  const tokens = await listDeviceTokens().catch(() => [] as string[]);
  if (!tokens.length) return { sent: 0 };
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tokens.map((to) => ({ to, title: m.title.slice(0, 120), body: m.body.slice(0, 300), data: m.data ?? {}, sound: "default" }))),
    });
    const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    await Promise.all((json.data ?? []).map((r, i) => (r.details?.error === "DeviceNotRegistered" ? removeDeviceToken(tokens[i]) : null)));
    return { sent: (json.data ?? []).filter((r) => r.status === "ok").length };
  } catch {
    return { sent: 0 };
  }
}
