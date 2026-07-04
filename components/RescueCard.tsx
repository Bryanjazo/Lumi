// Lumi · Rescue Mode (emotional-model spec §3)
//
// When life happened — days away, or a backlog that would otherwise
// greet the user as a wall of overdue — Home swaps its normal state
// for THIS: a warm reset with three doors. No task list, no counts,
// no red. The framing is "I'll take care of it", because the app
// genuinely can (auto-triage + the speak-to-Lumi engine).
//
//   🌱 Just one thing   → surface a single doable task, hide the rest
//   🧹 Clean up my tasks → auto-triage the backlog (keep/move/tuck)
//   🎙 Let me explain    → Untangle, primed for "life happened"

import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import * as Haptics from 'expo-haptics';

import { timeColors as C } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { lunaSource } from '../lib/luna-source';

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

interface Props {
  lunaSkin: string;
  onOneThing: () => void;
  onCleanUp: () => void;
  onExplain: () => void;
  /** "not now" — quietly return to the normal Home for today. */
  onDismiss: () => void;
}

const RescueButton = ({
  emoji,
  title,
  sub,
  onPress,
}: {
  emoji: string;
  title: string;
  sub: string;
  onPress: () => void;
}) => (
  <Pressable
    onPress={() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }}
    style={({ pressed }) => [styles.btn, pressed && { opacity: 0.75 }]}
  >
    <Text style={styles.btnEmoji}>{emoji}</Text>
    <View style={{ flex: 1 }}>
      <Text style={styles.btnTitle}>{title}</Text>
      <Text style={styles.btnSub}>{sub}</Text>
    </View>
    <Text style={styles.btnChevron}>›</Text>
  </Pressable>
);

export const RescueCard = ({
  lunaSkin,
  onOneThing,
  onCleanUp,
  onExplain,
  onDismiss,
}: Props) => (
  <View style={styles.card}>
    <View style={styles.edgeLight} />
    <View style={styles.head}>
      <Image
        source={lunaSource('idle', lunaSkin)}
        style={styles.cat}
        resizeMode="contain"
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>looks like life happened</Text>
        <Text style={styles.title}>
          Forget the backlog for a moment — I'll take care of it.
        </Text>
      </View>
    </View>
    <Text style={styles.ask}>What feels possible today?</Text>

    <RescueButton
      emoji="🌱"
      title="Just one thing"
      sub="One small, doable task. The rest can wait."
      onPress={onOneThing}
    />
    <RescueButton
      emoji="🧹"
      title="Clean up my tasks"
      sub="I'll keep what matters, move what can wait."
      onPress={onCleanUp}
    />
    <RescueButton
      emoji="🎙"
      title="Let me explain what's been going on"
      sub="Tell me everything — I'll sort it out."
      onPress={onExplain}
    />

    <Pressable onPress={onDismiss} hitSlop={8} style={styles.notNow}>
      <Text style={styles.notNowText}>show me everything as usual</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: hexA(C.honey, 0.28),
    backgroundColor: hexA(C.void2, 0.82),
    padding: 18,
    marginTop: 14,
    overflow: 'hidden',
  },
  edgeLight: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: hexA(C.honey, 0.4),
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cat: { width: 52, height: 52 },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: C.honey,
    marginBottom: 4,
  },
  title: {
    fontFamily: fonts.frauncesMed,
    fontSize: 17,
    lineHeight: 23,
    color: C.bone,
  },
  ask: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    marginTop: 12,
    marginBottom: 10,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: hexA(C.bone, 0.03),
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 8,
  },
  btnEmoji: { fontSize: 20 },
  btnTitle: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
    color: C.bone,
  },
  btnSub: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
    marginTop: 2,
  },
  btnChevron: { fontFamily: fonts.inter, fontSize: 20, color: C.mute },
  notNow: { alignSelf: 'center', marginTop: 14, padding: 4 },
  notNowText: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
    textDecorationLine: 'underline',
  },
});
