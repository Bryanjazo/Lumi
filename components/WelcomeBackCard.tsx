// Lumi · welcome back (emotional-model spec §2)
//
// After time away, Lumi is simply happy you're here — reading with
// your place saved, watching the window, or pouring tea. Never
// "you missed X". A small warm moment that dismisses on tap and
// disappears on the next app open anyway.

import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import * as Haptics from 'expo-haptics';

import { timeColors as C } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { lunaSource } from '../lib/luna-source';
import type { AwayStage } from '../lib/away';

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

// The pose per stage, from the art we actually have: reading = the
// settled grooming loop, window = calm idle, tea = the cozy sleep
// curl. All gentle — none read as hurt.
const STAGE_MOOD: Record<AwayStage, 'lick' | 'idle' | 'sleep'> = {
  reading: 'lick',
  window: 'idle',
  tea: 'sleep',
};

interface Props {
  stage: AwayStage;
  line: string;
  scene: string;
  lunaSkin: string;
  onDismiss: () => void;
}

export const WelcomeBackCard = ({
  stage,
  line,
  scene,
  lunaSkin,
  onDismiss,
}: Props) => (
  <Pressable
    onPress={() => {
      Haptics.selectionAsync();
      onDismiss();
    }}
    accessibilityRole="button"
    accessibilityLabel={`${scene}. ${line}`}
    accessibilityHint="tap to dismiss"
    style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
  >
    <View style={styles.edgeLight} />
    <Image
      source={lunaSource(STAGE_MOOD[stage], lunaSkin)}
      style={styles.cat}
      resizeMode="contain"
    />
    <View style={{ flex: 1 }}>
      <Text style={styles.scene}>{scene}</Text>
      <Text style={styles.line}>{line}</Text>
    </View>
    <Text style={styles.dismiss}>×</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: hexA(C.lichen, 0.3),
    backgroundColor: hexA(C.void2, 0.75),
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
    overflow: 'hidden',
  },
  edgeLight: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: hexA(C.lichen, 0.4),
  },
  cat: { width: 44, height: 44 },
  scene: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: C.lichenLt,
    marginBottom: 3,
  },
  line: {
    fontFamily: fonts.frauncesMed,
    fontSize: 14.5,
    lineHeight: 20,
    color: C.bone,
  },
  dismiss: {
    fontFamily: fonts.inter,
    fontSize: 18,
    color: C.mute,
    paddingHorizontal: 4,
  },
});
