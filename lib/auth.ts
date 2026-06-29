import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

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
 * Create a new account with email + password. The user gets a session
 * immediately, assuming "Confirm email" is disabled in Supabase Auth
 * settings (recommended — there's no second factor that needs a
 * confirmed email).
 */
export const signUp = async (
  email: string,
  password: string,
): Promise<void> => {
  requireConfigured();
  const { error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { emailRedirectTo: getRedirectUrl() },
  });
  if (error) throw error;
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
  await supabase.auth.signOut();
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
  const credential = await Apple.signInAsync({
    requestedScopes: [
      Apple.AppleAuthenticationScope.FULL_NAME,
      Apple.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) {
    throw new Error('Apple didn’t return an identity token — try again.');
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;

  // Apple gives the name ONLY on the first sign-in for this Services
  // ID. Caller (sign-up flow) uses this to seed the userStore name.
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
    // Translate the most common Supabase rejection into copy the user
    // can actually act on (vs. the raw "Unacceptable audience" line
    // that's meaningless outside our codebase).
    if (/audience|aud/i.test(msg)) {
      throw new Error(
        'Sign-in rejected — this build’s Google client doesn’t match the server. Update to the latest Lumi build.',
      );
    }
    throw new Error(msg);
  }

  // Instrument: log the user id + whether this looks like a fresh
  // create. If `created_at` is within the last 5 seconds of now, the
  // Google sign-in just minted a new row — almost always a sign the
  // user actually has an existing email/password account that
  // Supabase isn't linking.
  if (signedInUser) {
    const createdMs = signedInUser.created_at
      ? Date.parse(signedInUser.created_at)
      : NaN;
    const isFresh = !isNaN(createdMs) && Date.now() - createdMs < 5_000;
    console.log(
      '[google] supabase user',
      signedInUser.id,
      signedInUser.email,
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
 * screen. (Reset screen lands in a later feature.)
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
export const handleAuthDeepLink = async (url: string): Promise<boolean> => {
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
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error) {
    console.warn('[lumi] setSession failed', error.message);
    return false;
  }
  return true;
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
