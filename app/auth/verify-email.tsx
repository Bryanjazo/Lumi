// Verify-email screen — shown after signUp when Supabase withheld a
// session (email confirmations are ON in the dashboard). Waits for
// the user to click the link in their email; when Supabase's deep
// link fires, handleAuthDeepLink in app/_layout.tsx sets the
// session, useSession picks it up, and this screen navigates the
// user through to /auth/done.
//
// UX:
//   - Luna centered + soft breathing glow (reuses auth-door style)
//   - "Check your email" heading, address body
//   - Resend button (60s client-side cooldown to prevent spam;
//     Supabase throttles server-side too)
//   - "Wrong email? Change it" link → router.back() to AuthDoor

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { timeColors as TC } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaPixel } from '../../components/auth/LunaPixel';
import { resendConfirmation, useSession } from '../../lib/auth';

const RESEND_COOLDOWN_S = 60;

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const emailStr = typeof email === 'string' ? email : '';
  const { session } = useSession();

  const [cooldown, setCooldown] = useState(0);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.75)).current;

  // Auto-advance when the session lands — the deep link handler in
  // _layout.tsx will set it as soon as the user taps the email link.
  useEffect(() => {
    if (session) {
      router.replace('/auth/done' as never);
    }
  }, [session, router]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowScale, {
            toValue: 1.12,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 1,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(glowScale, {
            toValue: 1,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
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
  }, [glowScale, glowOpacity]);

  // Cooldown tick — decrement once a second, stop at 0.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0 || resendState === 'sending' || !emailStr) return;
    Haptics.selectionAsync();
    setResendState('sending');
    setErrorMsg(null);
    try {
      await resendConfirmation(emailStr);
      setResendState('sent');
      setCooldown(RESEND_COOLDOWN_S);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not resend';
      setResendState('error');
      setErrorMsg(raw);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleChangeEmail = () => {
    Haptics.selectionAsync();
    router.back();
  };

  const resendLabel =
    cooldown > 0
      ? `Resend in ${cooldown}s`
      : resendState === 'sending'
        ? 'Sending…'
        : resendState === 'sent'
          ? 'Sent — check your inbox'
          : 'Resend email';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />
      {/* Ember wash across the top */}
      <View pointerEvents="none" style={styles.washWrap}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="emberWash" cx="50%" cy="0%" r="80%">
              <Stop offset="0" stopColor={TC.ember} stopOpacity="0.13" />
              <Stop offset="0.55" stopColor={TC.ember} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="url(#emberWash)"
          />
        </Svg>
      </View>

      <View style={styles.content}>
        {/* Luna + glow */}
        <View style={styles.lunaWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.lunaGlow,
              { transform: [{ scale: glowScale }], opacity: glowOpacity },
            ]}
          >
            <Svg width="100%" height="100%">
              <Defs>
                <RadialGradient id="lunaGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#F4C98A" stopOpacity="0.32" />
                  <Stop offset="0.7" stopColor="#F4C98A" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill="url(#lunaGlow)"
              />
            </Svg>
          </Animated.View>
          <LunaPixel size={96} mood="idle" />
        </View>

        <Text style={styles.kicker}>ONE MORE STEP</Text>
        <Text style={styles.title}>Check your email.</Text>
        <Text style={styles.subtitle}>
          I sent a confirmation link to{' '}
          {emailStr ? (
            <Text style={styles.email}>{emailStr}</Text>
          ) : (
            <Text style={styles.email}>your inbox</Text>
          )}
          . Tap the link to finish setting up your space.
        </Text>

        {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

        <Pressable
          onPress={handleResend}
          disabled={cooldown > 0 || resendState === 'sending' || !emailStr}
          style={[
            styles.resendBtn,
            cooldown > 0 || resendState === 'sending' || !emailStr
              ? styles.resendBtnInactive
              : styles.resendBtnActive,
          ]}
          hitSlop={6}
        >
          <Text
            style={[
              styles.resendText,
              cooldown > 0 || resendState === 'sending' || !emailStr
                ? { color: TC.mute }
                : { color: TC.ember },
            ]}
          >
            {resendLabel}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleChangeEmail}
          style={styles.changeWrap}
          hitSlop={6}
        >
          <Text style={styles.changeText}>Wrong email? Change it</Text>
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
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  lunaWrap: {
    position: 'relative',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  lunaGlow: {
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
    marginTop: 18,
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 30,
    color: TC.bone,
    letterSpacing: -0.6,
    textAlign: 'center',
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: TC.boneDim,
    lineHeight: 21,
    marginTop: 14,
    maxWidth: 320,
    textAlign: 'center',
  },
  email: {
    color: TC.bone,
    fontFamily: fonts.interSemi,
  },
  errorText: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12.5,
    color: '#E07A4F',
    marginTop: 12,
    textAlign: 'center',
    maxWidth: 300,
  },
  resendBtn: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 220,
  },
  resendBtnActive: {
    borderColor: TC.ember,
    backgroundColor: 'transparent',
  },
  resendBtnInactive: {
    borderColor: TC.hair,
    backgroundColor: 'transparent',
  },
  resendText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    letterSpacing: 0.1,
  },
  changeWrap: {
    marginTop: 18,
    paddingVertical: 6,
  },
  changeText: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: TC.mute,
  },
});
