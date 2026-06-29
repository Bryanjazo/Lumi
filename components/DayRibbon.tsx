// DayRibbon — the live "shape of your day" strip ported from
// lumi-day-workflow.jsx. Four colored segments (Morning / Midday /
// Afternoon / Evening) sized proportionally to actual time spans
// between wake and sleep. Renders anchor markers (Wake / Breakfast /
// Lunch / Dinner / Sleep) as thin vertical lines with dots on top.
//
// Used in two places:
//   - Profile → Daily anchors (anchors mode, full size + markers)
//   - WindowEditorSheet (compact, no markers, draft-driven so the
//     user sees the boundaries reflow as they nudge)

import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts } from '../constants/fonts';

const C = {
  void: '#120E0C',
  bone: '#ECE0CB',
  mute: '#6E655A',
  hair: '#2A2420',
  honey: '#C9A06A',
  lichen: '#869072',
  ember: '#E07A4F',
  dusk: '#8EA0B4',
} as const;

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const fmtShort = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h < 12 ? 'a' : 'p';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, '0')}${ap}`;
};

interface AnchorMarker {
  key: string;
  minutes: number;
}

interface Props {
  /** Minutes since midnight when day starts. */
  wakeMin: number;
  /** Minutes since midnight when day ends. */
  sleepMin: number;
  /** Hour-of-day (0-23) where Midday begins. */
  middayHour: number;
  /** Hour-of-day where Afternoon begins. */
  afternoonHour: number;
  /** Hour-of-day where Evening begins. */
  eveningHour: number;
  /** Anchor markers to overlay (Wake / Breakfast / Lunch / Dinner / Sleep). */
  anchors?: AnchorMarker[];
  /** Compact mode — shorter, no markers, no end labels. Used in sheets. */
  compact?: boolean;
}

export const DayRibbon = ({
  wakeMin,
  sleepMin,
  middayHour,
  afternoonHour,
  eveningHour,
  anchors,
  compact,
}: Props) => {
  // Guard against degenerate ranges (sleep at or before wake) — the
  // ribbon needs positive span to size the segments. Defensively fall
  // back to "minimum 1 minute" so we never divide by zero.
  const span = Math.max(1, sleepMin - wakeMin);

  // Clamp boundary positions inside [wake, sleep] so weird states
  // (e.g. midday landing past sleep) don't blow up the layout.
  const cls = (m: number) => Math.max(wakeMin, Math.min(sleepMin, m));
  const middayMin = cls(middayHour * 60);
  const afternoonMin = cls(afternoonHour * 60);
  const eveningMin = cls(eveningHour * 60);

  const segs = [
    { label: 'Morning', color: C.honey, a: wakeMin, b: middayMin },
    { label: 'Midday', color: C.lichen, a: middayMin, b: afternoonMin },
    { label: 'Afternoon', color: C.ember, a: afternoonMin, b: eveningMin },
    { label: 'Evening', color: C.dusk, a: eveningMin, b: sleepMin },
  ];

  // Convert minutes → [0..1] proportion along the strip.
  const pct = (m: number) => (cls(m) - wakeMin) / span;

  return (
    <View style={{ marginBottom: compact ? 0 : 6 }}>
      <View style={[styles.bar, { height: compact ? 44 : 54 }]}>
        {segs.map((s) => {
          const frac = Math.max(0, pct(s.b) - pct(s.a));
          if (frac <= 0) return null;
          return (
            <View
              key={s.label}
              style={{
                flexGrow: frac,
                flexShrink: 1,
                flexBasis: 0,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRightWidth: 1,
                borderRightColor: hexA(C.void, 0.5),
              }}
            >
              <LinearGradient
                colors={[hexA(s.color, 0.32), hexA(s.color, 0.14)]}
                style={StyleSheet.absoluteFill}
              />
              <Text
                style={[styles.segLabel, { color: hexA(s.color, 0.95) }]}
                numberOfLines={1}
              >
                {s.label.toUpperCase()}
              </Text>
            </View>
          );
        })}

        {/* Anchor markers — thin white line with a dot on top. Sized
           by absolute left percentage so they don't disturb the flex
           sizing of the segments. */}
        {!compact &&
          anchors &&
          anchors.map((an) => (
            <View
              key={an.key}
              pointerEvents="none"
              style={[styles.marker, { left: `${pct(an.minutes) * 100}%` }]}
            >
              <View style={styles.markerDot} />
            </View>
          ))}
      </View>

      {!compact && (
        <View style={styles.endLabels}>
          <Text style={styles.endLabel}>{fmtShort(wakeMin)} wake</Text>
          <Text style={styles.endLabel}>{fmtShort(sleepMin)} bed</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    position: 'relative',
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.hair,
    overflow: 'hidden',
    backgroundColor: C.void,
  },
  segLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9,
    letterSpacing: 0.4,
    fontWeight: '700',
    textShadowColor: hexA(C.void, 0.6),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  marker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: hexA(C.bone, 0.45),
    transform: [{ translateX: -0.5 }],
  },
  markerDot: {
    position: 'absolute',
    top: -3,
    left: -2.5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.bone,
  },
  endLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  endLabel: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 10,
    color: C.mute,
  },
});
