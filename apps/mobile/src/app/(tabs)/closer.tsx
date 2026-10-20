import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { FeedbackButtons } from "../../components/job";
import { IconCheck, IconCopy } from "../../components/icons";
import { Banner, Button, Card, Dot, Field, Pill, PressableScale, ProgressBar, Row, Screen, Seg, T } from "../../components/ui";
import { endpoints } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme";
import type { CloserAdvice, CloserRoom } from "../../types";

const STAGE: Record<CloserAdvice["stage"], string> = {
  first_reply: "First reply", discovery: "Discovery", scoping: "Scoping", pricing: "Pricing",
  objection: "Objection", closing: "Closing", stalled: "Stalled", post_hire: "Post-hire",
};

/* Advice cards arrive after a 20-60 s wait the user asked for: rare tier, purpose = explanation of a new
 * state. Short staggered fade-up (250ms, 50ms apart); reduced motion → no entrance. Not a virtualized list. */
function Reveal({ i, children }: { i: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const entering = useMemo(() => (reduced ? undefined : FadeInDown.duration(250).delay(i * 50)), [i, reduced]);
  return <Animated.View entering={entering} style={{ marginBottom: 12 }}>{children}</Animated.View>;
}

const showList = (title: string, items: string[]) => Alert.alert(title, items.map((x) => `• ${x}`).join("\n\n"));

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); }, [done]);
  return (
    <Button small label={done ? "Copied" : "Copy reply"} variant={done ? "good" : "dark"}
      icon={(col) => (done ? <IconCheck size={16} color={col} /> : <IconCopy size={16} color={col} />)}
      onPress={async () => { await Clipboard.setStringAsync(text); haptic.light(); setDone(true); }} />
  );
}

