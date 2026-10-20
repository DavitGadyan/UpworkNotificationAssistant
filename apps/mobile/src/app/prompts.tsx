import { useState } from "react";
import { Alert, View } from "react-native";
import { ArmRow, Funnel, VERDICT } from "../components/promptLab";
import { Button, Card, Empty, Pill, Row, Screen, SectionTitle, T } from "../components/ui";
import { endpoints } from "../lib/api";
import { fetchLatestReport, useQuery } from "../lib/data";
import { fmtDate } from "../lib/format";
import { haptic } from "../lib/haptics";
import type { LabBoard } from "../types";

/** Prompt analytics: which writer / ranker prompt version gets views, replies, offers and hires. */
export default function Prompts() {
  const [tab, setTab] = useState<"writer" | "ranker">("writer");
  const rep = useQuery(`lab-${tab}`, () => fetchLatestReport<LabBoard>(tab === "writer" ? "prompt_lab" : "ranker_lab"));
  const [busy, setBusy] = useState(false);
  const b = rep.data?.data ?? null;
  const toggleTest = async (enabled: boolean) => {
    if (!b) return;
    setBusy(true);
    try { await endpoints.insights("lab", { enabled, arms: b.config.arms }); await endpoints.insights("lab-refresh"); haptic.success(); rep.reload(); }
    catch (e) { haptic.error(); Alert.alert("Didn't change", (e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Screen header={false} padTop={false} onRefresh={rep.refresh} refreshing={rep.refreshing}>
      <Row gap={8} style={{ marginBottom: 12 }}>
        <Button small label="Writer" variant={tab === "writer" ? "dark" : undefined} onPress={() => setTab("writer")} />
        <Button small label="Ranker" variant={tab === "ranker" ? "dark" : undefined} onPress={() => setTab("ranker")} />
      </Row>
      {!b ? <Empty title="No data yet"><T muted size={14}>{rep.loading ? "Loading…" : "Updates 8× a day"}</T></Empty> : (
        <View style={{ gap: 12 }}>
          <T faint size={12}>Updated {fmtDate(b.builtAt)} · reward = reply</T>
          <Card><Funnel f={b.funnel} /></Card>
          <SectionTitle>Versions</SectionTitle>
          {b.overall.arms.map((a) => <ArmRow key={a.arm} a={a} prompt={b.prompt} />)}
          {tab === "writer" ? (
            <Card style={{ gap: 8 }}>
              <Row style={{ justifyContent: "space-between" }}><T weight="semibold">A/B test</T><Pill label={b.config.enabled ? `On · ${b.config.arms.length} versions` : b.config.arms.length >= 2 ? `${b.config.arms.length} ready` : "Pick on web"} tone={b.config.enabled ? "good" : "neutral"} /></Row>
              {b.config.arms.length >= 2 && <Button small label={b.config.enabled ? "Stop test" : "Start test"} loading={busy} onPress={() => toggleTest(!b.config.enabled)} />}
            </Card>
          ) : null}
          {tab === "ranker" && b.byRank?.length ? (
            <>
              <SectionTitle>By job rank</SectionTitle>
              <Card style={{ gap: 6 }}>
                {b.byRank.map((r) => { const t = r.arms.reduce((s, a) => ({ n: s.n + a.n, w: s.w + a.wins, h: s.h + a.hires }), { n: 0, w: 0, h: 0 }); return <Row key={r.key} style={{ justifyContent: "space-between" }}><T size={14} style={{ flex: 1 }} numberOfLines={1}>{r.label}</T><T size={13} muted style={{ fontVariant: ["tabular-nums"] }}>{t.n} · {t.n ? Math.round((t.w / t.n) * 100) : 0}% reply · {t.h} hired</T></Row>; })}
              </Card>
            </>
          ) : null}
          <SectionTitle>By scenario</SectionTitle>
          {b.byScenario.map((s) => (
            <Card key={s.key} style={{ gap: 6 }}>
              <T weight="medium">{s.label}</T>
              <Row gap={6} wrap>
                <Pill label={`${VERDICT[s.verdict].label}${s.best != null ? `: ${s.arms.find((a) => a.arm === s.best)?.label ?? ""}` : ""}`} tone={VERDICT[s.verdict].tone} />
                <T faint size={12}>{s.n} decided</T>
                {s.pinned != null ? <Pill label="pinned" tone="good" /> : null}
              </Row>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
