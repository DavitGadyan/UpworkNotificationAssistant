import { router } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { NoAccessBanner } from "../../components/access";
import { IconBell, IconBriefcase, IconDoc, IconEye, IconSpark } from "../../components/icons";
import { Banner, Button, Card, Divider, KV, Pill, Row, Screen, SectionTitle, Stat, T } from "../../components/ui";
import { endpoints, getHealth, getHealthFull } from "../../lib/api";
import { config } from "../../lib/config";
import { fetchFeeds, fetchJobs, fetchNotificationsSince, fetchProposals, fetchWatch, useQuery } from "../../lib/data";
import { timeAgo, usd } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { useSettings } from "../../lib/settings";
import { useTheme } from "../../theme";

const DAY = 864e5;

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
  const all = jobs.data ?? [];
  const new24 = all.filter((j) => j.fetchedAtMs >= since).length;
  const alerts = (notes.data ?? []).filter((n) => n.ok).length;
  const watching = (watch.data ?? []).filter((w) => !w.done).length;
  const needLoom = (props.data ?? []).filter((p) => p.status === "needs_loom" || p.status === "draft").length;
  const toApprove = (props.data ?? []).filter((p) => p.status === "ready" || p.status === "approved" || p.status === "previewed").length;

  const refreshing = jobs.refreshing || health.refreshing;
  const refresh = () => { setNow(Date.now()); jobs.refresh(); feeds.refresh(); notes.refresh(); watch.refresh(); props.refresh(); health.refresh(); healthFull.refresh(); usage.refresh(); settings.refresh(); };

  function loadViaClaude() {
    const enabled = (feeds.data ?? []).filter((f) => f.enabled).length || 1;
    Alert.alert(
      "Load jobs via Claude?",
      `Runs one fetch of every enabled feed through the home worker's Claude login. Costs about $0.15 per feed on the Claude plan (≈ $${(enabled * 0.15).toFixed(2)} for ${enabled} feed${enabled === 1 ? "" : "s"}). New jobs appear here as they are ranked.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Load", onPress: async () => {
            setLoading(true);
            try { const r = await endpoints.fetchViaClaude(); haptic.success(); Alert.alert("Fetch started", r?.message ?? "New jobs will appear as they are ranked."); }
            catch (e) { haptic.error(); Alert.alert("Could not start the fetch", (e as Error).message); }
            finally { setLoading(false); }
          },
        },
      ],
    );
  }

  const h = health.data;
  const paused = settings.settings?.alertsPaused;

  return (
    <Screen title="Overview" subtitle="Every feed in one place: what it found, what matched, what reached you." onRefresh={refresh} refreshing={refreshing}>
      {config.demo ? <Banner tone="info" title="Demo mode">Showing fixture data from src/demo.ts - nothing here is live.</Banner> : null}
      <NoAccessBanner show={settings.noAccess} />
      {paused ? <Banner tone="warn" title="Alerts are paused">No pushes or calls go out until you resume them in Settings.</Banner> : null}

      <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
        <Stat label="New jobs · 24h" value={new24} sub="across all feeds" icon={<IconBriefcase size={16} color={c.muted} />} onPress={() => router.navigate("/jobs")} />
        <Stat label="Alerts sent · 24h" value={alerts} sub="push, message or call" icon={<IconBell size={16} color={c.muted} />} />
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 20 }}>
        <Stat label="Watching" value={watching} sub={watching === 1 ? "job's competition" : "jobs' competition"} icon={<IconEye size={16} color={c.muted} />} onPress={() => router.push("/watchlist")} />
        <Stat label="Waiting for Loom" value={needLoom} sub={`${toApprove} more to approve`} tone={needLoom ? "warn" : undefined} icon={<IconDoc size={16} color={c.muted} cut={c.surface} />} onPress={() => router.navigate("/proposals")} />
      </View>

      <SectionTitle right={h ? <Pill label={h.ok ? "All on time" : h.workerStale ? "Worker stalled" : `${h.lateFeeds} late`} tone={h.ok ? "good" : "bad"} /> : <Pill label="Worker offline" tone="neutral" />}>Polling health</SectionTitle>
      <Card style={{ marginBottom: 20 }}>
        {h ? <T muted size={13} style={{ marginBottom: 6 }}>Goal: every enabled feed fetched at least once per poll interval; a feed is late after {h.lateAfterMin} min without a success.</T> : null}
        {(feeds.data ?? []).filter((f) => f.enabled).map((f, i) => {
          const fj = all.filter((j) => j.feedId === f.id || j.feeds?.includes(f.name));
          const last = fj.reduce((m, j) => Math.max(m, j.fetchedAtMs), 0);
          const day = fj.filter((j) => j.fetchedAtMs >= since).length;
          // Exact worker status when the backend answers; otherwise estimate from stored jobs.
          const fh = healthFull.data?.feeds.find((x) => x.feedId === f.id);
          return (
            <View key={f.id}>
              {i > 0 ? <Divider /> : null}
              <Row style={{ justifyContent: "space-between", minHeight: 44 }}>
                <View style={{ flex: 1 }}>
                  <T weight="medium" numberOfLines={1}>{f.name}</T>
                  <T faint size={12}>
                    {fh
                      ? `last fetch ${fh.lastOkAt ? timeAgo(new Date(fh.lastOkAt).getTime()) : "never"} · ${fh.successRate24h ?? "-"}% ok 24h${fh.failures ? ` · ${fh.failures} failing` : ""}`
                      : `${f.kind.replace("_", " ")} · last job ${last ? timeAgo(last) : "never"}`}
                  </T>
                  {fh?.late && fh.lastError ? <T size={12} style={{ color: "#c0392b" }} numberOfLines={2}>{fh.lastError}</T> : null}
                </View>
                {fh ? <Pill label={fh.late ? "Late" : `${day} new`} tone={fh.late ? "bad" : day ? "info" : "neutral"} /> : <Pill label={`${day} new`} tone={day ? "info" : "neutral"} />}
              </Row>
            </View>
          );
        })}
        {!feeds.loading && !(feeds.data ?? []).some((f) => f.enabled) ? <T muted>No enabled feeds.</T> : null}
      </Card>

      <SectionTitle>Costs</SectionTitle>
      <Card style={{ marginBottom: 20 }}>
        {usage.data ? (
          <>
            <KV label="Claude today" value={`${usd(usage.data.claude.today)} / ${usd(usage.data.claude.dailyBudget)}`} tone={usage.data.claude.today > usage.data.claude.dailyBudget ? "bad" : undefined} />
            <KV label="Last 7 days" value={usd(usage.data.claude.last7)} />
            <KV label="Last 30 days" value={usd(usage.data.claude.last30)} />
            {usage.data.claude.remainingCredit != null ? <KV label="Prepaid credit left" value={usd(usage.data.claude.remainingCredit)} /> : null}
            <Divider />
            <KV label="Marketplace calls today" value={`${usage.data.upwork.callsToday.toLocaleString("en-US")} / ${usage.data.upwork.dailyCap.toLocaleString("en-US")}`} />
            <KV label="Connects balance" value={usage.data.upwork.connects.balance ?? "—"} />
          </>
        ) : (
          <T muted size={14}>{usage.loading ? "Loading…" : "Costs come from the home worker - offline right now."}</T>
        )}
      </Card>

      <Button label="Load via Claude" variant="dark" onPress={loadViaClaude} loading={loading} icon={(col) => <IconSpark size={18} color={col} />} />
      <T faint size={12} style={{ textAlign: "center", marginTop: 8 }}>Manual fetch of every enabled feed · ≈ $0.15 per feed on the Claude plan</T>
    </Screen>
  );
}
