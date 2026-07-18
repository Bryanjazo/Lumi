import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import { useUserStore } from '../store/userStore';

// Native SDKs are lazy-loaded so the app still boots in Expo Go
// (no native modules) and on platforms where they aren't available
// (web). Calls return a friendly error in those environments.
type AppleAuthMod = typeof import('expo-apple-authentication');
type GoogleSignInMod = typeof import('@react-native-google-signin/google-signin');

let _apple: AppleAuthMod | null = null;
const loadApple = (): AppleAuthMod | null => {
  if (_apple) return _apple;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _apple = require('expo-apple-authentication') as AppleAuthMod;
  } catch {
    // Native module not bundled (Expo Go).
  }
  return _apple;
};

let _google: GoogleSignInMod | null = null;
let _googleConfigured = false;
const loadGoogle = (): GoogleSignInMod | null => {
  if (_google) return _google;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _google = require('@react-native-google-signin/google-signin') as GoogleSignInMod;
  } catch {
    // Native module not bundled.
  }
  return _google;
};

const REDIRECT_PATH = 'auth/callback';
export const getRedirectUrl = () => Linking.createURL(REDIRECT_PATH);

const requireConfigured = () => {
  if (!isSupabaseConfigured) {
    throw new Error('Auth needs Supabase env vars. See .env.example.');
  }
};

// ── email + password ────────────────────────────────────────────────────

/**
 * Create a new account with email + password. Returns whether the
 * caller needs to wait for the user to click a confirmation link
 * before they're actually signed in.
 *
 *   { needsEmailConfirmation: true }  → Supabase created the user
 *     but withheld a session — the app should route to the
 *     verify-email screen and wait for the deep link.
 *   { needsEmailConfirmation: false } → session was created
 *     immediately (email confirmations disabled in dashboard);
 *     caller can route straight to onboarding / done.
 *
 * Whether Supabase issues a session depends on Authentication →
 * Settings → "Enable email confirmations". Confirmations ON is the
 * production-safe default — otherwise anyone can create an account
 * with a fake email and reach the app.
 */
export const signUp = async (
  email: string,
  password: string,
  name?: string,
): Promise<{ needsEmailConfirmation: boolean }> => {
  requireConfigured();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: getRedirectUrl(),
      // The handle_new_user trigger reads raw_user_meta_data->>'name'
      // when creating the users row — without this it always wrote ''.
      ...(name?.trim() ? { data: { name: name.trim() } } : {}),
    },
  });
  if (error) throw error;
  // Existing-account detection: with confirmations ON, Supabase
  // anti-enumeration returns a FAKE success for an email that
  // already has an account — same shape, no email sent, and the
  // user would sit on the verify screen waiting forever. The
  // fingerprint is an obfuscated user with an EMPTY identities
  // array. Surface the honest message instead.
  if (
    data.user &&
    Array.isArray(data.user.identities) &&
    data.user.identities.length === 0
  ) {
    // The anti-enumeration response can't tell us WHICH provider the
    // existing account uses — a Google-only user "trying sign-in"
    // with a password they never set would just loop on "didn't
    // match". Name the OAuth buttons too.
    throw new Error(
      'An account with this email already exists — try signing in, or use the Google/Apple button if that’s how you joined.',
    );
  }
  // No session AND we have a user → confirmation email was sent,
  // waiting for the click. No session AND no user → shouldn't
  // happen; treat as error.
  const needsEmailConfirmation = !data.session && !!data.user;
  return { needsEmailConfirmation };
};

/**
 * Re-send the signup confirmation email. Supabase throttles these
 * server-side (typically 1/min per address); we don't need to
 * enforce a client-side cooldown, but the UI does anyway to avoid
 * hammering the button.
 */
export const resendConfirmation = async (email: string): Promise<void> => {
  requireConfigured();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: getRedirectUrl() },
  });
  if (error) throw error;
};

// ── pending-confirmation credential stash ───────────────────────────
// In-memory ONLY (never persisted): after sign-up, the verify-email
// screen polls signIn with these so the moment the user clicks the
// confirmation link — on any device, any browser — the app signs
// itself in. Makes confirmation feel like "approved → you're in"
// even when the deep link never reaches us (desktop mail clients,
// missing redirect allow-list entries, etc.).
let pendingCreds: { email: string; password: string } | null = null;
export const stashPendingCredentials = (
  email: string,
  password: string,
): void => {
  pendingCreds = { email: email.trim().toLowerCase(), password };
};
export const clearPendingCredentials = (): void => {
  pendingCreds = null;
};
/**
 * One quiet sign-in attempt with the stashed credentials. Returns
 * true when a session was established (email now confirmed). Silent
 * on the expected failure (email not confirmed yet / creds missing).
 */
