import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import { haptic } from "../lib/haptics";
import { addFeedback, type JobView } from "../lib/data";
import { budgetLabel, compactMoney, intentLabel, intentTone, proposalsLabel, timeAgo } from "../lib/format";
import { toneColors, useTheme, type Tone } from "../theme";
import type { JobStatus, ScoreBreakdown, Settings } from "../types";
import { IconExternal, IconThumbDown, IconThumbUp } from "./icons";
import { Button, Card, Pill, PressableScale, RankPill, Row, T } from "./ui";

type Th = Pick<Settings, "callMin" | "telegramMin">;
export const DEFAULT_TH: Th = { callMin: 85, telegramMin: 65 };

/* Same rules as the web's components/ui/status.ts */
export function scoreTone(score: ScoreBreakdown, s: Th): Tone {
  if (score.excluded) return "bad";
  if (score.total >= s.callMin) return "good";
  if (score.total >= s.telegramMin) return "info";
  return "warn";
}

export const isOffProfile = (score: ScoreBreakdown) => !!score.excluded?.startsWith("Not your field");

/** Match labels need the AI's verdict: a high rules-only rank says "Not AI-checked", never "Top match". */
export function jobPill(status: JobStatus, score: ScoreBreakdown, s: Th): { label: string; tone: Tone } {
  if (status === "pending") return { label: "Checking client…", tone: "neutral" };
  if (status === "awaiting_ai") return { label: "Waiting for AI check", tone: "neutral" };
  if (status === "dismissed") return { label: "Dismissed", tone: "neutral" };
  if (status === "applied") return { label: "Applied", tone: "good" };
  if (status === "drafting") return { label: "Drafting", tone: "info" };
  if (isOffProfile(score)) return { label: "Not your field", tone: "neutral" };
  if (score.excluded) return { label: "Filtered out", tone: "bad" };
  if (status === "called") return { label: "Called", tone: "good" };
  if (!score.llm && score.total >= s.telegramMin) return { label: "Not AI-checked", tone: "warn" };
  if (score.total >= s.callMin) return { label: "Top match", tone: "good" };
  if (status === "notified") return { label: "Notified", tone: "info" };
  if (score.total >= s.telegramMin) return { label: "Match", tone: "info" };
  return { label: "Low fit", tone: "warn" };
}

export function openUpwork(url: string) {
  // The https://www.upwork.com/jobs/~02… universal link opens the marketplace app when it is installed.
  Linking.openURL(url).catch(() => Alert.alert("Could not open the link", url));
}

export function clientSpent(j: JobView) {
  return j.enrichment?.record.totalSpent ?? j.client.totalSpent;
}

export function JobCard({ job, th, onPress, onLongPress }: { job: JobView; th: Th; onPress: () => void; onLongPress?: () => void }) {
  const { c } = useTheme();
  const pill = jobPill(job.status, job.score, th);
  const intent = job.score.intent;
  return (
    <PressableScale onPress={onPress} onLongPress={onLongPress} accessibilityLabel={`${job.title}, rank ${job.score.total}`}>
      <Card style={{ gap: 10, opacity: job.status === "dismissed" ? 0.6 : 1 }}>
        <Row gap={12} style={{ alignItems: "flex-start" }}>
          <RankPill total={job.score.total} tone={scoreTone(job.score, th)} />
          <View style={{ flex: 1, gap: 4 }}>
            <T weight="semibold" size={15} numberOfLines={2}>{job.title}</T>
            <T muted size={13} numberOfLines={1}>{budgetLabel(job)} · {compactMoney(clientSpent(job))} spent · {proposalsLabel(job)}</T>
          </View>
        </Row>
        {intent ? <IntentChips intent={intent} /> : null}
        <Row style={{ justifyContent: "space-between" }}>
          <Row gap={6} style={{ flexShrink: 1 }}>
            <Pill label={pill.label} tone={pill.tone} />
            <T faint size={12} numberOfLines={1} style={{ flexShrink: 1 }}>{timeAgo(job.publishedAt)}{job.feeds?.[0] ? ` · ${job.feeds[0]}` : ""}</T>
          </Row>
          <PressableScale onPress={() => openUpwork(job.url)} accessibilityLabel="Open in Upwork" hitSlop={10}>
            <Row gap={4} style={{ minHeight: 32, paddingHorizontal: 4 }}>
              <T size={13} weight="medium" style={{ color: c.accent }}>Open in Upwork</T>
              <IconExternal size={14} color={c.accent} />
            </Row>
          </PressableScale>
        </Row>
      </Card>
    </PressableScale>
  );
}

/** Advisory hire-chance chip, plus a red "skip" chip with the pattern when the ghost risk is high. */
export function IntentChips({ intent }: { intent: NonNullable<ScoreBreakdown["intent"]> }) {
  const { c } = useTheme();
  return (
    <Row wrap gap={6}>
      <Pill label={`Hire chance ${intent.hireLikelihood}%`} tone={intentTone(intent.ghostRisk)} />
      {intent.ghostRisk === "high" ? (
        <>
          <Pill label="Likely not hiring — skip" tone="bad" />
          <T size={12} weight="medium" numberOfLines={1} style={{ color: c.bad, flexShrink: 1, alignSelf: "center" }}>{intentLabel(intent.archetype)}</T>
        </>
      ) : null}
    </Row>
  );
}

/** 👍/👎 that writes a public.feedback row. One haptic on commit; the filled state is the visual. */
export function FeedbackButtons({ kind, refId, data, label = "Was this useful?" }: { kind: "alert" | "draft" | "closer"; refId: string; data: Record<string, unknown>; label?: string }) {
  const { c } = useTheme();
  const [sent, setSent] = useState<-1 | 1 | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (rating: -1 | 1) => {
    if (busy) return;
    setBusy(true);
    setSent(rating);
    haptic.light();
    try { await addFeedback({ kind, refId, rating, data }); }
    catch (e) { setSent(null); haptic.error(); Alert.alert("Feedback not saved", (e as Error).message); }
    finally { setBusy(false); }
  };
  const btn = (rating: -1 | 1) => {
    const on = sent === rating;
    const t = toneColors(c, rating === 1 ? "good" : "bad");
    const color = on ? t.fg : c.muted;
    return (
      <PressableScale onPress={() => send(rating)} accessibilityLabel={rating === 1 ? "Thumbs up" : "Thumbs down"}>
        <View style={{ width: 48, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? t.bg : c.control }}>
          {rating === 1 ? <IconThumbUp size={20} color={color} /> : <IconThumbDown size={20} color={color} />}
        </View>
      </PressableScale>
    );
  };
  return (
    <Row style={{ justifyContent: "space-between" }}>
      <T muted size={14}>{sent ? "Thanks - this tunes the ranking." : label}</T>
      <Row>{btn(1)}{btn(-1)}</Row>
    </Row>
  );
}

export function OpenButton({ url, label = "Open in Upwork" }: { url: string; label?: string }) {
  return <Button label={label} variant="dark" onPress={() => openUpwork(url)} icon={(col) => <IconExternal size={16} color={col} />} />;
}
