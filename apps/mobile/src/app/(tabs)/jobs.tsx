import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Platform, RefreshControl, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { LinearTransition, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NoAccessBanner } from "../../components/access";
import { JobCard, openUpwork } from "../../components/job";
import { ApiBanner, Banner, Empty, PageTitle, Seg, T } from "../../components/ui";
import { fetchFeeds, fetchJobs, setJobStatus, useQuery, type JobView } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { useSettings } from "../../lib/settings";
import { font, radius, useTheme } from "../../theme";

type StatusFilter = "active" | "all" | "new" | "notified" | "drafting" | "applied" | "dismissed";
type RankFilter = "0" | "50" | "65" | "85";

// Module scope: rebuilding a layout-animation builder in render costs every re-render.
const ROW_CLOSE = LinearTransition.duration(200);

function DismissAction({ progress }: { progress: SharedValue<number> }) {
  const { c } = useTheme();
  // Reveal follows the finger on the UI thread; the label fades in as the row opens.
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.get() * 1.4) }));
  return (
    <View style={{ width: 120, marginLeft: 8, borderRadius: radius.card, backgroundColor: c.badSoft, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={style}><Text style={{ color: c.bad, fontFamily: font.semibold, fontSize: 15 }}>Dismiss</Text></Animated.View>
    </View>
  );
}

export default function Jobs() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { th, noAccess } = useSettings();
  const jobs = useQuery("jobs", () => fetchJobs(300), ["jobs"]);
  const feeds = useQuery("jobs-feeds", fetchFeeds);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [minRank, setMinRank] = useState<RankFilter>("0");
  const [feed, setFeed] = useState<string>("all");

  const list = useMemo(() => (jobs.data ?? []).filter((j) => {
    if (status === "active" && j.status === "dismissed") return false;
    if (status !== "active" && status !== "all" && j.status !== status) return false;
    if (j.score.total < Number(minRank)) return false;
    if (feed !== "all" && String(j.feedId) !== feed) return false;
    return true;
  }), [jobs.data, status, minRank, feed]);

  async function dismiss(job: JobView) {
    haptic.medium();
    // Optimistic: hide now, realtime confirms; roll back on error.
    jobs.setData((d) => d?.map((j) => (j.id === job.id ? { ...j, status: "dismissed" } : j)));
    try { await setJobStatus(job.id, "dismissed"); }
    catch (e) { jobs.reload(); haptic.error(); Alert.alert("Could not dismiss", (e as Error).message); }
  }

  function menu(job: JobView) {
    haptic.select();
    Alert.alert(job.title, undefined, [
      { text: "Open in Upwork", onPress: () => openUpwork(job.url) },
      ...(job.status !== "dismissed" ? [{ text: "Dismiss", style: "destructive" as const, onPress: () => dismiss(job) }] : [{ text: "Restore", onPress: () => setJobStatus(job.id, "new").then(jobs.reload) }]),
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const header = (
    <View style={{ gap: 10, marginBottom: 12 }}>
      <PageTitle title="Jobs" subtitle="Newest first. Swipe left or long-press to dismiss." />
      <ApiBanner />
      <NoAccessBanner show={noAccess} />
      {jobs.error ? <Banner tone="bad" title="Could not load jobs">{jobs.error}</Banner> : null}
      <Seg scroll value={status} onChange={(v) => { haptic.select(); setStatus(v); }} options={[
        { value: "active", label: "Active" }, { value: "new", label: "New" }, { value: "notified", label: "Notified" },
        { value: "drafting", label: "Drafting" }, { value: "applied", label: "Applied" }, { value: "dismissed", label: "Dismissed" }, { value: "all", label: "All" },
      ]} />
      <Seg value={minRank} onChange={(v) => { haptic.select(); setMinRank(v); }} options={[
        { value: "0", label: "Any rank" }, { value: "50", label: "50+" }, { value: "65", label: "65+" }, { value: "85", label: "85+" },
      ]} />
      {(feeds.data?.length ?? 0) > 1 ? (
        <Seg scroll value={feed} onChange={(v) => { haptic.select(); setFeed(v); }} options={[{ value: "all", label: "All feeds" }, ...(feeds.data ?? []).map((f) => ({ value: String(f.id), label: f.name }))]} />
      ) : null}
      <T faint size={12}>{list.length} job{list.length === 1 ? "" : "s"}</T>
    </View>
  );

  return (
    <Animated.FlatList
      style={{ flex: 1, backgroundColor: c.ground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingTop: Platform.OS === "android" ? insets.top + 12 : 12, paddingBottom: 48, gap: 10 }}
      data={list}
      keyExtractor={(j) => j.id}
      itemLayoutAnimation={ROW_CLOSE}
      ListHeaderComponent={header}
      ListEmptyComponent={jobs.loading ? <T muted>Loading…</T> : <Empty title="No jobs match">Change the filters or pull to refresh.</Empty>}
      refreshControl={<RefreshControl refreshing={jobs.refreshing} onRefresh={() => { jobs.refresh(); feeds.refresh(); }} tintColor={c.muted} />}
      renderItem={({ item }) => (
        <ReanimatedSwipeable
          friction={1.6}
          rightThreshold={80}
          overshootRight={false}
          enabled={item.status !== "dismissed"}
          renderRightActions={(progress) => <DismissAction progress={progress} />}
          onSwipeableOpen={() => dismiss(item)}
        >
          <JobCard job={item} th={th} onPress={() => router.push({ pathname: "/job/[id]", params: { id: item.id } })} onLongPress={() => menu(item)} />
        </ReanimatedSwipeable>
      )}
    />
  );
}
