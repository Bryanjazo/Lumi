// WinBackSheet — the lapsed-subscriber welcome-back conversation
//
// When a paid subscription lapses (RC webhook flips the DB row, the
// sync flips local state) the user silently lands back on free. This
// is the ONE gentle acknowledgment: warm, no guilt, no lock. It fires
// once and only once per account (markWinBackSeen → winBackDue goes
// false forever), driven by `winBackDue` from useAccessStatus and
// gated in _layout so it never lands on a cold-start frame or over
// onboarding/auth.
//
// Reactivating a past payer is the cheapest revenue there is — but the
// copy still holds the line: free is the floor, nothing is taken away.
// "everything you did while you were away is safe" is literally true.
//
// Structure/animation mirror UpgradePromptSheet (the app's other
// bottom sheet), including the Reduce Motion handling.

import { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import { timeColors as TC } from '../constants/colors';
import { useUserStore } from '../store/userStore';
import { isReduceMotionEnabled } from '../lib/useReducedMotion';

export const WinBackSheet = ({ visible }: { visible: boolean }) => {
  const router = useRouter();
  const markWinBackSeen = useUserStore((s) => s.markWinBackSeen);

  // Pop-in animation on open. Refs, not per-render `new` — a re-render
  // while the sheet was open reset the values mid-animation.
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    if (isReduceMotionEnabled()) {
      // Reduce Motion — present the sheet already settled, no slide.
      translateY.setValue(0);
      opacity.setValue(1);
      return;
    }
    translateY.setValue(40);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
    // run once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  // BOTH paths mark the sheet seen — this is a one-shot forever. Once
  // seen, winBackDue can never be true again, so we never re-nag.
  const onSeePlans = () => {
    Haptics.selectionAsync();
    markWinBackSeen();
    router.push('/paywall');
  };
  const onDismiss = () => {
    Haptics.selectionAsync();
    markWinBackSeen();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <SafeAreaView style={styles.sheetWrap} edges={['bottom']}>
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY }], opacity }]}
          >
            <Text style={styles.eyebrow}>WELCOME BACK</Text>
            <Text style={styles.title}>the extras are right where you left them</Text>
            <Text style={styles.body}>
              everything you did while you were away is safe. want the
              extras back?
            </Text>

            <Pressable
              onPress={onSeePlans}
              style={[styles.primaryBtn, { backgroundColor: TC.ember }]}
              accessibilityRole="button"
              accessibilityLabel="See plans"
              accessibilityHint="Opens the subscription plans"
            >
              <Text style={styles.primaryBtnText}>see plans →</Text>
            </Pressable>

            <Pressable
              onPress={onDismiss}
              style={styles.secondaryBtn}
              accessibilityRole="button"
              accessibilityLabel="Not right now"
              accessibilityHint="Dismisses this and stays on free"
            >
              <Text style={styles.secondaryBtnText}>not right now</Text>
            </Pressable>
          </Animated.View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    backgroundColor: TC.void2,
    borderTopWidth: 1,
    borderColor: TC.hair,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 10,
  },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 3,
    color: TC.dusk,
    marginBottom: 11,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: TC.bone,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  body: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.boneDim,
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 18,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
    color: TC.void,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: TC.boneDim,
  },
});