export const tryPendingSignIn = async (): Promise<boolean> => {
  if (!pendingCreds || !isSupabaseConfigured) return false;
  const { error } = await supabase.auth.signInWithPassword({
    email: pendingCreds.email,
    password: pendingCreds.password,
  });
  if (!error) {
    pendingCreds = null;
    return true;
  }
  return false;
};

export const signIn = async (
  email: string,
  password: string,
): Promise<void> => {
  requireConfigured();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
};

export const signOut = async (): Promise<void> => {
  // Sign-out completeness (security audit §5): push everything local
  // to the cloud FIRST, and only wipe the device copy when that push
  // succeeded — the wipe must never be the thing that destroys
  // unsynced work. If the push fails (offline, misconfigured), local
  // data stays: it's AES-encrypted at rest, and the cross-account
  // guard in _layout still wipes it before a DIFFERENT account can
  // see it.
  let pushed = false;
  try {
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
    const offline = useUserStore.getState().offlineMode;
    if (userId && isSupabaseConfigured && !offline) {
      const { pushAllNow } = await import('./sync');
      await pushAllNow(userId);
      pushed = true;
    }
  } catch {
    // fail-safe: keep local data
  }
  await supabase.auth.signOut();
  // The pull receipts describe a local store that's about to be wiped
  // (or already diverged). Leaving them set let a same-session
  // re-sign-in skip the fresh pull AND open the push gate against
  // post-wipe defaults — re-clobbering the cloud profile. Nobody is
  // signed in at this instant, so clearing everything is safe; the
  // next sign-in re-pulls and re-mints its own receipt.
  try {
    const { useSyncStatus } = await import('./sync');
    useSyncStatus.setState({ pulledFor: {}, petMergedFor: {} });
  } catch {
    // sync module unavailable (tests) — nothing to clear
  }
  if (pushed) {
    const { resetLocalUserData } = await import('./localData');
    resetLocalUserData();
  }
};

// ── Sign in with Apple ──────────────────────────────────────────────────
//
// Flow: native StoreKit-style sheet → Apple returns an identity token
// → Supabase exchanges it for a session via signInWithIdToken.
//
// Apple gives the user's full name and email ONLY on the very first
// sign-in. We capture them when present so the Supabase user row has a
// real email/name; on subsequent sign-ins these come back null and we
// rely on the existing row.
//
// REQUIRES: Sign in with Apple capability enabled on the App ID in
// Apple Developer Portal + Apple provider configured in Supabase Auth
// dashboard (Services ID, Team ID, Key ID, .p8 private key).

// Stable marker for a user-cancelled Apple sheet (see GOOGLE_CANCELLED).
export const APPLE_CANCELLED = 'APPLE_SIGNIN_CANCELLED';

