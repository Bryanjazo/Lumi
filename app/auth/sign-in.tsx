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
import { signIn, signUp } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';

type Mode = 'signin' | 'signup';
type Status = 'idle' | 'submitting';

export default function SignInScreen() {
  const router = useRouter();
  const setOfflineMode = useUserStore((s) => s.setOfflineMode);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const validPw = password.length >= 6;
  const canSubmit = validEmail && validPw && isSupabaseConfigured;

  const submit = async () => {
    if (!canSubmit || status === 'submitting') return;
    Haptics.selectionAsync();
    setStatus('submitting');
    setError(null);
    try {
      if (mode === 'signup') {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Root layout reroutes when the session change lands.
    } catch (e) {
      setStatus('idle');
      setError(prettyError(e));
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
        <CozyWindow size={150} />
      </View>

      <Text style={styles.eyebrow}>· LUMI ·</Text>

      <Text style={styles.h1}>
        {mode === 'signin' ? (
          <>
            Welcome <Text style={styles.italic}>back.</Text>
          </>
        ) : (
          <>
            Come <Text style={styles.italic}>in.</Text>
          </>
        )}
      </Text>
      <Text style={styles.sub}>
        {mode === 'signin'
          ? 'Sign in to keep Luna with you across devices.'
          : 'Make an account. Phone gets verified next.'}
      </Text>

      <View style={styles.modeRow}>
        <Pressable
          onPress={() => {
            if (mode !== 'signin') {
              Haptics.selectionAsync();
              setMode('signin');
              setError(null);
            }
          }}
          style={[styles.modeBtn, mode === 'signin' && styles.modeBtnActive]}
        >
          <Text style={[styles.modeText, mode === 'signin' && styles.modeTextActive]}>
            Sign in
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (mode !== 'signup') {
              Haptics.selectionAsync();
              setMode('signup');
              setError(null);
            }
          }}
          style={[styles.modeBtn, mode === 'signup' && styles.modeBtnActive]}
        >
          <Text style={[styles.modeText, mode === 'signup' && styles.modeTextActive]}>
            Create account
          </Text>
        </Pressable>
      </View>

      <View style={styles.form}>
        <Text style={styles.fieldLabel}>EMAIL</Text>
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
          autoComplete="email"
          editable={isSupabaseConfigured && status !== 'submitting'}
        />

        <Text style={[styles.fieldLabel, { marginTop: 18 }]}>PASSWORD</Text>
        <View style={styles.pwRow}>
          <TextInput
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (error) setError(null);
            }}
            placeholder={mode === 'signup' ? 'at least 6 characters' : '••••••••'}
            placeholderTextColor={colors.text3}
            style={[styles.input, styles.pwInput]}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            editable={isSupabaseConfigured && status !== 'submitting'}
            onSubmitEditing={submit}
            returnKeyType="go"
          />
          <Pressable onPress={() => setShowPw((s) => !s)} style={styles.eye}>
            <Text style={styles.eyeText}>{showPw ? 'hide' : 'show'}</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          onPress={submit}
          disabled={!canSubmit || status === 'submitting'}
          style={({ pressed }) => [
            styles.btn,
            (!canSubmit || status === 'submitting') && styles.btnDisabled,
            pressed && { transform: [{ translateY: 1 }] },
          ]}
        >
          {status === 'submitting' ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text style={styles.btnText}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}  ✦
            </Text>
          )}
        </Pressable>

        <Text style={styles.fineprint}>
          {mode === 'signup'
            ? "You'll land in your 7-day free trial right after."
            : 'Forgot your password? Reset link coming soon.'}
        </Text>
      </View>

      {!isSupabaseConfigured && (
        <Pressable onPress={stayOffline} style={styles.devSkip}>
          <Text style={styles.devSkipText}>Skip · dev mode only</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const prettyError = (e: unknown): string => {
  const raw = e instanceof Error ? e.message : 'Something went wrong';
  if (/invalid login/i.test(raw)) return "That email + password didn't match.";
  if (/already registered/i.test(raw))
    return 'An account with that email already exists — try Sign in.';
  if (/weak password/i.test(raw))
    return 'Password is too short or too common.';
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
    marginBottom: 18,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 100,
    padding: 4,
    marginBottom: 18,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 100,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: colors.plumBg,
  },
  modeText: {
    fontFamily: fonts.sansMedium,
    color: colors.text2,
    fontSize: 13,
  },
  modeTextActive: {
    color: colors.plum,
    fontFamily: fonts.sansSemi,
  },
  form: {},
  fieldLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  input: {
    borderBottomColor: colors.border2,
    borderBottomWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 2,
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 20,
  },
  pwRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  pwInput: { flex: 1 },
  eye: {
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  eyeText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 11,
    letterSpacing: 0.5,
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
  devSkip: { marginTop: 14, alignSelf: 'center', paddingVertical: 8 },
  devSkipText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 12,
  },
});
