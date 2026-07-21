// Lumi · learning · energy curve
//
// Per-user 48-slot (30-min) energy curve learned from COMPLETIONS —
// WHEN you actually finish things is our proxy for when you run
// strongest. (Check-ins used to feed this, but that capture flow was
// retired — checkinStore.add() has no callers — so the curve read an
// array that never fills and could never graduate. Completions carry
// the same hour-of-day + weekday signal and are what we still collect
// every day.) Pure math; no LLM.
//
// Confidence ramp — completions are SPARSER than the old check-ins
// (you don't finish something every half hour), so graduation counts
// EVENTS as well as distinct days:
//
//   < 6 events / < 3 days   → baseline silently; UI says "learning"
//   ≥ 6 over ≥ 3 days       → faint "early read"
//   ≥ 15 over ≥ 5 days      → trusted curve, peak/slump fire off it
//
// Spec: lumi-data-architecture.md §4.

// Checkin is still the input for the self-reported daily-energy series
// helpers at the bottom of this file (Me tab / Recap sparkline) — those
// read a mood coordinate, not activity timing, so they stay on it.
import { Checkin } from '../../store/checkinStore';
import type { EnergyWindowKey } from '../../store/userStore';

/**
 * The activity signal the curve + peak/low-day math run on: one event
 * per finished quest. We only need the timestamp — the hour-of-day
 * places it in a 30-min slot, the weekday feeds peakAndLowDays().
 *
 * SOURCE (see lib/learning/index.ts): these come from the durable
 * userStore.completionLog ring buffer, NOT live Quest.completedAt rows.
 * A recurring quest resets completedAt to null when it respawns each
 * day, so live rows can't hold a habit's history — the densest signal
 * we have would erase itself every morning and the curve could never
 * graduate. The log stamps each award once and survives the respawn.
 */
export interface CompletionEvent {
  /** ISO timestamp the activity happened. From completionLog[i].at
   *  (originally the award-time Quest.completedAt). */
  completedAt: string;
}

export type Chronotype = 'early' | 'neutral' | 'night';

/**
 * Map the user's onboarding answers to a chronotype prior for the
 * baseline curve. Before we have ≥14 days of real data, the curve
 * is *entirely* the baseline — so if we don't seed this correctly
 * from the user's "I'm sharpest in the X" answer, the peak/slump
 * windows show up in the wrong half of the day.
 *
 * Sharp wins over foggy when both are set (it's the more direct
 * signal). Sharp 'afternoon' stays neutral — the neutral curve
 * already peaks early-afternoon, so it fits.
 */
export const chronotypeFromWindow = (
  sharp: EnergyWindowKey | null,
  foggy: EnergyWindowKey | null,
): Chronotype => {
  if (sharp === 'morning') return 'early';
  if (sharp === 'evening') return 'night';
  if (sharp === 'midday' || sharp === 'afternoon') return 'neutral';
  // No sharp signal — let the foggy answer pull the other way.
  if (foggy === 'morning') return 'night';
  if (foggy === 'evening') return 'early';
  return 'neutral';
};

export interface EnergySlot {
  /** Slot index 0–47 (each = 30 minutes). */
  slot: number;
  /** 0–100 energy estimate. */
  energy: number;
  /** 0–1 — how much we trust this slot's value. */
  confidence: number;
}

export interface EnergyCurve {
  slots: EnergySlot[];
  /** Minutes since midnight; null if no clear peak. */
  peakStart: number | null;
  peakEnd: number | null;
  slumpStart: number | null;
  slumpEnd: number | null;
  /** Distinct days that contributed data in the lookback window. */
  sampleDays: number;
  /** Total completion events that fed the curve in the window — the
   *  other half of the graduation gate (days alone can't crown it). */
  sampleCount: number;
  /** Overall confidence in the curve as a whole. */
  confidence: number;
  /** Was this curve learned or is it still the baseline? */
  source: 'baseline' | 'learning' | 'learned';
}

