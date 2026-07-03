// Lumi · encrypted at-rest storage (security audit §5/§6)
//
// The "LargeSecureStore" pattern from Supabase's own Expo guide:
// values are AES-256-CTR encrypted with a per-item random key; the
// KEY lives in SecureStore (iOS Keychain / Android Keystore), the
// ciphertext lives in AsyncStorage. Why the split: Keychain values
// are size-limited (~2KB) and a Supabase session or a quest store
// blows straight past that — so the small secret goes in the vault
// and the big blob goes in AsyncStorage where size is free but, on
// its own, it would be plaintext.
//
// Threat model: a device backup, filesystem browse, or another app on
// a compromised device can read AsyncStorage — with this adapter they
// get hex noise. The AES key never leaves the Keychain/Keystore.
//
// MIGRATION: existing installs have plaintext values under the same
// storage keys (the pre-audit state). getItem detects those (real
// ciphertext is pure hex; JSON starts with '{'/'['), re-encrypts them
// in place, and returns the original value — nobody gets signed out
// and no store loses data.
//
// FAIL-SAFE: ciphertext without its key (e.g. Android restored
// AsyncStorage from a backup without the Keystore) decrypts to null —
// the session/store just re-initializes instead of crashing.

import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';

/** SecureStore keys must be [A-Za-z0-9._-]. Storage keys like
 *  "sb-xxxx-auth-token" and "lumi-quests" already comply; this guards
 *  anything that doesn't. */
const secureKeyFor = (key: string): string =>
  `lss.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/** Real ciphertext from this adapter is pure lowercase hex. Anything
 *  else under the key predates encryption (plaintext JSON). */
const looksEncrypted = (value: string): boolean =>
  value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/.test(value);

const encrypt = async (key: string, value: string): Promise<string> => {
  // Fresh random 256-bit key per WRITE — with a never-reused key, the
  // fixed CTR counter is sound (per the Supabase reference impl).
  const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
  const cipher = new aesjs.ModeOfOperation.ctr(
    encryptionKey,
    new aesjs.Counter(1),
  );
  const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
  await SecureStore.setItemAsync(
    secureKeyFor(key),
    aesjs.utils.hex.fromBytes(encryptionKey),
  );
  return aesjs.utils.hex.fromBytes(encryptedBytes);
};

const decrypt = async (
  key: string,
  value: string,
): Promise<string | null> => {
  const keyHex = await SecureStore.getItemAsync(secureKeyFor(key));
  if (!keyHex) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(
    aesjs.utils.hex.toBytes(keyHex),
    new aesjs.Counter(1),
  );
  const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
  return aesjs.utils.utf8.fromBytes(decryptedBytes);
};

export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const stored = await AsyncStorage.getItem(key);
    if (stored == null) return null;
    // Legacy plaintext (pre-encryption install) → adopt it: hand the
    // value back untouched and re-encrypt it in place.
    if (!looksEncrypted(stored)) {
      void secureStorage.setItem(key, stored);
      return stored;
    }
    try {
      return await decrypt(key, stored);
    } catch {
      // Corrupt/keyless ciphertext — fail safe, re-initialize.
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    const encrypted = await encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  },

  removeItem: async (key: string): Promise<void> => {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(secureKeyFor(key));
  },
};