export const signInWithApple = async (): Promise<{
  fullName: string | null;
}> => {
  requireConfigured();
  if (Platform.OS !== 'ios') {
    throw new Error('Sign in with Apple is only available on iOS.');
  }
  const Apple = loadApple();
  if (!Apple) {
    throw new Error(
      'Sign in with Apple needs the dev build — not available in Expo Go.',
    );
  }
  const available = await Apple.isAvailableAsync();
  if (!available) {
    throw new Error('Sign in with Apple isn’t available on this device.');
  }
  let credential;
  try {
    credential = await Apple.signInAsync({
      requestedScopes: [
        Apple.AppleAuthenticationScope.FULL_NAME,
        Apple.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    // Backing out of the Apple sheet throws ERR_REQUEST_CANCELED with
    // a generic message that doesn't match /cancel/i — normalize to a
    // stable marker (mirrors GOOGLE_CANCELLED) so the AuthDoor stays
    // silent instead of flashing a spurious error banner.
    const code = (e as { code?: string }).code;
    if (code === 'ERR_REQUEST_CANCELED') {
      throw new Error(APPLE_CANCELLED);
    }
    throw e;
  }
  if (!credential.identityToken) {
    throw new Error('Apple didn’t return an identity token — try again.');
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) {
    const msg = error.message ?? 'Apple sign-in failed';
    // Same "already registered under another provider" translation
    // the Google flow does — surfaces which method the user should
    // use instead of dumping a raw Supabase internal string.
    if (
      /already registered|identity.*exists|duplicate/i.test(msg) ||
      /email.*already/i.test(msg)
    ) {
      throw new Error(
        'That Apple ID’s email already has a Lumi account — sign in with the method you used before (email/password or Google).',
      );
    }
    throw error;
  }

  // Apple gives the name ONLY on the first sign-in for this Services
  // ID. Caller (sign-up flow) uses this to seed the userStore name.
  // Apple hands us the name exactly ONCE, client-side only — the
  // identity token carries no name claim, so the server row and auth
  // metadata would stay nameless forever. Persist it into metadata now
  // (best-effort) so reinstalls and the cross-account wipe's metadata
  // reseed can recover it.
  const appleName = credential.fullName
    ? [credential.fullName.givenName, credential.fullName.familyName]
        .filter(Boolean)
        .join(' ')
        .trim()
    : '';
  if (appleName) {
    try {
      await supabase.auth.updateUser({ data: { name: appleName } });
    } catch {
      // metadata write is a nice-to-have; the local store still has it
    }
  }
  const fullName = credential.fullName
    ? [credential.fullName.givenName, credential.fullName.familyName]
        .filter(Boolean)
        .join(' ')
        .trim() || null
    : null;
  return { fullName };
};

// ── Sign in with Google ─────────────────────────────────────────────────
//
// Flow: native Google sign-in sheet → returns an idToken → Supabase
// exchanges it for a session.
//
// SDK contract (@react-native-google-signin/google-signin v14):
//   const r = await GoogleSignin.signIn();
//   r.type === 'success'   → r.data = { idToken | null, user, scopes, serverAuthCode }
//   r.type === 'cancelled' → r.data = null
//
//   idToken can be null in success cases (rare, but documented).
//   When that happens, getTokens() is the explicit fallback.
//
// REQUIRES (all four; missing any one → silent failure on device):
//   1. EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in eas.json
//      (audience for Supabase idToken verification)
//   2. EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID in eas.json
//      (binds the iOS binary to a specific Cloud Console OAuth client)
//   3. Reversed iOS Client ID in app.json CFBundleURLSchemes
//      (so iOS knows how to route Google's callback URL back to the app)
//   4. Supabase → Auth → Providers → Google:
//      - Web Client ID + Secret pasted
//      - iOS Client ID in "Authorized Client IDs"
//      - "Skip nonce checks" toggled ON (native iOS flow has no nonce)

// Stable marker so the caller (AuthDoor) can silence cancellations
// without depending on the SDK's evolving error codes.
export const GOOGLE_CANCELLED = 'GOOGLE_SIGNIN_CANCELLED';

export const signInWithGoogle = async (): Promise<{
  fullName: string | null;
}> => {
  requireConfigured();
  const Google = loadGoogle();
  if (!Google) {
    throw new Error(
      'Sign in with Google needs the dev build — not available in Expo Go.',
    );
  }
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!webClientId) {
    throw new Error(
      'Google sign-in needs EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in eas.json.',
    );
  }
  if (Platform.OS === 'ios' && !iosClientId) {
    // Without iosClientId on iOS the SDK falls back to looking for
    // GoogleService-Info.plist — which we don't ship — and crashes
    // at signIn time with a cryptic "DEVELOPER_ERROR". Fail early.
    throw new Error(
      'Google sign-in needs EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID in eas.json.',
    );
  }
  if (!_googleConfigured) {
    Google.GoogleSignin.configure({
      webClientId,
      ...(iosClientId ? { iosClientId } : {}),
    });
    _googleConfigured = true;
  }
  if (Platform.OS === 'android') {
    await Google.GoogleSignin.hasPlayServices({
      showPlayServicesUpdateDialog: true,
    });
  }

  // ── Run signIn, normalize cancellation into a stable marker ──
  let signInResult: unknown;
  try {
    signInResult = await Google.GoogleSignin.signIn();
  } catch (raw) {
    const e = raw as { code?: string; message?: string };
    console.warn(
      '[google] signIn threw',
      e.code ?? '(no code)',
      e.message ?? '(no message)',
    );
    // SDK v14 raises native errors with codes:
    //   SIGN_IN_CANCELLED        — user backed out
    //   SIGN_IN_REQUIRED         — silent sign-in needed but no creds
    //   IN_PROGRESS              — duplicate call
    //   PLAY_SERVICES_NOT_AVAILABLE
    //   DEVELOPER_ERROR          — misconfigured OAuth client (iOS Client
    //                              ID mismatch, missing URL scheme, etc.)
    if (
      e.code === 'SIGN_IN_CANCELLED' ||
      /cancel/i.test(e.message ?? '')
    ) {
      throw new Error(GOOGLE_CANCELLED);
    }
    if (e.code === 'DEVELOPER_ERROR') {
      throw new Error(
        'Google rejected this app. Check that the iOS Client ID and ' +
          'bundle ID in Google Cloud Console match this build.',
      );
    }
    throw raw;
  }

  const r = signInResult as
    | { type: 'success'; data: { idToken: string | null; user: { name: string | null } } }
    | { type: 'cancelled'; data: null }
    | { idToken?: string; user?: { name?: string | null } }; // legacy shape, just in case

  // v14 wrapped cancellation
  if ((r as { type?: string }).type === 'cancelled') {
    throw new Error(GOOGLE_CANCELLED);
  }

  const successShape = r as {
    type?: 'success';
    data?: { idToken: string | null; user: { name: string | null } };
    // legacy
    idToken?: string;
    user?: { name?: string | null };
  };

  let idToken: string | null =
    successShape.data?.idToken ?? successShape.idToken ?? null;

  // Fallback: if signIn returned no idToken, ask the SDK for fresh
  // tokens. Documented edge case for v14.
  if (!idToken) {
    try {
      const tokens = await Google.GoogleSignin.getTokens();
      idToken = tokens.idToken ?? null;
    } catch (e) {
      console.warn('[google] getTokens fallback failed', e);
    }
  }
  if (!idToken) {
    throw new Error(
      'Google didn’t return an ID token. Try again, or use email sign-in.',
    );
  }

  // Wrap the Supabase exchange in its own try/catch so a network
  // hiccup or "audience mismatch" rejection becomes a clean thrown
  // error the AuthDoor can surface — not an UnhandledPromiseRejection
  // that bubbles out and bricks the JS thread.
  //
  // DUPLICATE-ACCOUNT NOTE: Supabase defaults treat email/password and
  // OAuth identities for the same email as SEPARATE users. So a user
  // who previously signed up with foo@gmail.com (password) and now
  // taps "Sign in with Google" using the same Gmail will get a brand-
  // new auth.users row with no data, while their old account sits
  // intact but inaccessible.
  //
  // The real fix lives in the Supabase dashboard:
  //   Authentication → Settings → "Allow Manual Linking"
  // OR enable "Link a new identity to an existing user account if the
  // email is already registered" if your dashboard version exposes it.
  // We instrument the post-sign-in user below so we can SEE in logs
  // when this is happening (created_at very close to now == fresh).
  let supabaseError: { message?: string } | null = null;
  let signedInUser: { id: string; email?: string; created_at?: string } | null =
    null;
  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    supabaseError = error ?? null;
    signedInUser = data?.user
      ? {
          id: data.user.id,
          email: data.user.email ?? undefined,
          created_at: data.user.created_at,
        }
      : null;
  } catch (e) {
    supabaseError = e as { message?: string };
  }
  if (supabaseError) {
    const msg = supabaseError.message ?? 'Supabase rejected the Google token';
    console.warn('[google] supabase signInWithIdToken failed', msg);
    // Translate common Supabase rejections into copy the user can
    // act on (vs. raw internal error strings).
    if (/audience|aud/i.test(msg)) {
      throw new Error(
        'Sign-in rejected — this build’s Google client doesn’t match the server. Update to the latest Lumi build.',
      );
    }
    // Supabase returns this when "Link identities" is DISABLED in
    // the dashboard AND the user's email is already registered under
    // a different provider (email/password or Apple). Message tells
    // the user which provider to use so they don't spin their
    // wheels.
    if (
      /already registered|identity.*exists|duplicate/i.test(msg) ||
      /email.*already/i.test(msg)
    ) {
      throw new Error(
        'That email already has a Lumi account — sign in with the method you used before (email/password or Apple).',
      );
    }
    throw new Error(msg);
  }

  // Instrument: log whether this looks like a fresh create. If
  // `created_at` is within the last 5 seconds of now, the Google
  // sign-in just minted a new row — almost always a sign the user
  // actually has an existing email/password account that Supabase
  // isn't linking. DEV-only, and no PII (id/email stay out of logs —
  // production console output can end up in device logs / crash
  // reports; security audit §1.4).
  if (__DEV__ && signedInUser) {
    const createdMs = signedInUser.created_at
      ? Date.parse(signedInUser.created_at)
      : NaN;
    const isFresh = !isNaN(createdMs) && Date.now() - createdMs < 5_000;
    console.log(
      '[google] supabase user',
      isFresh ? '(JUST CREATED — possible duplicate)' : '(returning)',
    );
  }

  const fullName =
    successShape.data?.user?.name ?? successShape.user?.name ?? null;
  return { fullName };
};

/**
 * Change the signed-in user's email. Supabase sends a confirmation
 * link to BOTH the old and new address; the user is still signed in
 * under the old email until they confirm the new one (so we don't
 * sign them out here). The profile screen surfaces a "check your
 * inbox" message after the call resolves.
 */
export const changeEmail = async (newEmail: string): Promise<void> => {
  requireConfigured();
  const { error } = await supabase.auth.updateUser({
    email: newEmail.trim().toLowerCase(),
  });
  if (error) throw error;
};

/**
 * Hard-delete the signed-in user's account on the server. Requires a
 * Supabase Edge Function named `delete-user` that calls
 * `auth.admin.deleteUser(userId)` (the client doesn't have that
 * permission on its own). On success, the auth row is gone and all
 * RLS-protected rows cascade-delete via the ON DELETE CASCADE
 * foreign keys in the data schema.
 *
 * The caller (profile screen) handles the local-store purge and
 * sign-out — this helper only owns the server side. If the function
 * isn't deployed yet, the caller falls back to local-only purge and
 * surfaces a "your data was cleared locally, ask us to delete it
 * server-side" message so the privacy promise is still honored.
 */
export const deleteAccount = async (): Promise<void> => {
  requireConfigured();
  const { data, error } = await supabase.functions.invoke('delete-user');
  if (error) {
    throw new Error(error.message || 'Server delete failed.');
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error));
  }
};

