import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { FeedbackButtons, openUpwork } from "../../components/job";
import { IconCheck, IconCopy, IconExternal, IconRefresh, IconSend } from "../../components/icons";
import { Banner, Bullets, Button, Card, Empty, Field, KV, Pill, PressableScale, Row, Screen, SectionTitle, Seg, T } from "../../components/ui";
import { endpoints } from "../../lib/api";
import { applyUrl, DURATIONS, findPlaceholders, letterForUpwork } from "../../lib/clean";
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

/** One field to paste into Upwork: tap to copy, ticked once copied. */
function CopyRow({ label, preview, done, onPress }: { label: string; preview: string; done: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`Copy ${label}`}>
      <Row gap={12} style={{ minHeight: 56, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.line }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="medium" size={14}>{label}</T>
          <T faint size={12} numberOfLines={1}>{preview || "—"}</T>
        </View>
        <Row gap={6} style={{ paddingHorizontal: 12, minHeight: 36, borderRadius: radius.pill, backgroundColor: done ? c.goodSoft : c.track }}>
          {done ? <IconCheck size={14} color={c.good} /> : <IconCopy size={14} color={c.ink} />}
          <T size={13} weight="medium" style={{ color: done ? c.good : c.ink }}>{done ? "Copied" : "Copy"}</T>
        </Row>
      </Row>
    </PressableScale>
  );
}

/** A red line under a field that still has a note to David or a fill-in slot. */
function NoteWarning({ text }: { text: string }) {
  const { c } = useTheme();
  const hits = findPlaceholders(text);
  if (!hits.length) return null;
  return <T size={12} style={{ color: c.bad, marginTop: -6, marginBottom: 12 }}>Remove before sending: {hits.map((h) => `"${h.length > 60 ? `${h.slice(0, 57)}…` : h}"`).join(", ")}</T>;
}

