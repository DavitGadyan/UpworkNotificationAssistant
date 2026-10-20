import { router } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { NoAccessBanner } from "../../components/access";
import { isOffProfile } from "../../components/job";
import { IconBell, IconBriefcase, IconChart, IconDoc, IconEye, IconFeed, IconRefresh, IconSearch, IconSpark } from "../../components/icons";
import { Banner, Button, Card, Dot, ListRow, Meter, Pill, Row, Screen, SectionTitle, T, Tile } from "../../components/ui";
import { endpoints, getHealth, getHealthFull } from "../../lib/api";
import { config } from "../../lib/config";
import { fetchFeeds, fetchJobs, fetchNotificationsSince, fetchProposals, fetchWatch, useQuery } from "../../lib/data";
import { timeAgo, usd } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { useSettings } from "../../lib/settings";
import { useTheme, type Tone } from "../../theme";

/*
 * Overview (compact, 2026-10-20): numbers first, one-word labels, details on tap.
 *   tiles      - new jobs, alerts, watching, drafts
 *   Upwork     - pacing state + day budgets (reset 04:00 Yerevan)
 *   Feeds      - one line each: new jobs in 24 h; lateness only matters when the worker is the searcher
 *   Costs      - AI $ today as a meter, 7 / 30 days, Connects
 */

const DAY = 864e5;
const STATE: Record<string, { label: string; tone: Tone }> = { normal: { label: "Normal", tone: "good" }, slow: { label: "Slowed", tone: "warn" }, stopped: { label: "Stopped", tone: "bad" } };

