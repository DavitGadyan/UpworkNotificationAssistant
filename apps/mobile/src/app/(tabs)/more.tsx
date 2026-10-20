import { router, type Href } from "expo-router";
import type { ReactNode } from "react";
import { Alert, View } from "react-native";
import { IconChart, IconChevronRight, IconFlask, IconEye, IconFeed, IconSettings, IconUser } from "../../components/icons";
import { Card, Divider, PressableScale, Row, Screen, T } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { config } from "../../lib/config";
import { useTheme } from "../../theme";

function Item({ icon, label, sub, href }: { icon: ReactNode; label: string; sub: string; href: Href }) {
  const { c } = useTheme();
  return (
    <PressableScale onPress={() => router.push(href)} accessibilityLabel={label}>
      <Row gap={12} style={{ minHeight: 56, paddingVertical: 6 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.control, alignItems: "center", justifyContent: "center" }}>{icon}</View>
        <View style={{ flex: 1 }}><T weight="medium">{label}</T><T faint size={12}>{sub}</T></View>
        <IconChevronRight size={18} color={c.faint} />
      </Row>
    </PressableScale>
  );
}

export default function More() {
  const { c } = useTheme();
  const { email, signOut } = useAuth();
  return (
    <Screen title="More">
      <Card style={{ marginBottom: 16 }}>
        <Item icon={<IconEye size={20} color={c.ink} />} label="Watchlist" sub="Bids on alerted jobs" href="/watchlist" />
        <Divider />
        <Item icon={<IconChart size={20} color={c.ink} />} label="Insights" sub="Funnel · wins · reviews" href="/insights" />
        <Item icon={<IconFlask size={20} color={c.ink} cut={c.control} />} label="Prompts" sub="Reply rate per version" href="/prompts" />
        <Divider />
        <Item icon={<IconFeed size={20} color={c.ink} />} label="Feeds" sub="Searches" href="/feeds" />
        <Divider />
        <Item icon={<IconSettings size={20} color={c.ink} cut={c.control} />} label="Settings" sub="Alerts · limits · budget" href="/settings" />
      </Card>
      <Card style={{ gap: 12 }}>
        <Row gap={12}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.control, alignItems: "center", justifyContent: "center" }}><IconUser size={20} color={c.ink} /></View>
          <View style={{ flex: 1 }}><T weight="medium">{email ?? "Signed in"}</T><T faint size={12}>{config.demo ? "Demo mode" : "Synced via Supabase"}</T></View>
        </Row>
        <PressableScale onPress={() => Alert.alert("Sign out?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => signOut() }])} accessibilityLabel="Sign out">
          <View style={{ minHeight: 46, borderRadius: 12, backgroundColor: c.badSoft, alignItems: "center", justifyContent: "center" }}>
            <T weight="medium" style={{ color: c.bad }}>Sign out</T>
          </View>
        </PressableScale>
      </Card>
      <T faint size={12} style={{ textAlign: "center", marginTop: 16 }}>Up Assistant 1.0.0</T>
    </Screen>
  );
}
