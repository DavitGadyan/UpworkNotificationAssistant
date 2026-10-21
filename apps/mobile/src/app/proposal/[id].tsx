import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { FeedbackButtons, openUpwork } from "../../components/job";
import { IconCheck, IconChevronRight, IconCopy, IconExternal, IconLink, IconRefresh, IconSend } from "../../components/icons";
import { Banner, Bullets, Button, Card, Empty, Field, KV, Pill, PressableScale, Row, Screen, Seg, T } from "../../components/ui";
import { endpoints } from "../../lib/api";
import { applyUrl, DURATIONS, findPlaceholders, letterForUpwork } from "../../lib/clean";
import { fetchJob, fetchProposal, useQuery } from "../../lib/data";
import { CONTACT_ROLE_LABELS, COVER_MAX, LOOM_PLACEHOLDER, LOOM_RE, money, timeAgo } from "../../lib/format";
import { haptic } from "../../lib/haptics";
import { addProjectLink, hasProjectLink, removeProjectLink, type SiteProject } from "../../lib/portfolio";
import { nextStep, PROPOSAL_STATUS, STEPS, stepIndex } from "../../lib/status";
import { font, motion, radius, useTheme } from "../../theme";
import type { Proposal } from "../../types";

/*
 * Proposal editor (reworked 2026-10-20 - "all cluttered"): one card per job, in reading order.
 *   1. Next step   - the single action for this state (approve → preview → submit), Loom as an optional row.
 *   2. Letter      - rendered like the client will read it; "Edit" switches to the text box.
 *   3. Answers     - same read/edit switch.
 *   4. Terms       - bid and project length.
 *   5. Folded away - research, the copy-and-paste route, the Upwork preview.
 * A Loom video is optional: approving without one removes the "Loom:" line on the server (lib/proposals/submit.ts).
 */

/* Stepper. State indication: colour-only transition (200ms ease-out) when a step completes. */
function Stepper({ idx }: { idx: number }) {
  const { c } = useTheme();
  return (
    <Row gap={0} style={{ alignItems: "flex-start", marginBottom: 14 }}>
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

/** Upwork's boost block, as the server stores it with the preview (lib/proposals/submit.ts boostInfo). */
type BoostInfo = { available: boolean; reason: string | null; skip: boolean; recommended: number | null; max: number | null; topBids: number[] | null; note: string | null };

/**
 * Optional Connects boost for a top slot on the client's list. Shows Upwork's minimum, maximum and the competing bids;
 * setting or removing a boost rebuilds the Upwork preview, so the SUBMIT tap confirms exactly what is shown.
 */
function BoostCard({ p, busy, onSet }: { p: Proposal; busy: boolean; onSet: (connects: number | null) => void }) {
  const b = (p.preview?.boost ?? null) as BoostInfo | null;
  const current = (p.preview?.boostConnects as number | null | undefined) ?? null;
  const [amount, setAmount] = useState(current != null ? String(current) : b?.recommended != null ? String(b.recommended) : "");
  const n = Number(amount);
  const min = Math.max(1, b?.recommended ?? 1);
  const valid = amount.trim() !== "" && Number.isInteger(n) && n >= min && (b?.max == null || n <= b.max);
  return (
    <Card style={{ marginBottom: 12, gap: 10 }}>
      <CardHead title="Boost" right={current != null ? <Pill label={`${current} Connects`} tone="info" /> : <T faint size={12}>optional</T>} />
      {!b ? <T muted size={13}>{"Upwork's preview has no boost details for this job."}</T>
        : !b.available ? <T muted size={13}>{`Boosting isn't available on this job${b.reason ? `: ${b.reason}` : ""}.`}</T>
        : (
          <>
            {b.skip ? <T size={13} style={{ fontWeight: "600" }}>Upwork advises against boosting this one.</T> : null}
            <T muted size={13}>
              {`${b.topBids == null ? "Current bids unknown." : b.topBids.length ? `Current top bids: ${b.topBids.join(", ")} Connects.` : "No one has boosted yet."}${b.recommended != null ? ` Minimum for a top slot: ${b.recommended}.` : ""}${b.max != null ? ` Most you can bid: ${b.max}.` : ""}`}
            </T>
            {b.note ? <T faint size={12}>{b.note}</T> : null}
            <Field label="Connects to bid" value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad"
              error={amount.trim() && !valid ? `Between ${min} and ${b.max ?? "your balance"}` : null} style={{ marginBottom: 0 }} />
            <Row gap={8}>
              <Button small variant="dark" label={current != null ? "Change boost" : "Boost"} disabled={busy || !valid || n === current} loading={busy} onPress={() => onSet(n)} />
              {current != null ? <Button small variant="ghost" label="Remove" disabled={busy} onPress={() => onSet(null)} /> : null}
            </Row>
            <T faint size={12}>Rebuilds the Upwork preview. Upwork charges it only if you land in a paid slot. Nothing is sent until you submit.</T>
          </>
        )}
    </Card>
  );
}

/** Card header: title on the left, an action on the right. */
function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <Row style={{ justifyContent: "space-between", minHeight: 28 }}>
      <T weight="displaySemi" size={17}>{title}</T>
      {right}
    </Row>
  );
}

