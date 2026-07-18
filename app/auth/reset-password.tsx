// Set-a-new-password screen — the missing half of "Forgot password?".
//
// The recovery email's deep link signs the user in with a temporary
// session (handleAuthDeepLink flags it, callback.tsx routes here).
// Until this screen existed, tapping the link just… signed you in
// once, password unchanged — a dead end the next time you were
// signed out. The root gate in _layout.tsx explicitly leaves this
// route alone so the form can't be yanked away mid-typing.

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaPixel } from '../../components/auth/LunaPixel';
import { AuthField } from '../../components/auth/AuthField';
import { AuthButton } from '../../components/auth/AuthButton';
import { updatePassword } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useAmbientLunaMood } from '../../lib/luna-mood';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [pw, setPw] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const ambient = useAmbientLunaMood();

  const handleSave = async () => {
    Haptics.selectionAsync();
    if (pw.length < 8) {
      setError('At least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await updatePassword(pw);
      setDone(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : 'Could not update password';
      // Supabase refuses a password identical to the current one, and
      // an expired recovery session comes back as an auth error —
      // translate both into a next step instead of a raw string.
      if (/same.*password|different from the old/i.test(raw)) {
        setError('That’s already your password — pick a new one.');
      } else if (/expired|invalid|missing/i.test(raw)) {
        setError(
          'This reset link has expired — request a fresh one from “Forgot password?”.',
        );
      } else {
        setError(raw);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
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
            <LunaPixel mood={done ? 'happy' : ambient} size={80} />
            <Text selectable={false} style={styles.heading}>
              {done ? 'All set.' : 'New password.'}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.shimmer} />

            {done ? (
              <View>
                <Text style={styles.sentIcon}>🔒</Text>
                <Text style={styles.sentTitle}>Password updated</Text>
                <Text style={styles.sentBody}>
                  You&apos;re signed in — the old password stops working
                  from now on.
                </Text>
                <AuthButton onPress={() => router.replace('/')}>
                  Take me in
                </AuthButton>
              </View>
            ) : (
              <View>
                <Text style={styles.cardTitle}>Pick a new password</Text>
                <Text style={styles.cardSub}>
                  You&apos;re signed in through the reset link — set the
                  new one and you&apos;re done.
                </Text>
                <AuthField
                  label="New password"
                  value={pw}
                  onChangeText={(v) => {
                    setPw(v);
                    if (error) setError('');
                  }}
                  placeholder="At least 8 characters"
                  secureTextEntry
                  error={error}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={handleSave}
                />
                <AuthButton
                  onPress={handleSave}
                  loading={loading}
                  disabled={!isSupabaseConfigured}
                >
                  Save new password
                </AuthButton>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgAuth },
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 30,
  },
  lunaArea: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 14,
    position: 'relative',
  },
  lunaGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(176,102,74,0.07)',
    top: -20,
  },
  heading: {
    fontFamily: fonts.serifItalic,
    fontSize: 22,
    color: colors.cream,
    marginTop: 12,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surfaceAuth,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    padding: 20,
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
    marginBottom: 5,
  },
  cardSub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text3,
    marginBottom: 16,
    lineHeight: 19,
  },
  sentIcon: { fontSize: 32, textAlign: 'center', marginBottom: 12 },
  sentTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  sentBody: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text2,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
});
