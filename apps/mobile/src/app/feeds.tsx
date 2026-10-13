import { View } from "react-native";
import { Card, Empty, Pill, Row, Screen, T, Tag } from "../components/ui";
import { fetchFeeds, useQuery } from "../lib/data";
import { money } from "../lib/format";

const KIND = { most_recent: "Most recent", best_match: "Best matches", search: "Search" } as const;

export default function Feeds() {
  const q = useQuery("feeds", fetchFeeds);
  return (
    <Screen header={false} padTop={false} onRefresh={q.refresh} refreshing={q.refreshing}>
      <T muted size={14} style={{ marginBottom: 12 }}>Feeds are edited on the web dashboard; this is a read-only view.</T>
      <View style={{ gap: 10 }}>
        {(q.data ?? []).map((f) => (
          <Card key={f.id} style={{ gap: 8, opacity: f.enabled ? 1 : 0.6 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <T weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{f.name}</T>
              <Pill label={f.enabled ? "On" : "Off"} tone={f.enabled ? "good" : "neutral"} />
            </Row>
            <Row wrap gap={6}>
              <Tag label={KIND[f.kind] ?? f.kind} />
              {f.data.query ? <T muted size={13}>“{f.data.query}”</T> : null}
              {f.data.minHourly ? <T muted size={13}>≥ {money(f.data.minHourly)}/hr</T> : null}
              {f.data.minBudget ? <T muted size={13}>≥ {money(f.data.minBudget)}</T> : null}
            </Row>
            {f.data.skills?.length ? <Row wrap gap={6}>{f.data.skills.map((s) => <Tag key={s} label={s} />)}</Row> : null}
          </Card>
        ))}
        {!q.loading && !q.data?.length ? <Empty title="No feeds">Add feeds on the web dashboard.</Empty> : null}
      </View>
    </Screen>
  );
}
