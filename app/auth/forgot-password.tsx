import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
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
import { LunaPixel } from '../../components/auth/LunaPixel';
import { AuthField } from '../../components/auth/AuthField';
import { AuthButton } from '../../components/auth/AuthButton';
import { requestPasswordReset } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    Haptics.selectionAsync();
    if (!email.includes('@')) {
      setError('Enter your email first');
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not send reset link',
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      <Pressable
        style={[styles.backBtn, { top: insets.top + 12 }]}
        onPress={() => router.back()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <View style={styles.lunaArea}>
        <View style={styles.lunaGlow} />
        <LunaPixel mood={sent ? 'happy' : 'idle'} size={100} />
        <Text style={styles.heading}>
          {sent ? 'Check your email.' : 'Reset password.'}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <View style={[styles.card, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.shimmer} />

          {sent ? (
            <View>
              <Text style={styles.sentIcon}>📬</Text>
              <Text style={styles.sentTitle}>We sent you a link</Text>
              <Text style={styles.sentBody}>
                Check{' '}
                <Text style={{ color: colors.text, fontFamily: fonts.sansSemi }}>
                  {email}
                </Text>{' '}
                for a password reset link.{'\n'}It expires in 15 minutes.
              </Text>
              <AuthButton onPress={() => router.replace('/auth/sign-in')}>
                Back to log in
              </AuthButton>
              <AuthButton
                variant="ghost"
                onPress={() => {
                  setSent(false);
                  setEmail('');
                }}
              >
                Try a different email
              </AuthButton>
            </View>
          ) : (
            <View>
              <Text style={styles.cardTitle}>Forgot your password?</Text>
              <Text style={styles.cardSub}>
                Enter your email and we'll send a reset link.
              </Text>
              <AuthField
                label="Email"
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (error) setError('');
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                error={error}
                autoComplete="email"
                textContentType="emailAddress"
              />
              <AuthButton
                onPress={handleSend}
                loading={loading}
                disabled={!isSupabaseConfigured}
              >
                Send reset link
              </AuthButton>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backBtn: { position: 'absolute', left: 20, zIndex: 10 },
  backText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.text3,
  },
  lunaArea: {
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 12,
    minHeight: 180,
    justifyContent: 'flex-end',
  },
  lunaGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(176,102,74,0.07)',
    top: 30,
  },
  heading: {
    fontFamily: fonts.serifItalic,
    fontSize: 20,
    color: colors.cream,
    marginTop: 10,
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
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
    marginBottom: 18,
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
    marginBottom: 24,
  },
});
