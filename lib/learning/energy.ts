// Lumi · learning · energy curve
//
// Per-user 48-slot (30-min) energy curve learned from check-ins.
// Pure math; no LLM. Per the architecture's confidence ramp:
//
//   sample_days  < 7   → use baseline silently; UI says "learning"
//   7 ≤ days < 14      → faint "early read"
//   days ≥ 14           → trusted curve, peak/slump fire off it
//
// Spec: lumi-data-architecture.md §4.

import { Checkin } from '../../store/checkinStore';
import type { EnergyWindowKey } from '../../store/userStore';

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
  /** Overall confidence in the curve as a whole. */
  confidence: number;
  /** Was this curve learned or is it still the baseline? */
  source: 'baseline' | 'learning' | 'learned';
}

const SLOTS = 48;
const LOOKBACK_DAYS = 28;
const MIN_CONFIDENT_DAYS = 14;
const MIN_VISIBLE_DAYS = 7;

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
  checkins: Checkin[],
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

  // Per-slot accumulator: sum of energy + count + per-day set for
  // confidence ramp.
  const sums: number[] = Array(SLOTS).fill(0);
  const counts: number[] = Array(SLOTS).fill(0);
  const dayKeys: Set<string>[] = Array.from({ length: SLOTS }, () => new Set());
  const allDays = new Set<string>();

  for (const c of checkins) {
    const at = new Date(c.createdAt);
    if (at < cutoff) continue;
    const slot = Math.floor((at.getHours() * 60 + at.getMinutes()) / 30);
    const day = c.createdAt.slice(0, 10);
    sums[slot] += c.energy;
    counts[slot]++;
    dayKeys[slot].add(day);
    allDays.add(day);
  }

  const sampleDays = allDays.size;
  const baseline = baselineCurve(chronotype, wakeHour, sleepHour);

  const slots: EnergySlot[] = baseline.map((b) => {
    if (counts[b.slot] === 0) {
      return { ...b, confidence: 0 };
    }
    const learnedRaw = sums[b.slot] / counts[b.slot];
    const slotConfidence = Math.min(1, dayKeys[b.slot].size / MIN_CONFIDENT_DAYS);
    // Blend learned with baseline by slot confidence so sparse slots
    // don't yank the curve around with one outlier check-in.
    const energy = slotConfidence * learnedRaw + (1 - slotConfidence) * b.energy;
    return {
      slot: b.slot,
      energy: Math.round(Math.max(0, Math.min(100, energy))),
      confidence: slotConfidence,
    };
  });

  // Source / confidence labels per the architecture's ramp.
  let source: EnergyCurve['source'];
  if (sampleDays >= MIN_CONFIDENT_DAYS) source = 'learned';
  else if (sampleDays >= MIN_VISIBLE_DAYS) source = 'learning';
  else source = 'baseline';
  const confidence = Math.min(1, sampleDays / MIN_CONFIDENT_DAYS);

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

/** Average energy over the last N days (default 7). */
export const avgRecentEnergy = (checkins: Checkin[], days = 7): number => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recent = checkins.filter((c) => new Date(c.createdAt) >= cutoff);
  if (recent.length === 0) return 0;
  return Math.round(recent.reduce((s, c) => s + c.energy, 0) / recent.length);
};

/**
 * Returns the peak day-of-week (Sun=0..Sat=6) by average energy in the
 * last 28 days. Used by the recap "peaks Wednesday" narrative.
 */
export const peakAndLowDays = (
  checkins: Checkin[],
): { peakDow: number | null; lowDow: number | null } => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const sums: number[] = Array(7).fill(0);
  const counts: number[] = Array(7).fill(0);
  for (const c of checkins) {
    const at = new Date(c.createdAt);
    if (at < cutoff) continue;
    const dow = at.getDay();
    sums[dow] += c.energy;
    counts[dow]++;
  }
  const avgs = sums.map((s, i) => (counts[i] ? s / counts[i] : null));
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
