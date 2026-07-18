// Stable per-install device id — the key under which THIS device
// writes its ledger delta slice (users.ledgers[deviceId], see
// lib/sync.ts). Two devices completing different tasks the same day
// used to max-merge their aggregate counts and silently under-count;
// per-device slices sum exactly because each device is the only
// writer of its own key.
//
// Deliberately NOT wiped on account switch (it's device identity,
// not user data — slices live per-user server-side). A reinstall
// mints a fresh id; the old slice stays in the sum, the new one
// starts at zero — history preserved either way.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'lumi.deviceId';
let cached: string | null = null;

export const getDeviceId = async (): Promise<string> => {
  if (cached) return cached;
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) {
      cached = v;
      return v;
    }
  } catch {
    // storage hiccup — fall through to a fresh id (session-stable
    // via the module cache)
  }
  const id = `d_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  cached = id;
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    // unpersisted — still stable for this session
  }
  return id;
};
