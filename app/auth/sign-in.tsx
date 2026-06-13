import { useState } from 'react';
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
import { signInWithEmail } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';

type Stage = 'enter' | 'sending' | 'sent' | 'error';

export default function SignIn() {
  const router = useRouter();
  const setOfflineMode = useUserStore((s) => s.setOfflineMode);
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState<Stage>('enter');
  const [error, setError] = useState<string | null>(null);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const send = async () => {
    if (!validEmail || stage === 'sending') return;
    Haptics.selectionAsync();
    setStage('sending');
    setError(null);
    try {
      await signInWithEmail(email);
      setStage('sent');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : 'Something went wrong');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const stayOffline = () => {
    Haptics.selectionAsync();
    setOfflineMode(true);
    router.replace('/(tabs)');
  };

  return (
    <Screen scroll={false} style={styles.outer}>
      <View style={styles.illustration}>
        <CozyWindow size={160} />
      </View>

      <Text style={styles.eyebrow}>· LUMI ·</Text>
      <Text style={styles.h1}>
        Come <Text style={styles.italic}>in.</Text>
      </Text>
      <Text style={styles.sub}>
        Sign in or make an account — same warm door, either way.
      </Text>

      {stage === 'sent' ? (
        <View style={styles.sentCard}>
          <Text style={styles.sentGlyph}>✉</Text>
          <Text style={styles.sentH}>The letter is on its way.</Text>
          <Text style={styles.sentP}>
            Sent to <Text style={styles.sentEmail}>{email}</Text>.{'\n'}
            Tap it from this phone — it'll open Lumi and sign you in. If
            you're new, your account is made automatically.
          </Text>
          <Pressable
            onPress={() => setStage('enter')}
            style={styles.resend}
          >
            <Text style={styles.resendText}>↩  Use a different email</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>YOUR EMAIL</Text>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (stage === 'error') setStage('enter');
            }}
            placeholder="hello@example.com"
            placeholderTextColor={colors.text3}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={isSupabaseConfigured}
          />
          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={send}
            disabled={!validEmail || !isSupabaseConfigured || stage === 'sending'}
            style={({ pressed }) => [
              styles.btn,
              (!validEmail || !isSupabaseConfigured || stage === 'sending') && {
                opacity: 0.4,
              },
              pressed && { transform: [{ translateY: 1 }] },
            ]}
          >
            {stage === 'sending' ? (
              <ActivityIndicator color={colors.cream} />
            ) : (
              <Text style={styles.btnText}>Send me a link  ✦</Text>
            )}
          </Pressable>

          <Text style={styles.fineprint}>
            New here? You'll get{' '}
            <Text style={styles.fineStrong}>7 days free</Text> after you tap
            the link. No password to remember. Cancel anytime.
          </Text>
        </View>
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
    fontSize: 44,
    lineHeight: 48,
    textAlign: 'center',
    marginBottom: 8,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.caramel },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 26,
  },
  form: {},
  fieldLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  // Notebook-rule input: underline only, no harsh box
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
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 18,
    // soft warm shadow
    shadowColor: colors.caramel,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
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
  sentCard: {
    backgroundColor: colors.caramelBg,
    borderColor: colors.caramelBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
  },
  sentGlyph: {
    fontSize: 34,
    color: colors.caramel,
    marginBottom: 10,
  },
  sentH: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 10,
  },
  sentP: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 16,
  },
  sentEmail: { fontFamily: fonts.sansSemi, color: colors.cream },
  resend: { paddingVertical: 8 },
  resendText: {
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
