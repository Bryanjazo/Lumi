import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
    // All calls return offline shape; stores will fall back to AsyncStorage.
    _supabase = createClient('https://offline.invalid', 'offline-key', {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    return _supabase;
  }
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
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
