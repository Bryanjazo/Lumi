// Lumi · THE one definition of "this week".
//
// Audit finding: three surfaces disagreed — the recap counted by
// planned date over a rolling 7 days, Me's story by completion time
// over rolling 168h, Patterns by Sunday-anchored calendar week. A
// user tapped "full recap →" after Me said "9 things this week" and
// the recap said 6. Everyone now counts the same thing Patterns'
// grid draws: completions (by LOCAL completion day) inside the
// Sunday-anchored calendar week, merged with the persisted doneLog
// ledger so deleting old quests can't cool history.

import type { Quest } from '../store/questStore';

export const localYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Noon-anchored start of the Sunday week `offset` weeks back
 *  (0 = current week). Noon keeps DST from shifting the day. */
export const sundayWeekStart = (offset = 0, now = new Date()): Date => {
  const s = new Date(now);
  s.setHours(12, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay() - offset * 7);
  return s;
};

/** Per-day completion counts (quest-derived, max-merged with the
 *  doneLog ledger) for the 7 days of a Sunday week. Future days 0. */
export const completedByDayForWeek = (
  quests: Quest[],
  doneLog: Record<string, number>,
  offset = 0,
  now = new Date(),
): number[] => {
  const byDay = new Map<string, number>();
  for (const q of quests) {
    if (!q.completed || !q.completedAt) continue;
    const k = localYmd(new Date(q.completedAt));
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const start = sundayWeekStart(offset, now);
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = localYmd(d);
    out.push(Math.max(byDay.get(k) ?? 0, doneLog[k] ?? 0));
  }
  return out;
};

/** Total completions in a Sunday week (0 = current). */
export const completedForWeek = (
  quests: Quest[],
  doneLog: Record<string, number>,
  offset = 0,
  now = new Date(),
): number =>
  completedByDayForWeek(quests, doneLog, offset, now).reduce(
    (a, b) => a + b,
    0,
  );

/** Open+done tasks PLANNED into the current Sunday week (by q.date).
 *  Floored at the completion count so "done / set" can't exceed 1
 *  when the week's work was clearing older backlog. */
export const plannedForWeek = (
  quests: Quest[],
  doneCount: number,
  offset = 0,
  now = new Date(),
): number => {
  const start = sundayWeekStart(offset, now);
  const startK = localYmd(start);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const endK = localYmd(end);
  const planned = quests.filter(
    (q) => q.window !== 'someday' && q.date && q.date >= startK && q.date <= endK,
  ).length;
  return Math.max(planned, doneCount);
};

/** Best FULL past week on record (from the ledger alone) — lets
 *  "your best yet" be a verified claim instead of "better than last
 *  week". Returns 0 when there's no history. */
export const bestPastWeek = (
  doneLog: Record<string, number>,
  now = new Date(),
): number => {
  const currentStart = localYmd(sundayWeekStart(0, now));
  const weekTotals = new Map<string, number>();
  for (const [k, n] of Object.entries(doneLog)) {
    if (k >= currentStart) continue; // current week isn't "past"
    const d = new Date(k + 'T12:00');
    const wk = localYmd(sundayWeekStart(0, d));
    weekTotals.set(wk, (weekTotals.get(wk) ?? 0) + n);
  }
  let best = 0;
  for (const v of weekTotals.values()) best = Math.max(best, v);
  return best;
};
