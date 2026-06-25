/**
 * Window-based time model — shared by Home and Time tabs.
 *
 * Every quest carries `window` (which part of day) and an optional
 * `scheduledHour/Minute` (the exact "at" time). Together they encode
 * three tiers:
 *   - anchored:  window set + at set  → exact time, looms on Time radar
 *   - windowed:  window set, at null  → "sometime this morning/midday/etc"
 *   - someday:   window === 'someday' → off the clock, never on the radar
 *
 * Invariant: if `at` is set, `window` MUST match the window that time
 * falls into. Home enforces this via `deriveWindow` before writing.
 */

export type WindowKey =
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'evening'
  | 'someday';

export interface WindowMeta {
  label: string;
  sub: string;
  color: string;
  glyph: string;
  start: number | null; // 24-hr clock; null = someday
  end: number | null;
}

export const WINDOWS: Record<WindowKey, WindowMeta> = {
  morning: {
    label: 'Morning',
    sub: 'wake – 11',
    color: '#C9A06A',
    glyph: '◔',
    start: 7,
    end: 11,
  },
  midday: {
    label: 'Midday',
    sub: '11 – 2',
    color: '#869072',
    glyph: '◑',
    start: 11,
    end: 14,
  },
  afternoon: {
    label: 'Afternoon',
    sub: '2 – 5',
    color: '#E07A4F',
    glyph: '◕',
    start: 14,
    end: 17,
  },
  evening: {
    label: 'Evening',
    sub: '5 – bed',
    color: '#8EA0B4',
    glyph: '●',
    start: 17,
    end: 22,
  },
  someday: {
    label: 'Someday',
    sub: 'no rush',
    color: '#6E655A',
    glyph: '○',
    start: null,
    end: null,
  },
};

export const WIN_ORDER: WindowKey[] = [
  'morning',
  'midday',
  'afternoon',
  'evening',
  'someday',
];

/**
 * Given an exact time in minutes-since-midnight, return which window
 * it falls into. Used by Home when the user picks an exact time —
 * we derive the window from it so the invariant holds.
 */
export const deriveWindow = (minutesSinceMidnight: number): WindowKey => {
  const h = minutesSinceMidnight / 60;
  for (const k of WIN_ORDER) {
    const w = WINDOWS[k];
    if (w.start != null && w.end != null && h >= w.start && h < w.end) {
      return k;
    }
  }
  return 'evening';
};

/**
 * Which window the current clock falls into (used to highlight the
 * "NOW" window on Home, and to project windowed quests on Time).
 */
export const currentWindow = (now: Date = new Date()): WindowKey => {
  const h = now.getHours() + now.getMinutes() / 60;
  for (const k of WIN_ORDER) {
    const w = WINDOWS[k];
    if (w.start != null && w.end != null && h >= w.start && h < w.end) {
      return k;
    }
  }
  return 'evening';
};

/**
 * Format minutes-since-midnight as a short time string ("3:00p").
 */
export const fmtMinutes = (m: number): string => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const hh = h % 12 || 12;
  const mm = String(min).padStart(2, '0');
  return `${hh}:${mm}${h < 12 ? 'a' : 'p'}`;
};

// ────────────────────────────────────────────────────────────────────
// User-overridable windows
// ────────────────────────────────────────────────────────────────────
// The Windows editor in profile lets the user shift the three middle
// boundaries (morning→midday, midday→afternoon, afternoon→evening).
// Morning's start is wakeHour; evening's end is the sleep anchor.
// These helpers wrap WINDOWS so the rest of the app can be migrated
// onto them one screen at a time without a big-bang rewrite.

import { useMemo } from 'react';
import {
  useUserStore,
  type WindowOverrides,
} from '../store/userStore';

const formatHour = (h: number): string => {
  const hh = h % 12 || 12;
  return h < 12 ? `${hh}a` : `${hh}p`;
};

/** Build a WINDOWS-shaped lookup that respects the user's overrides. */
export const computeEffectiveWindows = (
  overrides: WindowOverrides,
  wakeHour: number,
  sleepHour: number,
): Record<WindowKey, WindowMeta> => {
  const m = overrides.midday;
  const a = overrides.afternoon;
  const e = overrides.evening;
  return {
    morning: {
      ...WINDOWS.morning,
      start: wakeHour,
      end: m,
      sub: `wake – ${m}`,
    },
    midday: {
      ...WINDOWS.midday,
      start: m,
      end: a,
      sub: `${formatHour(m)} – ${formatHour(a)}`,
    },
    afternoon: {
      ...WINDOWS.afternoon,
      start: a,
      end: e,
      sub: `${formatHour(a)} – ${formatHour(e)}`,
    },
    evening: {
      ...WINDOWS.evening,
      start: e,
      end: sleepHour,
      sub: `${formatHour(e)} – bed`,
    },
    someday: WINDOWS.someday,
  };
};

/** Hook — read the effective windows for the current user. */
export const useEffectiveWindows = (): Record<WindowKey, WindowMeta> => {
  const overrides = useUserStore((s) => s.windowOverrides);
  const wakeHour = useUserStore((s) =>
    Math.floor(s.anchors.wake / 60),
  );
  const sleepHour = useUserStore((s) =>
    Math.floor(s.anchors.sleep / 60),
  );
  return useMemo(
    () => computeEffectiveWindows(overrides, wakeHour, sleepHour),
    [overrides, wakeHour, sleepHour],
  );
};

/** Non-hook getter (for stores / sync code that can't use hooks). */
export const getEffectiveWindows = (): Record<WindowKey, WindowMeta> => {
  const s = useUserStore.getState();
  const wake = Math.floor(s.anchors.wake / 60);
  const sleep = Math.floor(s.anchors.sleep / 60);
  return computeEffectiveWindows(s.windowOverrides, wake, sleep);
};

/** currentWindow over an arbitrary windows lookup. */
export const currentWindowFor = (
  windows: Record<WindowKey, WindowMeta>,
  now: Date = new Date(),
): WindowKey => {
  const h = now.getHours() + now.getMinutes() / 60;
  for (const k of WIN_ORDER) {
    const w = windows[k];
    if (w.start != null && w.end != null && h >= w.start && h < w.end) {
      return k;
    }
  }
  return 'evening';
};

/** deriveWindow over an arbitrary windows lookup. */
export const deriveWindowFor = (
  windows: Record<WindowKey, WindowMeta>,
  minutesSinceMidnight: number,
): WindowKey => {
  const h = minutesSinceMidnight / 60;
  for (const k of WIN_ORDER) {
    const w = windows[k];
    if (w.start != null && w.end != null && h >= w.start && h < w.end) {
      return k;
    }
  }
  return 'evening';
};
