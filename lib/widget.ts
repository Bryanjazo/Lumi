import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useUserStore } from '../store/userStore';
import { useQuestStore } from '../store/questStore';
import { useAmbientLunaMood } from './luna-mood';

// ── Bridge to the iOS widget extension ──────────────────────────────
//
// The widget is a separate native bundle (targets/widget/) that
// reads from a shared App Group via UserDefaults(suiteName:). On the
// JS side we write through @bacons/apple-targets's ExtensionStorage,
// then call .reloadWidget() to invalidate the timeline so iOS picks
// up the new entry immediately.
//
// Keep the storage keys in sync with `SharedKey` in
// targets/widget/index.swift.

const APP_GROUP = 'group.app.lumi.ios';

const KEY_MOOD = 'mood';
const KEY_PET = 'petName';
const KEY_COMPLETED = 'completedToday';

// Lazy-load: this package contains a native module that only exists
// after prebuild, so importing eagerly would break Expo Go boot.
type ExtensionStorageMod = typeof import('@bacons/apple-targets');

let _mod: ExtensionStorageMod | null = null;
const loadMod = (): ExtensionStorageMod | null => {
  if (_mod) return _mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _mod = require('@bacons/apple-targets') as ExtensionStorageMod;
  } catch {
    // Native module not bundled (Expo Go / web / Android).
  }
  return _mod;
};

const isWidgetSupported = () => Platform.OS === 'ios' && loadMod() !== null;

/**
 * Push the current mood snapshot to the widget. Writes the three
 * fields the widget reads, then asks iOS to reload the timeline.
 * Safe to call on Android / Expo Go — becomes a no-op there.
 */
export const pushMoodToWidget = (snapshot: {
  mood: string;
  petName: string;
  completedToday: number;
}): void => {
  const mod = loadMod();
  if (!mod || Platform.OS !== 'ios') return;
  try {
    const store = new mod.ExtensionStorage(APP_GROUP);
    store.set(KEY_MOOD, snapshot.mood);
    store.set(KEY_PET, snapshot.petName);
    store.set(KEY_COMPLETED, snapshot.completedToday);
    mod.ExtensionStorage.reloadWidget();
  } catch {
    // Widget bundle not installed yet, or App Group denied — silent.
  }
};

/**
 * Hook that watches the ambient mood + completion count + petName
 * and pushes to the widget whenever the tuple changes. Mount once
 * at the app root (app/_layout.tsx). Throttled by the tuple-equality
 * check — every Zustand re-render does not trigger a reload, only
 * actual value transitions do.
 */
export const useWidgetSync = (): void => {
  const mood = useAmbientLunaMood();
  const petName = useUserStore((s) => s.petName);
  // We can't use questStore.completedToday() inside a selector
  // (selector must be pure / referentially stable); subscribe to
  // the array and derive in render. The selector returns a new
  // array reference only when quests mutate, so this is cheap.
  const completedToday = useQuestStore((s) => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return s.quests.filter((q) => q.date === todayKey && q.completed).length;
  });

  // Track the last-pushed snapshot to avoid redundant reloads. iOS
  // throttles widget reloads itself but we still want to avoid the
  // bridge cost on every Zustand notification.
  const lastSent = useRef<string>('');

  useEffect(() => {
    if (!isWidgetSupported()) return;
    const key = `${mood}|${petName}|${completedToday}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    pushMoodToWidget({ mood, petName, completedToday });
  }, [mood, petName, completedToday]);
};
