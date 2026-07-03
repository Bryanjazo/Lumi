import 'react-native-url-polyfill/auto';
// Session tokens are encrypted at rest (security audit §5): AES key
// in the iOS Keychain / Android Keystore via SecureStore, ciphertext
// in AsyncStorage (sessions are too big for the Keychain directly).
// Existing plaintext sessions migrate in place on first read — no
// one gets signed out by the upgrade.
import { secureStorage } from './secureStorage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.SUPABASE_ANON_KEY ?? '';

let _supabase: SupabaseClient | null = null;

export const supabase: SupabaseClient = (() => {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Stub client to avoid crashing the app during local dev without env vars.
    // All calls return offline shape; persistSession is off so the
    // storage adapter is never exercised here.
    _supabase = createClient('https://offline.invalid', 'offline-key', {
      auth: {
        storage: secureStorage,
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    return _supabase;
  }
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return _supabase;
})();

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export type DbUser = {
  id: string;
  name: string;
  level: number;
  xp: number;
  streak: number;
  shield_available: boolean;
  pet_name: string;
  created_at: string;
};

export type DbQuest = {
  id: string;
  user_id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  xp_reward: number;
  completed: boolean;
  date: string;
  created_at: string;
};

export type DbCheckin = {
  id: string;
  user_id: string;
  mood: string;
  text_input: string | null;
  ai_response: string | null;
  emotional_state: string | null;
  created_at: string;
};

export type DbSosEvent = {
  id: string;
  user_id: string;
  type: 'rsd' | 'depersonalization';
  duration_seconds: number;
  created_at: string;
};
