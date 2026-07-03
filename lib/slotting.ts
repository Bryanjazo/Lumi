// Lumi · auto-slotting for windowed tasks
//
// "Set it to morning" should MEAN a time. Before this, every windowed
// task piled up at the window's start on the Time thread (five tasks
// all reading "11a"). Now, when a task is committed with a window but
// no explicit time, we materialize the NEXT OPEN SLOT in that window:
// walk from the window start, skip past anchors (breakfast at 8:00
// blocks until 8:15) and everything already scheduled (each occupying
// its duration), snap to the quarter hour, and write a real anchor.
//
// Decisions happen ONCE at commit — same philosophy as capture's
// existing rule ("the render is read-only after that"). No reflowing
// at render time; if the user wants a task elsewhere they drag it.
//
// When a window can't fit the task at all, findWindowSlot returns
// null: callers either fall back to plain windowed (renders at the
// window start, worst case is the old behavior) or — in pickers —
// gray the window out entirely via windowIsFull.

import type { Quest } from '../store/questStore';
import type { DailyAnchors } from '../store/userStore';
import type { WindowKey } from '../constants/windows';
import { todayKey } from './gamification';

/** Anchors are moments, not blocks — but a task shouldn't start ON
 *  one. Breakfast at 8:00 pushes the first slot to 8:15. */
const ANCHOR_BLOCK_MIN = 15;
const SNAP = 15;

const roundUp = (m: number): number => Math.ceil(m / SNAP) * SNAP;

/** Shape-compatible with useEffectiveWindows()'s return — hours, with
 *  null start/end for someday. Typed loosely so lib code doesn't need
 *  the hook's exact ReturnType. */
interface EffectiveWindowsLike {
  [key: string]: {
    label: string;
    start: number | null;
    end: number | null;
  };
}

export interface SlotQuery {
  window: WindowKey;
  /** Target day (YYYY-MM-DD local). */
  dateISO: string;
  durationMin: number;
  /** ALL quests — read fresh from the store per call so consecutive
   *  commits cascade (task two lands after task one). */
  quests: Quest[];
  anchors: DailyAnchors;
  effectiveWindows: EffectiveWindowsLike;
  /** Minute-of-day "now" — pass when dateISO is today so a slot never
   *  lands in the past. Null/undefined for future days. */
  nowMin?: number | null;
}

/** Next open start (minutes since midnight) in the window that fits
 *  `durationMin`, or null when the window is full. */
export const findWindowSlot = (q: SlotQuery): number | null => {
  if (q.window === 'someday') return null;
  const win = q.effectiveWindows[q.window];
  if (!win || win.start == null || win.end == null) return null;
  const winStart = win.start * 60;
  const winEnd = win.end * 60;

  // Busy intervals on the target day: the routine anchors + every
  // already-scheduled task (completed ones too — their slot is spent).
  const busy: { s: number; e: number }[] = [
    q.anchors.wake,
    q.anchors.breakfast,
    q.anchors.lunch,
    q.anchors.dinner,
    q.anchors.sleep,
  ].map((a) => ({ s: a, e: a + ANCHOR_BLOCK_MIN }));
  for (const t of q.quests) {
    if (t.window === 'someday') continue;
    if ((t.date ?? todayKey()) !== q.dateISO) continue;
    if (t.scheduledHour == null) continue;
    const s = t.scheduledHour * 60 + (t.scheduledMinute ?? 0);
    busy.push({ s, e: s + (t.durationMinutes ?? 30) });
  }
  busy.sort((a, b) => a.s - b.s);

  let cand = winStart;
  if (q.dateISO === todayKey() && q.nowMin != null) {
    cand = Math.max(cand, q.nowMin + 5);
  }
  cand = roundUp(cand);

  // Walk the sorted blocks forward. `cand` only ever moves right, so
  // one pass settles it.
  for (const b of busy) {
    if (b.e <= cand) continue; // already behind us
    if (b.s >= cand + q.durationMin) break; // fits before this block
    cand = roundUp(Math.max(cand, b.e));
  }
  return cand + q.durationMin <= winEnd ? cand : null;
};

/** True when the window can't fit a task of this length — pickers use
 *  it to gray the window out. */
export const windowIsFull = (q: SlotQuery): boolean =>
  findWindowSlot(q) == null;