/**
 * Trigger Supabase's password-reset email. The recovery link comes back
 * via deep link → handleAuthDeepLink sets a temporary session → the app
 * can then call supabase.auth.updateUser({ password }) on a reset
 * screen, where callback.tsx routes to /auth/reset-password.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  requireConfigured();
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: getRedirectUrl() },
  );
  if (error) throw error;
};

// ── deep link fallback (for password-reset recovery links) ──────────────

// A recovery link signs the user in ONLY so they can set a new
// password — landing them in the app as if nothing happened left the
// forgotten password unchanged (the old dead-end). handleAuthDeepLink
// raises this flag BEFORE setSession (the session event races the
// return value); the callback screen consumes it and routes to
// /auth/reset-password instead of the tabs.
let pendingRecovery = false;
export const consumePendingPasswordRecovery = (): boolean => {
  const was = pendingRecovery;
  pendingRecovery = false;
  return was;
};

export const handleAuthDeepLink = async (url: string): Promise<boolean> => {
  // LOAD-BEARING: this whole path assumes the IMPLICIT auth flow
  // (supabase-js default; lib/supabase.ts sets no flowType). Implicit
  // links arrive as lumi://auth/callback#access_token=…&type=… — if
  // anyone ever sets flowType:'pkce', links become ?code=… with no
  // access_token and BOTH email confirmation AND password reset
  // silently die right here. Don't change the flow without rewriting
  // this handler.
  if (!url.includes('access_token')) return false;
  const parsed = Linking.parse(url);
  const params = { ...(parsed.queryParams ?? {}) } as Record<
    string,
    string | undefined
  >;
  const hash = url.split('#')[1];
  if (hash) {
    for (const part of hash.split('&')) {
      const [k, v] = part.split('=');
      if (k && v) params[k] = decodeURIComponent(v);
    }
  }
  const access_token = params.access_token;
  const refresh_token = params.refresh_token;
  if (!access_token || !refresh_token) return false;
  if (params.type === 'recovery') pendingRecovery = true;
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error) {
    pendingRecovery = false;
    console.warn('[lumi] setSession failed', error.message);
    return false;
  }
  return true;
};

/**
 * Set a new password for the signed-in user (the recovery session the
 * deep link just established). Supabase invalidates the old password
 * on success.
 */
export const updatePassword = async (password: string): Promise<void> => {
  requireConfigured();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
};

// ── session hook ────────────────────────────────────────────────────────
export const useSession = (): {
  session: Session | null;
  loading: boolean;
} => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
};
