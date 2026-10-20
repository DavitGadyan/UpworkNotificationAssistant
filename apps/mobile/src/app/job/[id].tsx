import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Switch, View } from "react-native";
import { FeedbackButtons, jobPill, OpenButton, scoreTone } from "../../components/job";
import { IconAlert, IconBriefcase, IconCheck, IconDoc, IconGlobe, IconSearch, IconSpark, IconStar, IconUser } from "../../components/icons";
import { Banner, Button, Card, Dot, Empty, Field, ListRow, Pill, PressableScale, ProgressBar, RankPill, Row, Screen, SectionTitle, T, Tag, Tile } from "../../components/ui";
import { endpoints } from "../../lib/api";
import { fetchJob, fetchProposals, useQuery } from "../../lib/data";
import { budgetLabel, compactMoney, intentLabel, intentRiskLabel, intentTone, money, pct, proposalsLabel, timeAgo } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { useSettings } from "../../lib/settings";
import { PROPOSAL_STATUS } from "../../lib/status";
import { useTheme } from "../../theme";
import type { RuleFlag } from "../../types";

/* Job detail (compact, 2026-10-20): numbers and pills first; long text (reasons, reviews, evidence) behind a tap. */

const sevTone = (s: RuleFlag["severity"]): "bad" | "warn" | "info" => (s === "red" ? "bad" : s === "amber" ? "warn" : "info");
const show = (title: string, lines: string[]) => Alert.alert(title, lines.map((l) => `• ${l}`).join("\n\n"));

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { th } = useSettings();
  const job = useQuery(`job:${id}`, () => fetchJob(id), ["jobs"]);
  const proposals = useQuery(`job-props:${id}`, () => fetchProposals(id), ["proposals"]);

  const [guidance, setGuidance] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [fullSummary, setFullSummary] = useState(false);

  useEffect(() => {
    if (!drafting) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [drafting]);

  const j = job.data;
  if (!j) {
    return (
      <Screen header={false} padTop={false} onRefresh={job.refresh} refreshing={job.refreshing}>
        {job.loading ? <T muted>Loading…</T> : <Empty title="Job not found">{job.error ?? "It may have been cleaned up."}</Empty>}
      </Screen>
    );
  }

  const pill = jobPill(j.status, j.score, th);
  const llm = j.score.llm ?? null;
  const rules = j.score.rules;
  const intent = j.score.intent ?? null;
  const rec = j.enrichment?.record;
  const derived = rules?.derived;
  const fit = j.score.profileFit;
  const mi = (I: typeof IconUser) => <I size={13} color={c.muted} cut={c.surface} />;

  async function draft() {
    setElapsed(0); setDrafting(true); setDraftError(null);
    haptic.light();
    try {
      const p = await endpoints.draft(j!.id, { guidance: guidance.trim() || undefined, webSearch });
      haptic.success();
      proposals.reload();
      router.push({ pathname: "/proposal/[id]", params: { id: String(p.id) } });
    } catch (e) {
      haptic.error();
      setDraftError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  const reviews = j.enrichment?.reviews ?? [];
  const questions = j.enrichment?.screeningQuestions ?? [];
  const connects = j.enrichment?.connectsCost ?? null;

  return (
    <Screen header={false} padTop={false} onRefresh={() => { job.refresh(); proposals.refresh(); }} refreshing={job.refreshing}>
      <Stack.Screen options={{ title: `Rank ${j.score.total}` }} />
      <Row gap={12} style={{ alignItems: "flex-start", marginBottom: 10 }}>
        <RankPill total={j.score.total} tone={scoreTone(j.score, th)} />
        <View style={{ flex: 1, gap: 6 }}>
          <T weight="displaySemi" size={18} numberOfLines={3} selectable>{j.title}</T>
          <Row wrap gap={6}>
            <Pill label={pill.label} tone={pill.tone} />
            {rules?.category ? <Tag label={rules.category} /> : null}
            <T faint size={12}>{timeAgo(j.publishedAt)}</T>
          </Row>
        </View>
      </Row>
      <Row wrap gap={6} style={{ marginBottom: 12 }}>
        <Pill label={budgetLabel(j)} tone="info" />
        <Pill label={proposalsLabel(j)} />
        <Pill label={j.client.country ?? "Country ?"} />
        {connects != null ? <Pill label={`${connects} Connects`} /> : null}
      </Row>
      <OpenButton url={j.url} />
      <View style={{ height: 14 }} />

      {j.status === "pending" ? <Banner tone="info" title="Checking client…" /> : null}
      {j.status === "awaiting_ai" ? <Banner tone="info" title="Waiting for AI check">Not alerted until ranked</Banner> : null}
      {fit?.verdict === "off" ? (
        <Banner tone="neutral" title={`Not your field${fit.field ? ` · ${fit.field}` : ""}`} action={fit.reasons.length ? <Button small variant="ghost" label="Why" onPress={() => show("Not your field", fit.reasons)} /> : undefined} />
      ) : j.score.excluded ? <Banner tone="bad" title={j.score.excluded.startsWith("Not your field") ? "Not your field" : "Filtered out"}><T size={13} numberOfLines={2} style={{ color: c.bad }}>{j.score.excluded}</T></Banner> : null}
      {fit && fit.verdict !== "off" ? (
        <ListRow first icon={<Dot tone={fit.verdict === "core" ? "good" : "warn"} />} title={`${fit.verdict === "core" ? "Your field" : "Unclear fit"}${fit.field ? ` · ${fit.field}` : ""}`}
          right={fit.reasons.length ? <T faint size={12}>Why ›</T> : undefined} onPress={fit.reasons.length ? () => show("Field fit", fit.reasons) : undefined} />
      ) : null}

      {intent || llm ? (
        <Row gap={8} style={{ marginVertical: 12 }}>
          {intent ? <Tile label="Hire chance" value={`${intent.hireLikelihood}%`} sub={intentRiskLabel(intent.ghostRisk)} tone={intentTone(intent.ghostRisk)} icon={mi(IconUser)}
            onPress={intent.evidence.length ? () => show(intentLabel(intent.archetype), intent.evidence) : undefined} /> : null}
          {llm ? <Tile label="AI fit" value={llm.fit} sub={`value ${llm.valuePotential}`} icon={mi(IconSpark)} /> : null}
          {rules ? <Tile label="Rules" value={rules.score} sub={`${rules.flags.length} flags`} tone={rules.flags.some((f) => f.severity === "red") ? "bad" : undefined} icon={mi(IconCheck)} /> : null}
        </Row>
      ) : null}
      {intent?.ghostRisk === "high" ? <Banner tone="bad" title="Likely not hiring - skip">{intentLabel(intent.archetype)}</Banner> : null}

      {llm ? (
        <>
          <SectionTitle>AI read</SectionTitle>
          <Card style={{ gap: 10, marginBottom: 16 }}>
            <PressableScale onPress={() => setFullSummary((v) => !v)} accessibilityLabel="AI summary">
              <T size={14} numberOfLines={fullSummary ? undefined : 3} selectable>{llm.summary}</T>
            </PressableScale>
            <Row wrap gap={6}>
              {llm.reasons.length ? <PressableScale onPress={() => show("Why it fits", llm.reasons)} accessibilityLabel="Why it fits"><Pill label={`✓ ${llm.reasons.length} fits`} tone="good" /></PressableScale> : null}
              {llm.redFlags.length ? <PressableScale onPress={() => show("Red flags", llm.redFlags)} accessibilityLabel="Red flags"><Pill label={`⚠ ${llm.redFlags.length} flags`} tone="bad" /></PressableScale> : null}
              {llm.bigFish ? <PressableScale onPress={() => Alert.alert("Big fish", llm.bigFish!)} accessibilityLabel="Big fish"><Pill label="Big fish" tone="info" /></PressableScale> : null}
              {llm.finalProduct ? <PressableScale onPress={() => Alert.alert("Final product", llm.finalProduct!)} accessibilityLabel="Final product"><Pill label="Product" /></PressableScale> : null}
            </Row>
            {llm.skillsWanted.length ? <Row wrap gap={6}>{llm.skillsWanted.slice(0, 8).map((s) => <Tag key={s} label={s} />)}</Row> : null}
          </Card>
        </>
      ) : null}

      {rules && (rules.flags.length || rules.passes.length) ? (
        <>
          <SectionTitle>Rules</SectionTitle>
          <Card style={{ gap: 8, marginBottom: 16 }}>
            {rules.flags.length ? <Row wrap gap={6}>{rules.flags.map((f) => <Pill key={f.code} label={`${f.label}${f.penalty ? ` −${f.penalty}` : ""}`} tone={sevTone(f.severity)} />)}</Row> : null}
            {rules.passes.length ? <Row wrap gap={6}>{rules.passes.map((p) => <Pill key={p} label={p} tone="good" />)}</Row> : null}
          </Card>
        </>
      ) : null}

      <SectionTitle right={j.client.paymentVerified === false ? <Pill label="Unverified" tone="bad" /> : j.client.paymentVerified ? <Pill label="Verified" tone="good" /> : undefined}>Client</SectionTitle>
      <Row gap={8} style={{ marginBottom: 8 }}>
        <Tile label="Hire rate" value={pct(rec?.hireRatePercent ?? derived?.hireRate)} icon={mi(IconUser)} />
        <Tile label="Spent" value={compactMoney(rec?.totalSpent ?? j.client.totalSpent)} icon={mi(IconBriefcase)} />
        <Tile label="Avg/hr" value={derived?.avgPaid != null ? money(derived.avgPaid) : "—"} icon={mi(IconGlobe)} />
      </Row>
      <Row gap={8} style={{ marginBottom: 16 }}>
        <Tile label="Posted" value={rec?.jobsPosted ?? j.client.totalPostedJobs} sub={rec?.openJobs != null ? `${rec.openJobs} open` : undefined} icon={mi(IconDoc)} />
        <Tile label="Rating" value={(rec?.feedbackScore ?? j.client.totalFeedback)?.toFixed?.(1) ?? "—"} sub={`${rec?.feedbackCount ?? j.client.totalReviews} reviews`} icon={mi(IconStar)}
          onPress={reviews.length ? () => Alert.alert("Reviews", reviews.slice(0, 5).map((r) => `${r.score != null ? `${r.score.toFixed(1)}★ ` : ""}“${r.comment}”`).join("\n\n")) : undefined} />
        <Tile label="Last hire" value={derived?.lastHireDays != null ? `${derived.lastHireDays}d` : "—"} sub={rec?.hours != null ? `${rec.hours.toLocaleString("en-US")} h` : undefined} icon={mi(IconSearch)} />
      </Row>

      {questions.length ? (
        <>
          <SectionTitle right={<Pill label={`${questions.length}`} />}>Questions</SectionTitle>
          <Card style={{ marginBottom: 16, paddingVertical: 4 }}>
            {questions.map((q, i) => <ListRow key={i} first={i === 0} icon={<T faint size={12}>{i + 1}</T>} title={q} onPress={() => Alert.alert(`Question ${i + 1}`, q)} />)}
          </Card>
        </>
      ) : null}

      <SectionTitle>Draft</SectionTitle>
      <Card style={{ marginBottom: 16, gap: 4 }}>
        <Field label="" value={guidance} onChangeText={setGuidance} placeholder="Guidance (optional)" multiline style={{ marginBottom: 6 }} />
        <Row style={{ justifyContent: "space-between", minHeight: 40, marginBottom: 6 }}>
          <Row gap={6}><IconGlobe size={14} color={c.muted} /><T size={14}>Web research</T></Row>
          <Switch value={webSearch} onValueChange={(v) => { haptic.select(); setWebSearch(v); }} trackColor={{ true: c.accent }} accessibilityLabel="Research the client on the web" />
        </Row>
        {drafting ? (
          <View style={{ gap: 6, paddingVertical: 4 }}>
            <ProgressBar />
            <T muted size={12}>Writing… {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · 1–3 min</T>
          </View>
        ) : (
          <Button label="Generate draft" variant="accent" onPress={draft} icon={(col) => <IconSpark size={18} color={col} />} />
        )}
        {draftError ? <Banner tone="bad" title="Draft failed"><T size={13} numberOfLines={3} style={{ color: c.bad }}>{draftError}</T></Banner> : null}
      </Card>

      {proposals.data?.length ? (
        <>
          <SectionTitle>Proposals</SectionTitle>
          <Card style={{ marginBottom: 16, paddingVertical: 4 }}>
            {proposals.data.map((p, i) => {
              const st = PROPOSAL_STATUS[p.status];
              return <ListRow key={p.id} first={i === 0} icon={<IconDoc size={16} color={c.muted} cut={c.surface} />} title={`#${p.id}`} meta={timeAgo(p.updatedAt)}
                right={<Pill label={st.label} tone={st.tone} />} onPress={() => router.push({ pathname: "/proposal/[id]", params: { id: String(p.id) } })} />;
            })}
          </Card>
        </>
      ) : null}

      <Card style={{ marginBottom: 16 }}>
        <FeedbackButtons kind="alert" refId={j.id} label="Good alert?" data={{
          title: j.title, score: j.score.total, category: rules?.category ?? llm?.category ?? null, rules: rules?.score ?? null,
          llmFit: llm?.fit ?? null, flags: rules?.flags.map((f) => f.code) ?? [],
        }} />
      </Card>
      {(rec == null && j.status === "pending") ? <Row gap={6}><IconAlert size={14} color={c.faint} /><T faint size={12}>Client record loading</T></Row> : null}
    </Screen>
  );
}