/** Small text button for card headers ("Edit", "Done", "Show"). */
function TextButton({ label, onPress, icon }: { label: string; onPress: () => void; icon?: (color: string) => ReactNode }) {
  const { c } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label}>
      <Row gap={6} style={{ minHeight: 32, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: c.control }}>
        {icon?.(c.ink)}
        <T size={13} weight="medium">{label}</T>
      </Row>
    </PressableScale>
  );
}

/** A card that folds away - the parts David reads once, not every time. */
function Fold({ title, summary, children, open: initial = false }: { title: string; summary?: string; children: ReactNode; open?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(initial);
  return (
    <Card padded={false} style={{ marginBottom: 12 }}>
      <Pressable onPress={() => { haptic.select(); setOpen((v) => !v); }} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title}>
        <Row gap={10} style={{ padding: 16, minHeight: 56 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="semibold" size={15}>{title}</T>
            {summary && !open ? <T muted size={13} numberOfLines={1}>{summary}</T> : null}
          </View>
          <Animated.View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }], transitionProperty: "transform", transitionDuration: motion.state, transitionTimingFunction: motion.easeOutCss }}>
            <IconChevronRight size={18} color={c.muted} cut={c.surface} />
          </Animated.View>
        </Row>
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>{children}</View> : null}
    </Card>
  );
}

/** The letter the way the client reads it: headings, bullets, the Loom line marked when it is still a placeholder. */
function LetterView({ text, loom }: { text: string; loom: string | null }) {
  const { c } = useTheme();
  const lines = text.replace(/\r/g, "").split("\n");
  return (
    <View style={{ gap: 2 }} accessibilityLabel="Cover letter">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 10 }} />;
        if (line.includes(LOOM_PLACEHOLDER)) {
          return (
            <Row key={i} gap={6} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: c.warnSoft, alignSelf: "flex-start" }}>
              <IconLink size={13} color={c.warn} />
              <T size={13} weight="medium" style={{ color: c.warn }}>Loom not attached - this line is left out</T>
            </Row>
          );
        }
        const head = line.match(/^(DELIVERABLES|BUDGET|Similar work)\s*:\s*(.*)$/i);
        if (head) {
          return (
            <View key={i} style={{ marginTop: 4, gap: 2 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, letterSpacing: 0.6, color: c.muted, textTransform: "uppercase" }}>{head[1]}</Text>
              {head[2] ? <T size={15} selectable>{head[2]}</T> : null}
            </View>
          );
        }
        const bullet = line.match(/^\s*[•\-*]\s+(.*)$/);
        if (bullet) {
          return (
            <Row key={i} gap={10} style={{ alignItems: "flex-start" }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink, marginTop: 8 }} />
              <T size={15} style={{ flex: 1 }} selectable>{bullet[1]}</T>
            </Row>
          );
        }
        if (loom && line.includes(loom)) {
          return <T key={i} size={15} selectable style={{ color: c.accent }}>{line}</T>;
        }
        return <T key={i} size={15} selectable>{line}</T>;
      })}
    </View>
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

