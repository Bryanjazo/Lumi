// Lumi · learning · digest
//
// One hook that runs all the math detectors in a single useMemo and
// returns the combined digest. Pure read-side derivation — no Edge
// Function, no LLM, ~free. The "moat" math layer the architecture
// names as the bulk of "Lumi learns you."

import { useMemo } from 'react';
import { useQuestStore } from '../../store/questStore';
import { useSuggestionsStore } from '../../store/suggestionsStore';
import { useUserStore } from '../../store/userStore';

import {
  detectRecurrencePatterns,
  normalizeForSuppression,
} from './recurrence';
import {
  computeEnergyCurve,
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
  // Energy — the curve + peak/low DAY math run on completions now
  // (WHEN you finish things). The old self-reported daily-energy series
  // (last7DaysEnergy / avgRecentEnergy) was dropped from the digest: it
  // read the retired check-in store, so it was permanently empty, and
  // its only reader (Recap) supersedes it with energyForSundayWeek.
  curve: EnergyCurve;
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
  // Durable completion timeline — survives recurring respawn (which
  // nulls Quest.completedAt), so it's the real history the energy curve
  // and peak/low-day math run on. See the read in the memo below.
  // Appended once per award in completeQuestCore (userStore.logCompletion).
  const completionLog = useUserStore((s) => s.completionLog);
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

    // The energy curve + peak/low-day math run on COMPLETIONS — WHEN
    // you finish things is the activity signal (check-ins were retired
    // and never populated).
    //
    // The durable source is userStore.completionLog, a capped ring
    // buffer stamped on every award in completeQuestCore. We CANNOT read
    // live quest rows for history: a recurring quest resets completedAt
    // to null the moment it respawns (questStore respawn), so every
    // daily habit — the densest, most-honest completion signal we have —
    // erases its own timeline each morning. Reading the log means the
    // curve finally accumulates across days and can graduate for a
    // habit-driven user instead of being stuck at "learning" forever.
    //
    // Fallback: if the log is empty (a device that hasn't awarded
    // anything since the log shipped), fall back to today's live
    // completedAt rows so the curve keeps drawing something instead of
    // going blank during the changeover.
    const loggedCompletions = completionLog.map((e) => ({
      completedAt: e.at,
    }));
    const completions =
      loggedCompletions.length > 0
        ? loggedCompletions
        : quests
            .filter((q) => q.completed && q.completedAt)
            .map((q) => ({ completedAt: q.completedAt as string }));

    const curve = computeEnergyCurve(
      completions,
      chronotype,
      wakeHour,
      sleepHour,
    );
    const { peakDow, lowDow } = peakAndLowDays(completions);

    const followThrough = computeFollowThrough(quests);
    const pattern = strongWindowInsight(followThrough);

    const stale = findStale(quests);
    const avoidance = dominantStaleCluster(stale);

    const win = findWinOfWeek(quests);

    return {
      recurrence,
      curve,
      peakDow,
      lowDow,
      followThrough,
      pattern,
      stale,
      avoidance,
      win,
    };
  }, [quests, completionLog, suppressed, chronotype, wakeHour, sleepHour]);
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
  CompletionEvent,
} from './energy';
export type {
  FollowThrough,
  WindowStat,
  DowStat,
  StrongWindowInsight,
} from './followThrough';
export type { StaleItem, AvoidanceCluster } from './avoidance';
export type { WinItem } from './win';
