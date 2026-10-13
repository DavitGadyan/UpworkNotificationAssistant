import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useTheme } from "../../theme";

/* Platform tab bar (NativeTabs): real UITabBar / Material bar, no custom transitions - tabs never slide. */
export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <NativeTabs tintColor={c.ink} labelStyle={{ selected: { color: c.ink } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} md="dashboard" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="jobs">
        <NativeTabs.Trigger.Label>Jobs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "briefcase", selected: "briefcase.fill" }} md="work" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="proposals">
        <NativeTabs.Trigger.Label>Proposals</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} md="description" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="closer">
        <NativeTabs.Trigger.Label>Closer</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} md="forum" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
