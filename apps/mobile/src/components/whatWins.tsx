import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import { endpoints } from "../lib/api";
import { fetchLatestReport, fetchLessonsDecisions, fetchProposalOutcomes, useQuery } from "../lib/data";
import { fmtDate } from "../lib/format";
import { haptic } from "../lib/haptics";
import type { Tone } from "../theme";
import type { LessonsReport, OutcomeLabel } from "../types";
import { Button, Card, Divider, PressableScale, Pill, Row, SectionTitle, Stat, T } from "./ui";

/** Same labels as the web (lib/learning/labels.ts). Both kinds of no-reply count against. */
export const OUTCOME: Record<OutcomeLabel, { label: string; tone: Tone }> = {
  win: { label: "Client replied", tone: "good" },
  loss_viewed: { label: "Viewed, no reply", tone: "bad" },
  loss_unviewed: { label: "Not viewed", tone: "warn" },
  pending: { label: "Waiting", tone: "neutral" },
  void: { label: "No signal", tone: "neutral" },
};

/** Insights → What wins: which proposals got a client reply, and lessons waiting for David's approval. */
export function WhatWins() {
  const rows = useQuery("outcomes", () => fetchProposalOutcomes(60));
  const [busy, setBusy] = useState<string | null>(null);
  const list = (rows.data ?? []).filter((o) => o.outcome !== "void");
  const count = (k: OutcomeLabel) => list.filter((o) => o.outcome === k).length;
  const decidedN = count("win") + count("loss_viewed") + count("loss_unviewed");

  const run = async (action: "outcomes", body: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      await endpoints.insights(action, body);
      haptic.success();
      rows.reload();
    } catch (e) { haptic.error(); Alert.alert("Didn't run", (e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <>
      <SectionTitle right={<Button small label="Check replies" loading={busy === "outcomes"} onPress={() => run("outcomes")} />}>What wins</SectionTitle>
      <Card style={{ marginBottom: 16, gap: 12 }}>
        <Row gap={8}>
          <View style={{ flex: 1 }}><Stat label="Replied" value={count("win")} tone="good" /></View>
          <View style={{ flex: 1 }}><Stat label="Viewed, no reply" value={count("loss_viewed")} tone="bad" /></View>
          <View style={{ flex: 1 }}><Stat label="Not viewed" value={count("loss_unviewed")} tone="warn" /></View>
        </Row>
        <T faint size={12}>{decidedN ? `Reply rate ${Math.round((count("win") / decidedN) * 100)}% of ${decidedN} decided · ${count("pending")} waiting (under 7 days)` : rows.loading ? "Loading…" : "No proposals read yet - tap Check replies."}</T>
        {list.slice(0, 12).map((o) => (
          <PressableScale key={o.upwork_proposal_id} onPress={() => Linking.openURL(`https://www.upwork.com/jobs/~02${o.job_id}`)} accessibilityLabel={`Open ${o.job_title}`}>
            <View style={{ gap: 4, paddingVertical: 6 }}>
              <Row gap={6} wrap><Pill label={OUTCOME[o.outcome].label} tone={OUTCOME[o.outcome].tone} /><T faint size={12}>{fmtDate(o.submitted_at)}{o.insights?.proposalsTotal != null ? ` · ${o.insights.proposalsTotal} applicants` : ""}</T></Row>
              <T weight="medium" numberOfLines={2}>{o.job_title}</T>
              {o.first_reply ? <T muted size={13} numberOfLines={2}>“{o.first_reply}”</T> : null}
            </View>
          </PressableScale>
        ))}
        <Divider />
        <Lessons target="writer" />
        <Divider />
        <Lessons target="ranker" />
      </Card>
    </>
  );
}

/** One lessons report (writer or ranker); each only ever changes its own prompt, after approval. */
function Lessons({ target }: { target: "writer" | "ranker" }) {
  const rep = useQuery(`r-${target}-lessons`, () => fetchLatestReport<LessonsReport>(target === "writer" ? "lessons" : "ranker_lessons"));
  const decisions = useQuery("lessons-decisions", fetchLessonsDecisions);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const report = rep.data;
  const decided = report ? (decisions.data ?? []).find((d) => d.reportId === report.id) ?? null : null;
  const lessons = report?.data.ok ? report.data.lessons : [];
  const sel = picked ?? new Set(lessons.filter((l) => l.confidence !== "low").map((l) => l.id));
  const run = async (action: "lessons" | "approve-lessons" | "reject-lessons", body: Record<string, unknown> = {}) => {
    setBusy(action);
    try { await endpoints.insights(action, body); haptic.success(); rep.reload(); decisions.reload(); }
    catch (e) { haptic.error(); Alert.alert("Didn't run", (e as Error).message); }
    finally { setBusy(null); }
  };
  return (
    <View style={{ gap: 12 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <T weight="semibold">{target === "writer" ? "Writer lessons" : "Ranker lessons"}</T>
          <Button small label="Find lessons" loading={busy === "lessons"} onPress={() => Alert.alert("Find lessons", target === "writer" ? "Compares replied vs no-reply proposals and your edits to the AI drafts (one AI call, about $0.30)." : "Compares viewed vs never-viewed proposals by the rank each job had (one AI call, about $0.30).", [{ text: "Cancel", style: "cancel" }, { text: "Run", onPress: () => run("lessons", { target }) }])} />
        </Row>
        {!report ? <T muted size={14}>No report yet - it runs weekly.</T> : !report.data.ok ? <T muted size={14}>{report.data.message}</T> : (
          <View style={{ gap: 10 }}>
            {report.data.headline ? <T weight="semibold">{report.data.headline}</T> : null}
            {report.data.convinces ? <T muted size={14}>{target === "writer" ? "What convinced: " : "Where the ranking is off: "}{report.data.convinces}</T> : null}
            {report.data.earnsClick ? <T muted size={14}>{target === "writer" ? "What you correct: " : "What earned the click: "}{report.data.earnsClick}</T> : null}
            {lessons.map((l) => {
              const on = decided ? decided.ids.includes(l.id) : sel.has(l.id);
              return (
                <PressableScale key={l.id} disabled={!!decided} accessibilityLabel={l.lesson}
                  onPress={() => { haptic.select(); const n = new Set(sel); if (on) n.delete(l.id); else n.add(l.id); setPicked(n); }}>
                  <View style={{ gap: 4, opacity: on ? 1 : 0.55 }}>
                    <Row gap={6} wrap><Pill label={on ? "✓ selected" : "not selected"} tone={on ? "good" : "neutral"} /><Pill label={`${l.target === "writer" ? "Writer" : "Ranker"} · ${l.confidence}`} /></Row>
                    <T>{l.lesson}</T>
                    <T faint size={12}>{l.evidence}</T>
                  </View>
                </PressableScale>
              );
            })}
            {decided ? <T faint size={12}>{decided.status === "approved" ? `Approved ${decided.ids.length} on ${fmtDate(decided.at)} - now in the prompts.` : `Rejected on ${fmtDate(decided.at)}.`}</T> : (
              <Row gap={8}>
                <Button small label={`Approve ${sel.size}`} disabled={!sel.size} loading={busy === "approve-lessons"}
                  onPress={() => Alert.alert("Approve lessons", `Add ${sel.size} lesson${sel.size === 1 ? "" : "s"} to the ${target} prompt? Roll back any time in Settings → Prompts on the web.`, [{ text: "Cancel", style: "cancel" }, { text: "Approve", onPress: () => run("approve-lessons", { reportId: report.id, ids: [...sel] }) }])} />
                <Button small label="Reject" loading={busy === "reject-lessons"} onPress={() => run("reject-lessons", { reportId: report.id })} />
              </Row>
            )}
          </View>
        )}
    </View>
  );
}
