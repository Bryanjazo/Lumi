// Lumi · learning · recurrence detection
//
// The math half of the learning layer (the moat). Pure SQL-equivalent
// over the user's own data, no LLM. The architecture's golden rule:
// pattern *detection* is math, pattern *expression* is the LLM.
//
// Input  : the local Quest store + a completed-timestamp on each row
// Output : Suggestion[] matching the existing suggestionsStore shape
//          (so the Home "Lumi noticed" surface lights up automatically)
//
// Spec: lumi-learning-recurrence-architecture.md §3 + lumi-ai-arch §3.

import { Quest } from '../../store/questStore';
import { Importance } from '../../constants/importance';
import {
  RecurRule,
  CadenceKey,
  WeekdayKey,
  RecurPart,
  RDAYS,
} from '../../constants/recur';
import type { Suggestion } from '../../store/suggestionsStore';

const MIN_OCCURRENCES = 3;
const LOOKBACK_DAYS = 56; // ~8 weeks
const MIN_CONFIDENCE = 0.45;

// Normalize a title for grouping: lowercased, punctuation/numbers
// stripped, whitespace collapsed. "Grocery run!" and "grocery run"
// must hash to the same bucket.
const normalizeTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ymd = (d: Date): string => {
  // Local Y-M-D — recurrence detector compares quest dates, which are
  // local. UTC was clipping any quest done in evening hours west of
  // UTC into the wrong day, breaking weekly/biweekly detection.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fromYmd = (s: string): Date => new Date(s + 'T00:00:00');

const dayDiff = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

// ── time-of-day windowing for inferring `part` ─────────────────────
// Driven by the user's effective windows (Windows editor + anchors),
// NOT the legacy 11/14/17 literals. Resolved at call time via the
// non-hook getter.
const partOfHour = (h: number): RecurPart => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const w = require('../../constants/windows').getEffectiveWindows() as Record<
    string,
    { start: number; end: number }
  >;
  if (h < w.midday.start) return 'morning';
  if (h < w.afternoon.start) return 'midday';
  if (h < w.evening.start) return 'afternoon';
  return 'evening';
};

// "May 5 · Sun" / "Mon 9:05a" — short readable evidence chips.
const formatEvidence = (d: Date, withTime = false): string => {
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  const day = d.getDate();
  const wd = RDAYS[d.getDay()];
  if (withTime) {
    const h = d.getHours() % 12 || 12;
    const m = d.getMinutes().toString().padStart(2, '0');
    const ampm = d.getHours() < 12 ? 'a' : 'p';
    return `${wd} ${h}:${m}${ampm}`;
  }
  return `${month} ${day} · ${wd}`;
};

interface CadenceClassification {
  rule: RecurRule;
  /** Average gap variance — 0 = perfectly regular, →1 = chaotic. */
  variance: number;
  /** Human copy for the card's "span" line. */
  span: string;
}

const classifyCadence = (
  completions: Date[],
  dominantPart: RecurPart,
): CadenceClassification | null => {
  if (completions.length < MIN_OCCURRENCES) return null;
  const sorted = [...completions].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(dayDiff(sorted[i - 1], sorted[i]));
  }
  const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const variance =
    gaps.reduce((s, g) => s + Math.abs(g - meanGap), 0) /
    (gaps.length * Math.max(meanGap, 1));

  // Same weekday across all completions?
  const weekdays = new Set(sorted.map((d) => d.getDay()));
  const sameWeekday = weekdays.size === 1;
  const targetWeekday = sorted[0].getDay();
  const targetDay: WeekdayKey = RDAYS[targetWeekday];

  // Weekday-only (Mon-Fri) cadence?
  const allWeekdays = sorted.every((d) => d.getDay() >= 1 && d.getDay() <= 5);

  let every: CadenceKey;
  let day: WeekdayKey | undefined;
  let spanCount: number;

  if (meanGap < 1.5) {
    // Daily
    every = allWeekdays && !weekdays.has(0) && !weekdays.has(6)
      ? 'weekday'
      : 'day';
    spanCount = sorted.length;
  } else if (meanGap >= 6 && meanGap <= 8.5 && sameWeekday) {
    every = 'week';
    day = targetDay;
    spanCount = sorted.length;
  } else if (meanGap >= 12 && meanGap <= 16 && sameWeekday) {
    every = '2week';
    day = targetDay;
    spanCount = sorted.length;
  } else if (meanGap >= 27 && meanGap <= 32) {
    every = 'month';
    spanCount = sorted.length;
  } else if (meanGap >= 5 && meanGap <= 9 && variance > 0.15) {
    // Loose "weekly-ish" — fall back to weekly with the most common day.
    const dayCounts = new Map<number, number>();
    sorted.forEach((d) => {
      dayCounts.set(d.getDay(), (dayCounts.get(d.getDay()) ?? 0) + 1);
    });
    const bestDay = Array.from(dayCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0][0];
    every = 'week';
    day = RDAYS[bestDay];
    spanCount = sorted.length;
  } else {
    return null;
  }

  // Human copy for the span chip.
  let span: string;
  if (every === 'week' && day) {
    const noun = `${day}${spanCount > 1 ? 's' : ''}`;
    span = `${spanCount} ${noun} in a row`;
  } else if (every === '2week' && day) {
    span = `every other ${day}, ${spanCount} times`;
  } else if (every === 'weekday') {
    span = 'every weekday this week';
  } else if (every === 'day') {
    span = `${spanCount} days in a row`;
  } else if (every === 'month') {
    span = `${spanCount} months in a row`;
  } else {
    span = `${spanCount} times`;
  }

  return { rule: { every, day, part: dominantPart }, variance, span };
};

