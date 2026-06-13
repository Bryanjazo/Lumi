export const LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 900, 1400, 2000, 2800, 3800, 5000, 6500, 8200, 10200, 12500,
  15100, 18000,
];

export const TITLES = [
  'Just Starting',
  'Finding Footing',
  'Building Rhythm',
  'Steady Hands',
  'In the Flow',
  'Real Momentum',
  'Practiced',
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

export const todayKey = () => new Date().toISOString().slice(0, 10);
