import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { NoAccessBanner } from "../../components/access";
import { Banner, Card, Empty, Pill, PressableScale, Row, Screen, SearchField, Seg, T } from "../../components/ui";
import { fetchProposals, useQuery } from "../../lib/data";
import { money, timeAgo } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { useSettings } from "../../lib/settings";
import { LAST_STEP, PROPOSAL_STATUS, STEPS, stepIndex } from "../../lib/status";
import { useTheme } from "../../theme";
import type { ProposalStatus } from "../../types";

type Group = "todo" | "submitted" | "discarded" | "all";
const GROUP: Record<Exclude<Group, "all">, ProposalStatus[]> = {
  todo: ["draft", "needs_loom", "ready", "approved", "previewed"],
  submitted: ["submitted"],
  discarded: ["discarded"],
};

export default function Proposals() {
  const { c } = useTheme();
  const { noAccess } = useSettings();
  const q = useQuery("proposals", () => fetchProposals(), ["proposals"]);
  const [group, setGroup] = useState<Group>("todo");
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const list = (q.data ?? []).filter((p) => (group === "all" || GROUP[group].includes(p.status))
    && (!term || [p.jobTitle, p.coverLetter, p.research?.contactName, p.research?.company].filter(Boolean).join(" ").toLowerCase().includes(term)));

  return (
    <Screen title="Proposals" onRefresh={q.refresh} refreshing={q.refreshing}>
      <NoAccessBanner show={noAccess} />
      {q.error ? <Banner tone="bad" title="Could not load proposals">{q.error}</Banner> : null}
      <View style={{ marginBottom: 12, gap: 10 }}>
        <SearchField value={search} onChangeText={setSearch} placeholder="Search" />
        <Seg value={group} onChange={(v) => { haptic.select(); setGroup(v); }} options={[
          { value: "todo", label: "To do" }, { value: "submitted", label: "Sent" }, { value: "discarded", label: "Discarded" }, { value: "all", label: "All" },
        ]} />
      </View>
      <View style={{ gap: 10 }}>
        {list.map((p) => {
          const st = PROPOSAL_STATUS[p.status];
          const idx = stepIndex(p.status);
          return (
            <PressableScale key={p.id} onPress={() => router.push({ pathname: "/proposal/[id]", params: { id: String(p.id) } })} accessibilityLabel={p.jobTitle}>
              <Card style={{ gap: 10 }}>
                <T weight="semibold" numberOfLines={1}>{p.jobTitle}</T>
                <Row style={{ justifyContent: "space-between" }}>
                  <Row gap={6}><Pill label={st.label} tone={st.tone} /><T faint size={12}>{timeAgo(p.updatedAt)}</T></Row>
                  <T weight="semibold" style={{ fontVariant: ["tabular-nums"] }}>{money(p.bid)}</T>
                </Row>
                {idx >= 0 ? (
                  <Row gap={4} style={{ marginTop: 2 }} >
                    {STEPS.map((s, i) => <View key={s} accessibilityLabel={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= idx ? (idx === LAST_STEP ? c.good : c.ink) : c.control }} />)}
                  </Row>
                ) : null}
              </Card>
            </PressableScale>
          );
        })}
        {!q.loading && !list.length ? <Empty title="Nothing here">Draft from a job, or turn on auto-draft</Empty> : null}
      </View>
    </Screen>
  );
}
