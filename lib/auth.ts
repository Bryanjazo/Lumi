import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

const REDIRECT_PATH = 'auth/callback';
export const getRedirectUrl = () => Linking.createURL(REDIRECT_PATH);

/**
 * Send a 6-digit verification code to email. Supabase's signInWithOtp
 * delivers a token; the email template includes the code by default
 * ({{ .Token }}). We also pass emailRedirectTo so the link still works
 * as a fallback if the user taps it instead of typing the code.
 */
export const sendEmailCode = async (email: string): Promise<void> => {
  if (!isSupabaseConfigured) {
    throw new Error('Auth needs Supabase env vars. See .env.example.');
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: getRedirectUrl(),
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
};

/**
 * Exchange the 6-digit code for a session.
 */
export const verifyEmailCode = async (
  email: string,
  code: string,
): Promise<void> => {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw error;
};

export const signOut = async (): Promise<void> => {
  await supabase.auth.signOut();
};

/**
 * Defensive fallback: if the user taps the link in the email instead of
 * typing the code, the magic-link tokens land in the URL and we still
 * sign them in.
 */
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