function PreviewRows({ data }: { data: Record<string, unknown> }) {
  const flat = flatten(data);
  const find = (key: string) => Object.keys(flat).find((k) => k === key || k.endsWith(`.${key}`));
  const hl = HIGHLIGHT.map(([k, label]) => [find(k), label] as const).filter(([k]) => k);
  const rest = Object.keys(flat).filter((k) => !hl.some(([h]) => h === k) && !/id$/i.test(k) && flat[k] != null && String(flat[k]).length < 80).slice(0, 8);
  return (
    <View>
      {hl.map(([k, label]) => <KV key={k} label={label} value={show(flat[k!])} />)}
      {rest.map((k) => <KV key={k} label={k.replace(/[._]/g, " ")} value={show(flat[k])} />)}
    </View>
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
  return <T size={12} style={{ color: c.bad }}>Remove before sending: {hits.map((h) => `"${h.length > 60 ? `${h.slice(0, 57)}…` : h}"`).join(", ")}</T>;
}

/** A tick box row (44pt+ tall) for one Upwork portfolio item. */
function CheckRow({ label, checked, onPress, disabled, tone }: { label: string; checked: boolean; onPress: () => void; disabled?: boolean; tone?: "warn" }) {
  const { c } = useTheme();
  return (
    <PressableScale onPress={onPress} disabled={disabled} accessibilityLabel={label}>
      <Row gap={12} style={{ minHeight: 48, paddingVertical: 6 }}>
        <View accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} style={{
          width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center",
          borderWidth: 2, borderColor: checked ? c.ink : c.line, backgroundColor: checked ? c.ink : c.surface,
        }}>
          {checked ? <IconCheck size={13} color={c.surface} /> : null}
        </View>
        <T size={14} style={{ flex: 1, color: tone === "warn" ? c.warn : c.ink }}>{label}</T>
      </Row>
    </PressableScale>
  );
}

/**
 * Portfolio for this proposal. Upwork portfolio items are real attachments (saved with the draft, sent with the
 * Upwork preview). Portfolio-site projects can't be attached by Upwork, so "Add" puts a "Similar work:" line with
 * the link into the letter - visible in the letter above, and saved like any other edit.
 */
