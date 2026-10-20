import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { scoreTone } from "../components/job";
import { Card, Empty, Pill, PressableScale, RankPill, Row, Screen, SearchField, T } from "../components/ui";
import { fetchJobsByIds, fetchWatch, useQuery } from "../lib/data";
import { timeAgo, timeUntil } from "../lib/format";
import { useSettings } from "../lib/settings";

export default function Watchlist() {
  const { th } = useSettings();
  const watch = useQuery("watch", fetchWatch, ["job_watch"]);
  const ids = (watch.data ?? []).map((w) => w.job_id);
  const jobs = useQuery(`watch-jobs:${ids.join(",")}`, () => fetchJobsByIds(ids), ["jobs"]);
  const byId = new Map((jobs.data ?? []).map((j) => [j.id, j]));
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const rows = (watch.data ?? []).filter((w) => !term || (byId.get(w.job_id)?.title ?? "").toLowerCase().includes(term));
  const active = rows.filter((w) => !w.done), done = rows.filter((w) => w.done);

  return (
    <Screen header={false} padTop={false} onRefresh={() => { watch.refresh(); jobs.refresh(); }} refreshing={watch.refreshing}>
      <View style={{ marginBottom: 12 }}><SearchField value={search} onChangeText={setSearch} placeholder="Search" /></View>
      <View style={{ gap: 10 }}>
        {[...active, ...done].map((w) => {
          const j = byId.get(w.job_id);
          return (
            <PressableScale key={w.job_id} onPress={() => router.push({ pathname: "/job/[id]", params: { id: w.job_id } })} accessibilityLabel={j?.title ?? w.job_id}>
              <Card style={{ gap: 8, opacity: w.done ? 0.6 : 1 }}>
                <Row gap={12} style={{ alignItems: "flex-start" }}>
                  {j ? <RankPill total={j.score.total} tone={scoreTone(j.score, th)} /> : null}
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" numberOfLines={1}>{j?.title ?? `Job ${w.job_id}`}</T>
                    <T muted size={13} numberOfLines={1}>{w.last_tier ?? w.last_count} bids · since {timeAgo(w.started_at)}</T>
                  </View>
                </Row>
                <Row gap={6}>
                  {w.done ? <Pill label={`Done · ${w.done}`} /> : <Pill label={`Next ${timeUntil(w.next_at)}`} tone="info" />}
                  {w.warned ? <Pill label="Bids rising" tone="warn" /> : null}
                </Row>
              </Card>
            </PressableScale>
          );
        })}
        {!watch.loading && !rows.length ? <Empty title="Nothing watched">Added on each alert</Empty> : null}
      </View>
    </Screen>
  );
}
