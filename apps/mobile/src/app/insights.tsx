import { useState } from "react";
import { Alert, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { WhatWins } from "../components/whatWins";
import { Banner, Bullets, Button, Card, Divider, Empty, KV, Pill, Row, Screen, SectionTitle, T } from "../components/ui";
import { endpoints } from "../lib/api";
import { fetchLatestReport, fetchSnapshots, useQuery } from "../lib/data";
import { compactMoney, fmtDate, intentLabel } from "../lib/format";
import { haptic } from "../lib/haptics";
import { font, useTheme } from "../theme";
import type { Calibration, CoachReport, GhostReport, Icp, MonthlyReview, SnapshotRow } from "../types";

type Action = "snapshot" | "review" | "coach" | "icp" | "calibrate" | "apply-calibration" | "ghosts";

function RunButton({ action, label, confirm, onDone }: { action: Action; label: string; confirm?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await endpoints.insights(action); haptic.success(); onDone(); }
    catch (e) { haptic.error(); Alert.alert("Didn't run", (e as Error).message); }
    finally { setBusy(false); }
  };
  return <Button small label={label} loading={busy} onPress={() => (confirm ? Alert.alert(label, confirm, [{ text: "Cancel", style: "cancel" }, { text: "Run", onPress: go }]) : go())} />;
}

