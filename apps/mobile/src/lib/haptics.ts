import * as Haptics from "expo-haptics";

/* One haptic per user action, always paired with a visual change. Failures (no engine, web) are ignored. */
const safe = (p: Promise<unknown>) => { p.catch(() => {}); };

export const haptic = {
  select: () => safe(Haptics.selectionAsync()),
  light: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
