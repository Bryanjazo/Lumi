export const LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 900, 1400, 2000, 2800, 3800, 5000, 6500, 8200, 10200, 12500,
  15100, 18000,
];

export const TITLES = [
  'First Spark',
  'Finding Footing',
  'Quiet Climb',
  'Steady Hands',
  'Soft Momentum',
  'Building Rhythm',
  'Focused Wanderer',
  'Tuned In',
  'Lit Up',
  'Untamed',
  'Threshold',
  'Threshold',
  'Threshold',
  'Threshold',
  'Threshold',
  'Threshold',
];

export const levelFromXp = (xp: number) => {
  let lvl = 0;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
    else break;
  }
  return lvl;
};

export const xpProgress = (xp: number) => {
  const lvl = levelFromXp(xp);
  const cur = LEVEL_THRESHOLDS[lvl - 1] ?? 0;
  const next = LEVEL_THRESHOLDS[lvl] ?? cur + 1000;
  const pct = Math.max(0, Math.min(1, (xp - cur) / (next - cur)));
  return { level: lvl, cur, next, pct, title: TITLES[lvl - 1] ?? 'Threshold' };
};

export const xpForQuest = (difficulty: 'easy' | 'medium' | 'hard') => {
  if (difficulty === 'easy') return 30;
  if (difficulty === 'medium') return 80;
  return 160;
};

export const XP = {
  checkin: 30,
  sos: 50,
  brainDump: 15,
} as const;

export type LunaState = 'thriving' | 'struggling' | 'away';

export const lunaState = (params: {
  questsCompletedToday: number;
  dailyQuestTarget: number;
  streak: number;
  checkedInToday: boolean;
  lastActiveDaysAgo: number;
}): LunaState => {
  const energy =
    (params.questsCompletedToday / Math.max(1, params.dailyQuestTarget)) * 10;
  if (params.lastActiveDaysAgo > 2) return 'away';
  if (energy >= 6 && params.streak >= 1) return 'thriving';
  if (energy >= 3 || params.checkedInToday) return 'struggling';
  return 'struggling';
};

/**
 * Format a Date as YYYY-MM-DD in the USER'S LOCAL TIMEZONE.
 *
 * Why local (not UTC via toISOString): "today" needs to mean the same
 * calendar day everywhere in the app. With UTC, a user at 11 PM
 * Pacific (= 7 AM UTC next day) would write tasks with tomorrow's UTC
 * date — and the Time tab (which derives "today" from local midnight)
 * would show those tasks on tomorrow. Aligning everything to local
 * fixes that mismatch.
 */
export const localYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const todayKey = (): string => localYmd(new Date());
