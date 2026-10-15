import { router } from "expo-router";
import { View } from "react-native";
import type { Tone } from "../theme";
import type { ArmStat, LabBoard } from "../types";
import { Card, PressableScale, Pill, Row, Stat, T } from "./ui";

export const VERDICT: Record<string, { label: string; tone: Tone }> = {
  best: { label: "Clear winner", tone: "good" },
  leading: { label: "Leading", tone: "info" },
  single: { label: "Only one version tried", tone: "neutral" },
  not_enough_data: { label: "Not enough data", tone: "neutral" },
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

/** Sent → viewed → replied → offer → hired (same numbers as the web Prompt analytics page). */
export function Funnel({ f }: { f: LabBoard["funnel"] }) {
  return (
    <View style={{ gap: 8 }}>
      <Row gap={8}>
        <View style={{ flex: 1 }}><Stat label="Sent" value={f.sent} sub={`${f.decided} with a result`} /></View>
        <View style={{ flex: 1 }}><Stat label="Viewed" value={pct(f.viewed, f.decided)} /></View>
        <View style={{ flex: 1 }}><Stat label="Replied" value={pct(f.replied, f.decided)} tone="good" /></View>
      </Row>
      <Row gap={8}>
        <View style={{ flex: 1 }}><Stat label="Offers" value={pct(f.offers, f.decided)} sub={`${f.offers}`} /></View>
        <View style={{ flex: 1 }}><Stat label="Hired" value={pct(f.hires, f.decided)} sub={`${f.hires}`} tone="good" /></View>
        <View style={{ flex: 1 }}><Stat label="Connects" value={f.connects} /></View>
      </Row>
    </View>
  );
}

/** One row per version; tap opens its screen. */
export function ArmRow({ a, prompt }: { a: ArmStat; prompt: LabBoard["prompt"] }) {
  return (
    <PressableScale onPress={() => router.push({ pathname: "/prompt/[id]", params: { id: String(a.arm), p: prompt === "job_ranking" ? "ranker" : "writer" } })} accessibilityLabel={a.label}>
      <Card style={{ gap: 6 }}>
        <Row gap={6} wrap style={{ justifyContent: "space-between" }}>
          <T weight="semibold">{a.label}</T>
          {a.pBest != null ? <Pill label={`${a.pBest}% chance best`} tone={a.pBest >= 80 ? "good" : "neutral"} /> : <Pill label="baseline" />}
        </Row>
        <T muted size={13}>{a.n} sent · viewed {a.viewRate}% · replied {a.wins} ({a.replyRate}%) · offers {a.offers} · hired {a.hires} ({a.hireRate}%){a.kept != null ? ` · text kept ${a.kept}%` : ""}</T>
      </Card>
    </PressableScale>
  );
}
