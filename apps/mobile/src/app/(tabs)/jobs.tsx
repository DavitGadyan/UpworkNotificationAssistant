import { router } from "expo-router";
import { useDeferredValue, useMemo, useState } from "react";
import { Alert, Platform, RefreshControl, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { LinearTransition, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NoAccessBanner } from "../../components/access";
import { CalendarRange } from "../../components/CalendarRange";
import { isOffProfile, JobCard, openUpwork } from "../../components/job";
import { RangeSlider } from "../../components/RangeSlider";
import { ApiBanner, Banner, Card, Empty, PageTitle, SearchField, Seg, T } from "../../components/ui";
import { fetchFeeds, fetchJobs, setJobStatus, useQuery, type JobView } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { DATE_PRESETS, DEFAULT_DATE, dateLabel, inDateFilter, postedMs, type DateFilter, type DatePreset } from "../../lib/jobFilters";
import { useSettings } from "../../lib/settings";
import { font, radius, useTheme } from "../../theme";

type StatusFilter = "active" | "all" | "new" | "awaiting_ai" | "notified" | "drafting" | "applied" | "dismissed" | "off";

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
  const [score, setScore] = useState<[number, number]>([0, 100]);
  const [when, setWhen] = useState<DateFilter>(DEFAULT_DATE); // opens on the last 24 hours
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [sliding, setSliding] = useState(false);
  // "Last 24 hours" is measured from when the list was last refreshed or a range was picked.
  const [now, setNow] = useState(() => Date.now());
  const [feed, setFeed] = useState<string>("all");
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search.trim().toLowerCase());

  const list = useMemo(() => {
    return (jobs.data ?? []).filter((j) => {
      // Jobs outside his fields only show under "Not my field".
      if (status === "off") return isOffProfile(j.score);
      if (isOffProfile(j.score)) return false;
      if (status === "active" && j.status === "dismissed") return false;
      if (status !== "active" && status !== "all" && j.status !== status) return false;
      if (j.score.total < score[0] || j.score.total > score[1]) return false;
      if (!inDateFilter(postedMs(j), when, now)) return false;
      if (feed !== "all" && String(j.feedId) !== feed) return false;
      if (term && !`${j.title} ${j.skills.join(" ")} ${j.description}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [jobs.data, status, score, when, feed, now, term]);

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
      <SearchField value={search} onChangeText={setSearch} placeholder="Search title, skills or description" />
      <Seg scroll value={status} onChange={(v) => { haptic.select(); setStatus(v); }} options={[
        { value: "active", label: "Active" }, { value: "new", label: "New" }, { value: "awaiting_ai", label: "Waiting for AI" }, { value: "notified", label: "Notified" },
        { value: "drafting", label: "Drafting" }, { value: "applied", label: "Applied" }, { value: "dismissed", label: "Dismissed" }, { value: "all", label: "All" },
        { value: "off", label: "Not my field" },
      ]} />
      <Seg<DatePreset | "custom">
        scroll
        value={"preset" in when ? when.preset : "custom"}
        onChange={(v) => { haptic.select(); if (v === "custom") setCalendarOpen(true); else { setNow(Date.now()); setWhen({ preset: v }); } }}
        options={[...DATE_PRESETS.map((p) => ({ value: p.value, label: p.label })), { value: "custom", label: "preset" in when ? "Pick dates…" : dateLabel(when) }]}
      />
      <Card style={{ paddingVertical: 10 }}>
        <RangeSlider label="Score" value={score} onChange={setScore} onSlidingStart={() => setSliding(true)} onSlidingEnd={() => setSliding(false)} />
      </Card>
      {(feeds.data?.length ?? 0) > 1 ? (
        <Seg scroll value={feed} onChange={(v) => { haptic.select(); setFeed(v); }} options={[{ value: "all", label: "All feeds" }, ...(feeds.data ?? []).map((f) => ({ value: String(f.id), label: f.name }))]} />
      ) : null}
      {/* Repeats the active filters: a picked date range sits off-screen at the end of the scrolling chip row. */}
      <T faint size={12}>
        {list.length} job{list.length === 1 ? "" : "s"} · {"preset" in when ? (when.preset === "all" ? "any date" : `last ${dateLabel(when)}`) : `posted ${dateLabel(when)}`}
        {score[0] > 0 || score[1] < 100 ? ` · score ${score[0]}–${score[1]}` : ""}
      </T>
    </View>
  );

  return (
    <>
    <Animated.FlatList
      style={{ flex: 1, backgroundColor: c.ground }}
      scrollEnabled={!sliding}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingTop: Platform.OS === "android" ? insets.top + 12 : 12, paddingBottom: 48, gap: 10 }}
      data={list}
      keyExtractor={(j) => j.id}
      itemLayoutAnimation={ROW_CLOSE}
      ListHeaderComponent={header}
      ListEmptyComponent={jobs.loading ? <T muted>Loading…</T> : <Empty title="No jobs match">Change the filters or pull to refresh.</Empty>}
      refreshControl={<RefreshControl refreshing={jobs.refreshing} onRefresh={() => { setNow(Date.now()); jobs.refresh(); feeds.refresh(); }} tintColor={c.muted} />}
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
    {calendarOpen ? (
      <CalendarRange
        initial={"since" in when ? when : null}
        onApply={(r) => { setWhen(r); setCalendarOpen(false); }}
        onClose={() => setCalendarOpen(false)}
      />
    ) : null}
    </>
  );
}