export default function Overview() {
  const { c } = useTheme();
  const settings = useSettings();
  const jobs = useQuery("ov-jobs", () => fetchJobs(500), ["jobs"]);
  const feeds = useQuery("ov-feeds", fetchFeeds);
  const notes = useQuery("ov-notes", () => fetchNotificationsSince(Date.now() - DAY), ["notifications"]);
  const watch = useQuery("ov-watch", fetchWatch, ["job_watch"]);
  const props = useQuery("ov-props", () => fetchProposals(), ["proposals"]);
  const health = useQuery("ov-health", () => getHealth().catch(() => null));
  const healthFull = useQuery("ov-health-full", () => getHealthFull());
  const usage = useQuery("ov-usage", () => endpoints.usage().catch(() => null));
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const since = now - DAY;
  // Jobs outside his fields don't count as found or matched.
  const all = (jobs.data ?? []).filter((j) => !isOffProfile(j.score));
  const new24 = all.filter((j) => j.fetchedAtMs >= since).length;
  const alerts = (notes.data ?? []).filter((n) => n.ok).length;
  const watching = (watch.data ?? []).filter((w) => !w.done).length;
  const toReview = (props.data ?? []).filter((p) => p.status === "needs_loom" || p.status === "draft").length;
  const toApprove = (props.data ?? []).filter((p) => p.status === "ready" || p.status === "approved" || p.status === "previewed").length;

  const refreshing = jobs.refreshing || health.refreshing;
  const refresh = () => { setNow(Date.now()); jobs.refresh(); feeds.refresh(); notes.refresh(); watch.refresh(); props.refresh(); health.refresh(); healthFull.refresh(); usage.refresh(); settings.refresh(); };

  function loadViaClaude() {
    const enabled = (feeds.data ?? []).filter((f) => f.enabled).length || 1;
    Alert.alert("Load via Claude?", `One fetch of every enabled feed · ≈ $${(enabled * 0.15).toFixed(2)}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Load", onPress: async () => {
          setLoading(true);
          try { const r = await endpoints.fetchViaClaude(); haptic.success(); Alert.alert("Started", r?.message ?? "New jobs appear as they are ranked."); }
          catch (e) { haptic.error(); Alert.alert("Could not start", (e as Error).message); }
          finally { setLoading(false); }
        },
      },
    ]);
  }

  const h = health.data;
  const hf = healthFull.data;
  const pace = hf?.pacing;
  const workerPolls = (pace?.poller ?? settings.settings?.upwork?.poller) === "worker";
  const paused = settings.settings?.alertsPaused;
  const st = pace ? STATE[pace.state] ?? STATE.normal : null;
  const mutedIcon = (I: typeof IconBell) => <I size={14} color={c.muted} cut={c.surface} />;

  return (
    <Screen title="Overview" onRefresh={refresh} refreshing={refreshing}>
      {config.demo ? <Banner tone="info" title="Demo mode">Fixture data - nothing is live.</Banner> : null}
      <NoAccessBanner show={settings.noAccess} />
      {hf?.aiRanking?.paused ? <Banner tone="warn" title="AI ranking paused">Daily AI budget reached · resumes 04:00</Banner> : null}
      {paused ? <Banner tone="warn" title="Alerts paused">Resume in Settings</Banner> : null}

      <Row gap={8} style={{ marginBottom: 8 }}>
        <Tile label="New · 24h" value={new24} icon={mutedIcon(IconBriefcase)} onPress={() => router.navigate("/jobs")} />
        <Tile label="Alerts · 24h" value={alerts} icon={mutedIcon(IconBell)} />
      </Row>
      <Row gap={8} style={{ marginBottom: 20 }}>
        <Tile label="Watching" value={watching} icon={mutedIcon(IconEye)} onPress={() => router.push("/watchlist")} />
        <Tile label="To review" value={toReview} sub={toApprove ? `+${toApprove} to send` : undefined} tone={toReview ? "warn" : undefined} icon={mutedIcon(IconDoc)} onPress={() => router.navigate("/proposals")} />
      </Row>

      <SectionTitle right={st ? <Pill label={st.label} tone={st.tone} /> : <Pill label={h ? "No data" : "Worker offline"} tone="neutral" />}>Upwork</SectionTitle>
      <Card style={{ marginBottom: 20, paddingVertical: 10 }}>
        {pace ? (
          <>
            <Row gap={6} style={{ marginBottom: 2 }}>
              <Dot tone={pace.peak.now ? "info" : "neutral"} />
              <T muted size={12} numberOfLines={1} style={{ flex: 1 }}>
                {pace.poller === "chat" ? "Chat" : "Worker"} · every {pace.cadenceMin} min{pace.peak.now ? " · peak" : ""}{pace.level ? ` · L${pace.level}` : ""}
              </T>
              <T faint size={12}>resets 04:00</T>
            </Row>
            <Meter label="Job opens" used={pace.budgets.get.used} cap={pace.budgets.get.cap} icon={mutedIcon(IconEye)} />
            <Meter label="Searches" used={pace.budgets.search.used} cap={pace.budgets.search.cap} icon={mutedIcon(IconSearch)} />
            <Meter label="All calls" used={pace.budgets.day.used} cap={pace.budgets.day.cap} icon={mutedIcon(IconChart)} />
            <Meter label="This hour" used={pace.budgets.hour.used} cap={pace.budgets.hour.cap} icon={mutedIcon(IconRefresh)} />
            {pace.lastError && now - Date.parse(pace.lastError.at) < DAY ? (
              <ListRow first={false} icon={<Dot tone="warn" />} title={`Last warning · ${pace.lastError.cls}`} meta={timeAgo(Date.parse(pace.lastError.at))}
                onPress={() => Alert.alert("Last Upwork warning", pace.lastError!.detail || pace.lastError!.cls)} />
            ) : null}
          </>
        ) : (
          <T muted size={13}>{healthFull.loading ? "Loading…" : "Worker offline"}</T>
        )}
      </Card>

      <SectionTitle right={workerPolls && h && !h.ok ? <Pill label={`${h.lateFeeds} late`} tone="bad" /> : undefined}>Feeds</SectionTitle>
      <Card style={{ marginBottom: 20, paddingVertical: 4 }}>
        {(feeds.data ?? []).filter((f) => f.enabled).map((f, i) => {
          const fj = all.filter((j) => j.feedId === f.id || j.feeds?.includes(f.name));
          const day = fj.filter((j) => j.fetchedAtMs >= since).length;
          const last = fj.reduce((m, j) => Math.max(m, j.fetchedAtMs), 0);
          const fh = hf?.feeds.find((x) => x.feedId === f.id);
          // Lateness only means something when the worker is the one searching.
          const late = workerPolls && !!fh?.late;
          return (
            <ListRow key={f.id} first={i === 0} icon={<IconFeed size={16} color={late ? c.bad : c.muted} />}
              title={shortFeed(f.name)} meta={last ? `last job ${timeAgo(last)}` : "no jobs yet"}
              right={<Pill label={late ? "Late" : `${day}`} tone={late ? "bad" : day ? "info" : "neutral"} />}
              onPress={late && fh?.lastError ? () => Alert.alert(f.name, fh.lastError!) : undefined} />
          );
        })}
        {!feeds.loading && !(feeds.data ?? []).some((f) => f.enabled) ? <T muted>No feeds</T> : null}
      </Card>

      <SectionTitle>Costs</SectionTitle>
      <Card style={{ marginBottom: 16, paddingVertical: 10 }}>
        {usage.data ? (
          <>
            <Meter label="AI today" used={usage.data.claude.today} cap={usage.data.claude.dailyBudget} format={(n) => usd(n)} icon={mutedIcon(IconSpark)} />
            <Row gap={8} style={{ marginTop: 8 }}>
              <MiniStat label="7 days" value={usd(usage.data.claude.last7)} />
              <MiniStat label="30 days" value={usd(usage.data.claude.last30)} />
              <MiniStat label="Connects" value={String(usage.data.upwork.connects.balance ?? "—")} />
            </Row>
          </>
        ) : (
          <T muted size={13}>{usage.loading ? "Loading…" : "Worker offline"}</T>
        )}
      </Card>

      <Button small label="Load via Claude" variant="dark" onPress={loadViaClaude} loading={loading} icon={(col) => <IconSpark size={16} color={col} />} />
    </Screen>
  );
}

/** "Search: LLM, Large, Language, Model…" → "Search · LLM, Large…" */
function shortFeed(name: string) {
  const m = name.match(/^(\w+):\s*(.*)$/);
  if (!m) return name;
  const rest = m[2].split(/,\s*/).slice(0, 2).join(", ");
  return `${m[1]} · ${rest}${m[2].split(",").length > 2 ? "…" : ""}`;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.sunken }}>
      <T faint size={11}>{label}</T>
      <T weight="semibold" size={15} style={{ fontVariant: ["tabular-nums"] }}>{value}</T>
    </View>
  );
}
