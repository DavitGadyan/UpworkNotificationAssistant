import { router } from "expo-router";
import { View } from "react-native";
import type { Tone } from "../theme";
import type { ArmStat, LabBoard } from "../types";
import { Card, PressableScale, Pill, Row, T, Tile } from "./ui";

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
        <Tile label="Sent" value={f.sent} sub={`${f.decided} decided`} />
        <Tile label="Viewed" value={pct(f.viewed, f.decided)} />
        <Tile label="Replied" value={pct(f.replied, f.decided)} tone="good" />
      </Row>
      <Row gap={8}>
        <Tile label="Offers" value={pct(f.offers, f.decided)} sub={`${f.offers}`} />
        <Tile label="Hired" value={pct(f.hires, f.decided)} sub={`${f.hires}`} tone="good" />
        <Tile label="Connects" value={f.connects} />
      </Row>
    </View>
  );
}

/** One row per version; tap opens its screen. */
export function ArmRow({ a, prompt }: { a: ArmStat; prompt: LabBoard["prompt"] }) {
  return (
    <PressableScale onPress={() => router.push({ pathname: "/prompt/[id]", params: { id: String(a.arm), p: prompt === "job_ranking" ? "ranker" : "writer" } })} accessibilityLabel={a.label}>
      <Card style={{ gap: 6 }}>
        <Row gap={6} style={{ justifyContent: "space-between" }}>
          <T weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{a.label}</T>
          {a.pBest != null ? <Pill label={`${a.pBest}% best`} tone={a.pBest >= 80 ? "good" : "neutral"} /> : <Pill label="baseline" />}
        </Row>
        <Row wrap gap={6}>
          <Pill label={`${a.n} sent`} />
          <Pill label={`👀 ${a.viewRate}%`} />
          <Pill label={`💬 ${a.replyRate}%`} tone="good" />
          <Pill label={`✓ ${a.hires} hired`} tone={a.hires ? "good" : "neutral"} />
          {a.kept != null ? <Pill label={`kept ${a.kept}%`} /> : null}
        </Row>
      </Card>
    </PressableScale>
  );
}
