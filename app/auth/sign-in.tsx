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
import { sendEmailCode, verifyEmailCode } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';

type Stage = 'enter-email' | 'sending' | 'enter-code' | 'verifying';

const RESEND_COOLDOWN = 30; // seconds

export default function SignIn() {
  const router = useRouter();
  const setOfflineMode = useUserStore((s) => s.setOfflineMode);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('enter-email');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<TextInput>(null);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // Cooldown ticker for resend.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const sendCode = async () => {
    if (!validEmail || stage === 'sending') return;
    Haptics.selectionAsync();
    setStage('sending');
    setError(null);
    try {
      await sendEmailCode(email);
      setStage('enter-code');
      setCooldown(RESEND_COOLDOWN);
      setTimeout(() => codeRef.current?.focus(), 100);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setStage('enter-email');
      setError(e instanceof Error ? e.message : 'Something went wrong');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const verify = async (token: string) => {
    if (stage === 'verifying') return;
    Haptics.selectionAsync();
    setStage('verifying');
    setError(null);
    try {
      await verifyEmailCode(email, token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The auth-state listener in app/_layout.tsx routes us on session change.
    } catch (e) {
      setStage('enter-code');
      setCode('');
      setError(
        e instanceof Error ? e.message : "That code didn't match. Try again.",
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const onCodeChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) void verify(cleaned);
  };

  const stayOffline = () => {
    Haptics.selectionAsync();
    setOfflineMode(true);
    router.replace('/(tabs)');
  };

  const goBackToEmail = () => {
    Haptics.selectionAsync();
    setCode('');
    setError(null);
    setStage('enter-email');
  };

  return (
    <Screen scroll={false} style={styles.outer}>
      <View style={styles.illustration}>
        <CozyWindow size={160} />
      </View>

      <Text style={styles.eyebrow}>· LUMI ·</Text>

      {stage === 'enter-email' || stage === 'sending' ? (
        <>
          <Text style={styles.h1}>
            Come <Text style={styles.italic}>in.</Text>
          </Text>
          <Text style={styles.sub}>
            Sign in or make an account — same warm door, either way.
          </Text>

          <View style={styles.form}>
            <Text style={styles.fieldLabel}>YOUR EMAIL</Text>
            <TextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (error) setError(null);
              }}
              placeholder="hello@example.com"
              placeholderTextColor={colors.text3}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={isSupabaseConfigured && stage !== 'sending'}
              onSubmitEditing={sendCode}
              returnKeyType="send"
            />
            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              onPress={sendCode}
              disabled={
                !validEmail || !isSupabaseConfigured || stage === 'sending'
              }
              style={({ pressed }) => [
                styles.btn,
                (!validEmail || !isSupabaseConfigured || stage === 'sending') &&
                  styles.btnDisabled,
                pressed && { transform: [{ translateY: 1 }] },
              ]}
            >
              {stage === 'sending' ? (
                <ActivityIndicator color={colors.cream} />
              ) : (
                <Text style={styles.btnText}>Send me a code  ✦</Text>
              )}
            </Pressable>

            <Text style={styles.fineprint}>
              New here? You'll get{' '}
              <Text style={styles.fineStrong}>7 days free</Text> after we verify
              your code. No password to remember. Cancel anytime.
            </Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.h1}>
            Six little <Text style={styles.italic}>digits.</Text>
          </Text>
          <Text style={styles.sub}>
            We sent a code to{'\n'}
            <Text style={styles.subEmail}>{email}</Text>
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

            {/* Invisible input behind the cells captures keystrokes + paste. */}
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
              <Pressable onPress={goBackToEmail} disabled={stage === 'verifying'}>
                <Text style={styles.linkText}>← Wrong email</Text>
              </Pressable>
              <Pressable
                onPress={sendCode}
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
              Check your inbox — and spam, just in case. The code expires in 10
              minutes.
            </Text>
          </View>
        </>
      )}

      {!isSupabaseConfigured && (
        <Pressable onPress={stayOffline} style={styles.devSkip}>
          <Text style={styles.devSkipText}>Skip · dev mode only</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  outer: { paddingTop: 8 },
  illustration: { alignItems: 'center', marginTop: 8, marginBottom: 18 },
  eyebrow: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 12,
  },
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 40,
    lineHeight: 44,
    textAlign: 'center',
    marginBottom: 8,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.caramel },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  subEmail: {
    fontFamily: fonts.sansSemi,
    color: colors.cream,
  },
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
    marginBottom: 6,
  },
  error: {
    fontFamily: fonts.sansItalic,
    color: colors.rose,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 6,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 18,
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
    marginTop: 18,
    paddingHorizontal: 8,
  },
  fineStrong: {
    fontFamily: fonts.sansSemi,
    color: colors.caramel,
    fontStyle: 'normal',
  },
  // ── code entry ─────────────────────────────────────────
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
  devSkip: { marginTop: 18, alignSelf: 'center', paddingVertical: 8 },
  devSkipText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 12,
  },
});
