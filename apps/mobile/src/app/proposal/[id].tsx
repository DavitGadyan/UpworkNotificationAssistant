import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { FeedbackButtons, openUpwork } from "../../components/job";
import { IconCheck, IconCopy, IconExternal, IconRefresh } from "../../components/icons";
import { Banner, Bullets, Button, Card, Empty, Field, KV, Pill, Row, Screen, SectionTitle, T } from "../../components/ui";
import { endpoints } from "../../lib/api";
import { fetchJob, fetchProposal, useQuery } from "../../lib/data";
import { CONTACT_ROLE_LABELS, COVER_MAX, LOOM_PLACEHOLDER, LOOM_RE, money, timeAgo } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { PROPOSAL_STATUS, STEPS, stepIndex } from "../../lib/status";
import { font, motion, radius, useTheme } from "../../theme";
import type { Proposal } from "../../types";

/* Stepper. State indication: colour-only transition (200ms ease-out) when a step completes. */
function Stepper({ idx }: { idx: number }) {
  const { c } = useTheme();
  return (
    <Row gap={0} style={{ alignItems: "flex-start", marginBottom: 16 }}>
      {STEPS.map((s, i) => {
        const done = i <= idx;
        const current = i === idx + 1;
        return (
          <View key={s} style={{ flex: 1, alignItems: "center", gap: 6 }} accessibilityLabel={`${s}: ${done ? "done" : current ? "next" : "to do"}`}>
            <Row gap={0} style={{ width: "100%" }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? "transparent" : i <= idx ? c.ink : c.line }} />
              <Animated.View style={{
                width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
                backgroundColor: done ? c.ink : c.surface, borderWidth: 2, borderColor: done || current ? c.ink : c.line,
                transitionProperty: ["backgroundColor", "borderColor"], transitionDuration: "200ms", transitionTimingFunction: motion.easeOutCss,
              }}>
                {done ? <IconCheck size={14} color={c.surface} /> : <Text style={{ fontFamily: font.semibold, fontSize: 12, color: current ? c.ink : c.faint }}>{i + 1}</Text>}
              </Animated.View>
              <View style={{ flex: 1, height: 2, backgroundColor: i === STEPS.length - 1 ? "transparent" : i < idx ? c.ink : c.line }} />
            </Row>
            <Text style={{ fontFamily: current ? font.semibold : font.medium, fontSize: 11, color: done || current ? c.ink : c.faint }}>{s}</Text>
          </View>
        );
      })}
    </Row>
  );
}

const HIGHLIGHT: [string, string][] = [["connects_cost", "Connects cost"], ["connects_balance", "Connects balance"], ["boost", "Boost"], ["unmet_preferred_qualifications", "Unmet preferred qualifications"]];

