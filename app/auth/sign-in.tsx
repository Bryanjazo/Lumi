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
    <Screen>
      <View style={styles.head}>
        <Text style={styles.label}>SIGN IN</Text>
        <Text style={styles.h1}>
          Save your progress <Text style={styles.italic}>across devices.</Text>
        </Text>
        <Text style={styles.sub}>
          We'll email you a link. No password to remember.
        </Text>
      </View>

      {!isSupabaseConfigured && (
        <View style={styles.warn}>
          <Text style={styles.warnText}>
            Supabase isn't configured yet (no env vars). You can still keep
            using Lumi offline — your data stays on this device.
          </Text>
        </View>
      )}

      {stage === 'sent' ? (
        <View style={styles.sentCard}>
          <Text style={styles.sentTag}>CHECK YOUR INBOX</Text>
          <Text style={styles.sentH}>
            We sent a link to <Text style={styles.sentEmail}>{email}</Text>
          </Text>
          <Text style={styles.sentP}>
            Tap it from this phone. The app will open and sign you in.
          </Text>
          <Pressable
            onPress={() => setStage('enter')}
            style={styles.resend}
          >
            <Text style={styles.resendText}>Use a different email</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (stage === 'error') setStage('enter');
            }}
            placeholder="you@example.com"
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
            style={[
              styles.btn,
              (!validEmail || !isSupabaseConfigured || stage === 'sending') && {
                opacity: 0.4,
              },
            ]}
          >
            {stage === 'sending' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Send link</Text>
            )}
          </Pressable>
        </>
      )}

      {!isSupabaseConfigured && (
        <Pressable onPress={stayOffline} style={styles.offline}>
          <Text style={styles.offlineText}>Skip — dev mode only</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 30, marginBottom: 22 },
  label: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.8,
    marginBottom: 10,
  },
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
    marginBottom: 8,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.cream },
  sub: { fontFamily: fonts.sans, color: colors.text2, fontSize: 13 },
  warn: {
    backgroundColor: colors.caramelBg,
    borderColor: colors.caramelBorder,
    borderWidth: 1,
    borderRadius: 11,
    padding: 12,
    marginBottom: 16,
  },
  warnText: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border2,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 16,
    marginBottom: 14,
  },
  error: {
    fontFamily: fonts.sans,
    color: colors.rose,
    fontSize: 12,
    marginBottom: 10,
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 14,
    borderRadius: 100,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: fonts.sansSemi,
    color: '#fff',
    fontSize: 14,
  },
  sentCard: {
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1,
    borderRadius: 15,
    padding: 18,
  },
  sentTag: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  sentH: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 18,
    marginBottom: 8,
  },
  sentEmail: { color: colors.cream },
  sentP: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 14,
  },
  resend: {
    paddingVertical: 8,
  },
  resendText: {
    fontFamily: fonts.sansMedium,
    color: colors.plum,
    fontSize: 13,
  },
  offline: {
    marginTop: 22,
    alignItems: 'center',
    paddingVertical: 14,
  },
  offlineText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 13,
  },
});