const CACHE = (id: number) => `proposal-draft:${id}`;
type Cached = { letter: string; answers: { question: string; answer: string }[]; bid: string; duration: string; savedAt: number };
const AUTOSAVE_MS = 3000;

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
  const [duration, setDuration] = useState("");
  const [loom, setLoom] = useState("");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [restored, setRestored] = useState<Cached | null>(null);
  const saveSeq = useRef(0);
  const cacheChecked = useRef(false);

  const dirty = !!p && (letter !== p.coverLetter || bid !== (p.bid == null ? "" : String(p.bid)) || duration !== (p.estimatedDuration ?? "") || JSON.stringify(answers) !== JSON.stringify(p.answers));
  const bidValid = bid.trim() === "" || Number.isFinite(Number(bid));
  const locked = !!p && (p.status === "submitted" || p.status === "discarded");

  // Load server state into the editor - on first load, and on live updates only when nothing is being edited.
  // (State adjusted during render - React's pattern for deriving state from changed props/data.)
  if (p && p.updatedAt !== loadedAt && !(loadedAt && dirty)) {
    setLetter(p.coverLetter);
    setAnswers(p.answers);
    setBid(p.bid == null ? "" : String(p.bid));
    setDuration(p.estimatedDuration ?? "");
    setLoom(p.loomUrl ?? "");
    setLoadedAt(p.updatedAt);
  }

  /** Save what is on screen. Only the server copy is refreshed, never the text boxes, so typing is never overwritten. */
  async function persist(): Promise<boolean> {
    if (!p || locked || !dirty) return true;
    if (!bidValid) { setSaveState("offline"); return false; }
    const n = ++saveSeq.current;
    setSaveState("saving");
    try {
      const next = await endpoints.editProposal(p.id, { coverLetter: letter.slice(0, COVER_MAX), answers, bid: bid.trim() === "" ? null : Number(bid), estimatedDuration: duration || undefined });
      if (n === saveSeq.current) {
        q.setData(next);
        setLoadedAt(next.updatedAt);
        setSaveState("saved");
        AsyncStorage.removeItem(CACHE(p.id)).catch(() => {});
      }
      return true;
    } catch {
      if (n === saveSeq.current) setSaveState("offline");
      return false;
    }
  }

  // Autosave: keep a copy on the phone at once, save to the server a few seconds after typing stops.
  // (Each server save is one queued job for the home worker, so the pause is longer than the web editor's.)
  useEffect(() => {
    if (!p || locked || !dirty || !loadedAt) return;
    const snap: Cached = { letter, answers, bid, duration, savedAt: Date.now() };
    AsyncStorage.setItem(CACHE(p.id), JSON.stringify(snap)).catch(() => {});
    const t = setTimeout(() => { void persist(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, answers, bid, duration]);

  // Edits made on this phone that never reached the server (app closed, worker offline): offer them back.
  useEffect(() => {
    if (!p || cacheChecked.current || !loadedAt) return;
    cacheChecked.current = true;
    AsyncStorage.getItem(CACHE(p.id)).then((raw) => {
      if (!raw) return;
      const c = JSON.parse(raw) as Cached;
      const same = c.letter === p.coverLetter && c.bid === (p.bid == null ? "" : String(p.bid)) && c.duration === (p.estimatedDuration ?? "") && JSON.stringify(c.answers) === JSON.stringify(p.answers);
      if (same || c.savedAt < Date.parse(p.updatedAt) || locked) { AsyncStorage.removeItem(CACHE(p.id)).catch(() => {}); return; }
      setLetter(c.letter); setAnswers(c.answers); setBid(c.bid); setDuration(c.duration);
      setRestored({ letter: p.coverLetter, answers: p.answers, bid: p.bid == null ? "" : String(p.bid), duration: p.estimatedDuration ?? "", savedAt: 0 });
    }).catch(() => {});
  }, [p, loadedAt, locked]);

  if (!p) {
    return <Screen header={false} padTop={false}>{q.loading ? <T muted>Loading…</T> : <Empty title="Proposal not found">{q.error ?? "It may have been removed."}</Empty>}</Screen>;
  }

  const st = PROPOSAL_STATUS[p.status];
  const idx = stepIndex(p.status);
  const screening = job.data?.enrichment?.screeningQuestions ?? [];
  const connects = job.data?.enrichment?.connectsCost ?? null;
  const upwork = (p.preview?.upwork ?? null) as Record<string, unknown> | null;
  const loomValid = LOOM_RE.test(loom.trim());
  const hourly = job.data?.jobType === "HOURLY";
  const apply = job.data ? applyUrl(job.data) : applyUrl({ url: p.jobUrl });
  const pasteLetter = letterForUpwork(letter);
  const notes = [letter, ...answers.map((a) => a.answer)].some((t) => findPlaceholders(t).length > 0);
  const manual = p.preview?.manual === true;

  /** Copy one field for Upwork. A field that still has a note to David is never copied. */
  async function copy(key: string, text: string) {
    const hits = findPlaceholders(text);
    if (hits.length) {
      haptic.error();
      Alert.alert("Remove the note first", `This still contains ${hits.map((h) => `"${h}"`).join(", ")}. The client would see it.`);
      return;
    }
    await Clipboard.setStringAsync(text);
    haptic.success();
    setCopied((prev) => ({ ...prev, [key]: true }));
    if (dirty) void persist();
  }

  function sentOnUpwork() {
    Alert.alert("Sent on Upwork?", "Mark this proposal as sent. Nothing is sent from the app - this only records that you applied.", [
      { text: "Cancel", style: "cancel" },
      { text: "Mark as sent", onPress: async () => { if (await persist()) run("applied", () => endpoints.markApplied(p!.id), { success: true }); } },
    ]);
  }

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

  const saveIfDirty = persist;

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
        <Banner tone="info">Nothing is sent to Upwork from here unless you submit. Copy each part below and paste it into Upwork yourself.</Banner>
        {error ? <Banner tone="bad" title="That didn't work">{error}</Banner> : null}
        {restored ? (
          <Banner tone="warn" title="Restored edits from this phone" action={<Button small label="Use saved version" onPress={() => {
            setLetter(restored.letter); setAnswers(restored.answers); setBid(restored.bid); setDuration(restored.duration);
            setRestored(null); AsyncStorage.removeItem(CACHE(p.id)).catch(() => {});
          }} />}>These edits hadn&apos;t reached the server. They save again in a moment.</Banner>
        ) : null}

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
        <NoteWarning text={letter} />
        {letter.includes(LOOM_PLACEHOLDER) ? <T size={12} style={{ color: c.warn, marginBottom: 12 }}>No Loom yet: the Loom line is left out when you copy. Attaching a Loom link fills it in.</T> : <View style={{ height: 8 }} />}
        <Row gap={8} wrap style={{ marginBottom: 16, alignItems: "center" }}>
          <Button small label={copied.letter ? "Copied" : "Copy"} icon={(col) => (copied.letter ? <IconCheck size={16} color={col} /> : <IconCopy size={16} color={col} />)} onPress={() => copy("letter", pasteLetter)} />
          {!locked ? (
            <T size={12} faint>
              {saveState === "saving" ? "Saving…" : saveState === "offline" ? (bidValid ? "Not saved yet - kept on this phone, retrying" : "Fix the bid to save") : dirty ? "Edited" : "All changes saved"}
            </T>
          ) : null}
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
              <View key={i}>
                <Field label={a.question} value={a.answer} multiline editable={!locked}
                  onChangeText={(t) => setAnswers((prev) => prev.map((x, j) => (j === i ? { ...x, answer: t } : x)))} />
                <NoteWarning text={a.answer} />
              </View>
            ))}
          </>
        ) : null}

        <SectionTitle right={connects != null ? <Pill label={`${connects} Connects`} tone="info" /> : undefined}>Bid</SectionTitle>
        <Field label={hourly ? "Hourly rate (USD)" : "Amount (USD)"} value={bid} onChangeText={(t) => setBid(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" editable={!locked} placeholder={hourly ? "e.g. 85" : "e.g. 4500"}
          error={bidValid ? null : "Enter a number"} hint={p.bid != null ? `Saved: ${money(p.bid)}` : undefined} />
        {!hourly ? (
          <View style={{ gap: 6, marginBottom: 16 }}>
            <T muted size={13} weight="medium">How long will this project take?</T>
            <Seg scroll value={duration} options={DURATIONS.map((d) => ({ value: d as string, label: d }))} onChange={(v) => { if (!locked) { haptic.select(); setDuration(v); } }} />
          </View>
        ) : null}

        {!locked ? (
          <>
            <SectionTitle right={notes ? <Pill label="Has notes" tone="bad" /> : undefined}>Send on Upwork</SectionTitle>
            <Card style={{ marginBottom: 16, gap: 10 }}>
              <T muted size={13}>Open the apply page, then tap each part to copy it and paste it into the matching box on Upwork.</T>
              <Row gap={8} wrap>
                {apply ? <Button small variant="dark" label="Open apply page" icon={(col) => <IconExternal size={16} color={col} />} onPress={() => openUpwork(apply)} /> : null}
                <Button small label="Open job" icon={(col) => <IconExternal size={16} color={col} />} onPress={() => openUpwork(p.jobUrl)} />
              </Row>
              <View>
                <CopyRow label="Cover letter" preview={`${pasteLetter.length.toLocaleString("en-US")} chars · ${pasteLetter.split("\n")[0]}`} done={!!copied.letter} onPress={() => copy("letter", pasteLetter)} />
                {answers.map((a, i) => (
                  <CopyRow key={i} label={`Answer ${i + 1}`} preview={a.question} done={!!copied[`a${i}`]} onPress={() => copy(`a${i}`, a.answer)} />
                ))}
                {bid.trim() && bidValid ? <CopyRow label={hourly ? "Hourly rate" : "Bid"} preview={hourly ? `$${bid}/hr` : `$${bid}`} done={!!copied.bid} onPress={() => copy("bid", bid.trim())} /> : null}
                {!hourly && duration ? <CopyRow label="Project length" preview={`${duration} - pick it in the list on Upwork`} done={!!copied.duration} onPress={() => copy("duration", duration)} /> : null}
              </View>
              <Button label="I sent it on Upwork" variant="accent" disabled={notes || busy !== null} loading={busy === "applied"} icon={(col) => <IconSend size={16} color={col} />} onPress={sentOnUpwork} />
              {notes ? <T size={12} style={{ color: c.bad }}>Remove the notes marked in red first.</T> : null}
            </Card>
          </>
        ) : null}

        <SectionTitle>Or send from the app · Loom video</SectionTitle>
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

        {p.status === "submitted" ? <Banner tone="good" title={manual ? "Sent on Upwork" : "Submitted"}>{`${manual ? "You sent it on Upwork" : "Sent"}${p.submittedAt ? ` ${timeAgo(p.submittedAt)}` : ""}.`}</Banner> : null}

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
