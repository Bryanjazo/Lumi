// AuthDoor — Lumi's one warm door, two modes.
//
// Replaces the boxy sign-in / sign-up cards with the mock
// (`lumi-auth.jsx`): radial ember wash, Luna centered with a soft
// breathing glow, Fraunces italic title, social-first row, inline
// icon fields with ember-focus borders, and a single bottom toggle
// that flips between signup ↔ signin in place — no navigation, so
// the user never feels they "left" the door.
//
// Color law: ember = the user's actions (CTA, focus, links); dusk =
// Lumi's voice (the kicker line above the title).
//
// Wiring preserved from the previous screens: signUp/signIn, name
// → userStore on signup, isSupabaseConfigured skip-offline path,
// router.replace('/auth/done') after sign-up, Forgot password
// route, pretty error mapping, haptics.

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ScrollView,
  Alert,
  Animated,
  Easing,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, {
  Circle,
  Defs,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { colors, timeColors as TC } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaPixel } from './LunaPixel';
import {
  signIn,
  signUp,
  signInWithApple,
  signInWithGoogle,
  GOOGLE_CANCELLED,
} from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';

export type AuthMode = 'signin' | 'signup';

interface Props {
  initialMode: AuthMode;
}

type FocusKey = 'name' | 'email' | 'pw' | null;

type Errors = Partial<{
  name: string;
  email: string;
  pass: string;
  submit: string;
}>;

const prettySignUpError = (raw: string): string => {
  if (/already registered/i.test(raw))
    return 'An account with that email exists — try Sign in.';
  if (/weak password/i.test(raw)) return 'Password is too short or too common.';
  if (/email rate/i.test(raw))
    return 'Email rate limit hit. Try again in an hour, or use a + alias.';
  return raw;
};

const prettySignInError = (raw: string): string => {
  if (/invalid login/i.test(raw)) return "That email + password didn't match.";
  return raw;
};

