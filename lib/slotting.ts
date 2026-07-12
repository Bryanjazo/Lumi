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
// When a window can't fit the task, resolveSlot overflows honestly
// instead of letting tasks pile up at the window start ("five tasks
// all at 11a"): first the next open slot later the SAME day, then the
// first future day with room. Pickers still gray full windows out via
// windowIsFull.

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

/** Busy intervals on the target day: the routine anchors + every
 *  already-scheduled task (completed ones too — their slot is spent). */
const busyFor = (q: SlotQuery): { s: number; e: number }[] => {
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
  return busy.sort((a, b) => a.s - b.s);
};

/** Walk the sorted blocks forward from `from`; first :15 start where
 *  `durationMin` fits before `end`, or null. `cand` only ever moves
 *  right, so one pass settles it. */
const walkSlots = (
  q: SlotQuery,
  from: number,
  end: number,
): number | null => {
  let cand = from;
  if (q.dateISO === todayKey() && q.nowMin != null) {
    cand = Math.max(cand, q.nowMin + 5);
  }
  cand = roundUp(cand);
  for (const b of busyFor(q)) {
    if (b.e <= cand) continue; // already behind us
    if (b.s >= cand + q.durationMin) break; // fits before this block
    cand = roundUp(Math.max(cand, b.e));
  }
  return cand + q.durationMin <= end ? cand : null;
};

/** Next open start (minutes since midnight) in the window that fits
 *  `durationMin`, or null when the window is full. */
export const findWindowSlot = (q: SlotQuery): number | null => {
  if (q.window === 'someday') return null;
  const win = q.effectiveWindows[q.window];
  if (!win || win.start == null || win.end == null) return null;
  return walkSlots(q, win.start * 60, win.end * 60);
};

/** Overflow — the window is full but the DAY may not be: next open
 *  slot from the window's start forward to the sleep anchor (never
 *  earlier than asked — an "afternoon" task must not surprise-land
 *  at 8 AM). Null when the rest of the day is spoken for too. */
export const findDaySlot = (q: SlotQuery): number | null => {
  if (q.window === 'someday') return null;
  const win = q.effectiveWindows[q.window];
  const from =
    win?.start != null ? win.start * 60 : q.anchors.wake + 30;
  return walkSlots(q, from, q.anchors.sleep);
};

export interface SlotResolution {
  dateISO: string;
  min: number;
  /** 'window' — landed in the asked window. 'crammed' — window was
   *  full, landed later the same day. 'moved' — the whole day was
   *  full, landed on the next day with room. */
  how: 'window' | 'crammed' | 'moved';
}

/** THE slot decision, overflow-aware. Tries, in order: the asked
 *  window on the asked day → the next open slot later that same day
 *  ("cram") → the first future day with room (asked window first,
 *  then anywhere in that day). Days aren't infinite lists to walk
 *  forever — after `maxDaysAhead` we give up and return null so the
 *  caller can fall back to plain windowed (the pre-slotting shape). */
export const resolveSlot = (
  q: SlotQuery,
  maxDaysAhead = 14,
): SlotResolution | null => {
  if (q.window === 'someday') return null;
  // Defensive: a malformed dateISO would make the next-day loop below
  // build "NaN-NaN-NaN" strings via `new Date(bad + 'T12:00')`. All
  // real callers pass YYYY-MM-DD, but guard so a bad value fails
  // closed (caller falls back to plain windowed) instead of writing
  // a garbage date into the store.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.dateISO)) return null;
  const inWindow = findWindowSlot(q);
  if (inWindow != null) {
    return { dateISO: q.dateISO, min: inWindow, how: 'window' };
  }
  const crammed = findDaySlot(q);
  if (crammed != null) {
    return { dateISO: q.dateISO, min: crammed, how: 'crammed' };
  }
  for (let i = 1; i <= maxDaysAhead; i++) {
    const d = new Date(q.dateISO + 'T12:00'); // noon-anchored, DST-safe
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayQ: SlotQuery = { ...q, dateISO: iso, nowMin: null };
    const slot = findWindowSlot(dayQ) ?? findDaySlot(dayQ);
    if (slot != null) return { dateISO: iso, min: slot, how: 'moved' };
  }
  return null;
};

/** True when the window can't fit a task of this length — pickers use
 *  it to gray the window out. */
export const windowIsFull = (q: SlotQuery): boolean =>
  findWindowSlot(q) == null;
