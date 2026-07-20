// Lumi · "Hey Lumi" voice layer UI (mock: lumi-hey-lumi.jsx)
//
// Never a takeover: the screen behind dims but stays put — voice is
// a LAYER (ember edge glow + bottom sheet), not a place. Color law:
// ember = the user (glow, waveform, caret, Keep); dusk = everything
// Luna says. The mock's sleeping-Luna corner affordance was cut on
// purpose — the phrase is the only trigger.
//
// Rendered from Home as a transparent Modal so it covers the tab bar
// too. Tapping the dimmed backdrop = cancel (mock: "any → tap-to-
// cancel → asleep"), except during the kept toast beat.

import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { timeColors as C } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { isReduceMotionEnabled } from '../lib/useReducedMotion';
import { lunaSource, useLunaSkin } from '../lib/luna-source';
import { classifyKind } from '../constants/taskKinds';
import { WINDOWS } from '../constants/windows';
import type { SmartTask } from '../lib/capture';
import type { HeyLumiPhase } from '../lib/heyLumi';

interface Props {
  phase: HeyLumiPhase;
  transcript: string;
  tasks: SmartTask[];
  countdown: number;
  /** False = the 45s cap finalized (ambient-babble shape) — no
   *  countdown; the sheet waits for an explicit tap. */
  autoKeep: boolean;
  onKeep: () => void;
  onFixUp: () => void;
  onCancel: () => void;
}

const fmtTime = (at: number): string => {
  const h = Math.floor(at / 60);
  const m = at % 60;
  const hr = h % 12 || 12;
  const suf = h < 12 ? 'am' : 'pm';
  return m === 0 ? `${hr} ${suf}` : `${hr}:${String(m).padStart(2, '0')} ${suf}`;
};

/** Row tag mirrors the mock: pinned time when anchored, otherwise
 *  the part-of-day window ("Evening", "Someday"). */
const tagFor = (t: SmartTask): string => {
  if (t.timeMode === 'anchored' && t.at != null) return fmtTime(t.at);
  if (t.recur) return 'repeats';
  return WINDOWS[t.window].label;
};

/** Ember waveform — the user's voice, always ember. */
const Waveform = ({ active }: { active: boolean }) => {
  const bars = useRef(
    Array.from({ length: 16 }, () => new Animated.Value(0.2)),
  ).current;
  useEffect(() => {
    if (!active) return;
    if (isReduceMotionEnabled()) {
      // Reduce Motion — freeze a steady, present waveform (no dancing
      // bars), rather than leaving them collapsed or animating.
      bars.forEach((v) => v.setValue(0.6));
      return;
    }
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 0.35 + Math.abs(Math.sin(i * 1.3)) * 0.65,
            duration: 260 + (i % 5) * 70,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0.15,
            duration: 260 + ((i + 2) % 5) * 70,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    const starts = loops.map((l, i) => setTimeout(() => l.start(), i * 40));
    return () => {
      starts.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [active, bars]);
  return (
    <View style={styles.waveRow}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={[styles.waveBar, { transform: [{ scaleY: v }] }]}
        />
      ))}
    </View>
  );
};

/** Blinking ember caret at the end of the live transcript. */
const Caret = () => {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (isReduceMotionEnabled()) return; // blink loop — Reduce Motion leaves the caret solid
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0, duration: 60, delay: 480, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 60, delay: 480, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [op]);
  return <Animated.View style={[styles.caret, { opacity: op }]} />;
};

