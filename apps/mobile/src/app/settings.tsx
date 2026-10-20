import { useState } from "react";
import { Switch, View } from "react-native";
import { NoAccessBanner } from "../components/access";
import { Banner, Button, Card, Divider, Field, KV, Row, Screen, SectionTitle, Seg, T } from "../components/ui";
import { saveSettings } from "../lib/data";
import { haptic } from "../lib/haptics";
import { registerForPush } from "../lib/push";
import { useSettings } from "../lib/settings";
import { setThemePref, useThemePref, type ThemePref } from "../lib/themePref";
import { useTheme } from "../theme";

type Form = {
  alertsPaused: boolean;
  telegramMin: string;
  pollMin: string;
  poller: "chat" | "worker";
  source: "mcp" | "graphql";
  aaOn: boolean;
  aaStart: string;
  aaEnd: string;
  aaMax: string;
  peakOn: boolean;
  peakStart: string;
  peakEnd: string;
  peakTz: string;
  peakMin: string;
  offPeakMin: string;
  recoverMin: string;
  opensPerDay: string;
  autoEnabled: boolean;
  autoMinRank: string;
  autoDailyCap: string;
  budget: string;
  alsoMine: string;
  never: string;
};

function SwitchRow({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  const { c } = useTheme();
  return (
    <Row style={{ justifyContent: "space-between", minHeight: 52 }}>
      <View style={{ flex: 1, paddingRight: 12 }}><T weight="medium">{label}</T>{sub ? <T faint size={12}>{sub}</T> : null}</View>
      <Switch value={value} onValueChange={(v) => { haptic.select(); onChange(v); }} trackColor={{ true: c.accent }} accessibilityLabel={label} />
    </Row>
  );
}

/** Comma/newline-separated phrases → a clean list (same limits as the web's validator). */
const phrases = (s: string) => [...new Set(s.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length > 1 && x.length <= 60))].slice(0, 100);
const int = (s: string, min: number, max: number) => { const n = Math.round(Number(s)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const TZ_OPTIONS: { value: string; label: string }[] = [
  { value: "Asia/Yerevan", label: "Yerevan" },
  { value: "America/New_York", label: "New York" },
  { value: "America/Los_Angeles", label: "Los Angeles" },
  { value: "UTC", label: "UTC" },
];

const SOURCE_OPTIONS: { value: "mcp" | "graphql"; label: string }[] = [
  { value: "graphql", label: "Official API" },
  { value: "mcp", label: "MCP connector" },
];

const POLLER_OPTIONS: { value: "chat" | "worker"; label: string }[] = [
  { value: "chat", label: "Claude session" },
  { value: "worker", label: "Worker" },
];

export default function SettingsScreen() {
  const s = useSettings();
  const themePref = useThemePref();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [push, setPush] = useState<string | null>(null);

  // Seed the form once the row arrives (state adjusted during render, no effect needed).
  const d = s.settings;
  if (d && !form) {
    setForm({
      alertsPaused: !!d.alertsPaused,
      telegramMin: String(d.telegramMin ?? 65),
      pollMin: String(Math.round((d.pollIntervalSec ?? 300) / 60)),
      poller: d.upwork?.poller ?? "chat",
      source: d.source === "graphql" ? "graphql" : "mcp",
      aaOn: !!d.autoApply?.enabled,
      aaStart: d.autoApply?.start ?? "00:00",
      aaEnd: d.autoApply?.end ?? "11:00",
      aaMax: String(d.autoApply?.maxPerNight ?? 6),
      peakOn: d.upwork?.peak?.enabled ?? true,
      peakStart: d.upwork?.peak?.start ?? "18:00",
      peakEnd: d.upwork?.peak?.end ?? "01:00",
      peakTz: d.upwork?.peak?.timezone ?? "Asia/Yerevan",
      peakMin: String(d.upwork?.peak?.peakEveryMin ?? 4),
      offPeakMin: String(d.upwork?.peak?.offPeakEveryMin ?? 7),
      recoverMin: String(d.upwork?.recoverAfterMin ?? 30),
      opensPerDay: String(d.upwork?.jobOpensPerDay ?? 500),
      autoEnabled: !!d.autoDraft?.enabled,
      autoMinRank: String(d.autoDraft?.minRank ?? 85),
      autoDailyCap: String(d.autoDraft?.dailyCap ?? 3),
      budget: String(d.llm?.dailyBudgetUsd ?? 5),
      alsoMine: (d.profileFit?.alsoMine ?? []).join(", "),
      never: (d.profileFit?.never ?? []).join(", "),
    });
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!form) return;
    const telegramMin = int(form.telegramMin, 0, 100), poll = int(form.pollMin, 5, 60), minRank = int(form.autoMinRank, 0, 100), cap = int(form.autoDailyCap, 0, 50);
    const budget = Number(form.budget);
    const peakMin = int(form.peakMin, 4, 30), offPeakMin = int(form.offPeakMin, 4, 60), recoverMin = int(form.recoverMin, 10, 240), opensPerDay = int(form.opensPerDay, 60, 600);
    const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
    const aaMax = int(form.aaMax, 0, 20);
    if (aaMax == null || !hm.test(form.aaStart) || !hm.test(form.aaEnd)) {
      haptic.error(); setMsg({ tone: "bad", text: "Auto-apply: times must be HH:MM and max per night 0–20." }); return;
    }
    if (peakMin == null || offPeakMin == null || recoverMin == null || opensPerDay == null || !hm.test(form.peakStart) || !hm.test(form.peakEnd)) {
      haptic.error(); setMsg({ tone: "bad", text: "Peak: times must be HH:MM, peak 4–30 min, off-peak 4–60 min, back to normal 10–240 min, job opens 60–600." }); return;
    }
    if (telegramMin == null || poll == null || minRank == null || cap == null || !Number.isFinite(budget) || budget < 0) {
      haptic.error(); setMsg({ tone: "bad", text: "Check the numbers - one of them isn't valid." }); return;
    }
    setSaving(true); setMsg(null);
    try {
      // Only these keys change; saveSettings re-reads the row and deep-merges, so nothing else is touched.
      await saveSettings({
        alertsPaused: form.alertsPaused,
        telegramMin,
        pollIntervalSec: poll * 60,
        autoApply: { enabled: form.aaOn, start: form.aaStart, end: form.aaEnd, maxPerNight: aaMax },
        source: form.source,
        upwork: { poller: form.poller, peak: { enabled: form.peakOn, start: form.peakStart, end: form.peakEnd, timezone: form.peakTz, peakEveryMin: peakMin, offPeakEveryMin: offPeakMin }, recoverAfterMin: recoverMin, jobOpensPerDay: opensPerDay },
        autoDraft: { enabled: form.autoEnabled, minRank, dailyCap: cap },
        llm: { dailyBudgetUsd: Math.round(budget * 100) / 100 },
        profileFit: { alsoMine: phrases(form.alsoMine), never: phrases(form.never) },
      });
      haptic.success();
      setMsg({ tone: "good", text: "Saved. The worker picks this up on its next cycle." });
      s.reload();
    } catch (e) {
      haptic.error();
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen header={false} padTop={false} onRefresh={() => { setForm(null); s.refresh(); }} refreshing={s.refreshing}>
      <NoAccessBanner show={s.noAccess} />
      {s.error ? <Banner tone="bad" title="Could not load settings">{s.error}</Banner> : null}

      <SectionTitle>Appearance</SectionTitle>
      <Card style={{ marginBottom: 16, gap: 10 }}>
        <Seg value={themePref} options={THEME_OPTIONS} onChange={(v) => { haptic.select(); setThemePref(v); }} />
        <T faint size={12}>System follows this device&apos;s light or dark setting. Saved on this device.</T>
      </Card>
      {form ? (
        <>
          <SectionTitle>Alerts</SectionTitle>
          <Card style={{ marginBottom: 16 }}>
            <SwitchRow label="Pause all alerts" sub="No pushes, messages or calls until resumed" value={form.alertsPaused} onChange={(v) => set("alertsPaused", v)} />
            <Divider />
            <Field label="Alert at rank ≥" value={form.telegramMin} onChangeText={(t) => set("telegramMin", t.replace(/\D/g, ""))} keyboardType="number-pad" hint="Jobs ranked at or above this send an alert (0–100)" style={{ marginTop: 8 }} />
            <Field label="Poll every (minutes)" value={form.pollMin} onChangeText={(t) => set("pollMin", t.replace(/\D/g, ""))} keyboardType="number-pad" hint="5–60, worker only. Upwork restricted search twice for too many calls" />
          </Card>

          <SectionTitle>Upwork connection</SectionTitle>
          <Card style={{ marginBottom: 16, gap: 10 }}>
            <Seg value={form.source} options={SOURCE_OPTIONS} onChange={(v) => { haptic.select(); set("source", v); }} />
            <T faint size={12}>Official API: searches and client details through your API key and the gateway (no Best Matches). MCP: everything through the Upwork connector. Proposals are submitted through MCP either way.</T>
          </Card>

          <SectionTitle>Who searches Upwork</SectionTitle>
          <Card style={{ marginBottom: 16, gap: 10 }}>
            <Seg value={form.poller} options={POLLER_OPTIONS} onChange={(v) => { haptic.select(); set("poller", v); }} />
            <T faint size={12}>Only one searcher at a time - the other is refused by the pacing governor, so calls never double up.</T>
          </Card>

          <SectionTitle>Auto-apply at night</SectionTitle>
          <Card style={{ marginBottom: 16 }}>
            <SwitchRow label="Submit proposals while I sleep" sub="No Loom video · spends Connects · limits on the web Settings page" value={form.aaOn} onChange={(v) => set("aaOn", v)} />
            <Divider />
            <Row gap={10} style={{ marginTop: 8 }}>
              <Field label="Night starts" value={form.aaStart} onChangeText={(t) => set("aaStart", t)} placeholder="00:00" style={{ flex: 1 }} />
              <Field label="Night ends" value={form.aaEnd} onChangeText={(t) => set("aaEnd", t)} placeholder="11:00" style={{ flex: 1 }} />
              <Field label="Max / night" value={form.aaMax} onChangeText={(t) => set("aaMax", t.replace(/\D/g, ""))} keyboardType="number-pad" style={{ flex: 1 }} />
            </Row>
          </Card>

          <SectionTitle>Evening peak</SectionTitle>
          <Card style={{ marginBottom: 16 }}>
            <SwitchRow label="Search faster in the peak" sub="High-value US clients post from about 18:00 Armenian time" value={form.peakOn} onChange={(v) => set("peakOn", v)} />
            <Divider />
            <Row gap={10} style={{ marginTop: 8 }}>
              <Field label="Peak starts" value={form.peakStart} onChangeText={(t) => set("peakStart", t)} placeholder="18:00" style={{ flex: 1 }} />
              <Field label="Peak ends" value={form.peakEnd} onChangeText={(t) => set("peakEnd", t)} placeholder="01:00" style={{ flex: 1 }} />
            </Row>
            <Seg value={form.peakTz} options={TZ_OPTIONS.some((o) => o.value === form.peakTz) ? TZ_OPTIONS : [{ value: form.peakTz, label: form.peakTz }, ...TZ_OPTIONS]} onChange={(v) => { haptic.select(); set("peakTz", v); }} />
            <Row gap={10} style={{ marginTop: 8 }}>
              <Field label="Peak: every (min)" value={form.peakMin} onChangeText={(t) => set("peakMin", t.replace(/\D/g, ""))} keyboardType="number-pad" hint="4–30" style={{ flex: 1 }} />
              <Field label="Off-peak: every (min)" value={form.offPeakMin} onChangeText={(t) => set("offPeakMin", t.replace(/\D/g, ""))} keyboardType="number-pad" hint="4–60" style={{ flex: 1 }} />
            </Row>
            <Field label="Back to normal after a warning (min)" value={form.recoverMin} onChangeText={(t) => set("recoverMin", t.replace(/\D/g, ""))} keyboardType="number-pad"
              hint="10–240. After Upwork slows us down, the watcher re-checks this long after the last warning and returns to the times above." />
            <Field label="Job opens per day" value={form.opensPerDay} onChangeText={(t) => set("opensPerDay", t.replace(/\D/g, ""))} keyboardType="number-pad"
              hint="60–600, default 500, resets 04:00. Opening a job shows the client's history. Clean days peaked near 380; Upwork started throttling near 750." />
          </Card>

          <SectionTitle>Auto-draft</SectionTitle>
          <Card style={{ marginBottom: 16 }}>
            <SwitchRow label="Draft proposals automatically" sub="Never submitted - drafts wait for your Loom and approval" value={form.autoEnabled} onChange={(v) => set("autoEnabled", v)} />
            <Divider />
            <Row gap={10} style={{ marginTop: 8 }}>
              <Field label="Min rank" value={form.autoMinRank} onChangeText={(t) => set("autoMinRank", t.replace(/\D/g, ""))} keyboardType="number-pad" style={{ flex: 1 }} />
              <Field label="Daily cap" value={form.autoDailyCap} onChangeText={(t) => set("autoDailyCap", t.replace(/\D/g, ""))} keyboardType="number-pad" style={{ flex: 1 }} />
            </Row>
          </Card>

          <SectionTitle>AI budget</SectionTitle>
          <Card style={{ marginBottom: 16 }}>
            <Field label="Daily budget (USD)" value={form.budget} onChangeText={(t) => set("budget", t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" hint="Ranking and auto-drafts stop for the day at this amount; new jobs then wait for the AI check - nothing alerts on rules alone" />
          </Card>

          <SectionTitle>Your fields</SectionTitle>
          <Card style={{ marginBottom: 16 }}>
            <T muted size={13} style={{ marginBottom: 10 }}>Jobs outside your fields are marked “Not your field”: no AI check, no alert, no draft. Built in: AI agents, ML/CV, data, trading, voice agents &amp; automation, AI marketing &amp; ads, AI video, web &amp; app dev, blockchain, cloud - plus your Upwork profile skills.</T>
            <Field label="Also my work" value={form.alsoMine} onChangeText={(t) => set("alsoMine", t)} placeholder="e.g. Shopify app, Chrome extension" autoCapitalize="none" multiline hint="Comma-separated skills or title words" />
            <Field label="Never my work" value={form.never} onChangeText={(t) => set("never", t)} placeholder="e.g. WordPress theme, Salesforce admin" autoCapitalize="none" multiline hint="Comma-separated skills or title words" />
          </Card>

          {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
          <Button label="Save settings" variant="dark" onPress={save} loading={saving} />
        </>
      ) : !s.noAccess ? <T muted>{s.loading ? "Loading…" : "No settings found."}</T> : null}

      <SectionTitle>This device</SectionTitle>
      <Card style={{ marginTop: 4, gap: 8 }}>
        <KV label="Backend" value="Supabase + home worker" />
        <KV label="Push" value={push ?? "Registers on sign-in"} />
        <Button small label="Register for push notifications" onPress={async () => {
          const r = await registerForPush();
          setPush(r.ok ? "Registered" : r.reason);
          if (r.ok) haptic.success(); else haptic.error();
        }} />
      </Card>
    </Screen>
  );
}