const SLOTS = 48;
const LOOKBACK_DAYS = 28;
// Graduation thresholds. Completions are a sparse signal — a daily
// user finishes maybe 1–5 things a day, not the dozen-plus check-ins
// the retired flow could rack up — so we gate on EVENT COUNT and
// DISTINCT DAYS together. 15 completions spread over 5 separate days
// is enough shape to stop calling the curve a guess without letting a
// single busy afternoon (lots of events, one day) crown it. The
// 'learning' tier is deliberately low so the page shows an "early
// read" within a few days of real use rather than staying blank.
const MIN_LEARNED_COMPLETIONS = 15;
const MIN_LEARNED_DAYS = 5;
const MIN_LEARNING_COMPLETIONS = 6;
const MIN_LEARNING_DAYS = 3;
// Per-slot trust ramps with the number of DISTINCT DAYS that slot saw
// activity — one evening of batch-finishing six tasks shouldn't crown
// 9pm. Small divisor because the whole signal is sparse; a slot seen
// on 3 different days is about as trusted as we can honestly get.
const SLOT_CONFIDENT_DAYS = 3;

// ── Chronotype baseline curves (kept in code, not DB) ──────────────
// Smooth sinusoidal shapes seeded by chronotype. These power the curve
// before the user has enough data to personalize it.
//
// `wakeHour` / `sleepHour` come from the user's anchors so the night
// dip lines up with their actual sleep schedule. A shift worker who
// wakes at 14:00 and sleeps at 06:00 doesn't get a hardcoded 6am/22:30
// dip applied over their working hours; an early bird who sleeps at
// 21:00 gets the dip pulled earlier. Both also bound the slump search
// (so we don't mistake nighttime sleep for the productive-day slump).
const baselineSlot = (
  slot: number,
  chronotype: Chronotype,
  wakeHour: number,
  sleepHour: number,
): number => {
  const min = slot * 30;
  const hour = min / 60;
  // Three peak windows by chronotype.
  const peakHour = chronotype === 'early' ? 10 : chronotype === 'night' ? 18 : 12.5;
  const slumpHour = chronotype === 'early' ? 15 : chronotype === 'night' ? 11 : 16;
  // Distance from peak, modulated by slump dip.
  const peakDist = Math.abs(hour - peakHour);
  const slumpDist = Math.abs(hour - slumpHour);
  const peakScore = Math.max(0, 1 - peakDist / 7) * 70;
  const slumpDip = Math.max(0, 1 - slumpDist / 3) * 25;
  const base = 25; // floor
  // Sleep hours drop hard. `isAsleep` handles the wrap-around case
  // (sleep:23, wake:7 → asleep 23-24 and 0-7).
  const isAsleep = (h: number) =>
    sleepHour > wakeHour
      ? h < wakeHour || h >= sleepHour
      : h >= sleepHour && h < wakeHour;
  const nightDip = isAsleep(hour) ? 30 : 0;
  return Math.max(
    0,
    Math.min(100, base + peakScore - slumpDip - nightDip),
  );
};

const baselineCurve = (
  chronotype: Chronotype,
  wakeHour: number,
  sleepHour: number,
): EnergySlot[] =>
  Array.from({ length: SLOTS }, (_, slot) => ({
    slot,
    energy: baselineSlot(slot, chronotype, wakeHour, sleepHour),
    confidence: 0,
  }));

// ── Peak / slump detection ─────────────────────────────────────────
const findLongestRun = (
  slots: EnergySlot[],
  predicate: (s: EnergySlot) => boolean,
  startSlot = 0,
): { start: number; end: number } | null => {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = startSlot; i < slots.length; i++) {
    if (predicate(slots[i])) {
      if (curStart === -1) curStart = i;
      const len = i - curStart + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
    }
  }
  if (bestStart === -1 || bestLen < 2) return null;
  return {
    start: bestStart * 30,
    end: (bestStart + bestLen) * 30,
  };
};