export default function Closer() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ roomId?: string; autorun?: string }>();
  const [source, setSource] = useState<"inbox" | "paste">("inbox");
  const [rooms, setRooms] = useState<CloserRoom[] | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [picked, setRoomId] = useState<string | null>(null);
  const roomId = picked ?? params.roomId ?? null;
  const [thread, setThread] = useState("");
  const [country, setCountry] = useState("");
  const [clientName, setClientName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<CloserAdvice | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledFor = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  // iOS: the scroll view's automatic content inset puts y=0 under the status bar.
  const topInset = Platform.OS === "ios" ? insets.top : 0;


  async function loadInbox() {
    setLoadingInbox(true); setInboxError(null);
    try { const r = await endpoints.closerInbox(); setRooms(r.inbox); setInboxError(r.inboxError); }
    catch (e) { setInboxError((e as Error).message); }
    finally { setLoadingInbox(false); }
  }

  async function ask() {
    setBusy(true); setError(null); setAdvice(null);
    haptic.light();
    try {
      const r = await endpoints.closer({
        roomId: source === "inbox" ? roomId ?? undefined : undefined,
        thread: source === "paste" ? thread : undefined,
        country: country.trim() || undefined, clientName: clientName.trim() || undefined, goal: goal.trim() || undefined,
      });
      setAdvice(r);
      haptic.success();
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (params.autorun !== "1") return;
    const t = setTimeout(() => { loadInbox().then(() => ask()); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.autorun]);

  const canAsk = source === "inbox" ? !!roomId : thread.trim().length > 20;

  return (
    <Screen scrollRef={scrollRef} title="Closer">
      <View style={{ marginBottom: 12 }}>
        <Seg value={source} onChange={(v) => { haptic.select(); setSource(v); }} options={[{ value: "inbox", label: "Inbox" }, { value: "paste", label: "Paste" }]} />
      </View>

      {source === "inbox" ? (
        <Card style={{ marginBottom: 12, gap: 8 }}>
          {!rooms ? <Button label="Load inbox" onPress={loadInbox} loading={loadingInbox} /> : null}
          {inboxError ? <Banner tone="warn" title="Inbox unavailable"><T size={13} numberOfLines={2} style={{ color: c.warn }}>{inboxError}</T></Banner> : null}
          {rooms?.map((r) => {
            const on = r.id === roomId;
            return (
              <PressableScale key={r.id} onPress={() => { haptic.select(); setRoomId(r.id); }} accessibilityLabel={r.name}>
                <View style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.line, backgroundColor: on ? c.sunken : c.surface, gap: 2 }}>
                  <Row gap={6}>
                    {r.awaiting === "freelancer" ? <Dot tone="warn" /> : null}
                    <T weight="semibold" size={14} numberOfLines={1} style={{ flex: 1 }}>{r.name}</T>
                    <T faint size={11}>{r.lastAt ? timeAgo(r.lastAt) : ""}</T>
                    {r.unread ? <Pill label="New" tone="info" /> : null}
                  </Row>
                  <T muted size={12} numberOfLines={1}>{r.lastMessage || "—"}</T>
                </View>
              </PressableScale>
            );
          })}
          {rooms && !rooms.length && !inboxError ? <T muted>No conversations</T> : null}
          {rooms ? <Button small variant="ghost" label="Reload" onPress={loadInbox} loading={loadingInbox} /> : null}
        </Card>
      ) : (
        <Field label="" value={thread} onChangeText={setThread} multiline placeholder={"Client: …\nYou: …"} />
      )}

      <Row gap={10}>
        <Field label="" accessibilityLabel="Country" value={country} onChangeText={setCountry} placeholder="Country (auto)" style={{ flex: 1 }} />
        <Field label="" accessibilityLabel="Client name" value={clientName} onChangeText={setClientName} placeholder="Client name" style={{ flex: 1 }} />
      </Row>
      <Field label="" accessibilityLabel="Your goal for this reply" value={goal} onChangeText={setGoal} placeholder="Goal, e.g. hold $6k, book a call" />

      {busy ? <View style={{ gap: 8, marginBottom: 12 }}><ProgressBar /><T muted size={12}>Drafting… 20–60 s</T></View>
        : <Button label="Get advice" variant="dark" onPress={ask} disabled={!canAsk} />}
      {error ? <View style={{ marginTop: 12 }}><Banner tone="bad" title="No advice"><T size={13} numberOfLines={3} style={{ color: c.bad }}>{error}</T></Banner></View> : null}

      {advice ? (
        // Bring the answer into view once it arrives (it lands below the form).
        <View style={{ marginTop: 20 }} onLayout={(e) => {
          if (scrolledFor.current === advice.createdAt) return;
          scrolledFor.current = advice.createdAt;
          scrollRef.current?.scrollTo({ y: e.nativeEvent.layout.y - 12 - topInset, animated: true });
        }}>
          <Reveal i={0}>
            <Card style={{ gap: 8 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T weight="semibold" size={14} numberOfLines={2} style={{ flex: 1 }}>{advice.recommendedMove}</T>
                <Pill label={STAGE[advice.stage]} tone="info" />
              </Row>
              <PressableScale onPress={() => Alert.alert("Client read", advice.clientRead)} accessibilityLabel="Client read">
                <T muted size={13} numberOfLines={2}>{advice.clientRead}</T>
              </PressableScale>
            </Card>
          </Reveal>
          <Reveal i={1}>
            <Card style={{ gap: 10 }}>
              <Row style={{ justifyContent: "space-between" }}><T weight="displaySemi" size={16}>Reply</T><CopyButton text={advice.reply} /></Row>
              <T selectable>{advice.reply}</T>
            </Card>
          </Reveal>
          <Reveal i={2}>
            <Card style={{ gap: 8 }}>
              <T muted size={12} weight="medium">Next step</T>
              <T size={14}>{advice.nextStep}</T>
              <Row wrap gap={6}>
                {advice.questionsToAsk.length ? <PressableScale onPress={() => showList("Questions to ask", advice.questionsToAsk)} accessibilityLabel="Questions to ask"><Pill label={`? ${advice.questionsToAsk.length} questions`} tone="info" /></PressableScale> : null}
                {advice.alternatives.length ? <PressableScale onPress={() => showList("Alternatives", advice.alternatives)} accessibilityLabel="Alternatives"><Pill label={`${advice.alternatives.length} alternatives`} /></PressableScale> : null}
                {advice.risks.length ? <PressableScale onPress={() => showList("Risks", advice.risks)} accessibilityLabel="Risks"><Pill label={`⚠ ${advice.risks.length} risks`} tone="bad" /></PressableScale> : null}
                {advice.culturalNotes.length ? <PressableScale onPress={() => showList(`Culture · ${advice.country} (hypotheses)`, advice.culturalNotes)} accessibilityLabel="Cultural notes"><Pill label={`Culture · ${advice.country}`} tone="warn" /></PressableScale> : null}
              </Row>
            </Card>
          </Reveal>
          <Reveal i={3}>
            <Card><FeedbackButtons kind="closer" refId={String(advice.reportId ?? advice.createdAt)} label="Helpful advice?" data={{ stage: advice.stage, country: advice.country, roomId: advice.roomId, model: advice.model }} /></Card>
          </Reveal>
        </View>
      ) : null}
    </Screen>
  );
}
