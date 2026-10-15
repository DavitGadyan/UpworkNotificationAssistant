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
    const telegramMin = int(form.telegramMin, 0, 100), poll = int(form.pollMin, 2, 120), minRank = int(form.autoMinRank, 0, 100), cap = int(form.autoDailyCap, 0, 50);
    const budget = Number(form.budget);
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
            <Field label="Poll every (minutes)" value={form.pollMin} onChangeText={(t) => set("pollMin", t.replace(/\D/g, ""))} keyboardType="number-pad" hint="2–120. Shorter = faster alerts, more marketplace calls" />
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
