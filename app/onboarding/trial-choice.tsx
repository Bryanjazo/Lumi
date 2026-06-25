// Trial-choice — the calm, optional "7 days of Pro on us" offer
// shown ONCE right after onboarding (per
// lumi-monetization-model-spec-2.md §0).
//
// This is NOT a gate. Both buttons proceed into the app:
//   - "Start with 7 days of Pro" → startTrial() → /(tabs)
//   - "Just dive in free"        → /(tabs)
//
// Once dismissed the screen never re-shows; cap-hit prompts and the
// paywall pick up the upgrade conversation later. Free is always
// the floor — declining costs the user nothing.

import { useEffect, useRef } from 'react';
import {
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
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { fonts } from '../../constants/fonts';
import { timeColors as TC } from '../../constants/colors';
import { LunaPixel } from '../../components/auth/LunaPixel';
import { useAmbientLunaMood } from '../../lib/luna-mood';
import { useUserStore } from '../../store/userStore';
import { PRICING } from '../../lib/subscription';

const BENEFITS: { glyph: string; text: string }[] = [
  { glyph: '✦', text: 'Unlimited Untangle conversations' },
  { glyph: '◐', text: 'Unlimited smart capture + AI sorting' },
  { glyph: '◇', text: 'The full weekly recap narrative' },
  { glyph: '♡', text: 'Themes, deep insights, all unlocks' },
];

const LunaGlow = () => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.75)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.1,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.75,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.lunaGlowWrap, { transform: [{ scale }], opacity }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="trialLunaGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#F4C98A" stopOpacity="0.32" />
            <Stop offset="0.7" stopColor="#F4C98A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="url(#trialLunaGlow)"
        />
      </Svg>
    </Animated.View>
  );
};

const EmberWash = () => (
  <View pointerEvents="none" style={styles.washWrap}>
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id="trialEmberWash" cx="50%" cy="0%" r="80%">
          <Stop offset="0" stopColor={TC.ember} stopOpacity="0.14" />
          <Stop offset="0.55" stopColor={TC.ember} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="url(#trialEmberWash)"
      />
    </Svg>
  </View>
);

export default function TrialChoiceScreen() {
  const router = useRouter();
  const startTrial = useUserStore((s) => s.startTrial);
  const markTrialChoiceSeen = useUserStore((s) => s.markTrialChoiceSeen);
  const lunaMood = useAmbientLunaMood();

  const acceptTrial = () => {
    Haptics.selectionAsync();
    startTrial();
    markTrialChoiceSeen();
    router.replace('/(tabs)');
  };

  const declineTrial = () => {
    Haptics.selectionAsync();
    markTrialChoiceSeen();
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <EmberWash />

      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.lunaWrap}>
            <LunaGlow />
            <LunaPixel size={96} mood={lunaMood} />
          </View>
          <Text style={styles.kicker}>A LITTLE WELCOME GIFT</Text>
          <Text style={styles.title}>
            7 days of Pro Lumi — on me.
          </Text>
          <Text style={styles.subtitle}>
            See what unlimited feels like. No card, no charge. If it&apos;s
            not for you, you slide back to free — never locked, never
            nagged.
          </Text>
        </View>

        <View style={styles.benefitsCard}>
          {BENEFITS.map((b) => (
            <View key={b.text} style={styles.benefitRow}>
              <Text style={styles.benefitGlyph}>{b.glyph}</Text>
              <Text style={styles.benefitText}>{b.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.smallPrint}>
          After 7 days, Lumi stays free — full daily loop, capped AI.
          Upgrade to keep unlimited at {PRICING.annual.firstYearLabel}/yr
          (first year) or {PRICING.monthly.label}/mo.
        </Text>

        <Pressable
          onPress={acceptTrial}
          style={[styles.primaryBtn, { backgroundColor: TC.ember }]}
        >
          <Text style={styles.primaryBtnText}>
            Start 7 days of Pro →
          </Text>
        </Pressable>

        <Pressable onPress={declineTrial} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>
            Just dive in free — no rush
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: TC.void },
  washWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 380,
    zIndex: 0,
  },
  body: {
    flex: 1,
    paddingHorizontal: 26,
    paddingTop: 24,
    paddingBottom: 18,
  },

  hero: {
    alignItems: 'center',
    marginTop: 8,
  },
  lunaWrap: {
    position: 'relative',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  lunaGlowWrap: {
    position: 'absolute',
    width: 160,
    height: 160,
    left: -20,
    top: -20,
  },
  kicker: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 3,
    color: TC.dusk,
    marginBottom: 11,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    color: TC.bone,
    letterSpacing: -0.6,
    lineHeight: 34,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.boneDim,
    lineHeight: 21,
    marginTop: 12,
    maxWidth: 320,
    textAlign: 'center',
  },

  benefitsCard: {
    marginTop: 28,
    backgroundColor: TC.void2,
    borderWidth: 1,
    borderColor: TC.hair,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 12,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  benefitGlyph: {
    fontSize: 14,
    color: TC.dusk,
    width: 16,
    textAlign: 'center',
  },
  benefitText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.bone,
    letterSpacing: -0.1,
  },

  smallPrint: {
    marginTop: 18,
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: TC.mute,
    lineHeight: 17,
    textAlign: 'center',
  },

  primaryBtn: {
    marginTop: 22,
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 15,
    color: TC.void,
    letterSpacing: 0.2,
  },

  secondaryBtn: {
    marginTop: 12,
    borderRadius: 15,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 14,
    color: TC.boneDim,
  },
});
