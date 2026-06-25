// Lumi · learning · win of the week
//
// "The thing you'd have forgotten you did." Highest-tier completion
// after the longest delay. Per the architecture: importance rank ×
// days-from-create-to-complete = win score. Returns null if no
// completions worth featuring this week.

import { Quest } from '../../store/questStore';

export interface WinItem {
  quest: Quest;
  /** Days between createdAt and completedAt (clamped to 14). */
  delayDays: number;
  /** Day of week the win landed (0=Sun..6=Sat). */
  completedDow: number;
  /** Short copy for the recap card. */
  headline: string;
  body: string;
}

const ymd = (d: Date): string => {
  // Local Y-M-D so date keys agree with todayKey() in gamification and
  // quest.date written by the store. UTC was off by a day in evening
  // hours west of UTC.
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

const importanceRank = (imp: Quest['importance']): number =>
  imp === 'high' ? 3 : imp === 'medium' ? 2 : 1;

const DOW_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Window cuts are driven by the user's effective windows (Windows
// editor + anchors), NOT the legacy 11/14/17 literals. Resolved at
// call time via the non-hook getter so this module stays sync-safe.
const partOfDay = (hour: number): string => {
  // Lazy require to dodge an import cycle (constants/windows pulls
  // userStore which can be touched during learning-digest reads).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const w = require('../../constants/windows').getEffectiveWindows() as Record<
    string,
    { start: number; end: number }
  >;
  if (hour < w.midday.start) return 'morning';
  if (hour < w.afternoon.start) return 'midday';
  if (hour < w.evening.start) return 'afternoon';
  return 'evening';
};

export const findWinOfWeek = (quests: Quest[]): WinItem | null => {
  const thisWeekStart = isoOffset(-6);
  const today = ymd(new Date());
  let best: { quest: Quest; score: number; delay: number } | null = null;

  for (const q of quests) {
    if (!q.completed || !q.completedAt) continue;
    const completedDay = q.completedAt.slice(0, 10);
    if (completedDay < thisWeekStart || completedDay > today) continue;
    const created = new Date(q.createdAt);
    const completed = new Date(q.completedAt);
    const delay = Math.max(
      0,
      Math.floor((completed.getTime() - created.getTime()) / 86_400_000),
    );
    const clampedDelay = Math.min(delay, 14);
    const score = importanceRank(q.importance) * (1 + clampedDelay);
    if (!best || score > best.score) {
      best = { quest: q, score, delay };
    }
  }

  if (!best) return null;
  const completed = new Date(best.quest.completedAt!);
  const dow = completed.getDay();
  const part = partOfDay(completed.getHours());
  const dayCopy = DOW_NAMES[dow].toLowerCase() + ' ' + part;
  const delayCopy =
    best.delay >= 3
      ? ` — after putting it off for ${best.delay} days`
      : '';
  return {
    quest: best.quest,
    delayDays: Math.min(best.delay, 14),
    completedDow: dow,
    headline: `You finally finished ${best.quest.title.toLowerCase()}${delayCopy}.`,
    body:
      best.delay >= 3
        ? `That had been sitting on your list for over a week. You did it ${dayCopy}. Worth remembering.`
        : `Solid follow-through on a ${best.quest.importance === 'high' ? 'Trial' : 'Task'} — done ${dayCopy}.`,
  };
};
