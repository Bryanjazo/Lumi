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
import { PasswordStrength } from '../../components/auth/PasswordStrength';
import { signUp } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';

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
      "We're wiring this up. For now, use email — it's just as fast.",
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
          {/* Luna area — compact, just enough to set the mood */}
          <View style={styles.lunaArea}>
            <View style={styles.lunaGlow} />
            <LunaPixel mood={lunaMood} size={80} />
            <Text style={styles.kicker}>LUMI</Text>
            <Text style={styles.greeting}>
              {name.trim() ? `Hi ${name.trim()} —` : "Let's get you started."}
            </Text>
          </View>

          {/* Card grows to fill */}
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
              <Text style={{ color: colors.terra }}>Privacy</Text>.
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
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const prettyError = (raw: string): string => {
  if (/already registered/i.test(raw))
    return 'An account with that email exists — try Log in.';
  if (/weak password/i.test(raw)) return 'Password is too short or too common.';
  if (/email rate/i.test(raw))
    return 'Email rate limit hit. Try again in an hour, or use a + alias.';
  return raw;
};

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
    fontSize: 9,
    letterSpacing: 3,
    color: colors.terra,
    opacity: 0.65,
    marginTop: 8,
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    color: colors.text,
    marginBottom: 2,
  },
  cardSub: { fontFamily: fonts.sans, fontSize: 11, color: colors.text3 },
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
    gap: 8,
    marginVertical: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
  },
  terms: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.text3,
    lineHeight: 15,
    marginBottom: 10,
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
    flexWrap: 'wrap',
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
