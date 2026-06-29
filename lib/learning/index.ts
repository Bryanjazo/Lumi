// Lumi · learning · digest
//
// One hook that runs all the math detectors in a single useMemo and
// returns the combined digest. Pure read-side derivation — no Edge
// Function, no LLM, ~free. The "moat" math layer the architecture
// names as the bulk of "Lumi learns you."

import { useMemo } from 'react';
import { useQuestStore } from '../../store/questStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useSuggestionsStore } from '../../store/suggestionsStore';
import { useUserStore } from '../../store/userStore';

import {
  detectRecurrencePatterns,
  normalizeForSuppression,
} from './recurrence';
import {
  computeEnergyCurve,
  last7DaysEnergy,
  avgRecentEnergy,
  peakAndLowDays,
  chronotypeFromWindow,
  type EnergyCurve,
  type Chronotype,
} from './energy';
import {
  computeFollowThrough,
  strongWindowInsight,
  type FollowThrough,
  type StrongWindowInsight,
} from './followThrough';
import {
  findStale,
  dominantStaleCluster,
  type StaleItem,
  type AvoidanceCluster,
} from './avoidance';
import { findWinOfWeek, type WinItem } from './win';
import type { Suggestion } from '../../store/suggestionsStore';

export interface LearningDigest {
  // Recurrence
  recurrence: Suggestion[];
  // Energy
  curve: EnergyCurve;
  energyTrend: { day: string; v: number; date: string }[];
  avgEnergy7: number;
  peakDow: number | null;
  lowDow: number | null;
  // Follow-through
  followThrough: FollowThrough;
  pattern: StrongWindowInsight | null;
  // Avoidance
  stale: StaleItem[];
  avoidance: AvoidanceCluster | null;
  // Win
  win: WinItem | null;
}

/**
 * Build the digest. Chronotype is derived automatically from the
 * user's onboarding answers (sharpWindow + foggyWindow) so every
 * caller gets the right baseline curve without having to pass it.
 *
 * The earlier default of `'neutral'` was a latent bug — a user who
 * said "I'm sharpest in the evening" still got the neutral curve,
 * which shows peak ~12:30pm and slump ~4pm. They saw their slump
 * land in late afternoon / evening (wrong!) instead of mid-morning.
 *
 * The `override` arg is preserved so tests and the profile screen
 * can still pin a specific chronotype if needed.
 */
export const useLearningDigest = (
  override?: Chronotype,
): LearningDigest => {
  const quests = useQuestStore((s) => s.quests);
  const checkins = useCheckinStore((s) => s.checkins);
  const suppressed = useSuggestionsStore((s) => s.suppressed);
  const sharpWindow = useUserStore((s) => s.sharpWindow);
  const foggyWindow = useUserStore((s) => s.foggyWindow);
  // Anchors drive the baseline curve's night-dip AND bound the
  // slump search, so a shift worker / early bird gets a curve that
  // fits THEIR day, not a generic 6am-10:30pm template.
  const wakeHour = useUserStore((s) => Math.floor(s.anchors.wake / 60));
  const sleepHour = useUserStore((s) => Math.floor(s.anchors.sleep / 60));

  const chronotype: Chronotype =
    override ?? chronotypeFromWindow(sharpWindow, foggyWindow);

  return useMemo(() => {
    // Don't re-emit titles the user dismissed, OR titles already
    // attached to an active recurring quest.
    const suppressedSet = new Set(suppressed);
    const existingRecurringTitles = new Set(
      quests
        .filter((q) => q.recur)
        .map((q) => normalizeForSuppression(q.title)),
    );

    const recurrence = detectRecurrencePatterns(quests, {
      suppressed: suppressedSet,
      existingRecurringTitles,
    });

    const curve = computeEnergyCurve(checkins, chronotype, wakeHour, sleepHour);
    const energyTrend = last7DaysEnergy(checkins);
    const avgEnergy7 = avgRecentEnergy(checkins, 7);
    const { peakDow, lowDow } = peakAndLowDays(checkins);

    const followThrough = computeFollowThrough(quests);
    const pattern = strongWindowInsight(followThrough);

    const stale = findStale(quests);
    const avoidance = dominantStaleCluster(stale);

    const win = findWinOfWeek(quests);

    return {
      recurrence,
      curve,
      energyTrend,
      avgEnergy7,
      peakDow,
      lowDow,
      followThrough,
      pattern,
      stale,
      avoidance,
      win,
    };
  }, [quests, checkins, suppressed, chronotype, wakeHour, sleepHour]);
};

// Re-export the detectors so callers don't have to know the layout.
export {
  detectRecurrencePatterns,
  normalizeForSuppression,
} from './recurrence';
export {
  computeEnergyCurve,
  last7DaysEnergy,
  avgRecentEnergy,
  peakAndLowDays,
} from './energy';
export {
  computeFollowThrough,
  strongWindowInsight,
} from './followThrough';
export { findStale, dominantStaleCluster, formatStaleDays } from './avoidance';
export { findWinOfWeek } from './win';
export type {
  EnergyCurve,
  EnergySlot,
  Chronotype,
} from './energy';
export type {
  FollowThrough,
  WindowStat,
  DowStat,
  StrongWindowInsight,
} from './followThrough';
export type { StaleItem, AvoidanceCluster } from './avoidance';
export type { WinItem } from './win';
