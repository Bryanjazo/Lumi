// DayThread — your whole day as one quiet thread, ported from
// lumi-home-capture-4.jsx (its "DayRibbon"; renamed here because
// components/DayRibbon.tsx is already the window-segments strip used
// by profile/WindowEditorSheet — different creature).
//
// One thin line from wake to sleep:
//   - the elapsed portion glows ember (dark → warm toward "now")
//   - things you finished are small solid lichen dots behind you
//   - things still coming are hollow dots in their window's color
//   - "now" is a glowing ember bead with a tiny NOW label
//
// Pure presentation — the caller derives positions from real quest
// data (completedAt stamps, scheduled times / window starts).

import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { timeColors as C } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { SoftGlow } from './SoftGlow';

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

export interface ThreadDot {
  /** Minutes since midnight. */
  min: number;
  /** Dot color — window color for upcoming, ignored for done. */
  color: string;
}

interface Props {
  /** Minutes since midnight, current time. */
  nowMin: number;
  /** Day bounds, minutes since midnight. */
  wakeMin: number;
  sleepMin: number;
  /** Completed-today stamps (solid lichen dots behind "now"). */
  done: ThreadDot[];
  /** Upcoming anchored/windowed tasks (hollow colored dots ahead). */
  upcoming: ThreadDot[];
}

export const DayThread = ({ nowMin, wakeMin, sleepMin, done, upcoming }: Props) => {
  const span = Math.max(1, sleepMin - wakeMin);
  // Clamp into [2%, 98%] like the mockup so edge dots never clip.
  const pos = (m: number) =>
    Math.max(2, Math.min(98, ((m - wakeMin) / span) * 100));
  const nowPct = pos(nowMin);

  return (
    <View style={styles.wrap}>
      {/* Track */}
      <View style={styles.track} />
      {/* Elapsed — dark at wake, warming toward now. */}
      <LinearGradient
        colors={[hexA(C.ember, 0.05), hexA(C.ember, 0.4)]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.elapsed, { width: `${nowPct}%` }]}
      />
      {/* Done — small solid lichen dots behind you. */}
      {done
        .filter((d) => d.min > wakeMin + 30 && d.min <= nowMin)
        .map((d, i) => (
          <View key={`d${i}`} style={[styles.doneDot, { left: `${pos(d.min)}%` }]} />
        ))}
      {/* Upcoming — hollow dots ahead, tinted by their window. */}
      {upcoming
        .filter((u) => u.min > nowMin)
        .map((u, i) => (
          <View
            key={`u${i}`}
            style={[
              styles.upcomingDot,
              { left: `${pos(u.min)}%`, borderColor: u.color },
            ]}
          />
        ))}
      {/* Now — glowing ember bead. The halo is an SVG radial fade
         underneath (colored shadows are iOS-only, so we paint the
         glow instead of casting it). */}
      <SoftGlow
        color={C.ember}
        opacity={0.5}
        fade={0.75}
        style={[styles.nowHalo, { left: `${nowPct}%` }]}
      />
      <View style={[styles.nowBead, { left: `${nowPct}%` }]} />
      <Text style={[styles.nowLabel, { left: `${nowPct}%` }]}>now</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    height: 26,
    position: 'relative',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 10,
    height: 3,
    borderRadius: 2,
    backgroundColor: hexA(C.bone, 0.07),
  },
  elapsed: {
    position: 'absolute',
    left: 0,
    top: 10,
    height: 3,
    borderRadius: 2,
  },
  doneDot: {
    position: 'absolute',
    top: 9,
    width: 5,
    height: 5,
    borderRadius: 3,
    marginLeft: -2.5,
    backgroundColor: C.lichen,
    opacity: 0.85,
  },
  upcomingDot: {
    position: 'absolute',
    top: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    marginLeft: -3.5,
    borderWidth: 1.5,
    backgroundColor: C.void,
  },
  nowHalo: {
    position: 'absolute',
    top: -2,
    width: 28,
    height: 28,
    marginLeft: -14,
  },
  nowBead: {
    position: 'absolute',
    top: 6.5,
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    backgroundColor: C.ember,
    // iOS gets the true glow on top of the painted halo.
    shadowColor: C.ember,
    shadowOpacity: 0.75,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  nowLabel: {
    position: 'absolute',
    top: 19,
    width: 40,
    marginLeft: -20,
    textAlign: 'center',
    fontFamily: fonts.interSemi,
    fontSize: 8,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: C.ember,
  },
});