function flatten(o: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}
const show = (v: unknown) => (v == null ? "—" : Array.isArray(v) ? (v.length ? v.map(String).join(", ") : "None") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

function PreviewPanel({ data }: { data: Record<string, unknown> }) {
  const flat = flatten(data);
  const find = (key: string) => Object.keys(flat).find((k) => k === key || k.endsWith(`.${key}`));
  const hl = HIGHLIGHT.map(([k, label]) => [find(k), label] as const).filter(([k]) => k);
  const rest = Object.keys(flat).filter((k) => !hl.some(([h]) => h === k) && !/id$/i.test(k) && flat[k] != null && String(flat[k]).length < 80).slice(0, 8);
  return (
    <Card style={{ marginBottom: 16 }}>
      <T weight="semibold" style={{ marginBottom: 6 }}>Marketplace preview</T>
      {hl.map(([k, label]) => <KV key={k} label={label} value={show(flat[k!])} />)}
      {rest.map((k) => <KV key={k} label={k.replace(/[._]/g, " ")} value={show(flat[k])} />)}
    </Card>
  );
}

export default function ProposalEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const { c } = useTheme();
  const q = useQuery(`proposal:${pid}`, () => fetchProposal(pid), ["proposals"]);
  const p = q.data ?? null;
  const job = useQuery(`proposal-job:${p?.jobId ?? "-"}`, () => (p?.jobId ? fetchJob(p.jobId) : Promise.resolve(null)));

  const [letter, setLetter] = useState("");
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [bid, setBid] = useState("");
  const [loom, setLoom] = useState("");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const dirty = !!p && (letter !== p.coverLetter || bid !== (p.bid == null ? "" : String(p.bid)) || JSON.stringify(answers) !== JSON.stringify(p.answers));

  // Load server state into the editor - on first load, and on live updates only when nothing is being edited.
  // (State adjusted during render - React's pattern for deriving state from changed props/data.)
  if (p && p.updatedAt !== loadedAt && !(loadedAt && dirty)) {
    setLetter(p.coverLetter);
    setAnswers(p.answers);
    setBid(p.bid == null ? "" : String(p.bid));
    setLoom(p.loomUrl ?? "");
    setLoadedAt(p.updatedAt);
  }

  if (!p) {
    return <Screen header={false} padTop={false}>{q.loading ? <T muted>Loading…</T> : <Empty title="Proposal not found">{q.error ?? "It may have been removed."}</Empty>}</Screen>;
  }

  const st = PROPOSAL_STATUS[p.status];
  const idx = stepIndex(p.status);
  const locked = p.status === "submitted" || p.status === "discarded";
  const screening = job.data?.enrichment?.screeningQuestions ?? [];
  const connects = job.data?.enrichment?.connectsCost ?? null;
  const upwork = (p.preview?.upwork ?? null) as Record<string, unknown> | null;
  const loomValid = LOOM_RE.test(loom.trim());

  async function run(label: string, fn: () => Promise<Proposal>, opts: { success?: boolean } = {}) {
    setBusy(label); setError(null);
    try {
      const next = await fn();
      q.setData(next);
      setLoadedAt(null);
      if (opts.success) haptic.success(); else haptic.light();
      return true;
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = () => run("save", () => endpoints.editProposal(p.id, { coverLetter: letter.slice(0, COVER_MAX), answers, bid: bid.trim() === "" ? null : Number(bid) }));
  const saveIfDirty = async () => (dirty ? await save() : true);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: `Proposal #${p.id}` }} />
      <Screen header={false} padTop={false} onRefresh={q.refresh} refreshing={q.refreshing}>
        <T weight="displaySemi" size={19} style={{ marginBottom: 6 }}>{p.jobTitle}</T>
        <Row gap={6} style={{ marginBottom: 14 }}>
          <Pill label={st.label} tone={st.tone} />
          <T faint size={12}>updated {timeAgo(p.updatedAt)}{p.model ? ` · ${p.model}` : ""}</T>
        </Row>
        {idx >= 0 ? <Stepper idx={idx} /> : null}
        <Banner tone="info">Nothing is sent to Upwork until you submit here.</Banner>
        {error ? <Banner tone="bad" title="That didn't work">{error}</Banner> : null}

        {p.research ? (
          <>
            <SectionTitle>Research</SectionTitle>
            <Card style={{ marginBottom: 16, gap: 10 }}>
              <KV label="Contact" value={p.research.contactName ?? "Unknown"} />
              {p.research.contactRole ? (
                <View style={{ gap: 4 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <T muted size={14}>Contact role</T>
                    <Pill label={CONTACT_ROLE_LABELS[p.research.contactRole] ?? p.research.contactRole} tone="info" />
                  </Row>
                  {p.research.roleEvidence ? <T faint size={12}>{p.research.roleEvidence}</T> : null}
                </View>
              ) : null}
              <KV label="Company" value={`${p.research.company ?? "Unknown"}${p.research.company ? ` · ${p.research.companyConfidence}` : ""}`} tone={p.research.companyConfidence === "confirmed" ? "good" : undefined} />
              {p.research.bigFish ? <View style={{ gap: 4 }}><T muted size={13} weight="medium">Big fish</T><T>{p.research.bigFish}</T></View> : null}
              {p.research.hiddenProblems.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">Hidden problems</T><Bullets items={p.research.hiddenProblems} tone="warn" /></View> : null}
              {p.research.assumptions.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">Assumptions to check</T><Bullets items={p.research.assumptions} /></View> : null}
            </Card>
          </>
        ) : null}

        <SectionTitle right={<T size={12} muted style={{ color: letter.length > COVER_MAX ? c.bad : c.muted, fontVariant: ["tabular-nums"] }}>{letter.length.toLocaleString("en-US")} / {COVER_MAX.toLocaleString("en-US")}</T>}>Cover letter</SectionTitle>
        <Field label="" value={letter} onChangeText={setLetter} multiline editable={!locked} maxLength={COVER_MAX} style={{ marginBottom: 4 }} />
        {letter.includes(LOOM_PLACEHOLDER) ? <T size={12} style={{ color: c.warn, marginBottom: 12 }}>The letter still has the {LOOM_PLACEHOLDER} placeholder - attaching a Loom link fills it in.</T> : <View style={{ height: 8 }} />}
        <Row gap={8} wrap style={{ marginBottom: 16 }}>
          <Button small label="Copy" icon={(col) => <IconCopy size={16} color={col} />} onPress={async () => { await Clipboard.setStringAsync(letter); haptic.light(); }} />
          {!locked ? <Button small label={dirty ? "Save changes" : "Saved"} variant={dirty ? "dark" : "default"} disabled={!dirty} loading={busy === "save"} onPress={save} /> : null}
          {!locked ? (
            <Button small label={busy === "rewrite" ? "Rewriting…" : "Rewrite shorter"} loading={busy === "rewrite"} disabled={busy !== null}
              icon={(col) => <IconRefresh size={16} color={col} />} accessibilityLabel="Rewrite shorter"
              onPress={() => {
                const go = () => run("rewrite", () => endpoints.rewrite(p.id), { success: true });
                if (dirty) Alert.alert("Rewrite shorter?", "This replaces your unsaved edits.", [{ text: "Cancel", style: "cancel" }, { text: "Rewrite", onPress: go }]);
                else go();
              }} />
          ) : null}
        </Row>
        {busy === "rewrite" ? <T muted size={12} style={{ marginTop: -8, marginBottom: 16 }}>Rewriting - this usually takes 30 to 60 seconds.</T> : null}

        {(p.answers.length || screening.length) ? (
          <>
            <SectionTitle>Screening answers</SectionTitle>
            {answers.map((a, i) => (
              <Field key={i} label={a.question} value={a.answer} multiline editable={!locked}
                onChangeText={(t) => setAnswers((prev) => prev.map((x, j) => (j === i ? { ...x, answer: t } : x)))} />
            ))}
          </>
        ) : null}

        <SectionTitle right={connects != null ? <Pill label={`${connects} Connects`} tone="info" /> : undefined}>Bid</SectionTitle>
        <Field label="Amount (USD)" value={bid} onChangeText={(t) => setBid(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" editable={!locked} placeholder="e.g. 4500" hint={p.bid != null ? `Saved: ${money(p.bid)}` : undefined} />

        <SectionTitle>Loom video</SectionTitle>
        <Card style={{ marginBottom: 16, gap: 4 }}>
          <Field label="Loom link (or branded short link)" value={loom} onChangeText={setLoom} placeholder="https://www.loom.com/share/…" autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!locked}
            error={loom.trim() && !loomValid ? "Paste a Loom share link or a short link that redirects to one" : null} />
          {!locked ? (
            <Button label={p.loomUrl && p.loomUrl === loom.trim() ? "Loom attached" : "Attach Loom"} disabled={!loomValid || p.loomUrl === loom.trim()} loading={busy === "loom"}
              icon={p.loomUrl === loom.trim() && loomValid ? (col) => <IconCheck size={16} color={col} /> : undefined}
              onPress={async () => { if (await saveIfDirty()) run("loom", () => endpoints.loom(p.id, loom.trim())); }} />
          ) : null}
        </Card>

        {upwork ? <PreviewPanel data={upwork} /> : null}

        {!locked ? (
          <View style={{ gap: 10, marginBottom: 16 }}>
            {p.status === "ready" ? <Button label="Approve" variant="dark" loading={busy === "approve"} onPress={async () => { if (await saveIfDirty()) run("approve", () => endpoints.approve(p.id)); }} /> : null}
            {p.status === "approved" ? <Button label="Build preview" variant="dark" loading={busy === "preview"} onPress={() => run("preview", () => endpoints.preview(p.id))} /> : null}
            {p.status === "previewed" ? <Button label="Submit to Upwork…" variant="accent" onPress={() => { setConfirmText(""); setSubmitOpen(true); haptic.medium(); }} /> : null}
            {p.status === "needs_loom" || p.status === "draft" ? <T muted size={13}>Next: record a short Loom, paste its share link above and attach it. Then approve.</T> : null}
            <Button label="Discard" variant="danger" loading={busy === "discard"} onPress={() => Alert.alert("Discard this proposal?", "It stays in the list as discarded.", [
              { text: "Cancel", style: "cancel" },
              { text: "Discard", style: "destructive", onPress: () => { haptic.medium(); run("discard", () => endpoints.discard(p.id)); } },
            ])} />
          </View>
        ) : null}

        {p.status === "submitted" ? <Banner tone="good" title="Submitted">{p.submittedAt ? `Sent ${timeAgo(p.submittedAt)}.` : "Sent."}</Banner> : null}

        <Card style={{ marginBottom: 16 }}>
          <FeedbackButtons kind="draft" refId={String(p.id)} label="Good draft?" data={{ promptVersion: p.promptVersion, model: p.model, status: p.status }} />
        </Card>
        <Button label="Open job in Upwork" variant="ghost" icon={(col) => <IconExternal size={16} color={col} />} onPress={() => openUpwork(p.jobUrl)} />
        <Button label="View job details" variant="ghost" onPress={() => router.push({ pathname: "/job/[id]", params: { id: p.jobId } })} />
      </Screen>

      {/* Native page sheet: the platform's own presentation and dismissal. */}
      <Modal visible={submitOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSubmitOpen(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <T weight="display" size={24} style={{ textTransform: "uppercase" }}>Submit proposal</T>
          <T muted>This sends the proposal to the client on Upwork{connects != null ? ` and spends ${connects} Connects` : ""}. {"It can't be undone from here."}</T>
          <Card>
            <KV label="Bid" value={money(p.bid)} />
            <KV label="Loom" value={p.loomUrl ? "Attached" : "Missing"} tone={p.loomUrl ? "good" : "bad"} />
            <KV label="Cover letter" value={`${p.coverLetter.length.toLocaleString("en-US")} chars`} />
          </Card>
          <Field label='Type SUBMIT to confirm' value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} autoFocus placeholder="SUBMIT" />
          <Button label="Submit now" variant="accent" disabled={confirmText !== "SUBMIT"} loading={busy === "submit"} onPress={async () => {
            const ok = await run("submit", () => endpoints.submit(p.id), { success: true });
            if (ok) setSubmitOpen(false);
          }} />
          {error && submitOpen ? <Banner tone="bad">{error}</Banner> : null}
          <Button label="Cancel" variant="ghost" onPress={() => setSubmitOpen(false)} />
          <View style={{ height: 8, borderRadius: radius.pill }} />
        </ScrollView>
      </Modal>
    </KeyboardAvoidingView>
  );
}