// ── Main builder ───────────────────────────────────────────────────
export const computeEnergyCurve = (
  completions: CompletionEvent[],
  chronotype: Chronotype = 'neutral',
  // The user's wake / sleep anchor hours (0-23). Default to a sane
  // baseline if the caller doesn't pass them, but the digest hook
  // pipes the real values through so the night-dip + slump search
  // line up with the user's actual day.
  wakeHour = 6,
  sleepHour = 23,
): EnergyCurve => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  // Per-slot activity accumulator: completion count + the distinct
  // days that slot saw activity (for the per-slot confidence ramp).
  const counts: number[] = Array(SLOTS).fill(0);
  const dayKeys: Set<string>[] = Array.from({ length: SLOTS }, () => new Set());
  const allDays = new Set<string>();
  let nCompletions = 0;

  for (const c of completions) {
    const at = new Date(c.completedAt);
    // Guard bad/absent timestamps — a completion with an unparseable
    // completedAt must not slot at NaN or count toward graduation.
    if (Number.isNaN(at.getTime()) || at < cutoff) continue;
    const slot = Math.floor((at.getHours() * 60 + at.getMinutes()) / 30);
    // Local day key — the UTC slice split one local evening into two
    // "days", inflating sampleDays and firing the learned label early.
    const day = ymdLocal(at);
    counts[slot]++;
    dayKeys[slot].add(day);
    allDays.add(day);
    nCompletions++;
  }

  const sampleDays = allDays.size;
  // Busiest slot sets the intensity scale — every other slot reads as
  // a fraction of "your most active half-hour".
  const maxCount = counts.reduce((m, c) => Math.max(m, c), 0);
  const baseline = baselineCurve(chronotype, wakeHour, sleepHour);

  const slots: EnergySlot[] = baseline.map((b) => {
    if (counts[b.slot] === 0) {
      return { ...b, confidence: 0 };
    }
    // Activity → energy: the more you finish in a slot relative to
    // your busiest one, the more "up" that slot reads. Floored at 30
    // (not 0) so an active-but-quiet slot never plots as dead as true
    // sleep — a completion is positive evidence you were *up*.
    const intensity = maxCount > 0 ? counts[b.slot] / maxCount : 0;
    const activityEnergy = 30 + 70 * intensity;
    const slotConfidence = Math.min(
      1,
      dayKeys[b.slot].size / SLOT_CONFIDENT_DAYS,
    );
    // Blend learned with baseline by slot confidence so a slot seen on
    // a single day doesn't yank the curve around with one outlier.
    const energy =
      slotConfidence * activityEnergy + (1 - slotConfidence) * b.energy;
    return {
      slot: b.slot,
      energy: Math.round(Math.max(0, Math.min(100, energy))),
      confidence: slotConfidence,
    };
  });

  // Source / confidence labels — count AND days must both clear the
  // bar (a busy single day, or many quiet days, isn't a curve yet).
  let source: EnergyCurve['source'];
  if (
    nCompletions >= MIN_LEARNED_COMPLETIONS &&
    sampleDays >= MIN_LEARNED_DAYS
  )
    source = 'learned';
  else if (
    nCompletions >= MIN_LEARNING_COMPLETIONS &&
    sampleDays >= MIN_LEARNING_DAYS
  )
    source = 'learning';
  else source = 'baseline';
  const confidence = Math.min(1, nCompletions / MIN_LEARNED_COMPLETIONS);

  // Peak: longest run where energy ≥ 70.
  const peak = findLongestRun(slots, (s) => s.energy >= 70);
  // Slump: longest AWAKE-hour run where energy ≤ 45.
  //
  // Awake hours come from the user's wake/sleep anchors, NOT a
  // hardcoded 6am/22:30 — so a shift worker who wakes at 14:00 or
  // an early bird sleeping at 21:00 gets the slump search bounded
  // to THEIR day, not a generic one. Wrap-around (sleepHour <
  // wakeHour) handled the same way the baseline night-dip does it.
  const isAsleep = (hour: number) =>
    sleepHour > wakeHour
      ? hour < wakeHour || hour >= sleepHour
      : hour >= sleepHour && hour < wakeHour;
  const slump = findLongestRun(slots, (s) => {
    const hour = s.slot / 2;
    if (isAsleep(hour)) return false;
    return s.energy <= 45;
  });

  return {
    slots,
    peakStart: peak?.start ?? null,
    peakEnd: peak?.end ?? null,
    slumpStart: slump?.start ?? null,
    slumpEnd: slump?.end ?? null,
    sampleDays,
    sampleCount: nCompletions,
    confidence,
    source,
  };
};

// ── Helpers for downstream surfaces ────────────────────────────────

