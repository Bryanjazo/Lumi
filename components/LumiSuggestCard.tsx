// LumiSuggestCard — the "Lumi suggests" card on Home, ported from
// lumi-suggest-card.jsx. Replaces the prior thin "a rhythm Lumi
// noticed" card with a richer scheduling sheet that lets the user
// confirm or override the suggestion's defaults (duration, window,
// optional exact time) before accepting.
//
// Inputs: a Suggestion + total/index for bulk pagination, plus
// accept/dismiss/next callbacks. Internal local state for the
// scheduling controls so each card is independent.

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Switch,
  ScrollView,
  type ScrollView as ScrollViewType,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { fonts } from '../constants/fonts';
import type { WindowKey } from '../constants/windows';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#211A15',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  glow: '#F4C98A',
  honey: '#C9A06A',
  lichen: '#869072',
  dusk: '#8EA0B4',
  ash: '#5A5650',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const WINDOWS: {
  key: WindowKey;
  label: string;
  glyph: string;
  color: string;
  start: number;
  end: number;
}[] = [
  { key: 'morning', label: 'Morning', glyph: '◔', color: C.honey, start: 7, end: 11 },
  { key: 'midday', label: 'Midday', glyph: '◑', color: C.lichen, start: 11, end: 14 },
  { key: 'afternoon', label: 'Afternoon', glyph: '◕', color: C.ember, start: 14, end: 17 },
  { key: 'evening', label: 'Evening', glyph: '●', color: C.dusk, start: 17, end: 22 },
];

const DURATIONS: { m: number; label: string }[] = [
  { m: 15, label: '15m' },
  { m: 30, label: '30m' },
  { m: 60, label: '1h' },
  { m: 90, label: '1.5h' },
  { m: 120, label: '2h' },
];

// 7:00am → 9:30pm in 30-min steps for the exact-time rail.
const TIME_RAIL: number[] = (() => {
  const out: number[] = [];
  for (let t = 7 * 60; t <= 21 * 60 + 30; t += 30) out.push(t);
  return out;
})();

const fmtTime = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hr = h % 12 || 12;
  const ap = h < 12 ? 'am' : 'pm';
  return m === 0 ? `${hr}${ap}` : `${hr}:${String(m).padStart(2, '0')}${ap}`;
};

const windowOf = (min: number): WindowKey => {
  const h = min / 60;
  for (const w of WINDOWS) if (h >= w.start && h < w.end) return w.key;
  return h < 7 ? 'morning' : 'evening';
};

const defaultMinuteForWindow = (k: WindowKey): number => {
  const w = WINDOWS.find((x) => x.key === k);
  return (w ? w.start : 18) * 60;
};

export interface SuggestAcceptOptions {
  window: WindowKey;
  durationMin: number;
  /** Minute-of-day when the user pinned an exact time; null = floats. */
  exactMinute: number | null;
}

// Generic input shape — both recurrence Suggestions (from the
// suggestionsStore) and SmartTasks (from the brain-dump preview flow
// on Home) can adapt to this. Each surface decides what onAccept and
// onDismiss actually do; the card just collects the user's choices.
export interface SuggestInput {
  /** Stable id used for React keys and the parent's bookkeeping. */
  id: string;
  /** Headline shown in italic at the top of the card. */
  title: string;
  /** Optional sub-line under the title (e.g., "the LLM is still sorting"). */
  subtitle?: string;
  /** Default part-of-day; defaults to 'evening' if omitted. */
  defaultWindow?: WindowKey;
  /** Default minute-of-day for the pinned-time toggle; null = float. */
  defaultExactMinute?: number | null;
  /** Default duration in minutes; defaults to 30. */
  defaultDurationMin?: number;
}

interface Props {
  input: SuggestInput;
  /** Total number of pending suggestions — drives the "1 of N" badge. */
  total: number;
  /** 0-based index of this suggestion in the queue. */
  index: number;
  onAccept: (input: SuggestInput, opts: SuggestAcceptOptions) => void;
  onDismiss: (input: SuggestInput) => void;
  /** Skip without accepting/dismissing — moves to the next suggestion. */
  onSkip?: (input: SuggestInput) => void;
}