interface DetectorOptions {
  /** Titles the user has waved off — don't re-suggest. */
  suppressed?: Set<string>;
  /** Titles that already have an active recurring quest. */
  existingRecurringTitles?: Set<string>;
}

export const detectRecurrencePatterns = (
  quests: Quest[],
  opts: DetectorOptions = {},
): Suggestion[] => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffISO = ymd(cutoff);

  // Group completed quests by normalized title.
  const groups = new Map<
    string,
    { title: string; importance: Importance; completions: Date[] }
  >();
  for (const q of quests) {
    if (!q.completed || !q.completedAt) continue;
    if (q.date < cutoffISO) continue;
    const key = normalizeTitle(q.title);
    if (!key) continue;
    const existing = groups.get(key);
    const d = new Date(q.completedAt);
    if (existing) {
      existing.completions.push(d);
    } else {
      groups.set(key, {
        title: q.title,
        importance: q.importance,
        completions: [d],
      });
    }
  }

  const suggestions: Suggestion[] = [];
  for (const [key, g] of groups.entries()) {
    if (g.completions.length < MIN_OCCURRENCES) continue;
    if (opts.suppressed?.has(key)) continue;
    if (opts.existingRecurringTitles?.has(key)) continue;

    // Dominant part-of-day: histogram of completion hours.
    const partCounts: Record<RecurPart, number> = {
      morning: 0,
      midday: 0,
      afternoon: 0,
      evening: 0,
    };
    g.completions.forEach((d) => {
      partCounts[partOfHour(d.getHours())]++;
    });
    const dominantPart = (Object.entries(partCounts) as [
      RecurPart,
      number,
    ][]).sort((a, b) => b[1] - a[1])[0][0];

    const classification = classifyCadence(g.completions, dominantPart);
    if (!classification) continue;

    // Confidence = regularity × density.
    const regularity = 1 - Math.min(1, classification.variance);
    const density = Math.min(1, g.completions.length / 4);
    const confidence = regularity * density;
    if (confidence < MIN_CONFIDENCE) continue;

    // Pick most recent 3-4 evidence stamps.
    const recent = [...g.completions]
      .sort((a, b) => b.getTime() - a.getTime())
      .slice(0, 4)
      .reverse();
    const evidence = recent.map((d) => formatEvidence(d));

    suggestions.push({
      id: `detect_${key.replace(/\s+/g, '_')}_${classification.rule.every}`,
      kind: 'recurrence',
      title: g.title,
      importance: g.importance,
      span: classification.span,
      guess: classification.rule,
      evidence,
    });
  }

  // Rank: most confident first. Cap to a few so the UI stays calm.
  return suggestions.slice(0, 6);
};

// Exported for test access — useful as a hash to suppress re-emission.
export const normalizeForSuppression = normalizeTitle;
export const _internal = { classifyCadence, fromYmd, dayDiff, partOfHour };
