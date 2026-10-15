import { useRef, useState } from "react";
import { View, type GestureResponderEvent } from "react-native";
import { haptic } from "../lib/haptics";
import { useTheme } from "../theme";
import { T } from "./ui";

const THUMB = 28;

type Range = [number, number];

/**
 * Two-thumb 0–100 slider. Thumbs follow the finger locally; `onChange` fires once, when a thumb is released,
 * so the list re-filters once per drag. `onSlidingStart/End` let a parent list stop scrolling during a drag.
 * Uses the View responder props directly: the drag state lives in a ref that only event handlers touch.
 */
export function RangeSlider({ label, value, onChange, onSlidingStart, onSlidingEnd, step = 1 }: {
  label: string; value: Range; onChange: (v: Range) => void; onSlidingStart?: () => void; onSlidingEnd?: () => void; step?: number;
}) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const [live, setLive] = useState<Range | null>(null);
  const drag = useRef<{ live: Range; start: number; x0: number } | null>(null);
  const shown = live ?? value;
  const usable = Math.max(0, width - THUMB);
  const x = (v: number) => (v / 100) * usable;

  function grant(idx: number, e: GestureResponderEvent) {
    drag.current = { live: value, start: value[idx], x0: e.nativeEvent.pageX };
    haptic.select();
    onSlidingStart?.();
    setLive(value);
  }
  function move(idx: number, e: GestureResponderEvent) {
    const d = drag.current;
    if (!d || usable <= 0) return;
    const raw = d.start + ((e.nativeEvent.pageX - d.x0) / usable) * 100;
    const v = Math.round(Math.max(0, Math.min(100, raw)) / step) * step;
    const next: Range = idx === 0 ? [Math.min(v, d.live[1]), d.live[1]] : [d.live[0], Math.max(v, d.live[0])];
    if (next[0] !== d.live[0] || next[1] !== d.live[1]) { d.live = next; setLive(next); }
  }
  function finish() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setLive(null);
    onSlidingEnd?.();
    if (d.live[0] !== value[0] || d.live[1] !== value[1]) { haptic.light(); onChange(d.live); }
  }
  function nudge(idx: number, by: number) {
    const next: Range = idx === 0 ? [Math.max(0, Math.min(value[0] + by, value[1])), value[1]] : [value[0], Math.min(100, Math.max(value[1] + by, value[0]))];
    if (next[0] !== value[0] || next[1] !== value[1]) onChange(next);
  }
  // Stacked thumbs at the top end: draw the low one on top so it can still be dragged back.
  const order = shown[0] > 50 ? [1, 0] : [0, 1];

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <T muted size={13} weight="medium">{label}</T>
        <T size={13} weight="medium" style={{ fontVariant: ["tabular-nums"] }}>{shown[0]}–{shown[1]}</T>
      </View>
      <View style={{ height: THUMB + 12, justifyContent: "center" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={{ height: 6, borderRadius: 3, marginHorizontal: THUMB / 2, backgroundColor: c.track }} />
        <View style={{ position: "absolute", height: 6, borderRadius: 3, left: THUMB / 2 + x(shown[0]), width: Math.max(0, x(shown[1]) - x(shown[0])), backgroundColor: c.accent }} />
        {order.map((i) => (
          <View
            key={i}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={(e) => grant(i, e)}
            onResponderMove={(e) => move(i, e)}
            onResponderRelease={finish}
            onResponderTerminate={finish}
            hitSlop={14}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={i === 0 ? `Minimum ${label.toLowerCase()}` : `Maximum ${label.toLowerCase()}`}
            accessibilityValue={{ min: 0, max: 100, now: shown[i] }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) => nudge(i, e.nativeEvent.actionName === "increment" ? 5 : -5)}
            style={{
              position: "absolute", left: x(shown[i]), width: THUMB, height: THUMB, borderRadius: THUMB / 2,
              backgroundColor: c.surface, borderWidth: 2, borderColor: live ? c.accent : c.ink,
              boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            }}
          />
        ))}
      </View>
    </View>
  );
}
