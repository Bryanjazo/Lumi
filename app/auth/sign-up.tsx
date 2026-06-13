import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaPixel, LunaMood } from '../../components/auth/LunaPixel';
import { AuthField } from '../../components/auth/AuthField';
import { AuthButton } from '../../components/auth/AuthButton';
import { PasswordStrength } from '../../components/auth/PasswordStrength';
import { signUp } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';
import { Alert } from 'react-native';

type Errors = Partial<{
  name: string;
  email: string;
  pass: string;
  submit: string;
}>;

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setName_ = useUserStore((s) => s.setName);
  const setOfflineMode = useUserStore((s) => s.setOfflineMode);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);

  const lunaMood: LunaMood = name.trim().length > 1 ? 'happy' : 'idle';

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'We need something to call you';
    if (!email.includes('@')) e.email = "That doesn't look like an email";
    if (pass.length < 8) e.pass = 'At least 8 characters';
    return e;
  };

  const handleSubmit = async () => {
    Haptics.selectionAsync();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    try {
      setName_(name.trim());
      await signUp(email, pass);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Skip directly to the celebratory Done screen; root layout will
      // still pick up the session change in the background.
      router.replace('/auth/done' as never);
    } catch (err) {
      setErrors({
        submit:
          err instanceof Error
            ? prettyError(err.message)
            : 'Something went wrong',
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
      "We're wiring this up. For now, use email — it's just as fast and we don't ask for a card.",
    );
  };

  const skipOffline = () => {
    Haptics.selectionAsync();
    if (name.trim()) setName_(name.trim());
    setOfflineMode(true);
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.lunaArea}>
        <View style={styles.lunaGlow} />
        <LunaPixel mood={lunaMood} size={110} />
        <View style={styles.lunaLabel}>
          <Text style={styles.kicker}>lumi</Text>
          <Text style={styles.greeting}>
            {name.trim() ? `Hi ${name.trim()} —` : "Let's get you started."}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.shimmer} />

            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Create account</Text>
                <Text style={styles.cardSub}>
                  Free to start · no card needed
                </Text>
              </View>
              <View style={styles.freePill}>
                <Text style={styles.freePillText}>✦ Free</Text>
              </View>
            </View>

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
              <Text style={styles.dividerText}>or sign up with email</Text>
              <View style={styles.dividerLine} />
            </View>

            <AuthField
              label="Your name"
              value={name}
              onChangeText={(v) => {
                setName(v);
                if (errors.name) setErrors({ ...errors, name: undefined });
              }}
              placeholder="First name"
              error={errors.name}
              autoCapitalize="words"
              autoComplete="name"
            />
            <AuthField
              label="Email"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (errors.email) setErrors({ ...errors, email: undefined });
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
                if (errors.pass) setErrors({ ...errors, pass: undefined });
              }}
              placeholder="Min 8 characters"
              secureTextEntry
              error={errors.pass}
              autoComplete="new-password"
              textContentType="newPassword"
            />
            <PasswordStrength password={pass} />

            {errors.submit && (
              <Text style={styles.submitErr}>{errors.submit}</Text>
            )}

            <Text style={styles.terms}>
              By creating an account you agree to our{' '}
              <Text style={{ color: colors.terra }}>Terms</Text> and{' '}
              <Text style={{ color: colors.terra }}>Privacy Policy</Text>.
            </Text>

            <AuthButton
              onPress={handleSubmit}
              loading={loading}
              disabled={!isSupabaseConfigured}
            >
              Create account
            </AuthButton>

            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Already have an account? </Text>
              <Pressable onPress={() => router.push('/auth/sign-in')}>
                <Text style={styles.switchLink}>Log in</Text>
              </Pressable>
            </View>

            {!isSupabaseConfigured && (
              <Pressable onPress={skipOffline} style={styles.skip}>
                <Text style={styles.skipText}>Skip · dev mode only</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const prettyError = (raw: string): string => {
  if (/already registered/i.test(raw))
    return 'An account with that email already exists — try Log in.';
  if (/weak password/i.test(raw))
    return 'Password is too short or too common.';
  if (/email rate/i.test(raw))
    return 'Hit the email rate limit. Try again in an hour, or use a + alias.';
  return raw;
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  lunaArea: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
    minHeight: 180,
    justifyContent: 'flex-end',
  },
  lunaGlow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(176,102,74,0.08)',
    top: 0,
  },
  lunaLabel: { alignItems: 'center', marginTop: 8 },
  kicker: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: colors.terra,
    opacity: 0.6,
    marginBottom: 3,
  },
  greeting: {
    fontFamily: fonts.serifItalic,
    fontSize: 18,
    color: colors.cream,
  },
  scroll: { padding: 18, paddingTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 22,
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  cardTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 18,
    color: colors.text,
    marginBottom: 2,
  },
  cardSub: { fontFamily: fonts.sans, fontSize: 12, color: colors.text3 },
  freePill: {
    backgroundColor: colors.terraBg,
    borderWidth: 1,
    borderColor: 'rgba(201,160,106,0.2)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  freePillText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    color: colors.terra,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 16,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
  },
  terms: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
    lineHeight: 17,
    marginBottom: 14,
  },
  submitErr: {
    fontFamily: fonts.sansItalic,
    fontSize: 12,
    color: colors.err,
    marginBottom: 12,
    textAlign: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  switchText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text3,
  },
  switchLink: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.terra,
  },
  skip: { marginTop: 14, alignItems: 'center' },
  skipText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 12,
  },
});
