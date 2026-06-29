// Lumi · learning · follow-through stats
//
// Pure math layer for "how reliable am I, and where am I strongest?"
// Used by the Recap (done/set this week, trend, mini-bars) and the
// "Lumi noticed" pattern card (strong-window insight).

import { Quest } from '../../store/questStore';
import { WindowKey } from '../../constants/windows';
import { Importance } from '../../constants/importance';

export interface WindowStat {
  window: WindowKey;
  set: number;
  done: number;
  /** done / set, or 0 when set is 0. */
  rate: number;
}

export interface DowStat {
  dow: number; // 0=Sun..6=Sat
  set: number;
  done: number;
  rate: number;
}

export interface FollowThrough {
  /** This week (last 7 days through today). */
  thisWeek: { done: number; set: number };
  /** The 7 days before this week. */
  lastWeek: { done: number; set: number };
  /** Trend: thisWeek.done - lastWeek.done. */
  trend: number;
  /** done count per day of the last 7 days (oldest → newest). */
  doneByDay: number[];
  /**
   * One-letter day labels aligned to `doneByDay` — index 0 is six
   * days ago, index 6 is TODAY. Recap uses these instead of a
   * hardcoded "MTWTFSS" string (which was right only on Sundays).
   */
  doneByDayLetters: string[];
  /** Per-window stats over the last 28 days. */
  windowStats: WindowStat[];
  /** Per-day-of-week stats over the last 28 days. */
  dowStats: DowStat[];
  /** Strongest window (highest rate with ≥3 attempts). Null if no data. */
  strongWindow: WindowStat | null;
  /** Weakest window with enough data to be a real signal. */
  weakWindow: WindowStat | null;
}

// LOCAL Y-M-D keys throughout so we agree with todayKey()
// (lib/gamification) and capture.ts. UTC was off by a day at evening
// hours and threw off every recap surface that read this digest.
const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const isoOffset = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

const MIN_FOR_PATTERN = 3;

export const computeFollowThrough = (quests: Quest[]): FollowThrough => {
  const today = ymd(new Date());
  const thisStart = isoOffset(-6);
  const lastEnd = isoOffset(-7);
  const lastStart = isoOffset(-13);
  const monthCutoff = isoOffset(-27);

  const inThisWeek = quests.filter(
    (q) => q.date >= thisStart && q.date <= today,
  );
  const inLastWeek = quests.filter(
    (q) => q.date >= lastStart && q.date <= lastEnd,
  );
  const inMonth = quests.filter((q) => q.date >= monthCutoff);

  const thisWeek = {
    done: inThisWeek.filter((q) => q.completed).length,
    set: inThisWeek.length,
  };
  const lastWeek = {
    done: inLastWeek.filter((q) => q.completed).length,
    set: inLastWeek.length,
  };

  // done per day, last 7 days oldest → newest.
  // Slot 0 = 6 days ago, slot 6 = today (LOCAL). We key by the quest's
  // local Y-M-D against the slot's local Y-M-D so an evening
  // completion lands on its actual day, not tomorrow's UTC.
  const doneByDay: number[] = Array(7).fill(0);
  const doneByDayLetters: string[] = Array(7).fill('');
  const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const slotKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    slotKeys.push(ymd(d));
    doneByDayLetters[6 - i] = dayLetters[d.getDay()];
  }
  inThisWeek
    .filter((q) => q.completed)
    .forEach((q) => {
      const idx = slotKeys.indexOf(q.date);
      if (idx >= 0) doneByDay[idx]++;
    });

  // Per-window stats over 28 days.
  const windows: WindowKey[] = [
    'morning',
    'midday',
    'afternoon',
    'evening',
    'someday',
  ];
  const windowStats: WindowStat[] = windows.map((w) => {
    const set = inMonth.filter((q) => q.window === w).length;
    const done = inMonth.filter((q) => q.window === w && q.completed).length;
    return { window: w, set, done, rate: set ? done / set : 0 };
  });

  // Per-DoW stats: use completedAt for the DoW so it reflects when
  // work actually happened, not when it was planned.
  const dowStats: DowStat[] = Array.from({ length: 7 }, (_, dow) => ({
    dow,
    set: 0,
    done: 0,
    rate: 0,
  }));
  for (const q of inMonth) {
    const planned = new Date(q.date + 'T00:00:00');
    const plannedDow = planned.getDay();
    dowStats[plannedDow].set++;
    if (q.completed) dowStats[plannedDow].done++;
  }
  dowStats.forEach((s) => {
    s.rate = s.set ? s.done / s.set : 0;
  });

  // Strongest / weakest windows — only flag if we have enough samples.
  const realWindows = windowStats.filter(
    (s) => s.window !== 'someday' && s.set >= MIN_FOR_PATTERN,
  );
  const strongWindow =
    realWindows.length > 0
      ? realWindows.reduce((a, b) => (b.rate > a.rate ? b : a))
      : null;
  const weakWindow =
    realWindows.length > 0
      ? realWindows.reduce((a, b) => (b.rate < a.rate ? b : a))
      : null;

  return {
    thisWeek,
    lastWeek,
    trend: thisWeek.done - lastWeek.done,
    doneByDay,
    doneByDayLetters,
    windowStats,
    dowStats,
    strongWindow,
    weakWindow: strongWindow && weakWindow && strongWindow.window !== weakWindow.window ? weakWindow : null,
  };
};

// ── Pattern phrasing (the LLM would polish; templates work today) ──

const windowLabel = (w: WindowKey): string =>
  w === 'morning'
    ? 'morning'
    : w === 'midday'
      ? 'midday'
      : w === 'afternoon'
        ? 'afternoon'
        : w === 'evening'
          ? 'evening'
          : 'someday';

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
const fraction = (done: number, set: number): string =>
  `${done} in ${set}`;

export interface StrongWindowInsight {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  strong: WindowKey;
  weak: WindowKey | null;
}

/**
 * Generate the recap's "Pattern" section copy from the strong/weak
 * windows. Returns null if the data isn't strong enough to surface.
 */
export const strongWindowInsight = (
  ft: FollowThrough,
  importanceFilter?: Importance,
): StrongWindowInsight | null => {
  if (!ft.strongWindow || !ft.weakWindow) return null;
  // Only surface when the strong window is clearly better.
  if (ft.strongWindow.rate - ft.weakWindow.rate < 0.2) return null;
  void importanceFilter;
  const strong = ft.strongWindow.window;
  const weak = ft.weakWindow.window;

  const headline = `You finish ${fraction(ft.strongWindow.done, ft.strongWindow.set)} ${windowLabel(strong)} quests — but only ${fraction(ft.weakWindow.done, ft.weakWindow.set)} ${windowLabel(weak)}.`;
  const body = `${windowLabel(strong)[0].toUpperCase()}${windowLabel(strong).slice(1)}s are your strong window (${pct(ft.strongWindow.rate)}). The hard stuff lands better there.`;
  const cta = `Schedule my Trials in the ${windowLabel(strong)} →`;

  return {
    eyebrow: 'Lumi noticed something',
    headline,
    body,
    cta,
    strong,
    weak,
  };
};
