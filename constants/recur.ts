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

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
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
  const n = effInterval(rule);

  switch (rule.every) {
    case 'day':
      // "every N days" — advance N days from the last spawn.
      return ymd(addDays(from, n));

    case 'weekday': {
      let d = addDays(from, 1);
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
      return ymd(d);
    }

    case 'week': {
      // "every N weeks on <day>" — walk to the next matching weekday,
      // then add (n-1) more weeks so the gap is exactly N weeks.
      const target = rule.day ? WEEKDAY_INDEX[rule.day] : from.getDay();
      let d = addDays(from, 1);
      while (d.getDay() !== target) d = addDays(d, 1);
      if (n > 1) d = addDays(d, (n - 1) * 7);
      return ymd(d);
    }

    case '2week': {
      // Legacy biweekly — same as week + 1 extra 7-day jump.
      const target = rule.day ? WEEKDAY_INDEX[rule.day] : from.getDay();
      let d = addDays(from, 1);
      while (d.getDay() !== target) d = addDays(d, 1);
      return ymd(addDays(d, 7));
    }

    case 'month': {
      const d = new Date(from);
      d.setMonth(d.getMonth() + n);
      return ymd(d);
    }
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
