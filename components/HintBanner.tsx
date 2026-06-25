// Lumi · contextual hint banner.
//
// Architecture: lumi-onboarding-architecture §6.2.
// Lumi's voice (✦), one short line, single-tap × to dismiss. Persists
// dismissal via userStore.hintsSeen[] so a given key never re-renders
// after the user has seen it once. Never blocks an action — it's a
// caption, not a gate.

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMemo } from 'react';
import { fonts } from '../constants/fonts';
import { useUserStore } from '../store/userStore';
import { useAccent, accentFor, type Accent } from '../lib/theme';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

interface Props {
  /** Unique key persisted in userStore.hintsSeen. */
  hintKey: string;
  /** One-line hint copy. */
  children: React.ReactNode;
}

export const HintBanner = ({ hintKey, children }: Props) => {
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  const seen = useUserStore((s) => s.hintsSeen.includes(hintKey));
  const markHintSeen = useUserStore((s) => s.markHintSeen);
  const [visible, setVisible] = useState(!seen);
  const op = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(-8)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(op, {
        toValue: 1,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(ty, {
        toValue: 0,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, op, ty]);

  if (!visible || seen) return null;

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(op, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(ty, {
        toValue: -6,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      markHintSeen(hintKey);
    });
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        { opacity: op, transform: [{ translateY: ty }] },
      ]}
    >
      <Text style={styles.spark}>✦</Text>
      <Text style={styles.text}>{children}</Text>
      <Pressable onPress={dismiss} hitSlop={10} style={styles.dismissBtn}>
        <Text style={styles.dismiss}>×</Text>
      </Pressable>
    </Animated.View>
  );
};

const makeStyles = (accent: Accent) => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: `${accent.fg}55`,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 24,
    marginTop: 12,
  },
  spark: { color: accent.fg, fontSize: 13 },
  text: {
    flex: 1,
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  dismissBtn: { padding: 4 },
  dismiss: {
    fontSize: 18,
    color: C.mute,
    lineHeight: 18,
  },
});

const styles = makeStyles(accentFor('ember'));