export const LumiSuggestCard = ({
  input,
  total,
  index,
  onAccept,
  onDismiss,
  onSkip,
}: Props) => {
  // Seed state from the input's defaults so the user lands on Lumi's
  // best estimate; everything is overridable. Keyed on input.id so
  // a new card resets its local state when the parent advances to
  // the next suggestion in a bulk queue.
  const initialWindow: WindowKey = input.defaultWindow ?? 'evening';
  const initialExact = input.defaultExactMinute ?? null;
  const initialDuration = input.defaultDurationMin ?? 30;
  const [win, setWin] = useState<WindowKey>(initialWindow);
  const [dur, setDur] = useState<number>(initialDuration);
  const [exact, setExact] = useState<boolean>(initialExact != null);
  const [time, setTime] = useState<number>(
    initialExact ?? defaultMinuteForWindow(initialWindow),
  );

  // When the user toggles exact on, the window follows the chosen
  // hour. So "window" displayed in the summary should be derived.
  const effWin: WindowKey = exact ? windowOf(time) : win;
  const effWinObj = WINDOWS.find((w) => w.key === effWin) ?? WINDOWS[3];

  const pickWindow = (k: WindowKey) => {
    Haptics.selectionAsync();
    setWin(k);
    if (exact) setTime(defaultMinuteForWindow(k));
  };

  const toggleExact = (v: boolean) => {
    Haptics.selectionAsync();
    setExact(v);
    if (v && time === 0) setTime(defaultMinuteForWindow(win));
  };

  // Auto-scroll the time rail so the selected chip stays centered
  // when the user toggles exact-mode on or picks a window.
  const railRef = useRef<ScrollViewType>(null);
  const chipPositions = useRef<Record<number, number>>({});
  useEffect(() => {
    if (!exact) return;
    const x = chipPositions.current[time];
    if (x != null) {
      railRef.current?.scrollTo({ x: Math.max(0, x - 140), animated: true });
    }
  }, [exact, time]);

  const summary = exact
    ? `${effWinObj.label} · ${fmtTime(time)}`
    : `${effWinObj.label} · no set time`;

  const handleAccept = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onAccept(input, {
      window: effWin,
      durationMin: dur,
      exactMinute: exact ? time : null,
    });
  };

  return (
    <View style={styles.card}>
      {/* Top edge-light hairline */}
      <View style={styles.edgeLight} />

      {/* Header — eyebrow + bulk counter + dismiss × */}
      <View style={styles.header}>
        <Text style={styles.spark}>✦</Text>
        <Text style={styles.eyebrow}>Lumi suggests</Text>
        {total > 1 && (
          <View style={styles.counterPill}>
            <Text style={styles.counterText}>
              {index + 1} of {total}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {total > 1 && onSkip && (
          <Pressable
            onPress={() => onSkip(input)}
            hitSlop={10}
            style={styles.skipBtn}
          >
            <Text style={styles.skipText}>skip</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => onDismiss(input)}
          hitSlop={10}
          style={styles.dismissBtn}
        >
          <Text style={styles.dismissGlyph}>×</Text>
        </Pressable>
      </View>

      {/* Title + live summary */}
      <Text style={styles.title}>{input.title}</Text>
      <View style={styles.summaryRow}>
        <View
          style={[styles.summaryDot, { backgroundColor: effWinObj.color }]}
        />
        <Text style={styles.summaryText}>{input.subtitle ?? summary}</Text>
      </View>

      {/* Duration */}
      <Text style={styles.sectionLabel}>How long?</Text>
      <View style={styles.chipsRow}>
        {DURATIONS.map((d) => {
          const on = dur === d.m;
          return (
            <Pressable
              key={d.m}
              onPress={() => {
                Haptics.selectionAsync();
                setDur(d.m);
              }}
              style={[
                styles.durChip,
                on
                  ? { backgroundColor: C.ember, borderColor: C.ember }
                  : { backgroundColor: 'transparent', borderColor: C.hair },
              ]}
            >
              <Text
                style={[
                  styles.durChipText,
                  { color: on ? C.void : C.boneDim },
                ]}
              >
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* When — part-of-day grid */}
      <View style={styles.whenLabelRow}>
        <Text style={styles.sectionLabel}>When?</Text>
        {exact && (
          <Text style={styles.whenHint}>following your set time</Text>
        )}
      </View>
      <View style={styles.windowGrid}>
        {WINDOWS.map((w) => {
          const on = effWin === w.key;
          return (
            <Pressable
              key={w.key}
              onPress={() => pickWindow(w.key)}
              style={[
                styles.winCell,
                on
                  ? {
                      backgroundColor: hexA(w.color, 0.13),
                      borderColor: w.color,
                    }
                  : {
                      backgroundColor: hexA(C.void, 0.35),
                      borderColor: C.hair,
                    },
              ]}
            >
              <View
                style={[
                  styles.winGlyphBox,
                  on
                    ? {
                        backgroundColor: hexA(w.color, 0.18),
                        borderColor: hexA(w.color, 0.4),
                      }
                    : {
                        backgroundColor: hexA(C.bone, 0.05),
                        borderColor: 'transparent',
                      },
                ]}
              >
                <Text
                  style={[
                    styles.winGlyph,
                    { color: on ? w.color : C.mute },
                  ]}
                >
                  {w.glyph}
                </Text>
              </View>
              <Text
                style={[
                  styles.winLabel,
                  { color: on ? w.color : C.boneDim },
                ]}
              >
                {w.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Pin exact time toggle */}
      <View
        style={[
          styles.pinRow,
          {
            backgroundColor: exact
              ? hexA(C.ember, 0.08)
              : hexA(C.void, 0.4),
            borderColor: exact ? hexA(C.ember, 0.4) : C.hair,
          },
        ]}
      >
        <Text
          style={[styles.pinGlyph, { color: exact ? C.ember : C.mute }]}
        >
          ◷
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.pinTitle}>Pin an exact time</Text>
          <Text style={styles.pinSub}>
            {exact
              ? `Reminds you at ${fmtTime(time)}`
              : 'Otherwise it floats in the window'}
          </Text>
        </View>
        <Switch
          value={exact}
          onValueChange={toggleExact}
          trackColor={{ false: C.hair, true: C.ember }}
          thumbColor={exact ? C.void : C.mute}
        />
      </View>

      {/* Time rail (only visible when exact is on) */}
      {exact && (
        <View style={styles.railWrap}>
          <Text style={styles.railValue}>{fmtTime(time)}</Text>
          <ScrollView
            ref={railRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railContent}
          >
            {TIME_RAIL.map((t) => {
              const on = time === t;
              const isHour = t % 60 === 0;
              return (
                <Pressable
                  key={t}
                  onLayout={(e) => {
                    chipPositions.current[t] = e.nativeEvent.layout.x;
                  }}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setTime(t);
                  }}
                  style={[
                    styles.timeChip,
                    on
                      ? { backgroundColor: C.ember, borderColor: C.ember }
                      : { backgroundColor: 'transparent', borderColor: C.hair },
                  ]}
                >
                  <Text
                    style={[
                      styles.timeChipText,
                      {
                        color: on
                          ? C.void
                          : isHour
                            ? C.boneDim
                            : C.mute,
                        fontFamily: on ? fonts.interSemi : fonts.inter,
                      },
                    ]}
                  >
                    {fmtTime(t)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable onPress={handleAccept} style={styles.acceptBtn}>
          <Text style={styles.acceptText}>Accept</Text>
        </Pressable>
        <Pressable
          onPress={() => onDismiss(input)}
          style={styles.tweakBtn}
        >
          <Text style={styles.tweakText}>Not it</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    overflow: 'hidden',
    position: 'relative',
    // subtle drop shadow
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  edgeLight: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: hexA(C.dusk, 0.5),
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  spark: { fontSize: 12, color: C.dusk },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 2,
    color: C.dusk,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  counterPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    backgroundColor: hexA(C.dusk, 0.12),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.3),
  },
  counterText: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    color: C.dusk,
    letterSpacing: 0.3,
  },
  skipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skipText: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissGlyph: {
    fontSize: 15,
    color: C.mute,
    lineHeight: 16,
  },

  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 30,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 20,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryText: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    letterSpacing: -0.1,
  },

  sectionLabel: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 15,
    color: C.dusk,
    marginBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22,
  },
  durChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 100,
    borderWidth: 1,
  },
  durChipText: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  whenLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  whenHint: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11,
    color: C.mute,
  },
  windowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  winCell: {
    flexBasis: '47.5%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  winGlyphBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  winGlyph: {
    fontSize: 11.5,
  },
  winLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  pinGlyph: {
    fontSize: 15,
  },
  pinTitle: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
    color: C.bone,
    letterSpacing: -0.1,
  },
  pinSub: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    marginTop: 1,
  },

  railWrap: {
    marginTop: 14,
  },
  railValue: {
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    color: C.ember,
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  railContent: {
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  timeChip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  timeChipText: {
    fontSize: 13,
    letterSpacing: -0.2,
  },

  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: C.ember,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  acceptText: {
    fontFamily: fonts.interSemi,
    color: C.void,
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  tweakBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 22,
  },
  tweakText: {
    fontFamily: fonts.interSemi,
    color: C.boneDim,
    fontSize: 14,
    fontWeight: '600',
  },
});
