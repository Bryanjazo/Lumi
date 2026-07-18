// Reduce Motion (iOS: Settings → Accessibility → Motion) — one shared
// reader so every ambient animation in the app can respect it. For an
// ADHD audience this is more than comfort: constant motion is exactly
// the kind of attention hijack the OS flag exists to switch off.
//
// The value is cached module-level so non-hook code (imperative
// animation starters) can read it synchronously via
// isReduceMotionEnabled(); the hook re-renders subscribers when the
// OS setting changes mid-session.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let cached = false;
const listeners = new Set<(v: boolean) => void>();

void AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    cached = v;
    listeners.forEach((fn) => fn(v));
  })
  .catch(() => {});

AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
  cached = v;
  listeners.forEach((fn) => fn(v));
});

/** Synchronous read for imperative code (Animated.loop starters). */
export const isReduceMotionEnabled = (): boolean => cached;

/** Reactive read for components — re-renders on OS setting changes. */
export const useReducedMotion = (): boolean => {
  const [v, setV] = useState(cached);
  useEffect(() => {
    const fn = (next: boolean) => setV(next);
    listeners.add(fn);
    setV(cached);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return v;
};
