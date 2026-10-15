import { useState, type ReactNode, type RefObject } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApiReachable } from "../lib/api";
import { font, motion, radius, toneColors, useTheme, type Tone } from "../theme";
import { IconClose, IconSearch } from "./icons";

/* ---------- text ---------- */
export function T({ children, style, muted, faint, size = 15, weight = "body", numberOfLines, selectable }: {
  children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; faint?: boolean; size?: number;
  weight?: "body" | "medium" | "semibold" | "display" | "displaySemi"; numberOfLines?: number; selectable?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[{ color: muted ? c.muted : faint ? c.faint : c.ink, fontSize: size, lineHeight: Math.round(size * 1.45), fontFamily: font[weight] }, style]}
    >
      {children}
    </Text>
  );
}

/** Uppercase display title, like the web's .page-title ("OVERVIEW"). */
export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 30, letterSpacing: -0.2, color: c.ink, textTransform: "uppercase", flexShrink: 1 }}>{title}</Text>
        {right}
      </View>
      {subtitle ? <T muted size={14} style={{ marginTop: 4 }}>{subtitle}</T> : null}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 6 }}>
      <T weight="displaySemi" size={17}>{children}</T>
      {right}
    </View>
  );
}

/* ---------- containers ---------- */
export function Screen({ title, subtitle, right, children, onRefresh, refreshing, header = true, padTop = true, scrollRef }: {
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; header?: boolean; padTop?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: c.ground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingTop: Platform.OS === "android" && padTop ? insets.top + 12 : 12, paddingBottom: 48 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.muted} /> : undefined}
    >
      {header && title ? <PageTitle title={title} subtitle={subtitle} right={right} /> : null}
      <ApiBanner />
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { c } = useTheme();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.line, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.card, padding: padded ? 16 : 0 }, style]}>{children}</View>;
}

/* ---------- press feedback ----------
 * Gate: tens of times/day → near-imperceptible. Purpose: feedback. Tool: Reanimated CSS transition on
 * transform (120ms, strong ease-out), feedback on press-in. Reduced motion: no scale. */
export function PressableScale({ onPress, onLongPress, children, style, outerStyle, disabled, accessibilityLabel, hitSlop = 8 }: {
  onPress?: () => void; onLongPress?: () => void; children: ReactNode; style?: StyleProp<ViewStyle>; outerStyle?: StyleProp<ViewStyle>; disabled?: boolean; accessibilityLabel?: string; hitSlop?: number;
}) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      style={outerStyle}
      hitSlop={hitSlop}
      pressRetentionOffset={16}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View
        style={[
          { transform: [{ scale: pressed && !reduced ? 0.97 : 1 }], opacity: pressed && reduced ? 0.7 : 1, transitionProperty: ["transform", "opacity"], transitionDuration: motion.press, transitionTimingFunction: motion.easeOutCss },
          style,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

type BtnVariant = "default" | "dark" | "accent" | "ghost" | "danger" | "good";
export function Button({ label, onPress, variant = "default", icon, loading, disabled, small, style, accessibilityLabel }: {
  label: string; onPress?: () => void; variant?: BtnVariant; icon?: (color: string) => ReactNode; loading?: boolean; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const bg = { default: c.track, dark: c.ink, accent: c.accent, ghost: "transparent", danger: c.badSoft, good: c.good }[variant];
  const fg = { default: c.ink, dark: c.surface, accent: c.onAccent, ghost: c.ink, danger: c.bad, good: "#FFFFFF" }[variant];
  const off = disabled || loading;
  return (
    <PressableScale onPress={onPress} disabled={off} outerStyle={style} style={{ opacity: off ? 0.5 : 1 }} accessibilityLabel={accessibilityLabel ?? label}>
      <View style={{ minHeight: small ? 38 : 46, paddingHorizontal: small ? 14 : 18, borderRadius: radius.control, backgroundColor: bg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {loading ? <ActivityIndicator size="small" color={fg} /> : icon?.(fg)}
        <Text style={{ color: fg, fontFamily: font.medium, fontSize: small ? 14 : 15 }} numberOfLines={1}>{label}</Text>
      </View>
    </PressableScale>
  );
}

export function IconButton({ onPress, children, label, active }: { onPress: () => void; children: ReactNode; label: string; active?: boolean }) {
  const { c } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label}>
      <View style={{ width: 44, height: 44, borderRadius: radius.control, alignItems: "center", justifyContent: "center", backgroundColor: active ? c.ink : c.control }}>{children}</View>
    </PressableScale>
  );
}

/* ---------- pills, chips ---------- */
export function Pill({ label, tone = "neutral", style }: { label: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View style={[{ alignSelf: "flex-start", height: 24, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: t.bg, justifyContent: "center" }, style]}>
      <Text style={{ color: t.fg, fontFamily: font.medium, fontSize: 13 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function RankPill({ total, tone }: { total: number; tone: Tone }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View style={{ minWidth: 44, height: 44, borderRadius: radius.control, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }} accessibilityLabel={`Rank ${total}`}>
      <Text style={{ color: t.fg, fontFamily: font.display, fontSize: 18, fontVariant: ["tabular-nums"] }}>{total}</Text>
    </View>
  );
}

export function Tag({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 24, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: c.track, justifyContent: "center" }}>
      <Text style={{ color: c.ink, fontFamily: font.medium, fontSize: 11, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</Text>
    </View>
  );
}

/** Segmented control (web .seg). State change = colour only, 150ms. Tabs never slide. */
export function Seg<V extends string>({ value, options, onChange, scroll }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; scroll?: boolean }) {
  const { c } = useTheme();
  const items = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} hitSlop={4} style={scroll ? undefined : { flex: 1 }}>
        <Animated.View style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.raised : "transparent", transitionProperty: "backgroundColor", transitionDuration: "150ms", transitionTimingFunction: motion.easeOutCss }}>
          <Text style={{ color: on ? c.ink : c.muted, fontFamily: font.medium, fontSize: 14 }} numberOfLines={1}>{o.label}</Text>
        </Animated.View>
      </Pressable>
    );
  });
  const track = { flexDirection: "row" as const, gap: 4, padding: 4, borderRadius: radius.seg, backgroundColor: c.track };
  return scroll
    ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={track} style={{ flexGrow: 0, borderRadius: radius.seg }}>{items}</ScrollView>
    : <View style={track}>{items}</View>;
}