const monthLabel = (p: string) => new Date(`${p}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short" });

function FunnelChart({ rows, width }: { rows: SnapshotRow[]; width: number }) {
  const { c, dark } = useTheme();
  const series = [
    { key: "sent", label: "Sent", color: dark ? "#3A5F9E" : "#B7CFF7" },
    { key: "viewed", label: "Viewed", color: dark ? "#5D8FE6" : "#6E9FF1" },
    { key: "offers", label: "Offers", color: c.accent },
    { key: "hired", label: "Hired", color: c.good },
  ] as const;
  const H = 170, padL = 26, padB = 22, padT = 8;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => r.data.proposals[s.key])));
  const plotW = width - padL, plotH = H - padB - padT;
  const groupW = plotW / rows.length, barW = Math.max(3, Math.min(12, (groupW - 8) / 4));
  const ticks = [0, Math.round(max / 2), max];
  return (
    <View>
      <Svg width={width} height={H} accessibilityLabel="Proposal funnel per month">
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH;
          return (
            <G key={t}>
              <Line x1={padL} x2={width} y1={y} y2={y} stroke={c.line} strokeWidth={1} />
              <SvgText x={padL - 6} y={y + 4} fontSize={10} fill={c.faint} textAnchor="end" fontFamily={font.body}>{t}</SvgText>
            </G>
          );
        })}
        {rows.map((r, i) => {
          const x0 = padL + i * groupW + (groupW - barW * 4 - 3 * 2) / 2;
          return (
            <G key={r.period}>
              {series.map((s, k) => {
                const v = r.data.proposals[s.key];
                const h = (v / max) * plotH;
                return <Rect key={s.key} x={x0 + k * (barW + 2)} y={padT + plotH - h} width={barW} height={Math.max(1, h)} rx={2} fill={s.color} />;
              })}
              <SvgText x={padL + i * groupW + groupW / 2} y={H - 6} fontSize={11} fill={c.muted} textAnchor="middle" fontFamily={font.medium}>{monthLabel(r.period)}</SvgText>
            </G>
          );
        })}
      </Svg>
      <Row wrap gap={12} style={{ marginTop: 6 }}>
        {series.map((s) => <Row key={s.key} gap={6}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} /><T muted size={12}>{s.label}</T></Row>)}
      </Row>
    </View>
  );
}

function WinRateChart({ rows, width }: { rows: SnapshotRow[]; width: number }) {
  const { c } = useTheme();
  const pts = rows.map((r) => ({ p: r.period, v: r.data.proposals.sent ? (r.data.proposals.hired / r.data.proposals.sent) * 100 : null }));
  const H = 130, padL = 26, padB = 22, padT = 16;
  const max = Math.max(10, ...pts.map((x) => x.v ?? 0)) * 1.15;
  const plotW = width - padL - 28, plotH = H - padB - padT;
  const xy = (i: number, v: number) => [padL + 6 + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW), padT + plotH - (v / max) * plotH] as const;
  const d = pts.map((x, i) => (x.v == null ? "" : `${i === 0 || pts[i - 1].v == null ? "M" : "L"}${xy(i, x.v).join(",")}`)).join(" ");
  return (
    <Svg width={width} height={H} accessibilityLabel="Win rate per month">
      {[0, max / 2].map((t) => {
        const y = padT + plotH - (t / max) * plotH;
        return <G key={t}><Line x1={padL} x2={width} y1={y} y2={y} stroke={c.line} strokeWidth={1} /><SvgText x={padL - 6} y={y + 4} fontSize={10} fill={c.faint} textAnchor="end" fontFamily={font.body}>{`${Math.round(t)}%`}</SvgText></G>;
      })}
      <Path d={d} stroke={c.ink} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((x, i) => {
        if (x.v == null) return null;
        const [px, py] = xy(i, x.v);
        const last = i === pts.length - 1;
        return (
          <G key={x.p}>
            <Circle cx={px} cy={py} r={last ? 4.5 : 3} fill={last ? c.accent : c.surface} stroke={last ? c.accent : c.ink} strokeWidth={2} />
            <SvgText x={px} y={py - 9} fontSize={10} fill={last ? c.ink : c.muted} textAnchor="middle" fontFamily={last ? font.semibold : font.body}>{`${Math.round(x.v)}%`}</SvgText>
            <SvgText x={px} y={H - 6} fontSize={11} fill={c.muted} textAnchor="middle" fontFamily={font.medium}>{monthLabel(x.p)}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

/** Ghost patterns: jobs per hire-likelihood archetype, how tracked jobs resolved, repeat no-hire clients, suggestions. */
function GhostCard({ r }: { r: GhostReport }) {
  const { c } = useTheme();
  const max = Math.max(1, ...r.byArchetype.map((a) => a.jobs));
  const chance = (v: number | null) => (v == null ? c.muted : v < 35 ? c.bad : v < 60 ? c.warn : c.good);
  return (
    <>
      <T faint size={12}>{r.jobsAssessed} jobs assessed · built {fmtDate(r.builtAt)}. Advisory - never changes your rank.</T>
      {r.byArchetype.length ? (
        <View style={{ gap: 10 }}>
          {r.byArchetype.map((a) => (
            <View key={a.archetype} style={{ gap: 4 }} accessibilityLabel={`${intentLabel(a.archetype)}: ${a.jobs} jobs, ${a.highRisk} high risk, average hire chance ${a.avgLikelihood}%`}>
              <Row style={{ justifyContent: "space-between" }}>
                <T weight="medium" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>{intentLabel(a.archetype)}</T>
                <T size={12} style={{ color: chance(a.avgLikelihood), fontVariant: ["tabular-nums"] }}>{a.avgLikelihood}% avg</T>
              </Row>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: c.control, flexDirection: "row", overflow: "hidden" }}>
                <View style={{ width: `${(a.highRisk / max) * 100}%`, backgroundColor: c.bad }} />
                <View style={{ width: `${((a.jobs - a.highRisk) / max) * 100}%`, backgroundColor: c.accent }} />
              </View>
              <T faint size={12} style={{ fontVariant: ["tabular-nums"] }}>{a.jobs} {a.jobs === 1 ? "job" : "jobs"} · {a.highRisk} high risk</T>
            </View>
          ))}
        </View>
      ) : <T muted size={14}>No assessed jobs yet.</T>}

      <Divider />
      <T muted size={13} weight="medium">Outcomes · tracked / hired / closed, no hire / still open</T>
      {r.outcomes.length ? r.outcomes.map((o) => (
        <KV key={o.archetype} label={intentLabel(o.archetype)} value={`${o.tracked} / ${o.hired} / ${o.closedNoHire} / ${o.open}`} />
      )) : <T muted size={14}>Nothing tracked yet - outcomes are checked ~2 and ~7 days after posting.</T>}

      <Divider />
      <T muted size={13} weight="medium">Clients who post without hiring</T>
      {r.topClients.length ? r.topClients.slice(0, 6).map((cl) => (
        <KV key={cl.clientId} label={`${cl.country ?? "Unknown"} · #${cl.clientId.slice(-6)}`} value={`${cl.jobsSeen} posts · ${cl.closedNoHire} no hire`} tone={cl.closedNoHire ? "bad" : undefined} />
      )) : <T muted size={14}>No repeat posters yet.</T>}

      <Divider />
      <T muted size={13} weight="medium">Suggestions (not applied — your rules are unchanged)</T>
      {r.suggestions.map((sg, i) => (
        <View key={i} style={{ gap: 2, padding: 12, borderRadius: 12, backgroundColor: c.sunken }}>
          <T weight="medium" size={14}>{sg.suggestion}</T>
          <T muted size={13}>{sg.rationale}</T>
        </View>
      ))}
    </>
  );
}