function PortfolioCard({ jobId, ids, setIds, letter, setLetter, locked }: {
  jobId: string; ids: string[]; setIds: (v: string[]) => void; letter: string; setLetter: (v: string) => void; locked: boolean;
}) {
  const { c } = useTheme();
  const pq = useQuery(`portfolio:${jobId}`, () => endpoints.portfolio(jobId));
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const data = pq.data;
  const items = data?.upwork.items ?? [];
  const unknown = ids.filter((id) => !items.some((i) => i.id === id));
  const projects = data?.site.projects ?? [];
  const relevant = (data?.site.relevant ?? []).map((id) => projects.find((p) => p.id === id)).filter((p): p is SiteProject => !!p);
  const f = filter.trim().toLowerCase();
  const others = projects.filter((p) => !relevant.includes(p) && (!f || `${p.title} ${p.summary}`.toLowerCase().includes(f)));
  const inLetter = projects.filter((p) => hasProjectLink(letter, p.url)).length;
  const toggle = (id: string) => { haptic.select(); setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]); };

  async function refresh() {
    setRefreshing(true); setRefreshError(null);
    try { pq.setData(await endpoints.portfolio(jobId, true)); haptic.light(); } catch (e) { haptic.error(); setRefreshError((e as Error).message); } finally { setRefreshing(false); }
  }

  const projectRow = (pr: SiteProject, best: boolean) => {
    const added = hasProjectLink(letter, pr.url);
    return (
      <View key={pr.id} style={{ gap: 6, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line }}>
        <Row gap={6} wrap>
          <T weight="medium" size={14} style={{ flexShrink: 1 }}>{pr.title}</T>
          {best ? <Pill label="Matches this job" tone="info" /> : null}
        </Row>
        <T muted size={12} numberOfLines={2}>{pr.summary}</T>
        <Row gap={6}>
          <TextButton label="Open" icon={(col) => <IconExternal size={14} color={col} />} onPress={() => openUpwork(pr.url)} />
          {!locked ? (
            <TextButton label={added ? "In letter · remove" : "Add to letter"} icon={added ? (col) => <IconCheck size={14} color={col} /> : (col) => <IconLink size={14} color={col} />}
              onPress={() => { haptic.select(); setLetter(added ? removeProjectLink(letter, pr.url) : addProjectLink(letter, pr)); }} />
          ) : null}
        </Row>
      </View>
    );
  };

  return (
    <Card style={{ marginBottom: 12, gap: 10 }}>
      <CardHead title="Portfolio" right={data?.upwork.canRefresh ? (
        <TextButton label={refreshing ? "Refreshing…" : "Refresh"} icon={(col) => <IconRefresh size={14} color={col} />} onPress={() => { if (!refreshing) void refresh(); }} />
      ) : undefined} />
      {pq.loading && !data ? <T muted size={13}>Loading your portfolio…</T> : null}
      {pq.error && !data ? <T size={13} style={{ color: c.bad }}>{pq.error}</T> : null}
      {data ? (
        <>
          <View style={{ gap: 2 }}>
            <T muted size={13} weight="medium">Upwork portfolio items · attached to the proposal</T>
            {items.map((it) => <CheckRow key={it.id} label={it.title} checked={ids.includes(it.id)} disabled={locked} onPress={() => toggle(it.id)} />)}
            {unknown.map((id) => <CheckRow key={id} label={`Item ${id} - no longer on your Upwork profile; untick to remove`} checked disabled={locked} tone="warn" onPress={() => toggle(id)} />)}
            {!items.length && !unknown.length ? (
              <T muted size={13}>
                {`Your Upwork profile has no portfolio items Upwork can attach${data.upwork.checkedAt ? ` (checked ${timeAgo(data.upwork.checkedAt)})` : ""}. Add them on Upwork under Profile → Portfolio, then tap Refresh. Until then, add project links below.`}
              </T>
            ) : null}
            {ids.length ? <T faint size={12}>{ids.length} attached. Changing them after approval asks for a fresh approval.</T> : null}
            {refreshError ? <T size={12} style={{ color: c.bad }}>{refreshError}</T> : null}
          </View>
          <View style={{ gap: 2, marginTop: 4 }}>
            <T muted size={13} weight="medium">{`Portfolio-site projects · added to the letter as a link${inLetter ? ` · ${inLetter} in the letter` : ""}`}</T>
            {relevant.map((pr) => projectRow(pr, true))}
            {showAll || !relevant.length ? (
              <>
                <Field label="" value={filter} onChangeText={setFilter} placeholder="Filter by title or topic" autoCorrect={false} style={{ marginTop: 8, marginBottom: 0 }} />
                {others.map((pr) => projectRow(pr, false))}
                {!others.length ? <T faint size={12}>No project matches that filter.</T> : null}
              </>
            ) : (
              <TextButton label={`Show all projects (${projects.length - relevant.length} more)`} onPress={() => { haptic.select(); setShowAll(true); }} />
            )}
          </View>
        </>
      ) : null}
    </Card>
  );
}

