import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

const REDIRECT_PATH = 'auth/callback';

export const getRedirectUrl = () =>
  Linking.createURL(REDIRECT_PATH);

/**
 * Send a magic-link email. The link opens the app via the `lumi://` scheme
 * and triggers `handleAuthDeepLink` below.
 */
export const signInWithEmail = async (email: string): Promise<void> => {
  if (!isSupabaseConfigured) {
    throw new Error('Sign-in needs Supabase env vars. See .env.example.');
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: getRedirectUrl(),
    },
  });
  if (error) throw error;
};

export const signOut = async (): Promise<void> => {
  await supabase.auth.signOut();
};

/**
 * When the magic-link URL opens the app, Supabase puts the token in the
 * URL fragment. Parse it and hand it to setSession.
 */
export const handleAuthDeepLink = async (url: string): Promise<boolean> => {
  if (!url.includes('access_token')) return false;
  const parsed = Linking.parse(url);
  // Tokens come in either query or fragment depending on platform.
  const params = {
    ...(parsed.queryParams ?? {}),
  } as Record<string, string | undefined>;
  // Hash fragment isn't surfaced by Linking.parse on all platforms;
  // fall back to manual parsing.
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

/**
 * Subscribe to the current Supabase auth session.
 *
 * `loading` is true until we've checked the initial state. After that,
 * `session === null` means logged out (or offline-only mode), and
 * `session !== null` means signed in.
 */
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