export default function Insights() {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const snaps = useQuery("snapshots", () => fetchSnapshots(12));
  const coach = useQuery("r-coach", () => fetchLatestReport<CoachReport>("coach"));
  const review = useQuery("r-review", () => fetchLatestReport<MonthlyReview>("monthly_review"));
  const icp = useQuery("r-icp", () => fetchLatestReport<Icp>("icp"));
  const cal = useQuery("r-cal", () => fetchLatestReport<Calibration>("calibration"));
  const ghosts = useQuery("r-ghosts", () => fetchLatestReport<GhostReport>("ghost_patterns"));
  const rows = [...(snaps.data ?? [])].sort((a, b) => a.period.localeCompare(b.period)).slice(-6);
  const refresh = () => { snaps.refresh(); coach.refresh(); review.refresh(); icp.refresh(); cal.refresh(); ghosts.refresh(); };
  const latest = rows[rows.length - 1]?.data;

  return (
    <Screen header={false} padTop={false} onRefresh={refresh} refreshing={snaps.refreshing}>
      <WhatWins />
      <SectionTitle right={<RunButton action="snapshot" label="Snapshot" confirm="Reads last month's proposals from the marketplace and saves a snapshot." onDone={snaps.reload} />}>Proposal funnel</SectionTitle>
      <Card style={{ marginBottom: 16 }}>
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {rows.length && w ? <FunnelChart rows={rows} width={w} /> : <T muted size={14}>{snaps.loading ? "Loading…" : "No monthly snapshots yet. The worker takes one at the start of each month."}</T>}
        </View>
        {latest ? (
          <>
            <Divider />
            <Row style={{ justifyContent: "space-between" }}>
              {(["sent", "viewed", "offers", "hired"] as const).map((k) => (
                <View key={k} style={{ alignItems: "center", flex: 1 }}>
                  <T weight="display" size={22} style={{ fontVariant: ["tabular-nums"] }}>{latest.proposals[k]}</T>
                  <T faint size={12} style={{ textTransform: "capitalize" }}>{k}</T>
                </View>
              ))}
            </Row>
          </>
        ) : null}
      </Card>

      {rows.some((r) => r.data.proposals.sent) && w ? (
        <>
          <SectionTitle>Win rate</SectionTitle>
          <Card style={{ marginBottom: 16 }}><WinRateChart rows={rows} width={w} /><T faint size={12}>Hired ÷ sent, per month.</T></Card>
        </>
      ) : null}

      <SectionTitle right={<RunButton action="review" label="Run review" confirm="LLM review of the latest month (a few cents)." onDone={review.reload} />}>Monthly review</SectionTitle>
      <Card style={{ marginBottom: 16, gap: 10 }}>
        {review.data ? (
          <>
            <T weight="semibold">{review.data.data.headline}</T>
            <T faint size={12}>{review.data.data.period} · built {fmtDate(review.data.data.builtAt)}</T>
            {review.data.data.whatWorked.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">What worked</T><Bullets items={review.data.data.whatWorked} tone="good" /></View> : null}
            {review.data.data.whatDidnt.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">{"What didn't"}</T><Bullets items={review.data.data.whatDidnt} tone="bad" /></View> : null}
            {review.data.data.actions.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">Actions</T><Bullets items={review.data.data.actions} /></View> : null}
          </>
        ) : <T muted size={14}>No review yet.</T>}
      </Card>

      <SectionTitle right={<RunButton action="coach" label="Run coach" confirm="Benchmarks top peers and writes profile advice (LLM, ~$0.30)." onDone={coach.reload} />}>Profile coach</SectionTitle>
      <Card style={{ marginBottom: 16, gap: 10 }}>
        {coach.data ? (
          <>
            <T weight="semibold">{coach.data.data.headline}</T>
            {coach.data.data.recommendations.slice(0, 4).map((r, i) => (
              <View key={i} style={{ gap: 4 }}>
                <Row gap={6}><Pill label={r.area.replace("_", " ")} /><Pill label={r.impact} tone={r.impact === "high" ? "good" : r.impact === "medium" ? "info" : "neutral"} /></Row>
                <T>{r.change}</T>
                {r.newText ? <T muted size={14} selectable>“{r.newText}”</T> : null}
                <T faint size={12}>{r.why}</T>
              </View>
            ))}
          </>
        ) : <T muted size={14}>No coach report yet.</T>}
      </Card>

      <SectionTitle right={<RunButton action="icp" label="Rebuild" onDone={icp.reload} />}>Ideal client profile</SectionTitle>
      <Card style={{ marginBottom: 16 }}>
        {icp.data ? (
          <>
            <KV label="Gross, last 12 months" value={compactMoney(icp.data.data.totalGross)} />
            <KV label="Avg top contract" value={compactMoney(icp.data.data.avgTopContract)} />
            <KV label="Contracts" value={icp.data.data.contracts} />
            {icp.data.data.top.slice(0, 3).map((t) => <KV key={t.contractId} label={t.title} value={compactMoney(t.gross)} />)}
            {icp.data.data.notes.length ? <><Divider /><Bullets items={icp.data.data.notes} /></> : null}
          </>
        ) : <T muted size={14}>Not built yet.</T>}
      </Card>

      <SectionTitle right={<RunButton action="calibrate" label="Recalibrate" onDone={cal.reload} />}>Calibration</SectionTitle>
      <Card style={{ marginBottom: 16, gap: 8 }}>
        {cal.data ? (
          <>
            <T>{cal.data.data.message}</T>
            {cal.data.data.proposed ? (
              <>
                <KV label="Alert threshold" value={cal.data.data.proposed.telegramMin} />
                <KV label="Weights · rules / LLM" value={`${cal.data.data.proposed.weights.rules} / ${cal.data.data.proposed.weights.llm}`} />
                <RunButton action="apply-calibration" label="Apply proposal" confirm="Updates the alert threshold and blend weights." onDone={cal.reload} />
              </>
            ) : null}
          </>
        ) : <Empty title="No calibration yet">Rate alerts with 👍/👎 - after 20 ratings the ranking can be tuned to you.</Empty>}
      </Card>
      <SectionTitle right={<RunButton action="ghosts" label="Rebuild" onDone={ghosts.reload} />}>Ghost patterns</SectionTitle>
      <Card style={{ marginBottom: 16, gap: 10 }}>
        {ghosts.data ? <GhostCard r={ghosts.data.data} /> : <T muted size={14}>{ghosts.loading ? "Loading…" : "No report yet. Rebuild groups recent jobs by hire-likelihood pattern."}</T>}
      </Card>
      {snaps.error ? <Banner tone="bad">{snaps.error}</Banner> : null}
      <View style={{ height: 1, backgroundColor: c.ground }} />
    </Screen>
  );
}
