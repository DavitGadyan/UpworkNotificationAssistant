import { router } from "expo-router";
import { View } from "react-native";
import { scoreTone } from "../components/job";
import { Card, Empty, Pill, PressableScale, RankPill, Row, Screen, T } from "../components/ui";
import { fetchJobsByIds, fetchWatch, useQuery } from "../lib/data";
import { timeAgo, timeUntil } from "../lib/format";
import { useSettings } from "../lib/settings";

export default function Watchlist() {
  const { th } = useSettings();
  const watch = useQuery("watch", fetchWatch, ["job_watch"]);
  const ids = (watch.data ?? []).map((w) => w.job_id);
  const jobs = useQuery(`watch-jobs:${ids.join(",")}`, () => fetchJobsByIds(ids), ["jobs"]);
  const byId = new Map((jobs.data ?? []).map((j) => [j.id, j]));
  const rows = watch.data ?? [];
  const active = rows.filter((w) => !w.done), done = rows.filter((w) => w.done);

  return (
    <Screen header={false} padTop={false} onRefresh={() => { watch.refresh(); jobs.refresh(); }} refreshing={watch.refreshing}>
      <T muted size={14} style={{ marginBottom: 12 }}>After an alert, the proposal count is re-checked so you know when competition piles up.</T>
      <View style={{ gap: 10 }}>
        {[...active, ...done].map((w) => {
          const j = byId.get(w.job_id);
          return (
            <PressableScale key={w.job_id} onPress={() => router.push({ pathname: "/job/[id]", params: { id: w.job_id } })} accessibilityLabel={j?.title ?? w.job_id}>
              <Card style={{ gap: 8, opacity: w.done ? 0.6 : 1 }}>
                <Row gap={12} style={{ alignItems: "flex-start" }}>
                  {j ? <RankPill total={j.score.total} tone={scoreTone(j.score, th)} /> : null}
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" numberOfLines={2}>{j?.title ?? `Job ${w.job_id}`}</T>
                    <T muted size={13}>{w.last_tier ? `${w.last_tier} proposals` : `${w.last_count} proposals`} · watching since {timeAgo(w.started_at)}</T>
                  </View>
                </Row>
                <Row gap={6}>
                  {w.done ? <Pill label={`Done · ${w.done}`} /> : <Pill label={`Next check ${timeUntil(w.next_at)}`} tone="info" />}
                  {w.warned ? <Pill label="Competition rising" tone="warn" /> : null}
                </Row>
              </Card>
            </PressableScale>
          );
        })}
        {!watch.loading && !rows.length ? <Empty title="Not watching anything">Jobs are added automatically when an alert goes out.</Empty> : null}
      </View>
    </Screen>
  );
}