// ── Inline icons (stroke-only, matches mock) ───────────────────────
const MailIcon = ({ color }: { color: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Rect
      x={3}
      y={5}
      width={18}
      height={14}
      rx={2.5}
      stroke={color}
      strokeWidth={1.7}
    />
    <Path
      d="M4 7l8 5.5L20 7"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const LockIcon = ({ color }: { color: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Rect
      x={4.5}
      y={10.5}
      width={15}
      height={9.5}
      rx={2.5}
      stroke={color}
      strokeWidth={1.7}
    />
    <Path
      d="M8 10.5V8a4 4 0 0 1 8 0v2.5"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
    />
  </Svg>
);

const UserIcon = ({ color }: { color: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={8.4} r={3.6} stroke={color} strokeWidth={1.7} />
    <Path
      d="M5.5 19.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
    />
  </Svg>
);

// Apple glyph (filled, monochrome — sits on bone background)
const AppleGlyph = ({ color }: { color: string }) => (
  <Svg width={16} height={18} viewBox="0 0 24 24">
    <Path
      fill={color}
      d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.15-2.8.85-3.5.85-.7 0-1.9-.83-3.1-.8-1.6.02-3 .93-3.8 2.35-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.35 1.2-.05 1.6-.75 3-.75s1.8.75 3 .73c1.2-.02 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.2-2.6-.03-.01-2.4-.92-2.4-3.6zM14.2 5.3c.65-.8 1.1-1.9.97-3-.95.04-2.1.63-2.8 1.42-.6.7-1.1 1.8-1 2.85 1.05.08 2.1-.53 2.8-1.27z"
    />
  </Svg>
);

const GoogleGlyph = () => (
  <Svg width={16} height={16} viewBox="0 0 24 24">
    <Path
      fill="#E0A488"
      d="M21.6 12.2c0-.7-.06-1.2-.18-1.8H12v3.3h5.5c-.1.9-.7 2.2-2 3.1l-.02.12 2.9 2.2.2.02c1.85-1.7 2.9-4.2 2.9-7.2z"
    />
    <Path
      fill="#ECE0CB"
      d="M12 22c2.6 0 4.8-.86 6.4-2.34l-3.06-2.36c-.82.57-1.9.97-3.34.97-2.55 0-4.7-1.68-5.47-4l-.11.01-3 2.32-.04.1C4.96 19.6 8.2 22 12 22z"
    />
    <Path
      fill="#869072"
      d="M6.53 14.27c-.2-.6-.32-1.24-.32-1.9s.12-1.3.31-1.9l-.005-.13-3.04-2.36-.1.05A9.9 9.9 0 0 0 2.3 12.37c0 1.6.39 3.1 1.07 4.43l3.16-2.45z"
    />
    <Path
      fill="#E07A4F"
      d="M12 6.5c1.8 0 3 .78 3.7 1.43l2.7-2.64C16.8 3.7 14.6 2.8 12 2.8 8.2 2.8 4.96 5.2 3.37 8.5l3.15 2.45C7.3 8.62 9.45 6.5 12 6.5z"
    />
  </Svg>
);

// ── One field row ─────────────────────────────────────────────────
interface FieldProps {
  icon: 'mail' | 'lock' | 'user';
  label: string;
  value: string;
  onChange: (v: string) => void;
  focusKey: NonNullable<FocusKey>;
  focus: FocusKey;
  setFocus: (k: FocusKey) => void;
  placeholder?: string;
  secure?: boolean;
  showSecure?: boolean;
  onToggleSecure?: () => void;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  hasError?: boolean;
}

const Field = ({
  icon,
  label,
  value,
  onChange,
  focusKey,
  focus,
  setFocus,
  placeholder,
  secure,
  showSecure,
  onToggleSecure,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  hasError,
}: FieldProps) => {
  const on = focus === focusKey;
  const iconColor = on ? TC.ember : TC.mute;
  const borderColor = hasError
    ? colors.err
    : on
      ? TC.ember
      : TC.hair;
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldRow, { borderColor }]}>
        <View style={styles.fieldIcon}>
          {icon === 'mail' && <MailIcon color={iconColor} />}
          {icon === 'lock' && <LockIcon color={iconColor} />}
          {icon === 'user' && <UserIcon color={iconColor} />}
        </View>
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocus(focusKey)}
          onBlur={() => setFocus(null)}
          placeholder={placeholder}
          placeholderTextColor={TC.mute}
          style={styles.fieldInput}
          secureTextEntry={secure && !showSecure}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={false}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
        />
        {secure && (
          <Pressable
            onPress={onToggleSecure}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.fieldTrailing}>
              {showSecure ? 'hide' : 'show'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

// ── Soft breathing glow behind Luna ───────────────────────────────
const LunaGlow = () => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.75)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.12,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.75,
            duration: 1700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.lunaGlowWrap, { transform: [{ scale }], opacity }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="lunaGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#F4C98A" stopOpacity="0.32" />
            <Stop offset="0.7" stopColor="#F4C98A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="url(#lunaGlow)"
        />
      </Svg>
    </Animated.View>
  );
};

// ── Top ember wash (radial gradient behind everything) ────────────
const EmberWash = () => (
  <View pointerEvents="none" style={styles.washWrap}>
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id="emberWash" cx="50%" cy="0%" r="80%">
          <Stop offset="0" stopColor={TC.ember} stopOpacity="0.13" />
          <Stop offset="0.55" stopColor={TC.ember} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="url(#emberWash)"
      />
    </Svg>
  </View>
);

// ══════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════
export const AuthDoor = ({ initialMode }: Props) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setName_ = useUserStore((s) => s.setName);
  const setOfflineMode = useUserStore((s) => s.setOfflineMode);

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [focus, setFocus] = useState<FocusKey>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);

  const isUp = mode === 'signup';
  const ready =
    email.trim().includes('@') &&
    pw.length >= 4 &&
    (!isUp || name.trim().length > 0);

  const clearOn = (k: keyof Errors) => {
    if (errors[k] || errors.submit) {
      setErrors((prev) => ({ ...prev, [k]: undefined, submit: undefined }));
    }
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (isUp && !name.trim()) e.name = 'We need something to call you';
    if (!email.includes('@')) e.email = "That doesn't look like an email";
    if (isUp ? pw.length < 8 : pw.length === 0) {
      e.pass = isUp ? 'At least 8 characters' : 'Password is required';
    }
    return e;
  };

  const handleSubmit = async () => {
    Haptics.selectionAsync();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    try {
      if (isUp) {
        setName_(name.trim());
        await signUp(email, pw);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace('/auth/done' as never);
      } else {
        await signIn(email, pw);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Something went wrong';
      setErrors({
        submit: isUp ? prettySignUpError(raw) : prettySignInError(raw),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = async (provider: 'apple' | 'google') => {
    Haptics.selectionAsync();
    setErrors({});
    setLoading(true);
    try {
      const { fullName } =
        provider === 'apple'
          ? await signInWithApple()
          : await signInWithGoogle();
      // Apple/Google give us the name only on the very first sign-in.
      // When present, seed the userStore so the new account doesn't
      // land in onboarding with an empty greeting.
      if (fullName && !useUserStore.getState().name) {
        setName_(fullName);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Routing is handled by the session listener in _layout.tsx —
      // it'll bounce a new account to onboarding, an existing one
      // straight into (tabs).
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Something went wrong';
      // Silent cancellation paths — user backed out, don't show an
      // error banner. The Google flow throws the stable
      // GOOGLE_CANCELLED marker; Apple uses ERR_REQUEST_CANCELED.
      const cancelled =
        raw === GOOGLE_CANCELLED ||
        /canceled|cancelled|user cancel|ERR_REQUEST_CANCELED/i.test(raw);
      if (cancelled) {
        // silent
      } else {
        console.warn('[auth] social sign-in failed', provider, raw);
        setErrors({ submit: raw });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSkipOffline = () => {
    Haptics.selectionAsync();
    if (isUp && name.trim()) setName_(name.trim());
    setOfflineMode(true);
    router.replace('/(tabs)');
  };

  const switchMode = () => {
    Haptics.selectionAsync();
    setMode((m) => (m === 'signup' ? 'signin' : 'signup'));
    setFocus(null);
    setErrors({});
  };

  const kicker = isUp ? "Hi, I'm Lumi" : 'Welcome back';
  const title = isUp
    ? "Let's make your brain feel lighter."
    : 'Good to see you again.';
  const subtitle = isUp
    ? "Make a space that's just yours. It takes a minute, and I'll set it up around you."
    : "Pick up right where you left off — your pile's waiting, sorted.";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <EmberWash />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom + 18, 24) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Luna + greeting */}
          <View style={styles.hero}>
            <View style={styles.lunaWrap}>
              <LunaGlow />
              {/* INTENTIONAL EXCEPTION to the "always ambient" rule.
                  Sign-up / sign-in is Luna's *introduction* — first
                  impression for a brand-new user, calm re-entry for
                  a returning one. Showing a sad cat here because
                  someone is venting in their day, or a sleeping cat
                  because it's late, would frame the doorway as the
                  wrong mood. Keep Luna idle (gentle, present, ready)
                  on the auth door. Every screen INSIDE the app from
                  this point on reflects the user's real state. */}
              <LunaPixel size={96} mood="idle" />
            </View>
            <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          {/* Social row */}
          <View style={styles.socialRow}>
            <Pressable
              onPress={() => handleSocial('apple')}
              style={[styles.socialBtn, styles.appleBtn]}
            >
              <AppleGlyph color={TC.void} />
              <Text style={[styles.socialText, { color: TC.void }]}>
                Apple
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleSocial('google')}
              style={[styles.socialBtn, styles.googleBtn]}
            >
              <GoogleGlyph />
              <Text style={[styles.socialText, { color: TC.bone }]}>
                Google
              </Text>
            </Pressable>
          </View>

          {/* Defensive nudge — Lumi treats Google + email as separate
              accounts by default, so using the wrong button silently
              creates a fresh empty account. The visible reminder
              prevents most cases until the Supabase auto-link setting
              is enabled server-side. */}
          <Text style={styles.socialHint}>
            Use the same option you signed up with — Google and email
            are separate accounts.
          </Text>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or with email</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Fields */}
          <View style={{ gap: 14 }}>
            {isUp && (
              <Field
                icon="user"
                label="Your name"
                value={name}
                onChange={(v) => {
                  setName(v);
                  clearOn('name');
                }}
                focusKey="name"
                focus={focus}
                setFocus={setFocus}
                placeholder="what should Lumi call you?"
                autoCapitalize="words"
                autoComplete="name"
                hasError={!!errors.name}
              />
            )}
            <Field
              icon="mail"
              label="Email"
              value={email}
              onChange={(v) => {
                setEmail(v);
                clearOn('email');
              }}
              focusKey="email"
              focus={focus}
              setFocus={setFocus}
              placeholder="you@email.com"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              hasError={!!errors.email}
            />
            <Field
              icon="lock"
              label="Password"
              value={pw}
              onChange={(v) => {
                setPw(v);
                clearOn('pass');
              }}
              focusKey="pw"
              focus={focus}
              setFocus={setFocus}
              placeholder={isUp ? 'at least 8 characters' : 'your password'}
              secure
              showSecure={showPw}
              onToggleSecure={() => setShowPw((s) => !s)}
              autoComplete={isUp ? 'new-password' : 'current-password'}
              textContentType={isUp ? 'newPassword' : 'password'}
              returnKeyType={isUp ? 'next' : 'go'}
              onSubmitEditing={isUp ? undefined : handleSubmit}
              hasError={!!errors.pass}
            />
          </View>

          {/* Per-field error notes (rendered as one line so the form
              doesn't jump on the first miss) */}
          {(errors.name || errors.email || errors.pass) && (
            <Text style={styles.fieldErr}>
              {errors.name || errors.email || errors.pass}
            </Text>
          )}

          {/* Sign-in only: Forgot password */}
          {!isUp && (
            <Pressable
              onPress={() => router.push('/auth/forgot-password')}
              style={styles.forgotWrap}
              hitSlop={6}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          )}

          {/* Submit error */}
          {errors.submit && (
            <Text style={styles.submitErr}>{errors.submit}</Text>
          )}

          {/* Primary CTA */}
          <Pressable
            onPress={handleSubmit}
            disabled={!ready || loading || !isSupabaseConfigured}
            style={[
              styles.cta,
              ready && isSupabaseConfigured
                ? styles.ctaActive
                : styles.ctaInactive,
              { marginTop: isUp ? 22 : 18 },
            ]}
          >
            <Text
              style={[
                styles.ctaText,
                ready && isSupabaseConfigured
                  ? { color: TC.void }
                  : { color: TC.mute },
              ]}
            >
              {loading
                ? isUp
                  ? 'Creating…'
                  : 'Signing in…'
                : isUp
                  ? 'Create my space →'
                  : 'Sign in →'}
            </Text>
          </Pressable>

          {/* Terms */}
          {isUp && (
            <Text style={styles.terms}>
              By continuing you agree to Lumi&apos;s{' '}
              <Text style={styles.termsLink}>Terms</Text> &{' '}
              <Text style={styles.termsLink}>Privacy</Text>. Your thoughts
              stay yours.
            </Text>
          )}

          {/* Mode toggle */}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>
              {isUp ? 'Already have a space? ' : 'New here? '}
            </Text>
            <Pressable onPress={switchMode} hitSlop={6}>
              <Text style={styles.toggleLink}>
                {isUp ? 'Sign in' : 'Create one'}
              </Text>
            </Pressable>
          </View>

          {/* Offline / dev-mode skip — kept for parity */}
          {!isSupabaseConfigured && (
            <Pressable onPress={handleSkipOffline} style={styles.skip}>
              <Text style={styles.skipText}>Skip · dev mode only</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════
// Styles
// ══════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: TC.void },

  washWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 380,
    zIndex: 0,
  },

  scroll: {
    paddingHorizontal: 26,
    paddingTop: 32,
  },

  // ── Hero (Luna + greeting) ──
  hero: {
    alignItems: 'center',
  },
  lunaWrap: {
    position: 'relative',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  lunaGlowWrap: {
    position: 'absolute',
    width: 160,
    height: 160,
    left: -20,
    top: -20,
  },
  kicker: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 3,
    color: TC.dusk,
    marginBottom: 11,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 29,
    color: TC.bone,
    letterSpacing: -0.6,
    lineHeight: 34,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.boneDim,
    lineHeight: 21,
    marginTop: 12,
    maxWidth: 290,
    textAlign: 'center',
  },

  // ── Social row ──
  socialRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 28,
  },
  socialBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 13,
    paddingVertical: 13,
    borderWidth: 1,
  },
  appleBtn: {
    backgroundColor: TC.bone,
    borderColor: TC.bone,
  },
  googleBtn: {
    backgroundColor: TC.void2,
    borderColor: TC.hair,
  },
  socialText: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
    letterSpacing: -0.1,
  },

  // ── Divider ──
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    marginBottom: 18,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: TC.hair },
  dividerText: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: TC.mute,
    letterSpacing: 0.3,
  },
  socialHint: {
    fontFamily: fonts.inter,
    fontSize: 10.5,
    color: TC.mute,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
    lineHeight: 15,
  },

  // ── Field ──
  fieldLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: TC.mute,
    marginBottom: 7,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: TC.void2,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  fieldIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.inter,
    fontSize: 15,
    color: TC.bone,
    letterSpacing: -0.1,
    paddingVertical: 0,
  },
  fieldTrailing: {
    fontFamily: fonts.interSemi,
    fontSize: 11.5,
    color: TC.mute,
  },
  fieldErr: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12,
    color: colors.err,
    marginTop: 10,
  },

  // ── Forgot ──
  forgotWrap: {
    alignSelf: 'flex-end',
    marginTop: 11,
  },
  forgotText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    color: TC.ember,
  },

  submitErr: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12.5,
    color: colors.err,
    marginTop: 12,
    textAlign: 'center',
  },

  // ── Primary CTA ──
  cta: {
    width: '100%',
    paddingVertical: 17,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaActive: {
    backgroundColor: TC.ember,
  },
  ctaInactive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: TC.hair,
  },
  ctaText: {
    fontFamily: fonts.interSemi,
    fontSize: 15,
    letterSpacing: 0.2,
  },

  // ── Terms ──
  terms: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: TC.mute,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 14,
  },
  termsLink: {
    color: TC.boneDim,
    textDecorationLine: 'underline',
  },

  // ── Bottom toggle ──
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginTop: 28,
  },
  toggleText: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.boneDim,
  },
  toggleLink: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 15,
    color: TC.ember,
  },

  skip: {
    marginTop: 16,
    alignItems: 'center',
  },
  skipText: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: TC.mute,
  },
});
