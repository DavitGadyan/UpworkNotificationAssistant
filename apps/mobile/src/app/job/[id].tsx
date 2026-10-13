import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { FeedbackButtons, jobPill, OpenButton, scoreTone } from "../../components/job";
import { IconSpark } from "../../components/icons";
import { Banner, Bullets, Button, Card, Divider, Empty, Field, KV, Pill, PressableScale, ProgressBar, RankPill, Row, Screen, SectionTitle, T, Tag } from "../../components/ui";
import { endpoints } from "../../lib/api";
import { fetchJob, fetchProposals, useQuery } from "../../lib/data";
import { budgetLabel, compactMoney, intentLabel, intentRiskLabel, intentTone, money, pct, proposalsLabel, timeAgo } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { useSettings } from "../../lib/settings";
import { PROPOSAL_STATUS } from "../../lib/status";
import { useTheme } from "../../theme";
import type { RuleFlag } from "../../types";

const sevTone = (s: RuleFlag["severity"]): "bad" | "warn" | "info" => (s === "red" ? "bad" : s === "amber" ? "warn" : "info");

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

  useEffect(() => {
    if (!drafting) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [drafting]);

  const j = job.data;
  if (!j) {
    return (
      <Screen header={false} padTop={false} onRefresh={job.refresh} refreshing={job.refreshing}>
        {job.loading ? <T muted>Loading…</T> : <Empty title="Job not found">{job.error ?? "It may have been cleaned up, or this account can't read it."}</Empty>}
      </Screen>
    );
  }

  const pill = jobPill(j.status, j.score, th);
  const llm = j.score.llm ?? null;
  const rules = j.score.rules;
  const intent = j.score.intent ?? null;
  const rec = j.enrichment?.record;
  const derived = rules?.derived;

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

  return (
    <Screen header={false} padTop={false} onRefresh={() => { job.refresh(); proposals.refresh(); }} refreshing={job.refreshing}>
      <Stack.Screen options={{ title: `Rank ${j.score.total}` }} />
      <Row gap={12} style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <RankPill total={j.score.total} tone={scoreTone(j.score, th)} />
        <View style={{ flex: 1, gap: 6 }}>
          <T weight="displaySemi" size={20} selectable>{j.title}</T>
          <Row wrap gap={6}>
            <Pill label={pill.label} tone={pill.tone} />
            {rules?.category ? <Tag label={rules.category} /> : null}
            <T faint size={12}>{timeAgo(j.publishedAt)}</T>
          </Row>
        </View>
      </Row>
      <T muted size={14} style={{ marginBottom: 12 }}>{budgetLabel(j)} · {proposalsLabel(j)} · {j.client.country ?? "Unknown country"}</T>
      <OpenButton url={j.url} />
      <View style={{ height: 16 }} />

      {j.status === "pending" ? <Banner tone="info" title="Checking client…">The client record is still loading. The rank and alert decision update when it arrives.</Banner> : null}
      {j.score.excluded ? <Banner tone="bad" title="Filtered out">{j.score.excluded}</Banner> : null}

      {intent ? (
        <>
          <SectionTitle right={<Pill label={intentRiskLabel(intent.ghostRisk)} tone={intentTone(intent.ghostRisk)} />}>Hire likelihood</SectionTitle>
          <Card style={{ gap: 10, marginBottom: 20 }}>
            <Row gap={10} style={{ alignItems: "baseline" }}>
              <T weight="display" size={30} style={{ color: c[intentTone(intent.ghostRisk)] }}>{intent.hireLikelihood}%</T>
              <T weight="medium" style={{ flexShrink: 1 }}>{intentLabel(intent.archetype)}</T>
            </Row>
            {intent.ghostRisk === "high" ? <Pill label="Likely not hiring — skip" tone="bad" /> : null}
            {intent.evidence.length ? <Bullets items={intent.evidence} tone={intentTone(intent.ghostRisk)} /> : null}
            <T muted size={12}>Advisory only — your ranking rules are unchanged. High-risk jobs get no auto-draft.</T>
          </Card>
        </>
      ) : null}

      {llm ? (
        <>
          <SectionTitle right={<T muted size={13}>fit {llm.fit} · value {llm.valuePotential}</T>}>AI read</SectionTitle>
          <Card style={{ gap: 12, marginBottom: 20 }}>
            <T selectable>{llm.summary}</T>
            {llm.finalProduct ? <View style={{ gap: 4 }}><T muted size={13} weight="medium">Final product</T><T selectable>{llm.finalProduct}</T></View> : null}
            {llm.bigFish ? <View style={{ gap: 4 }}><T muted size={13} weight="medium">Big fish</T><T selectable>{llm.bigFish}</T></View> : null}
            {llm.reasons.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">Why it fits</T><Bullets items={llm.reasons} tone="good" /></View> : null}
            {llm.redFlags.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">Red flags</T><Bullets items={llm.redFlags} tone="bad" /></View> : null}
            {llm.skillsWanted.length ? <Row wrap gap={6}>{llm.skillsWanted.map((s) => <Tag key={s} label={s} />)}</Row> : null}
          </Card>
        </>
      ) : null}

      {rules ? (
        <>
          <SectionTitle right={<T muted size={13}>rules {rules.score}</T>}>Rule checks</SectionTitle>
          <Card style={{ gap: 10, marginBottom: 20 }}>
            {rules.flags.length ? (
              <Row wrap gap={6}>{rules.flags.map((f) => <Pill key={f.code} label={`${f.label}${f.penalty ? ` −${f.penalty}` : ""}`} tone={sevTone(f.severity)} />)}</Row>
            ) : <T muted size={14}>No flags.</T>}
            {rules.passes.length ? <Row wrap gap={6}>{rules.passes.map((p) => <Pill key={p} label={p} tone="good" />)}</Row> : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>Client record</SectionTitle>
      <Card style={{ marginBottom: 20 }}>
        {j.status === "pending" && !rec ? <T muted size={14}>Checking client…</T> : null}
        <KV label="Hire rate" value={pct(rec?.hireRatePercent ?? derived?.hireRate)} />
        <KV label="Avg paid" value={derived?.avgPaid != null ? `≈ ${money(derived.avgPaid)}/hr` : "—"} />
        <KV label="Total spent" value={compactMoney(rec?.totalSpent ?? j.client.totalSpent)} />
        <KV label="Hours billed" value={rec?.hours != null ? rec.hours.toLocaleString("en-US") : "—"} />
        <KV label="Jobs posted · open" value={`${rec?.jobsPosted ?? j.client.totalPostedJobs} · ${rec?.openJobs ?? "—"}`} />
        <KV label="Reviews" value={`${(rec?.feedbackScore ?? j.client.totalFeedback)?.toFixed?.(1) ?? "—"} ★ · ${rec?.feedbackCount ?? j.client.totalReviews}`} />
        <KV label="Payment verified" value={j.client.paymentVerified == null ? "Unknown" : j.client.paymentVerified ? "Yes" : "No"} tone={j.client.paymentVerified === false ? "bad" : undefined} />
        {derived?.lastHireDays != null ? <KV label="Last hire" value={`${derived.lastHireDays} days ago`} /> : null}
        {j.enrichment?.reviews.length ? (
          <>
            <Divider />
            {j.enrichment.reviews.slice(0, 3).map((r, i) => (
              <View key={i} style={{ paddingVertical: 6, gap: 2 }}>
                <T size={14} selectable>“{r.comment}”</T>
                <T faint size={12}>{r.score != null ? `${r.score.toFixed(1)} ★ · ` : ""}{r.title ?? ""}</T>
              </View>
            ))}
          </>
        ) : null}
      </Card>

      {(j.enrichment?.screeningQuestions.length || j.enrichment?.connectsCost != null) ? (
        <>
          <SectionTitle right={j.enrichment?.connectsCost != null ? <Pill label={`${j.enrichment.connectsCost} Connects`} tone="info" /> : undefined}>To apply</SectionTitle>
          <Card style={{ marginBottom: 20, gap: 8 }}>
            {j.enrichment?.screeningQuestions.length ? (
              j.enrichment.screeningQuestions.map((q, i) => <T key={i} size={15} selectable>{i + 1}. {q}</T>)
            ) : <T muted size={14}>No screening questions.</T>}
          </Card>
        </>
      ) : null}

      <Card style={{ marginBottom: 20 }}>
        <FeedbackButtons kind="alert" refId={j.id} label="Good alert?" data={{
          title: j.title, score: j.score.total, category: rules?.category ?? llm?.category ?? null, rules: rules?.score ?? null,
          llmFit: llm?.fit ?? null, flags: rules?.flags.map((f) => f.code) ?? [],
        }} />
      </Card>

      <SectionTitle>Proposal draft</SectionTitle>
      <Card style={{ marginBottom: 20, gap: 4 }}>
        <Field label="Guidance (optional)" value={guidance} onChangeText={setGuidance} placeholder="e.g. lead with the logistics agent project" multiline style={{ marginBottom: 8 }} />
        <Row style={{ justifyContent: "space-between", minHeight: 44, marginBottom: 8 }}>
          <View style={{ flex: 1 }}><T>Research the client on the web</T><T faint size={12}>Slower, finds company and contact</T></View>
          <Switch value={webSearch} onValueChange={(v) => { haptic.select(); setWebSearch(v); }} trackColor={{ true: c.accent }} />
        </Row>
        {drafting ? (
          <View style={{ gap: 8, paddingVertical: 4 }}>
            <ProgressBar />
            <T muted size={13}>Researching and writing… {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · usually 1–3 min. You can leave this screen; the draft appears under Proposals.</T>
          </View>
        ) : (
          <Button label="Generate proposal draft" variant="accent" onPress={draft} icon={(col) => <IconSpark size={18} color={col} />} />
        )}
        {draftError ? <Banner tone="bad" title="Draft failed">{draftError}</Banner> : null}
        <T faint size={12} style={{ marginTop: 6 }}>Drafts are never sent. Nothing reaches the client until you submit from the proposal screen.</T>
      </Card>

      {proposals.data?.length ? (
        <>
          <SectionTitle>Proposals for this job</SectionTitle>
          <View style={{ gap: 8 }}>
            {proposals.data.map((p) => {
              const st = PROPOSAL_STATUS[p.status];
              return (
                <PressableScale key={p.id} onPress={() => router.push({ pathname: "/proposal/[id]", params: { id: String(p.id) } })} accessibilityLabel={`Proposal ${p.id}`}>
                  <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 60 }}>
                    <View><T weight="medium">Proposal #{p.id}</T><T faint size={12}>updated {timeAgo(p.updatedAt)}</T></View>
                    <Pill label={st.label} tone={st.tone} />
                  </Card>
                </PressableScale>
              );
            })}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
