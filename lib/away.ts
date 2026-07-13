// Lumi · away/return state (emotional-model spec §2)
//
// When the user comes back after time away, Lumi is simply HAPPY
// they're back — never hurt, never "you missed X". This module is
// the single source of truth for "how long were they gone and what
// does Lumi say about it":
//
//   1 day away   → she's been reading      "I saved your place."
//   3+ days away → she's at the window     "I've been thinking about
//                                           your projects. Want to
//                                           untangle them?"
//   7+ days away → she's made tea          "Welcome back. We don't
//                                           have to do everything.
//                                           Just tell me what's on
//                                           your mind."
//
// Rescue Mode (§3) reads the same daysAway signal so the two
// experiences can't disagree about how long "away" was.

import { useMemo } from 'react';
import { useUserStore } from '../store/userStore';

export type AwayStage = 'reading' | 'window' | 'tea';

export interface AwayState {
  /** Whole days since the last registered activity. 0 = today. */
  daysAway: number;
  /** null = user was here yesterday or today — no welcome needed. */
  stage: AwayStage | null;
  /** Lumi's warm one-liner for the stage. */
  line: string | null;
  /** Small scene note for the stage ("she kept a book open…"). */
  scene: string | null;
}

const localToday = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Whole-day difference between two local Y-M-D strings. */
const dayDiff = (fromISO: string, toISO: string): number => {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
};

export const awayStateFor = (
  lastActiveDate: string | null,
  todayISO: string = localToday(),
): AwayState => {
  // Never been active (brand-new user) — this isn't "away", it's
  // day one. No welcome-back energy.
  if (!lastActiveDate) {
    return { daysAway: 0, stage: null, line: null, scene: null };
  }
  const daysAway = Math.max(0, dayDiff(lastActiveDate, todayISO));
  if (daysAway <= 1) {
    // Yesterday counts as "here" — a normal daily rhythm shouldn't
    // trigger welcome-back ceremony.
    return { daysAway, stage: null, line: null, scene: null };
  }
  if (daysAway >= 7) {
    return {
      daysAway,
      stage: 'tea',
      line: "Welcome back. We don't have to do everything — just tell me what's on your mind.",
      scene: 'Lumi made tea while she waited.',
    };
  }
  if (daysAway >= 3) {
    return {
      daysAway,
      stage: 'window',
      line: "I've been thinking about your projects. Want to untangle them together?",
      scene: 'Lumi was watching the window when you came in.',
    };
  }
  // 2 days — gentle, barely ceremonial.
  return {
    daysAway,
    stage: 'reading',
    line: 'I saved your place.',
    scene: 'Lumi kept a book open on your page.',
  };
};

/** The most recent "they were here" signal — an app open counts as
 *  much as a completed task. Browsing without doing anything is
 *  still showing up; no ceremony for that. */
export const lastSeenDate = (
  lastActiveDate: string | null,
  lastOpenedDate: string | null,
): string | null => {
  if (!lastActiveDate) return lastOpenedDate;
  if (!lastOpenedDate) return lastActiveDate;
  return lastOpenedDate > lastActiveDate ? lastOpenedDate : lastActiveDate;
};

/**
 * Reactive hook — reads the away state as of THIS app open. Home
 * calls `registerOpen()` on mount, which stamps today; the hook
 * therefore reads the PREVIOUS open date captured by that call. Use
 * the returned value from registerOpen (or read before stamping).
 */
export const useAwayState = (): AwayState => {
  const lastActiveDate = useUserStore((s) => s.lastActiveDate);
  const lastOpenedDate = useUserStore((s) => s.lastOpenedDate);
  return useMemo(
    () => awayStateFor(lastSeenDate(lastActiveDate, lastOpenedDate)),
    [lastActiveDate, lastOpenedDate],
  );
};
