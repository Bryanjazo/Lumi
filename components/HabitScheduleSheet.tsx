// HabitScheduleSheet — prompts the user to schedule a suggested habit
// before committing it. Replaces the old "one-tap accept with Lumi's
// guess" flow: now the user explicitly picks cadence (daily / weekly /
// monthly / weekdays / every 2 weeks), an optional weekday (when the
// cadence is weekly), and a specific clock time. The chosen rule
// flows into addQuest as recur + scheduledHour/Minute.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { fonts } from '../constants/fonts';
import {
  CADENCES,
  RDAYS,
  type CadenceKey,
  type RecurRule,
  type WeekdayKey,
} from '../constants/recur';
import { useAccent } from '../lib/theme';
import { useUserStore } from '../store/userStore';

// Sensible default clock time for a new habit when the LLM /
// suggestion didn't give one. Anchored to the user's day so we
// don't wake a night-shifter at 8am for a "morning meds" habit.
const defaultHabitAt = (part: 'morning' | 'midday' | 'afternoon' | 'evening', anchors: { wake: number; lunch: number; dinner: number; sleep: number }): number => {
  switch (part) {
    case 'morning':
      return Math.max(0, anchors.wake + 30);
    case 'midday':
      return anchors.lunch;
    case 'afternoon':
      return Math.floor((anchors.lunch + anchors.dinner) / 2);
    case 'evening':
      return Math.max(0, anchors.sleep - 60);
  }
};

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  dusk: '#8EA0B4',
  hair: '#2A2420',
  mute: '#6E655A',
};

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const fmtTime = (min: number): string => {
  const adj = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(adj / 60);
  const mm = adj % 60;
  const hr = h % 12 || 12;
  return `${hr}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

// Map a cadence key to a default part-of-day. Lumi's earlier guess
// passes in its own part — we honor it as the starting point so the
// user only adjusts what they care about.
type Part = 'morning' | 'midday' | 'afternoon' | 'evening';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Suggestion title. Read-only here — the sheet is for cadence + time. */
  title: string;
  /** Lumi's guessed rule — used as the initial state. */
  initial: RecurRule;
  onSave: (rule: RecurRule) => void;
}

export const HabitScheduleSheet = ({
  visible,
  onClose,
  title,
  initial,
  onSave,
}: Props) => {
  const accent = useAccent();
  const anchors = useUserStore((s) => s.anchors);
  const initialPart =
    initial.part === 'morning' ||
    initial.part === 'midday' ||
    initial.part === 'afternoon' ||
    initial.part === 'evening'
      ? initial.part
      : 'morning';
  const fallbackAt = defaultHabitAt(initialPart, anchors);
  const [cadence, setCadence] = useState<CadenceKey>(initial.every);
  const [day, setDay] = useState<WeekdayKey>(initial.day ?? 'Mon');
  const [minOfDay, setMinOfDay] = useState<number>(initial.at ?? fallbackAt);
  // Custom interval — "every N days/weeks/months". 1 = the cadence
  // chip's default (just "daily"/"weekly"/"monthly").
  const [interval, setIntervalCount] = useState<number>(initial.interval ?? 1);

  // Re-seed on each open so a Cancel → reopen shows the original
  // suggestion's guesses, not last edit's leftovers.
  useEffect(() => {
    if (visible) {
      setCadence(initial.every);
      setDay(initial.day ?? 'Mon');
      setMinOfDay(initial.at ?? fallbackAt);
      setIntervalCount(initial.interval ?? 1);
    }
    // fallbackAt depends on anchors + initialPart; tied to `visible`+`initial`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial]);

  const part: Part = useMemo(() => {
    const h = Math.floor(minOfDay / 60);
    if (h < 11) return 'morning';
    if (h < 14) return 'midday';
    if (h < 17) return 'afternoon';
    return 'evening';
  }, [minOfDay]);

  const showDayPicker = cadence === 'week' || cadence === '2week';

  const nudge = (delta: number) => {
    Haptics.selectionAsync();
    setMinOfDay((m) => {
      const next = ((m + delta) % 1440 + 1440) % 1440;
      return next;
    });
  };

  // ── Hold-to-accelerate the ±15-min time stepper. Going from 8am
  //    to 9pm by tap was 52 separate presses — the user flagged this.
  //    On hold we ramp through 3 speeds: slow (300ms / 15 min),
  //    medium (120ms / 15 min), fast (60ms / 60 min). Released or
  //    sheet-close cancels.
  const holdRef = useRef<{
    timer: ReturnType<typeof setInterval> | null;
    timeout: ReturnType<typeof setTimeout> | null;
  }>({ timer: null, timeout: null });

  const clearHold = () => {
    if (holdRef.current.timer) {
      clearInterval(holdRef.current.timer);
      holdRef.current.timer = null;
    }
    if (holdRef.current.timeout) {
      clearTimeout(holdRef.current.timeout);
      holdRef.current.timeout = null;
    }
  };

  const startHold = (delta: number) => {
    clearHold();
    // Phase 1: slow drip while the press settles.
    holdRef.current.timer = setInterval(() => nudge(delta), 300);
    // Phase 2: speed up after 800ms.
    holdRef.current.timeout = setTimeout(() => {
      clearHold();
      holdRef.current.timer = setInterval(() => nudge(delta), 120);
      // Phase 3: full sprint at 1h jumps after another 1.4s.
      holdRef.current.timeout = setTimeout(() => {
        clearHold();
        holdRef.current.timer = setInterval(
          () => nudge(delta * 4), // ±60 min jumps
          60,
        );
      }, 1400);
    }, 800);
  };

  // Cancel any ramp the moment the sheet closes mid-hold.
  useEffect(() => {
    if (!visible) clearHold();
    return clearHold;
  }, [visible]);

  // Interval stepper is meaningful for day / week / month cadences;
  // weekday and the legacy 2week have a fixed cadence by definition.
  const supportsInterval =
    cadence === 'day' || cadence === 'week' || cadence === 'month';
  const intervalUnit =
    cadence === 'day'
      ? 'day'
      : cadence === 'week'
        ? 'week'
        : cadence === 'month'
          ? 'month'
          : '';

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const rule: RecurRule = {
      every: cadence,
      part,
      at: minOfDay,
      ...(showDayPicker ? { day } : {}),
      ...(supportsInterval && interval > 1 ? { interval } : {}),
    };
    onSave(rule);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.sheetTitle}>Schedule this habit</Text>
            <Pressable
              onPress={handleSave}
              hitSlop={12}
              style={[
                styles.savePill,
                {
                  backgroundColor: accent.fg,
                  borderColor: accent.fg,
                },
              ]}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 20 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.eyebrow}>The habit</Text>
            <Text style={styles.habitTitle} numberOfLines={2}>
              {title}
            </Text>

            {/* ── How often ───────────────────────────────────────── */}
            <Text style={styles.eyebrow}>How often?</Text>
            <View style={styles.chipRow}>
              {CADENCES.map((c) => {
                const on = cadence === c.key;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCadence(c.key);
                    }}
                    style={[
                      styles.chip,
                      on && {
                        backgroundColor: accent.fg,
                        borderColor: accent.fg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: on ? C.void : C.boneDim },
                      ]}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* ── Interval stepper — only when the cadence supports a
                custom "every N" multiplier. Lets the user say e.g.
                "every 3 days" or "every 6 months" without picking
                from a fixed chip set. ────────────────────────── */}
            {supportsInterval && (
              <>
                <Text style={styles.eyebrow}>Repeat every</Text>
                <View style={styles.intervalRow}>
                  <Pressable
                    onPress={() => {
                      if (interval <= 1) return;
                      Haptics.selectionAsync();
                      setIntervalCount((n) => Math.max(1, n - 1));
                    }}
                    hitSlop={8}
                    style={[
                      styles.intervalStep,
                      interval <= 1 && { opacity: 0.4 },
                    ]}
                  >
                    <Text style={styles.intervalStepText}>−</Text>
                  </Pressable>
                  <View style={styles.intervalNumWrap}>
                    <Text style={styles.intervalNum}>{interval}</Text>
                    <Text style={styles.intervalUnit}>
                      {intervalUnit}
                      {interval === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      if (interval >= 99) return;
                      Haptics.selectionAsync();
                      setIntervalCount((n) => Math.min(99, n + 1));
                    }}
                    hitSlop={8}
                    style={[
                      styles.intervalStep,
                      interval >= 99 && { opacity: 0.4 },
                    ]}
                  >
                    <Text style={styles.intervalStepText}>+</Text>
                  </Pressable>
                </View>
              </>
            )}

            {/* ── Day of week (weekly / every-2-weeks only) ─────── */}
            {showDayPicker && (
              <>
                <Text style={styles.eyebrow}>Which day?</Text>
                <View style={styles.dayRow}>
                  {RDAYS.map((d) => {
                    const on = day === d;
                    return (
                      <Pressable
                        key={d}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setDay(d);
                        }}
                        style={[
                          styles.dayChip,
                          on && {
                            backgroundColor: accent.fg,
                            borderColor: accent.fg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayChipText,
                            { color: on ? C.void : C.boneDim },
                          ]}
                        >
                          {d}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* ── Time picker (15-min steps, tap-and-hold accelerates) */}
            <Text style={styles.eyebrow}>At what time?</Text>
            <View style={styles.timeRow}>
              <Pressable
                onPress={() => nudge(-15)}
                onPressIn={() => startHold(-15)}
                onPressOut={clearHold}
                hitSlop={8}
                style={styles.stepBtn}
              >
                <Text style={styles.stepGlyph}>−</Text>
              </Pressable>
              <Text style={[styles.timeBig, { color: accent.fg }]}>
                {fmtTime(minOfDay)}
              </Text>
              <Pressable
                onPress={() => nudge(15)}
                onPressIn={() => startHold(15)}
                onPressOut={clearHold}
                hitSlop={8}
                style={styles.stepBtn}
              >
                <Text style={styles.stepGlyph}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.timeHint}>
              Lands in your {part}
              {part === 'evening' ? '' : ' window'}.
            </Text>

            {/* ── Preview line ────────────────────────────────────── */}
            <View
              style={[
                styles.previewCard,
                { borderColor: hexA(accent.fg, 0.3) },
              ]}
            >
              <Text style={styles.previewEyebrow}>Preview</Text>
              <Text style={styles.previewLine}>
                <Text style={{ color: accent.fg, fontFamily: fonts.interSemi }}>
                  {previewCadenceText(cadence, day)}
                </Text>{' '}
                at{' '}
                <Text style={{ color: accent.fg, fontFamily: fonts.interSemi }}>
                  {fmtTime(minOfDay)}
                </Text>
                .
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const previewCadenceText = (c: CadenceKey, d: WeekdayKey): string => {
  switch (c) {
    case 'day':
      return 'Every day';
    case 'weekday':
      return 'Every weekday';
    case 'week':
      return `Every ${d}`;
    case '2week':
      return `Every other ${d}`;
    case 'month':
      return 'Once a month';
  }
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(8,6,5,0.74)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    backgroundColor: C.void2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.hair,
    maxHeight: '85%',
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.hair,
    alignSelf: 'center',
    marginTop: 9,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 12,
  },
  cancelText: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.boneDim,
  },
  sheetTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 17,
    color: C.bone,
    letterSpacing: -0.3,
  },
  savePill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
  },
  saveText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.void,
  },

  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.mute,
    marginTop: 22,
    marginBottom: 10,
  },
  habitTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.4,
    lineHeight: 28,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: 'transparent',
  },
  chipText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
  },

  // ── Interval stepper ──
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 4,
  },
  intervalStep: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: C.void2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intervalStepText: {
    fontFamily: fonts.interSemi,
    fontSize: 22,
    color: C.bone,
    lineHeight: 24,
  },
  intervalNumWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
  },
  intervalNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    color: C.bone,
    letterSpacing: -0.5,
  },
  intervalUnit: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.boneDim,
    letterSpacing: -0.1,
  },

  dayRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
  },
  dayChipText: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    letterSpacing: 0.3,
  },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginBottom: 6,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontFamily: fonts.inter,
    fontSize: 22,
    color: C.boneDim,
    lineHeight: 26,
  },
  timeBig: {
    minWidth: 140,
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    letterSpacing: -0.4,
  },
  timeHint: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12,
    color: C.mute,
    textAlign: 'center',
    marginBottom: 14,
  },

  previewCard: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: C.void,
  },
  previewEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: C.dusk,
    marginBottom: 6,
  },
  previewLine: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 15,
    color: C.bone,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
});
