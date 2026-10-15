import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect } from "react";
import { Linking, View } from "react-native";
import { ArmRow } from "../../components/promptLab";
import { OUTCOME } from "../../components/whatWins";
import { Card, Empty, Pill, PressableScale, Row, Screen, SectionTitle, T } from "../../components/ui";
import { fetchLatestReport, fetchPromptStats, useQuery } from "../../lib/data";
import { fmtDate } from "../../lib/format";
import type { LabBoard } from "../../types";

/** One prompt version: how it compares, its reply-rate trend and every proposal it wrote / ranked. */
export default function PromptVersion() {
  const { id, p } = useLocalSearchParams<{ id: string; p?: string }>();
  const arm = Number(id);
  const ranker = p === "ranker";
  const rep = useQuery(`lab-${ranker ? "ranker" : "writer"}`, () => fetchLatestReport<LabBoard>(ranker ? "ranker_lab" : "prompt_lab"));
  const stats = useQuery(`stats-${p}-${arm}`, () => fetchPromptStats(ranker ? "job_ranking" : "proposal", arm));
  const b = rep.data?.data ?? null;
  const me = b?.overall.arms.find((a) => a.arm === arm) ?? null;
  const info = b?.versions.find((v) => v.id === arm) ?? null;
  const nav = useNavigation();
  useEffect(() => { nav.setOptions({ title: me?.label ?? info?.label ?? "Prompt version" }); }, [nav, me?.label, info?.label]);
  const rows = b?.proposals[String(arm)] ?? [];
  const trend = (stats.data ?? []).filter((r) => r.sent > 0).slice(-10);

  return (
    <Screen header={false} padTop={false} onRefresh={() => { rep.refresh(); stats.refresh(); }} refreshing={rep.refreshing}>
      {!b ? <Empty title="Loading…" /> : (
        <View style={{ gap: 12 }}>
          {info ? <T faint size={12}>{[info.note, info.createdAt ? `saved ${fmtDate(info.createdAt)}` : null, info.active ? "active now" : null, b.config.arms.includes(arm) ? "in the A/B test" : null].filter(Boolean).join(" · ")}</T> : null}
          {me ? <ArmRow a={me} prompt={b.prompt} /> : <T muted>No proposals with a result yet.</T>}
          <SectionTitle>Compared with</SectionTitle>
          {b.overall.arms.filter((a) => a.arm !== arm).map((a) => <ArmRow key={a.arm} a={a} prompt={b.prompt} />)}
          {trend.length ? (
            <>
              <SectionTitle>Reply rate by day</SectionTitle>
              <Card style={{ gap: 4 }}>{trend.map((r) => <T key={r.day} size={14}>{r.day}: {Math.round((r.replied / r.sent) * 100)}% of {r.sent} · {r.hires} hired</T>)}</Card>
            </>
          ) : null}
          <SectionTitle>Proposals ({rows.length})</SectionTitle>
          {rows.map((r) => (
            <PressableScale key={r.upworkProposalId} onPress={() => Linking.openURL(`https://www.upwork.com/jobs/~02${r.jobId}`)} accessibilityLabel={`Open ${r.jobTitle}`}>
              <Card style={{ gap: 4 }}>
                <Row gap={6} wrap>
                  <Pill label={r.status === "Hired" ? "Hired" : r.status === "Offered" ? "Offer" : OUTCOME[r.outcome].label} tone={r.status === "Hired" || r.status === "Offered" ? "good" : OUTCOME[r.outcome].tone} />
                  <T faint size={12}>{fmtDate(r.submittedAt)} · {r.scenario}{ranker ? (r.rank != null ? ` · rank ${r.rank}` : "") : r.kept != null ? ` · text kept ${r.kept}%` : ""}</T>
                </Row>
                <T weight="medium" numberOfLines={2}>{r.jobTitle}</T>
              </Card>
            </PressableScale>
          ))}
        </View>
      )}
    </Screen>
  );
}
