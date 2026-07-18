// Lumi · recurrence — pure types + helpers.
//
// Spec: lumi-learning-recurrence-architecture.md.
// Recurring quests are always windowed (part-of-day), never anchored
// to an exact clock time — that sidesteps timezone/DST in v1.

import { WindowKey } from './windows';

export type CadenceKey = 'day' | 'weekday' | 'week' | '2week' | 'month';
export type WeekdayKey =
  | 'Sun'
  | 'Mon'
  | 'Tue'
  | 'Wed'
  | 'Thu'
  | 'Fri'
  | 'Sat';

/** Part-of-day a recurring quest lives in. Excludes "someday". */
export type RecurPart = Exclude<WindowKey, 'someday'>;

export interface RecurRule {
  every: CadenceKey;
  /** Only meaningful for week / 2week. */
  day?: WeekdayKey;
  /** Maps to the quest's window. */
  part: RecurPart;
  /**
   * Optional clock time as minutes since midnight (e.g. 480 = 8 AM).
   * When set, each spawned instance also gets scheduledHour/Minute so
   * the recurring task lands at a SPECIFIC time on the Time tab,
   * not just floating in its part-of-day. Set via the "schedule
   * habit" sheet on Home.
   */
  at?: number;
  /**
   * Custom interval — "every N days / weeks / months". Defaults to 1
   * when absent (backward-compatible with the original fixed
   * cadences). `every: 'day', interval: 3` → every 3 days;
   * `every: 'week', interval: 4` → every 4 weeks; etc. Ignored when
   * `every: 'weekday'` (the weekday-only cadence has no interval
   * sense) and when `every: '2week'` (legacy — already biweekly).
   */
  interval?: number;
}

export const CADENCES: { key: CadenceKey; label: string }[] = [
  { key: 'day', label: 'Every day' },
  { key: 'weekday', label: 'Weekdays' },
  { key: 'week', label: 'Weekly' },
  { key: '2week', label: 'Every 2 weeks' },
  { key: 'month', label: 'Monthly' },
];

export const RDAYS: WeekdayKey[] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];

export const RPARTS: RecurPart[] = [
  'morning',
  'midday',
  'afternoon',
  'evening',
];

const CADENCE_LABEL = new Map(CADENCES.map((c) => [c.key, c.label]));
const WEEKDAY_INDEX: Record<WeekdayKey, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Effective interval — 1 when undefined or for cadences that don't
// take an interval. Pulled out so all four readers (text, badge,
// nextOccurrence, due-today check) agree on the same fallback.
const effInterval = (rule: RecurRule): number => {
  if (rule.every === 'weekday' || rule.every === '2week') return 1;
  return rule.interval && rule.interval > 0 ? Math.floor(rule.interval) : 1;
};

/** Human cadence label e.g. "every Mon, morning" or "every 3 days, morning". */
export const cadenceText = (rule: RecurRule): string => {
  const n = effInterval(rule);
  let s = (CADENCE_LABEL.get(rule.every) ?? 'Weekly').toLowerCase();
  if (rule.every === 'week' && rule.day) {
    s = n > 1 ? `every ${n} weeks on ${rule.day}` : `every ${rule.day}`;
  } else if (rule.every === '2week' && rule.day) {
    s = `every other ${rule.day}`;
  } else if (rule.every === 'day' && n > 1) {
    s = `every ${n} days`;
  } else if (rule.every === 'week' && n > 1) {
    s = `every ${n} weeks`;
  } else if (rule.every === 'month' && n > 1) {
    s = `every ${n} months`;
  }
  return `${s}${rule.part ? `, ${rule.part}` : ''}`;
};

/** Short badge text shown next to the window chip. */
export const recurBadge = (rule: RecurRule): string => {
  const n = effInterval(rule);
  if (rule.every === 'week' && rule.day) {
    return n > 1 ? `${n}w · ${rule.day}` : rule.day;
  }
  if (rule.every === 'weekday') return 'weekdays';
  if (rule.every === 'day') return n > 1 ? `every ${n}d` : 'daily';
  if (rule.every === '2week' && rule.day) return `2w · ${rule.day}`;
  if (rule.every === 'month') return n > 1 ? `every ${n}mo` : 'monthly';
  return CADENCE_LABEL.get(rule.every)?.toLowerCase() ?? 'repeats';
};

