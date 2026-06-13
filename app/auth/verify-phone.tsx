import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { CozyWindow } from '../../components/CozyWindow';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  enrollAndChallengePhone,
  reChallengePhone,
  verifyPhoneCode,
  signOut,
} from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';

type Stage = 'phone-enter' | 'sending' | 'code-enter' | 'verifying';

const RESEND_COOLDOWN = 30;

export default function VerifyPhone() {
  const router = useRouter();
  const setPhoneVerified = useUserStore((s) => s.setPhoneVerified);

  const [stage, setStage] = useState<Stage>('phone-enter');
  const [phone, setPhone] = useState('+1 ');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<TextInput>(null);

  // Strip everything but digits + leading '+'. Supabase wants E.164.
  const e164 = (() => {
    const cleaned = phone.replace(/[^\d+]/g, '');
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  })();
  const validPhone = /^\+\d{8,15}$/.test(e164);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const sendCode = async () => {
    if (!validPhone || stage === 'sending') return;
    Haptics.selectionAsync();
    setStage('sending');
    setError(null);
    try {
      const { factorId: fId, challengeId: cId } =
        await enrollAndChallengePhone(e164);
      setFactorId(fId);
      setChallengeId(cId);
      setStage('code-enter');
      setCooldown(RESEND_COOLDOWN);
      setTimeout(() => codeRef.current?.focus(), 100);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setStage('phone-enter');
      setError(prettyError(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const resend = async () => {
    if (!factorId || cooldown > 0 || stage === 'verifying') return;
    Haptics.selectionAsync();
    try {
      const cId = await reChallengePhone(factorId);
      setChallengeId(cId);
      setCooldown(RESEND_COOLDOWN);
    } catch (e) {
      setError(prettyError(e));
    }
  };

  const verify = async (token: string) => {
    if (!factorId || !challengeId) return;
    if (stage === 'verifying') return;
    Haptics.selectionAsync();
    setStage('verifying');
    setError(null);
    try {
      await verifyPhoneCode(factorId, challengeId, token);
      setPhoneVerified(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Root layout reroutes when phoneVerified flips.
      router.replace('/(tabs)');
    } catch (e) {
      setStage('code-enter');
      setCode('');
      setError(prettyError(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const onCodeChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) void verify(cleaned);
  };

  const cancel = async () => {
    Haptics.selectionAsync();
    await signOut();
    router.replace('/auth/sign-in');
  };

  const goBackToPhone = () => {
    Haptics.selectionAsync();
    setCode('');
    setError(null);
    setStage('phone-enter');
  };

  const onPhoneChange = (v: string) => {
    setPhone(v);
    if (error) setError(null);
  };

  return (
    <Screen scroll={false} style={styles.outer}>
      <View style={styles.illustration}>
        <CozyWindow size={150} cat={false} />
      </View>

      <Text style={styles.eyebrow}>· STEP 2 OF 2 ·</Text>

      {stage === 'phone-enter' || stage === 'sending' ? (
        <>
          <Text style={styles.h1}>
            One <Text style={styles.italic}>quick</Text> text.
          </Text>
          <Text style={styles.sub}>
            We'll send a 6-digit code to make sure it's really you.
          </Text>

          <View style={styles.form}>
            <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
            <TextInput
              value={phone}
              onChangeText={onPhoneChange}
              placeholder="+1 555 123 4567"
              placeholderTextColor={colors.text3}
              style={styles.input}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={isSupabaseConfigured && stage !== 'sending'}
              onSubmitEditing={sendCode}
              returnKeyType="send"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              onPress={sendCode}
              disabled={!validPhone || stage === 'sending' || !isSupabaseConfigured}
              style={({ pressed }) => [
                styles.btn,
                (!validPhone || stage === 'sending' || !isSupabaseConfigured) &&
                  styles.btnDisabled,
                pressed && { transform: [{ translateY: 1 }] },
              ]}
            >
              {stage === 'sending' ? (
                <ActivityIndicator color={colors.cream} />
              ) : (
                <Text style={styles.btnText}>Send code  ✦</Text>
              )}
            </Pressable>

            <Text style={styles.fineprint}>
              Format: <Text style={styles.fineStrong}>+1 555 123 4567</Text>{' '}
              (country code matters). Standard SMS rates apply on your end.
            </Text>
          </View>

          <Pressable onPress={cancel} style={styles.cancelLink}>
            <Text style={styles.cancelText}>← Use a different account</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.h1}>
            Six little <Text style={styles.italic}>digits.</Text>
          </Text>
          <Text style={styles.sub}>
            Sent to{'\n'}
            <Text style={styles.subEmail}>{e164}</Text>
          </Text>

          <View style={styles.form}>
            <Pressable onPress={() => codeRef.current?.focus()}>
              <View style={styles.codeRow}>
                {Array.from({ length: 6 }).map((_, i) => {
                  const ch = code[i];
                  const active = i === code.length;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.codeCell,
                        ch !== undefined && styles.codeCellFilled,
                        active && styles.codeCellActive,
                      ]}
                    >
                      <Text style={styles.codeChar}>{ch ?? ''}</Text>
                    </View>
                  );
                })}
              </View>
            </Pressable>

            <TextInput
              ref={codeRef}
              value={code}
              onChangeText={onCodeChange}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
              autoFocus
              style={styles.hiddenInput}
              editable={stage !== 'verifying'}
            />

            {error && <Text style={styles.error}>{error}</Text>}
            {stage === 'verifying' && (
              <View style={styles.verifyingRow}>
                <ActivityIndicator color={colors.plum} size="small" />
                <Text style={styles.verifyingText}>Letting you in…</Text>
              </View>
            )}

            <View style={styles.codeFooter}>
              <Pressable onPress={goBackToPhone} disabled={stage === 'verifying'}>
                <Text style={styles.linkText}>← Wrong number</Text>
              </Pressable>
              <Pressable
                onPress={resend}
                disabled={cooldown > 0 || stage === 'verifying'}
              >
                <Text
                  style={[
                    styles.linkText,
                    cooldown > 0 && { color: colors.text3 },
                  ]}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.fineprint}>
              SMS can take up to a minute. Check your messages.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

const prettyError = (e: unknown): string => {
  const raw = e instanceof Error ? e.message : 'Something went wrong';
  if (/sms provider/i.test(raw) || /not configured/i.test(raw))
    return "Phone auth isn't configured yet (Supabase → Auth → Phone).";
  if (/invalid/i.test(raw) && /code/i.test(raw))
    return "That code didn't match. Try again.";
  if (/rate/i.test(raw)) return 'Too many tries. Wait a minute and retry.';
  if (/invalid phone/i.test(raw))
    return 'That number doesn’t look right. Include the country code.';
  return raw;
};

const styles = StyleSheet.create({
  outer: { paddingTop: 4 },
  illustration: { alignItems: 'center', marginTop: 4, marginBottom: 14 },
  eyebrow: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 10,
  },
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 36,
    lineHeight: 40,
    textAlign: 'center',
    marginBottom: 6,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.caramel },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  subEmail: { fontFamily: fonts.sansSemi, color: colors.cream },
  form: {},
  fieldLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  input: {
    borderBottomColor: colors.border2,
    borderBottomWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 2,
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 22,
  },
  error: {
    fontFamily: fonts.sansItalic,
    color: colors.rose,
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 22,
    shadowColor: colors.caramel,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: {
    fontFamily: fonts.sansSemi,
    color: colors.cream,
    fontSize: 14,
    letterSpacing: 0.4,
  },
  fineprint: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  fineStrong: {
    fontFamily: fonts.sansSemi,
    color: colors.caramel,
    fontStyle: 'normal',
  },
  cancelLink: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 8,
  },
  cancelText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 12,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 6,
    marginBottom: 12,
  },
  codeCell: {
    flex: 1,
    aspectRatio: 0.78,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeCellFilled: {
    borderColor: colors.plumBorder,
    backgroundColor: colors.plumBg,
  },
  codeCellActive: {
    borderColor: colors.caramel,
    shadowColor: colors.caramel,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  codeChar: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 26,
    lineHeight: 30,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  verifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    marginTop: 10,
  },
  verifyingText: {
    fontFamily: fonts.sansItalic,
    color: colors.text2,
    fontSize: 13,
  },
  codeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  linkText: {
    fontFamily: fonts.sansMedium,
    color: colors.caramel,
    fontSize: 13,
  },
});
