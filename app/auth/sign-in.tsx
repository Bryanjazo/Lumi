import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaPixel, LunaMood } from '../../components/auth/LunaPixel';
import { AuthField } from '../../components/auth/AuthField';
import { AuthButton } from '../../components/auth/AuthButton';
import { signIn } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';

type Errors = Partial<{
  email: string;
  pass: string;
  submit: string;
}>;

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setOfflineMode = useUserStore((s) => s.setOfflineMode);

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);

  const lunaMood: LunaMood = email.includes('@') ? 'happy' : 'idle';

  const validate = (): Errors => {
    const e: Errors = {};
    if (!email.includes('@')) e.email = 'Check your email address';
    if (!pass) e.pass = 'Password is required';
    return e;
  };

  const handleSubmit = async () => {
    Haptics.selectionAsync();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    try {
      await signIn(email, pass);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setErrors({
        submit:
          err instanceof Error && /invalid login/i.test(err.message)
            ? "That email + password didn't match."
            : err instanceof Error
              ? err.message
              : 'Wrong email or password',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = (provider: 'apple' | 'google') => {
    Haptics.selectionAsync();
    Alert.alert(
      `${provider === 'apple' ? 'Apple' : 'Google'} sign-in`,
      'Coming soon. For now, use your email and password.',
    );
  };

  const skipOffline = () => {
    Haptics.selectionAsync();
    setOfflineMode(true);
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View
          style={[
            styles.body,
            { paddingBottom: Math.max(insets.bottom + 16, 24) },
          ]}
        >
          <View style={styles.lunaArea}>
            <View style={styles.lunaGlow} />
            <LunaPixel mood={lunaMood} size={80} />
            <Text selectable={false} style={styles.kicker}>
              L U M I
            </Text>
            <Text selectable={false} style={styles.greeting}>
              Welcome back.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.shimmer} />
            <Text style={styles.cardTitle}>Log in</Text>

            <AuthButton
              variant="social"
              icon="🍎"
              onPress={() => handleSocial('apple')}
            >
              Continue with Apple
            </AuthButton>
            <AuthButton
              variant="social"
              icon="G"
              onPress={() => handleSocial('google')}
            >
              Continue with Google
            </AuthButton>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or log in with email</Text>
              <View style={styles.dividerLine} />
            </View>

            <AuthField
              label="Email"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (errors.email || errors.submit) setErrors({});
              }}
              placeholder="you@example.com"
              keyboardType="email-address"
              error={errors.email}
              autoComplete="email"
              textContentType="emailAddress"
            />
            <AuthField
              label="Password"
              value={pass}
              onChangeText={(v) => {
                setPass(v);
                if (errors.pass || errors.submit) setErrors({});
              }}
              placeholder="Your password"
              secureTextEntry
              error={errors.pass}
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={handleSubmit}
              returnKeyType="go"
            />

            <Pressable
              style={styles.forgotWrap}
              onPress={() => router.push('/auth/forgot-password')}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>

            {errors.submit && (
              <Text style={styles.submitErr}>{errors.submit}</Text>
            )}

            <AuthButton
              onPress={handleSubmit}
              loading={loading}
              disabled={!isSupabaseConfigured}
            >
              Log in
            </AuthButton>

            <View style={styles.switchRow}>
              <Text style={styles.switchText}>New here? </Text>
              <Pressable onPress={() => router.push('/auth/sign-up')}>
                <Text style={styles.switchLink}>Create account</Text>
              </Pressable>
            </View>

            {!isSupabaseConfigured && (
              <Pressable onPress={skipOffline} style={styles.skip}>
                <Text style={styles.skipText}>Skip · dev mode only</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  lunaArea: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
    position: 'relative',
  },
  lunaGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(176,102,74,0.08)',
    top: -28,
  },
  kicker: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 4,
    color: colors.terra,
    opacity: 0.7,
    marginTop: 10,
    ...(({ userSelect: 'none' } as object) as object),
  },
  greeting: {
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    color: colors.cream,
    marginTop: 4,
  },
  card: {
    flex: 1,
    marginTop: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(201,160,106,0.2)',
  },
  cardTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    color: colors.text,
    marginBottom: 14,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
  },
  forgotWrap: { alignItems: 'flex-end', marginBottom: 12, marginTop: -2 },
  forgotText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.terra,
  },
  submitErr: {
    fontFamily: fonts.sansItalic,
    fontSize: 12,
    color: colors.err,
    marginBottom: 10,
    textAlign: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 6,
  },
  switchText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.text3,
  },
  switchLink: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.terra,
  },
  skip: { marginTop: 8, alignItems: 'center' },
  skipText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 11,
  },
});
