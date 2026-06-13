import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

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
 * immediately (assuming "Confirm email" is disabled in Supabase Auth
 * settings — recommended, since phone verification is the security
 * layer). After signup, route to phone enrollment.
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

/**
 * Sign in an existing user with email + password. Returns when the
 * session is set.
 */
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

// ── phone MFA enrollment ────────────────────────────────────────────────

export interface PhoneEnrollment {
  factorId: string;
  challengeId: string;
}

/**
 * Enroll a new phone factor + immediately challenge it (sends SMS). The
 * returned factorId + challengeId are what you pass back to
 * verifyPhone() once the user types the code.
 *
 * Phone format must be E.164 ("+14155551234"). The screen formats it.
 */
export const enrollAndChallengePhone = async (
  phone: string,
): Promise<PhoneEnrollment> => {
  requireConfigured();

  // If the user retries with a new number, unenroll any existing
  // unverified phone factor first to avoid the "already enrolled" error.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const existing = factors?.phone ?? [];
  for (const f of existing) {
    if (f.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data: enrollData, error: enrollErr } =
    await supabase.auth.mfa.enroll({
      factorType: 'phone',
      phone: phone.trim(),
    });
  if (enrollErr || !enrollData) throw enrollErr ?? new Error('enroll failed');
  const factorId = enrollData.id;

  const { data: challengeData, error: challengeErr } =
    await supabase.auth.mfa.challenge({ factorId });
  if (challengeErr || !challengeData)
    throw challengeErr ?? new Error('challenge failed');

  return { factorId, challengeId: challengeData.id };
};

/**
 * Re-challenge an existing factor (used for the "resend code" button).
 */
export const reChallengePhone = async (
  factorId: string,
): Promise<string> => {
  requireConfigured();
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error || !data) throw error ?? new Error('challenge failed');
  return data.id;
};

/**
 * Verify the SMS code. On success the user's session is upgraded to
 * AAL2 and the phone factor is marked 'verified'.
 */
export const verifyPhoneCode = async (
  factorId: string,
  challengeId: string,
  code: string,
): Promise<void> => {
  requireConfigured();
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code: code.trim(),
  });
  if (error) throw error;
};

/**
 * Whether the current user has at least one verified phone factor.
 * Sign-in screens use this to decide whether to route to phone
 * enrollment after sign-in.
 */
export const hasVerifiedPhone = async (): Promise<boolean> => {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return false;
  return (data.phone ?? []).some((f) => f.status === 'verified');
};

// ── deep link fallback (kept from earlier; harmless if unused) ──────────
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