export const HeyLumiSheet = ({
  phase,
  transcript,
  tasks,
  countdown,
  autoKeep,
  onKeep,
  onFixUp,
  onCancel,
}: Props) => {
  const skin = useLunaSkin();
  const glow = useRef(new Animated.Value(0.35)).current;

  const glowOn = phase === 'wake' || phase === 'listening';
  const sheetUp =
    phase === 'listening' || phase === 'sorting' || phase === 'sorted';
  const visible = phase !== 'idle';

  useEffect(() => {
    if (!glowOn) return;
    if (isReduceMotionEnabled()) {
      // Reduce Motion — hold a steady ember edge glow instead of
      // breathing it in and out.
      glow.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 0.9,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.35,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glowOn, glow]);

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      {/* dim layer — tap anywhere to cancel */}
      <Pressable
        style={[
          styles.dim,
          { backgroundColor: phase === 'kept' ? 'rgba(18,14,12,0.25)' : 'rgba(18,14,12,0.62)' },
        ]}
        onPress={phase === 'kept' ? undefined : onCancel}
      />

      {/* ember edge glow — the user's color */}
      {glowOn && (
        <Animated.View
          pointerEvents="none"
          style={[styles.edgeGlow, { opacity: glow }]}
        />
      )}

      {/* wake pill — "mm?" */}
      {phase === 'wake' && (
        <View style={styles.wakePill}>
          <Image
            source={lunaSource('idle', skin)}
            style={styles.wakeLuna}
            resizeMode="contain"
          />
          <Text style={styles.wakeText}>mm?</Text>
        </View>
      )}

      {/* bottom sheet — listening / sorting / sorted */}
      {sheetUp && (
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {phase !== 'sorted' && (
            <View style={styles.headRow}>
              <Image
                source={lunaSource('idle', skin)}
                style={styles.headLuna}
                resizeMode="contain"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.kicker}>
                  {phase === 'sorting' ? 'SORTING' : 'LISTENING'}
                </Text>
                <Text style={styles.lunaLine}>
                  {phase === 'sorting' ? 'one sec…' : "go on, I've got it…"}
                </Text>
              </View>
              <Pressable onPress={onCancel} style={styles.cancelChip} hitSlop={8}>
                <Text style={styles.cancelChipText}>tap to cancel</Text>
              </Pressable>
            </View>
          )}

          {phase === 'listening' && (
            <>
              <Text style={styles.transcript}>
                {transcript}
                <Caret />
              </Text>
              <Waveform active />
            </>
          )}

          {phase === 'sorting' && (
            <Text style={[styles.transcript, styles.transcriptDim]}>
              {transcript}
            </Text>
          )}

          {phase === 'sorted' && (
            <>
              <View style={styles.headRow}>
                <Image
                  source={lunaSource('happy', skin)}
                  style={styles.headLuna}
                  resizeMode="contain"
                />
                <Text style={[styles.lunaLine, { flex: 1 }]}>
                  {tasks.length === 1
                    ? 'one thing. out of your head — I’ll hold it.'
                    : `${tasks.length} things. out of your head — I’ll hold them.`}
                </Text>
              </View>
              <View style={styles.rows}>
                {tasks.map((t, i) => {
                  const kind = classifyKind(t.title);
                  return (
                    <View key={`${i}-${t.title}`} style={styles.row}>
                      <View
                        style={[styles.rowDot, { backgroundColor: kind.color }]}
                      />
                      <Text style={styles.rowTitle}>{t.title}</Text>
                      <View
                        style={[
                          styles.rowTag,
                          { backgroundColor: `${kind.color}1F` },
                        ]}
                      >
                        <Text style={[styles.rowTagText, { color: kind.color }]}>
                          {tagFor(t)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              <View style={styles.btnRow}>
                <Pressable onPress={onKeep} style={styles.keepBtn}>
                  <Text style={styles.keepBtnText}>
                    {tasks.length === 1 ? 'Keep it' : 'Keep all'}
                  </Text>
                </Pressable>
                <Pressable onPress={onFixUp} style={styles.fixBtn}>
                  <Text style={styles.fixBtnText}>Fix up</Text>
                </Pressable>
              </View>
              <Text style={styles.countdownLine}>
                {autoKeep
                  ? `auto-keeps in ${countdown}s · say “scratch that” next time to undo`
                  : 'that was a long one — keep or fix up when ready'}
              </Text>
            </>
          )}
        </View>
      )}

      {/* kept toast */}
      {phase === 'kept' && (
        <View style={styles.keptToast}>
          <View style={styles.keptDot} />
          <Text style={styles.keptText}>held for you</Text>
          <Text style={styles.keptAside}>· off your mind</Text>
        </View>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  edgeGlow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: 2,
    borderColor: 'rgba(224,122,79,0.55)',
    shadowColor: C.ember,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  wakePill: {
    position: 'absolute',
    top: 64,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: 'rgba(224,122,79,0.4)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 16,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  wakeLuna: { width: 34, height: 34 },
  wakeText: {
    fontFamily: fonts.fraunces,
    fontSize: 15,
    color: C.dusk,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.void2,
    borderTopWidth: 1,
    borderColor: C.hair,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.hair,
    alignSelf: 'center',
    marginBottom: 16,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headLuna: { width: 52, height: 52 },
  kicker: {
    fontSize: 9,
    letterSpacing: 1.8,
    color: C.dusk,
    fontFamily: fonts.interSemi,
  },
  lunaLine: {
    fontFamily: fonts.fraunces,
    fontSize: 16,
    color: C.dusk,
    marginTop: 3,
    lineHeight: 22,
  },
  cancelChip: {
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  cancelChipText: { fontSize: 11, color: C.mute, fontFamily: fonts.inter },
  transcript: {
    marginTop: 18,
    fontSize: 16.5,
    lineHeight: 25,
    color: C.bone,
    minHeight: 78,
    fontFamily: fonts.inter,
  },
  transcriptDim: { color: C.boneDim, opacity: 0.6 },
  caret: {
    width: 2,
    height: 18,
    backgroundColor: C.ember,
    marginLeft: 3,
    transform: [{ translateY: 3 }],
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 30,
    marginTop: 14,
  },
  waveBar: {
    width: 3,
    height: 24,
    borderRadius: 2,
    backgroundColor: C.ember,
  },
  rows: { gap: 9, marginTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: C.void,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  rowDot: { width: 7, height: 7, borderRadius: 4 },
  rowTitle: {
    flex: 1,
    fontSize: 13.5,
    color: C.bone,
    fontFamily: fonts.inter,
  },
  rowTag: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  rowTagText: {
    fontSize: 10,
    letterSpacing: 0.5,
    fontFamily: fonts.interSemi,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  keepBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: C.ember,
    borderRadius: 999,
    paddingVertical: 13,
  },
  keepBtnText: {
    fontSize: 13.5,
    color: C.void,
    fontFamily: fonts.interSemi,
  },
  fixBtn: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  fixBtnText: { fontSize: 13, color: C.boneDim, fontFamily: fonts.inter },
  countdownLine: {
    textAlign: 'center',
    fontSize: 11,
    color: C.mute,
    marginTop: 12,
    fontFamily: fonts.inter,
  },
  keptToast: {
    position: 'absolute',
    bottom: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  keptDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.glow },
  keptText: { fontSize: 13, color: C.bone, fontFamily: fonts.inter },
  keptAside: {
    fontSize: 13,
    color: C.dusk,
    fontFamily: fonts.fraunces,
  },
});