// Local YYYY-MM-DD from any Date — kept here as a local copy to avoid
// a circular import from lib/gamification. Mirrors localYmd() there.
const ymdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * 7-day daily-energy series for the Me tab + Recap sparkline.
 * Latest check-in of each day wins. Days without a check-in get 0.
 *
 * IMPORTANT: dates are LOCAL throughout. We previously used
 * `c.createdAt.slice(0, 10)` (UTC) for the bucket key and
 * `d.getDay()` (local) for the letter — that drifts in any zone
 * that isn't UTC, which made today's check-ins show up on the
 * wrong bar (e.g. captured Tuesday evening PT but bucketed as
 * Wednesday UTC, so the Tuesday bar stayed empty). All bucketing
 * now uses the user's local date.
 */
export const last7DaysEnergy = (
  checkins: Checkin[],
): { day: string; v: number; date: string }[] => {
  const byDate = new Map<string, number>();
  // checkins are stored newest-first; first hit wins.
  checkins.forEach((c) => {
    const d = ymdLocal(new Date(c.createdAt));
    if (!byDate.has(d)) byDate.set(d, c.energy);
  });
  const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const out: { day: string; v: number; date: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = ymdLocal(d);
    out.push({ day: letters[d.getDay()], v: byDate.get(key) ?? 0, date: key });
  }
  return out;
};

/** Energy series for a SUNDAY-ANCHORED calendar week (offset weeks
 *  back, 0 = current) — the same window lib/week.ts counts
 *  completions in. The recap used to draw the rolling last-7-days
 *  curve next to Sunday-week task bars: two different date ranges on
 *  one screen. Future days (current week) report 0 = "no data". */
export const energyForSundayWeek = (
  checkins: Checkin[],
  offset = 0,
  now = new Date(),
): { day: string; v: number; date: string }[] => {
  const byDate = new Map<string, number>();
  checkins.forEach((c) => {
    const d = ymdLocal(new Date(c.createdAt));
    if (!byDate.has(d)) byDate.set(d, c.energy);
  });
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - offset * 7);
  const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const out: { day: string; v: number; date: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymdLocal(d);
    out.push({ day: letters[d.getDay()], v: byDate.get(key) ?? 0, date: key });
  }
  return out;
};

/** Average energy over the last N days (default 7). */
export const avgRecentEnergy = (checkins: Checkin[], days = 7): number => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recent = checkins.filter((c) => new Date(c.createdAt) >= cutoff);
  if (recent.length === 0) return 0;
  return Math.round(recent.reduce((s, c) => s + c.energy, 0) / recent.length);
};

/**
 * Returns the peak day-of-week (Sun=0..Sat=6) by how much you tend to
 * finish on it, over the last 28 days. Used by the "Wednesdays tend to
 * be your day" narrative on Patterns + the dow:N Home reveal.
 *
 * The metric is completions-per-observed-date (not raw volume) so a
 * weekday that simply recurs more often in the 28-day window doesn't
 * win on count alone.
 */
export const peakAndLowDays = (
  completions: CompletionEvent[],
): { peakDow: number | null; lowDow: number | null } => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const counts: number[] = Array(7).fill(0);
  const dates: Set<string>[] = Array.from({ length: 7 }, () => new Set());
  for (const c of completions) {
    const at = new Date(c.completedAt);
    if (Number.isNaN(at.getTime()) || at < cutoff) continue;
    const dow = at.getDay();
    counts[dow]++;
    dates[dow].add(ymdLocal(at));
  }
  // HONEST-DATA GUARD: "Wednesdays tend to be your day" must rest on
  // more than one Wednesday. A weekday only competes once it's been
  // observed on ≥2 DISTINCT dates — otherwise a single busy Wednesday
  // (batch-finishing a pile) reads as a standing trend off n=1.
  const MIN_DOW_DATES = 2;
  const avgs = counts.map((n, i) =>
    dates[i].size >= MIN_DOW_DATES ? n / dates[i].size : null,
  );
  let peakDow: number | null = null;
  let lowDow: number | null = null;
  let peakVal = -Infinity;
  let lowVal = Infinity;
  avgs.forEach((v, i) => {
    if (v == null) return;
    if (v > peakVal) {
      peakVal = v;
      peakDow = i;
    }
    if (v < lowVal) {
      lowVal = v;
      lowDow = i;
    }
  });
  return { peakDow, lowDow };
};