// LOCAL day, never toISOString().slice — UTC keys made every habit
// spawn a day early east of UTC (weekly-Monday fired on Sunday in
// Berlin/Tokyo/Sydney) and come due hours early for US evenings.
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s: string): Date => new Date(s + 'T00:00:00');
const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/**
 * Next occurrence date (YYYY-MM-DD) given the rule and a "from" date.
 * Returned date is strictly after `fromISO` — i.e. when the NEXT
 * instance should appear. If `fromISO` is null/undefined, we start
 * from today.
 */
export const nextOccurrence = (rule: RecurRule, fromISO?: string): string => {
  const from = fromISO ? fromYmd(fromISO) : new Date();
  from.setHours(0, 0, 0, 0);
  // Walk forward to the first day the rule FIRES, using the exact same
  // predicate the Time projection draws with (firesOnDate). This is
  // the fix for the two-writer drift: the spawn cadence and the ghost
  // projection now share ONE definition, so they can never disagree on
  // month-end (Jan 31 → skip Feb → Mar 31) or interval parity. The cap
  // covers the widest realistic gap — a high-interval monthly rule on
  // the 31st that skips short months can be a couple years out (interval
  // is user-settable up to 99) — while still terminating on a malformed
  // rule, where the fallback keeps callers moving.
  let d = addDays(from, 1);
  for (let i = 0; i < 4200; i++) {
    if (firesOnDate(rule, d, fromISO)) return ymd(d);
    d = addDays(d, 1);
  }
  return ymd(addDays(from, 30));
};

// DST-safe local day index — raw getTime()/86400000 mis-buckets across
// the spring-forward 23-hour day. Noon anchor dodges it.
const dayNumber = (d: Date): number => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  return Math.round(x.getTime() / 86400000);
};

/**
 * THE canonical "does this rule fire on calendar date `date`, given the
 * schedule anchor `anchorISO`?" predicate. Used by Time's ghost
 * projection so the projection and the store's spawn cadence
 * (nextOccurrence) can never disagree — they used to drift on month
 * interval and month-end. An occurrence never fires before its anchor.
 */
export const firesOnDate = (
  rule: RecurRule,
  date: Date,
  anchorISO?: string,
): boolean => {
  const dow = date.getDay();
  const n = effInterval(rule);
  const anchor = anchorISO ? new Date(anchorISO + 'T12:00:00') : new Date();
  switch (rule.every) {
    case 'day': {
      const diff = dayNumber(date) - dayNumber(anchor);
      return diff >= 0 && diff % n === 0;
    }
    case 'weekday':
      return dow >= 1 && dow <= 5;
    case 'week': {
      // A dayless week rule (common from bulk capture — "gym weekly")
      // fires on the ANCHOR's weekday, matching the pre-unification
      // spawn. Returning false here made nextOccurrence's walk never
      // fire → habits respawned ~monthly.
      const target = rule.day ? WEEKDAY_INDEX[rule.day] : anchor.getDay();
      if (target !== dow) return false;
      const weeks = Math.floor((dayNumber(date) - dayNumber(anchor)) / 7);
      if (weeks < 0) return false;
      return n <= 1 ? true : weeks % n === 0;
    }
    case '2week': {
      const target = rule.day ? WEEKDAY_INDEX[rule.day] : anchor.getDay();
      if (target !== dow) return false;
      const weeks = Math.floor((dayNumber(date) - dayNumber(anchor)) / 7);
      return weeks >= 0 && weeks % 2 === 0;
    }
    case 'month': {
      // Clamp to short months: a "monthly" anchored on the 29th–31st
      // fires on the month's LAST day when the anchor day doesn't
      // exist (Jan 31 → Feb 28/29 → Mar 31). The strict-equality
      // version silently skipped those months (~7 fires/year for a
      // 31st anchor), which contradicts the "monthly" label.
      const daysInMonth = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
      ).getDate();
      const targetDay = Math.min(anchor.getDate(), daysInMonth);
      if (date.getDate() !== targetDay) return false;
      const months =
        (date.getFullYear() - anchor.getFullYear()) * 12 +
        (date.getMonth() - anchor.getMonth());
      return months >= 0 && months % n === 0;
    }
    default:
      return false;
  }
};

/**
 * Is the rule due today, given the last-spawned date? Used by Home's
 * refreshRecurring() to know when to flip a recurring quest's
 * completion back to open.
 */
export const isDueToday = (
  rule: RecurRule,
  lastSpawnedISO?: string,
): boolean => {
  const today = ymd(new Date());
  if (!lastSpawnedISO) return true; // never spawned → due now
  const next = nextOccurrence(rule, lastSpawnedISO);
  return next <= today;
};