const CACHE = (id: number) => `proposal-draft:${id}`;
type Cached = { letter: string; answers: { question: string; answer: string }[]; bid: string; duration: string; portfolioIds?: string[]; savedAt: number };
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
  const [portfolioIds, setPortfolioIds] = useState<string[]>([]);
  const [loom, setLoom] = useState("");
  const [loomOpen, setLoomOpen] = useState(false);
  const [editing, setEditing] = useState(false);
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

  const dirty = !!p && (letter !== p.coverLetter || bid !== (p.bid == null ? "" : String(p.bid)) || duration !== (p.estimatedDuration ?? "") || JSON.stringify(answers) !== JSON.stringify(p.answers)
    || JSON.stringify(portfolioIds) !== JSON.stringify(p.portfolioProjectIds ?? []));
  const bidValid = bid.trim() === "" || Number.isFinite(Number(bid));
  const locked = !!p && (p.status === "submitted" || p.status === "discarded");

  // Load server state into the editor - on first load, and on live updates only when nothing is being edited.
  // (State adjusted during render - React's pattern for deriving state from changed props/data.)
  if (p && p.updatedAt !== loadedAt && !(loadedAt && dirty)) {
    setLetter(p.coverLetter);
    setAnswers(p.answers);
    setBid(p.bid == null ? "" : String(p.bid));
    setDuration(p.estimatedDuration ?? "");
    setPortfolioIds(p.portfolioProjectIds ?? []);
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
      const next = await endpoints.editProposal(p.id, { coverLetter: letter.slice(0, COVER_MAX), answers, bid: bid.trim() === "" ? null : Number(bid), estimatedDuration: duration || undefined, portfolioProjectIds: portfolioIds });
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
    const snap: Cached = { letter, answers, bid, duration, portfolioIds, savedAt: Date.now() };
    AsyncStorage.setItem(CACHE(p.id), JSON.stringify(snap)).catch(() => {});
    const t = setTimeout(() => { void persist(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, answers, bid, duration, portfolioIds]);

  // Edits made on this phone that never reached the server (app closed, worker offline): offer them back.
  useEffect(() => {
    if (!p || cacheChecked.current || !loadedAt) return;
    cacheChecked.current = true;
    AsyncStorage.getItem(CACHE(p.id)).then((raw) => {
      if (!raw) return;
      const c = JSON.parse(raw) as Cached;
      const serverIds = p.portfolioProjectIds ?? [];
      const same = c.letter === p.coverLetter && c.bid === (p.bid == null ? "" : String(p.bid)) && c.duration === (p.estimatedDuration ?? "") && JSON.stringify(c.answers) === JSON.stringify(p.answers)
        && JSON.stringify(c.portfolioIds ?? serverIds) === JSON.stringify(serverIds);
      if (same || c.savedAt < Date.parse(p.updatedAt) || locked) { AsyncStorage.removeItem(CACHE(p.id)).catch(() => {}); return; }
      setLetter(c.letter); setAnswers(c.answers); setBid(c.bid); setDuration(c.duration);
      if (c.portfolioIds) setPortfolioIds(c.portfolioIds);
      setRestored({ letter: p.coverLetter, answers: p.answers, bid: p.bid == null ? "" : String(p.bid), duration: p.estimatedDuration ?? "", portfolioIds: serverIds, savedAt: 0 });
    }).catch(() => {});
  }, [p, loadedAt, locked]);

  if (!p) {
    return <Screen header={false} padTop={false}>{q.loading ? <T muted>Loading…</T> : <Empty title="Proposal not found">{q.error ?? "It may have been removed."}</Empty>}</Screen>;
  }

  const st = PROPOSAL_STATUS[p.status];
  const idx = stepIndex(p.status);
  const step = nextStep(p.status, !!p.loomUrl);
  const screening = job.data?.enrichment?.screeningQuestions ?? [];
  const connects = job.data?.enrichment?.connectsCost ?? null;
  const upwork = (p.preview?.upwork ?? null) as Record<string, unknown> | null;
  const loomValid = LOOM_RE.test(loom.trim());
  const loomAttached = !!p.loomUrl && p.loomUrl === loom.trim();
  const hourly = job.data?.jobType === "HOURLY";
  const apply = job.data ? applyUrl(job.data) : applyUrl({ url: p.jobUrl });
  const pasteLetter = letterForUpwork(letter);
  const notes = [letter, ...answers.map((a) => a.answer)].some((t) => findPlaceholders(t).length > 0);
  const manual = p.preview?.manual === true;
  const canApprove = p.status === "ready" || p.status === "needs_loom" || p.status === "draft";
  const r = p.research;

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

  function approve() {
    const go = async () => { if (await persist()) run("approve", () => endpoints.approve(p!.id)); };
    if (p!.loomUrl) { void go(); return; }
    Alert.alert("Approve without a Loom?", "The Loom line is removed from the letter. You can still attach one later - it asks for a fresh approval.", [
      { text: "Add Loom first", onPress: () => setLoomOpen(true) },
      { text: "Approve", onPress: () => { void go(); } },
    ]);
  }

  const primary = (() => {
    if (locked) return null;
    if (canApprove) return <Button label="Approve" variant="dark" disabled={notes || busy !== null} loading={busy === "approve"} icon={(col) => <IconCheck size={16} color={col} />} onPress={approve} />;
    if (p.status === "approved") return <Button label="Build Upwork preview" variant="dark" disabled={busy !== null} loading={busy === "preview"} onPress={() => run("preview", () => endpoints.preview(p.id))} />;
    if (p.status === "previewed") return <Button label="Submit to Upwork…" variant="accent" disabled={busy !== null} icon={(col) => <IconSend size={16} color={col} />} onPress={() => { setConfirmText(""); setSubmitOpen(true); haptic.medium(); }} />;
    return null;
  })();

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? (bidValid ? "Not saved yet - kept on this phone, retrying" : "Fix the bid to save") : dirty ? "Edited" : "All changes saved";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: "Proposal" }} />
      <Screen header={false} padTop={false} onRefresh={q.refresh} refreshing={q.refreshing}>
        <T weight="displaySemi" size={19} style={{ marginBottom: 6 }}>{p.jobTitle}</T>
        <Row gap={6} style={{ marginBottom: 14 }}>
          <Pill label={st.label} tone={st.tone} />
          {p.loomUrl ? <Pill label="Loom" tone="good" /> : null}
          <T faint size={12}>updated {timeAgo(p.updatedAt)}</T>
        </Row>
        {idx >= 0 ? <Stepper idx={idx} /> : null}
        {error ? <Banner tone="bad" title="That didn't work">{error}</Banner> : null}
        {restored ? (
          <Banner tone="warn" title="Restored edits from this phone" action={<Button small label="Use saved version" onPress={() => {
            setLetter(restored.letter); setAnswers(restored.answers); setBid(restored.bid); setDuration(restored.duration); setPortfolioIds(restored.portfolioIds ?? []);
            setRestored(null); AsyncStorage.removeItem(CACHE(p.id)).catch(() => {});
          }} />}>These edits hadn&apos;t reached the server. They save again in a moment.</Banner>
        ) : null}

        {/* 1. Next step */}
        {!locked ? (
          <Card style={{ marginBottom: 12, gap: 12 }}>
            <View style={{ gap: 4 }}>
              <T weight="displaySemi" size={17}>{step.title}</T>
              <T muted size={13}>{step.hint}</T>
            </View>
            {primary}
            {notes ? <T size={12} style={{ color: c.bad }}>Remove the notes marked in red first.</T> : null}
            <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10, gap: 8 }}>
              {p.loomUrl && !loomOpen ? (
                <Row style={{ justifyContent: "space-between" }}>
                  <Row gap={6} style={{ flexShrink: 1 }}>
                    <IconLink size={14} color={c.good} />
                    <T size={13} weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>Loom attached</T>
                  </Row>
                  <Row gap={6}>
                    <TextButton label="Watch" onPress={() => openUpwork(p.loomUrl!)} />
                    <TextButton label="Replace" onPress={() => setLoomOpen(true)} />
                  </Row>
                </Row>
              ) : !loomOpen ? (
                <Row style={{ justifyContent: "space-between" }}>
                  <T muted size={13}>No Loom video (optional)</T>
                  <TextButton label="Add Loom" icon={(col) => <IconLink size={14} color={col} />} onPress={() => setLoomOpen(true)} />
                </Row>
              ) : (
                <View>
                  <Field label="Loom link (or branded short link)" value={loom} onChangeText={setLoom} placeholder="https://www.loom.com/share/…" autoCapitalize="none" autoCorrect={false} keyboardType="url" autoFocus
                    error={loom.trim() && !loomValid ? "Paste a Loom share link or a short link that redirects to one" : null} style={{ marginBottom: 8 }} />
                  <Row gap={8}>
                    <Button small label={loomAttached ? "Attached" : "Attach Loom"} disabled={!loomValid || loomAttached} loading={busy === "loom"}
                      icon={loomAttached ? (col) => <IconCheck size={16} color={col} /> : undefined}
                      onPress={async () => { if (await persist()) { if (await run("loom", () => endpoints.loom(p.id, loom.trim()))) setLoomOpen(false); } }} />
                    <Button small variant="ghost" label="Cancel" onPress={() => { setLoomOpen(false); setLoom(p.loomUrl ?? ""); }} />
                  </Row>
                </View>
              )}
            </View>
          </Card>
        ) : null}
        {p.status === "previewed" ? <BoostCard key={`${p.previewId}`} p={p} busy={busy === "boost"} onSet={(connects) => run("boost", () => endpoints.boost(p.id, connects))} /> : null}
        {p.status === "submitted" ? <Banner tone="good" title={manual ? "Sent on Upwork" : "Submitted"}>{`${manual ? "You sent it on Upwork" : "Sent"}${p.submittedAt ? ` ${timeAgo(p.submittedAt)}` : ""}. Follow the client's reply in Closer.`}</Banner> : null}
        {p.status === "discarded" ? <Banner tone="neutral" title="Discarded">Kept for the feedback loop; it can still be read.</Banner> : null}

        {/* 2. Letter */}
        <Card style={{ marginBottom: 12, gap: 12 }}>
          <CardHead title="Cover letter" right={!locked ? (
            <TextButton label={editing ? "Done" : "Edit"} onPress={() => { haptic.select(); if (editing) void persist(); setEditing((v) => !v); }} />
          ) : undefined} />
          {editing && !locked ? (
            <Field label="" value={letter} onChangeText={setLetter} multiline autoFocus maxLength={COVER_MAX} style={{ marginBottom: 0 }} />
          ) : (
            <LetterView text={letter} loom={p.loomUrl} />
          )}
          <NoteWarning text={letter} />
          <Row gap={8} style={{ justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
            <View style={{ flexShrink: 1, gap: 2 }}>
              <T size={12} faint style={{ color: letter.length > COVER_MAX ? c.bad : c.faint, fontVariant: ["tabular-nums"] }}>{letter.length.toLocaleString("en-US")} / {COVER_MAX.toLocaleString("en-US")} characters</T>
              {!locked ? <T size={12} faint>{busy === "rewrite" ? "Rewriting - usually 30 to 60 seconds." : saveLabel}</T> : null}
            </View>
            <Row gap={6}>
              <TextButton label={copied.letter ? "Copied" : "Copy"} icon={(col) => (copied.letter ? <IconCheck size={14} color={col} /> : <IconCopy size={14} color={col} />)} onPress={() => copy("letter", pasteLetter)} />
              {!locked ? (
                <TextButton label="Shorter" icon={(col) => <IconRefresh size={14} color={col} />} onPress={() => {
                  if (busy) return;
                  const go = () => run("rewrite", () => endpoints.rewrite(p.id), { success: true });
                  Alert.alert("Rewrite shorter?", dirty ? "This replaces your unsaved edits with a shorter version of the draft." : "Restructures the draft to about 900 characters. Takes 30 to 60 seconds.", [{ text: "Cancel", style: "cancel" }, { text: "Rewrite", onPress: go }]);
                }} />
              ) : null}
            </Row>
          </Row>
        </Card>

        {/* 3. Screening answers */}
        {(p.answers.length || screening.length) ? (
          <Card style={{ marginBottom: 12, gap: 14 }}>
            <CardHead title="Screening answers" right={!locked ? <TextButton label={editing ? "Done" : "Edit"} onPress={() => { haptic.select(); if (editing) void persist(); setEditing((v) => !v); }} /> : undefined} />
            {answers.map((a, i) => (
              <View key={i} style={{ gap: 6 }}>
                <T muted size={13} weight="medium">{i + 1}. {a.question}</T>
                {editing && !locked ? (
                  <Field label="" value={a.answer} multiline style={{ marginBottom: 0 }}
                    onChangeText={(t) => setAnswers((prev) => prev.map((x, j) => (j === i ? { ...x, answer: t } : x)))} />
                ) : (
                  <T size={15} selectable style={{ color: a.answer.trim() ? c.ink : c.faint }}>{a.answer.trim() || "No answer yet - tap Edit"}</T>
                )}
                <NoteWarning text={a.answer} />
              </View>
            ))}
          </Card>
        ) : null}

        {/* 4. Terms */}
        <Card style={{ marginBottom: 12, gap: 10 }}>
          <CardHead title="Terms" right={connects != null ? <Pill label={`${connects} Connects`} tone="info" /> : undefined} />
          <Field label={hourly ? "Hourly rate (USD)" : "Bid (USD)"} value={bid} onChangeText={(t) => setBid(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" editable={!locked} placeholder={hourly ? "e.g. 85" : "e.g. 4500"}
            error={bidValid ? null : "Enter a number"} hint={p.bid != null && bid !== String(p.bid) ? `Saved: ${money(p.bid)}` : undefined} style={{ marginBottom: 0 }} />
          {!hourly ? (
            <View style={{ gap: 6 }}>
              <T muted size={13} weight="medium">Project length</T>
              <Seg scroll value={duration} options={DURATIONS.map((d) => ({ value: d as string, label: d }))} onChange={(v) => { if (!locked) { haptic.select(); setDuration(v); } }} />
            </View>
          ) : null}
        </Card>

        {/* 4b. Portfolio - Upwork attachments and portfolio-site links */}
        <PortfolioCard jobId={p.jobId} ids={portfolioIds} setIds={setPortfolioIds} letter={letter} setLetter={setLetter} locked={locked} />

        {/* 5. Folded away */}
        {upwork ? (
          <Fold title="Upwork preview" summary="Connects cost, balance, unmet requirements" open>
            <PreviewRows data={upwork} />
          </Fold>
        ) : null}

        {r ? (
          <Fold title="Research" summary={[r.contactName ?? "Contact unknown", r.company ?? null].filter(Boolean).join(" · ")}>
            <KV label="Contact" value={r.contactName ?? "Unknown"} />
            {r.contactRole ? (
              <View style={{ gap: 4 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <T muted size={14}>Contact role</T>
                  <Pill label={CONTACT_ROLE_LABELS[r.contactRole] ?? r.contactRole} tone="info" />
                </Row>
                {r.roleEvidence ? <T faint size={12}>{r.roleEvidence}</T> : null}
              </View>
            ) : null}
            <KV label="Company" value={`${r.company ?? "Unknown"}${r.company ? ` · ${r.companyConfidence}` : ""}`} tone={r.companyConfidence === "confirmed" ? "good" : undefined} />
            {r.bigFish ? <View style={{ gap: 4, padding: 12, borderRadius: radius.control, backgroundColor: c.goodSoft }}><T size={12} weight="semibold" style={{ color: c.good, textTransform: "uppercase", letterSpacing: 0.6 }}>Big fish</T><T>{r.bigFish}</T></View> : null}
            {r.hiddenProblems.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">Hidden problems</T><Bullets items={r.hiddenProblems} tone="warn" /></View> : null}
            {r.assumptions.length ? <View style={{ gap: 6 }}><T muted size={13} weight="medium">Assumptions to check</T><Bullets items={r.assumptions} /></View> : null}
          </Fold>
        ) : null}

        {!locked ? (
          <Fold title="Paste into Upwork instead" summary="Copy each part and send it from the Upwork app">
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
          </Fold>
        ) : null}

        <Card style={{ marginBottom: 12 }}>
          <FeedbackButtons kind="draft" refId={String(p.id)} label="Good draft?" data={{ promptVersion: p.promptVersion, model: p.model, status: p.status }} />
        </Card>
        <Button label="Open job in Upwork" variant="ghost" icon={(col) => <IconExternal size={16} color={col} />} onPress={() => openUpwork(p.jobUrl)} />
        <Button label="View job details" variant="ghost" onPress={() => router.push({ pathname: "/job/[id]", params: { id: p.jobId } })} />
        {!locked ? (
          <Button label="Discard draft" variant="ghost" loading={busy === "discard"} style={{ marginTop: 8 }} onPress={() => Alert.alert("Discard this proposal?", "It stays in the list as discarded.", [
            { text: "Cancel", style: "cancel" },
            { text: "Discard", style: "destructive", onPress: () => { haptic.medium(); run("discard", () => endpoints.discard(p.id)); } },
          ])} />
        ) : null}
        {p.model ? <T faint size={12} style={{ textAlign: "center", marginTop: 8 }}>Written by {p.model}{p.promptVersion != null ? ` · prompt v${p.promptVersion}` : ""}</T> : null}
      </Screen>

      {/* Native page sheet: the platform's own presentation and dismissal. */}
      <Modal visible={submitOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSubmitOpen(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <T weight="display" size={24} style={{ textTransform: "uppercase" }}>Submit proposal</T>
          <T muted>This sends the proposal to the client on Upwork{connects != null ? ` and spends ${connects} Connects` : ""}. {"It can't be undone from here."}</T>
          <Card>
            <KV label="Bid" value={money(p.bid)} />
            <KV label="Loom" value={p.loomUrl ? "Attached" : "None (optional)"} tone={p.loomUrl ? "good" : undefined} />
            <KV label="Boost" value={p.preview?.boostConnects ? `${String(p.preview.boostConnects)} Connects bid` : "None"} />
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