/* ---------- stat tile ---------- */
export function Stat({ label, value, sub, tone, icon, onPress }: { label: string; value: ReactNode; sub?: string; tone?: Tone; icon?: ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  const body = (
    <Card style={{ flex: 1, minHeight: 110, justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon}
        <T muted size={13} weight="medium" numberOfLines={1}>{label}</T>
      </View>
      <Text style={{ fontFamily: font.display, fontSize: 28, color: tone ? toneColors(c, tone).fg : c.ink, fontVariant: ["tabular-nums"], marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <T faint size={12} numberOfLines={1}>{sub}</T> : null}
    </Card>
  );
  return onPress ? <PressableScale onPress={onPress} outerStyle={{ flex: 1 }} style={{ flex: 1 }} accessibilityLabel={label}>{body}</PressableScale> : <View style={{ flex: 1 }}>{body}</View>;
}

/* ---------- form ---------- */
export function Field({ label, hint, error, style, ...input }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: 6, marginBottom: 12 }, style as StyleProp<ViewStyle>]}>
      {label ? <T muted size={13} weight="medium">{label}</T> : null}
      <TextInput
        accessibilityLabel={label || input.placeholder}
        placeholderTextColor={c.faint}
        {...input}
        onFocus={(e) => { setFocus(true); input.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); input.onBlur?.(e); }}
        style={{
          minHeight: input.multiline ? 120 : 46, paddingHorizontal: 14, paddingVertical: input.multiline ? 12 : 0, borderRadius: radius.control,
          borderWidth: focus ? 2 : 1, borderColor: error ? c.bad : focus ? c.ink : c.line, backgroundColor: c.surface, color: c.ink,
          fontFamily: font.body, fontSize: 15, textAlignVertical: input.multiline ? "top" : "center",
        }}
      />
      {error ? <T size={13} style={{ color: c.bad }}>{error}</T> : hint ? <T faint size={12}>{hint}</T> : null}
    </View>
  );
}

/* ---------- feedback ---------- */
export function Banner({ tone = "info", title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: radius.control, padding: 12, marginBottom: 12, gap: 4 }} accessibilityRole="alert">
      {title ? <Text style={{ color: t.fg, fontFamily: font.semibold, fontSize: 14 }}>{title}</Text> : null}
      {typeof children === "string" ? <Text style={{ color: t.fg, fontFamily: font.body, fontSize: 14, lineHeight: 20 }}>{children}</Text> : children}
      {action}
    </View>
  );
}

export function ApiBanner() {
  const ok = useApiReachable();
  if (ok !== false) return null;
  return <Banner tone="warn" title="Home worker offline">Draft, approve and Closer actions wait until the worker at home is running again. Everything you can read here still works.</Banner>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: 32, gap: 6 }}>
      <T weight="semibold">{title}</T>
      {children ? <T muted size={14} style={{ textAlign: "center" }}>{children}</T> : null}
    </Card>
  );
}

export function KV({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 36, gap: 12 }}>
      <T muted size={14}>{label}</T>
      <Text style={{ fontFamily: font.semibold, fontSize: 15, color: tone ? toneColors(c, tone).fg : c.ink, fontVariant: ["tabular-nums"], flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: c.line, marginVertical: 8 }} />;
}

export function Bullets({ items, tone }: { items: string[]; tone?: Tone }) {
  const { c } = useTheme();
  const dot = tone ? toneColors(c, tone).fg : c.faint;
  return (
    <View style={{ gap: 6 }}>
      {items.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot, marginTop: 8 }} />
          <T size={15} style={{ flex: 1 }}>{s}</T>
        </View>
      ))}
    </View>
  );
}

/**
 * Indeterminate progress for long server work (drafting takes 1-3 min).
 * Gate: occasional. Purpose: state indication. Tool: CSS animation, linear, loops; childless absolute fill,
 * transform only. Reduced motion: a static half bar (the elapsed-time label carries the progress).
 */
const SLIDE = { from: { transform: [{ translateX: "-100%" }] }, to: { transform: [{ translateX: "250%" }] } } as const;
export function ProgressBar() {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: c.control, overflow: "hidden" }} accessibilityRole="progressbar">
      <Animated.View
        style={[
          { position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: 2, backgroundColor: c.accent },
          reduced ? { width: "50%" } : { animationName: SLIDE, animationDuration: "1400ms", animationIterationCount: "infinite", animationTimingFunction: "linear" },
        ]}
      />
    </View>
  );
}

export function Row({ children, gap = 8, wrap, style }: { children: ReactNode; gap?: number; wrap?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap, flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

/* ---------- search ---------- */
/** Search field for a list screen; filtering happens in the screen (lists are small and already loaded). */
export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.control, backgroundColor: c.track }}>
      <IconSearch size={18} color={c.muted} />
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.faint} accessibilityLabel={placeholder}
        returnKeyType="search" autoCorrect={false} autoCapitalize="none" clearButtonMode="never"
        style={{ flex: 1, color: c.ink, fontFamily: font.body, fontSize: 15, paddingVertical: 10 }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <IconClose size={16} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
