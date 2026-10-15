import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { haptic } from "../lib/haptics";
import { dayEnd, dayStart } from "../lib/jobFilters";
import { font, useTheme } from "../theme";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { Button, T } from "./ui";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const long = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthOf = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };

/**
 * Native page sheet with a month calendar: tap one day, or a first and a last day, then Apply.
 * Mount it only while open so each opening starts from `initial`.
 */
export function CalendarRange({ initial, onApply, onClose }: {
  initial: { since: number; until: number } | null; onApply: (r: { since: number; until: number }) => void; onClose: () => void;
}) {
  const { c } = useTheme();
  const [start, setStart] = useState<number | null>(initial ? dayStart(initial.since) : null);
  const [end, setEnd] = useState<number | null>(initial ? dayStart(initial.until) : null);
  const [month, setMonth] = useState(() => monthOf(initial?.since ?? Date.now()));

  const [today] = useState(() => dayStart(Date.now())); // the sheet is mounted only while open
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: daysIn }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1).getTime())];
  while (cells.length % 7) cells.push(null);
  const lo = start, hi = end ?? start;
  const atCurrentMonth = first.getFullYear() === new Date(today).getFullYear() && first.getMonth() === new Date(today).getMonth();

  function pick(day: number) {
    haptic.select();
    if (start == null || end != null) { setStart(day); setEnd(null); return; }
    if (day < start) { setEnd(start); setStart(day); } else setEnd(day);
  }
  const shift = (by: number) => { haptic.select(); setMonth(monthOf(new Date(first.getFullYear(), first.getMonth() + by, 1).getTime())); };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ padding: 20, gap: 14 }}>
        <T weight="display" size={24} style={{ textTransform: "uppercase" }}>Posted between</T>

        <View style={{ backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.line, padding: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
              <IconChevronLeft size={20} color={c.ink} />
            </Pressable>
            <Text style={{ fontFamily: font.semibold, fontSize: 16, color: c.ink }}>{monthTitle.format(month)}</Text>
            <Pressable onPress={() => shift(1)} disabled={atCurrentMonth} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month" accessibilityState={{ disabled: atCurrentMonth }} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: atCurrentMonth ? 0.3 : 1 }}>
              <IconChevronRight size={20} color={c.ink} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row" }}>
            {WEEKDAYS.map((w) => <Text key={w} style={{ flex: 1, textAlign: "center", fontFamily: font.medium, fontSize: 12, color: c.faint, paddingBottom: 6 }}>{w}</Text>)}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {cells.map((d, i) => {
              if (d == null) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
              const future = d > today;
              const edge = d === lo || d === hi;
              const inside = lo != null && hi != null && d > lo && d < hi;
              return (
                <View key={d} style={{ width: `${100 / 7}%`, height: 44, padding: 2, backgroundColor: inside ? c.accentSoft : "transparent" }}>
                  <Pressable
                    onPress={() => pick(d)} disabled={future}
                    accessibilityRole="button" accessibilityLabel={long.format(d)} accessibilityState={{ selected: edge || inside, disabled: future }}
                    style={{ flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: edge ? c.ink : "transparent" }}
                  >
                    <Text style={{
                      fontFamily: edge || d === today ? font.semibold : font.body, fontSize: 15, fontVariant: ["tabular-nums"],
                      color: edge ? c.surface : future ? c.faint : d === today ? c.accent : c.ink, opacity: future ? 0.5 : 1,
                    }}>{new Date(d).getDate()}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>

        <T muted size={14}>{lo == null ? "Tap a day, or a first and a last day." : end == null ? `${short.format(lo)} - tap the last day, or apply this one day.` : `${short.format(lo)} – ${short.format(hi!)}`}</T>
        <T faint size={12}>{"Jobs you don't act on are deleted after 24 hours, so earlier days only show jobs you drafted, watched or kept."}</T>
        <Button label="Apply" variant="dark" disabled={lo == null} onPress={() => { if (lo != null) { haptic.success(); onApply({ since: dayStart(lo), until: dayEnd(hi ?? lo) }); } }} />
        <Button label="Cancel" variant="ghost" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
