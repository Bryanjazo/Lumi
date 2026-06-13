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
