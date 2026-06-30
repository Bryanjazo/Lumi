// Focus session — JS-side lifecycle for a per-task Live Activity.
//
// Holds the currently-running session (taskId, taskTitle, startedAt,
// durationSec, mood) in a tiny Zustand store. While a session is
// active, a setInterval ticks every 5 seconds to:
//   - increment elapsed
//   - push mood + elapsed to the Live Activity via lumi-live-activity
//   - auto-end the session when elapsed >= duration
//
// 5-second cadence matches Apple's guidance: more frequent updates
// burn the ActivityKit budget and can get throttled.

import { create } from 'zustand';
import {
  startTaskActivity,
  updateTaskActivity,
  endTaskActivity,
  endAllTaskActivities,
  isLiveActivityAvailable,
} from 'lumi-live-activity';

const TICK_MS = 5_000;

export interface FocusSession {
  /** questStore id this session is tied to. */
  questId: string;
  taskTitle: string;
  /** Epoch ms when the session started. */
  startedAt: number;
  /** Total planned duration in seconds. */
  durationSec: number;
  /** Native Live Activity id (null if ActivityKit unavailable). */
  activityId: string | null;
}

interface FocusSessionState {
  current: FocusSession | null;
  start: (args: {
    questId: string;
    taskTitle: string;
    petName: string;
    durationSec: number;
    mood: string;
  }) => Promise<void>;
  end: (opts?: { reason?: 'completed' | 'cancelled' }) => Promise<void>;
  /** Internal — called by the tick interval to push elapsed/mood. */
  _tick: (mood: string) => Promise<void>;
}

let tickHandle: ReturnType<typeof setInterval> | null = null;

const stopTick = () => {
  if (tickHandle != null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
};

export const useFocusSession = create<FocusSessionState>((set, get) => ({
  current: null,

  start: async ({ questId, taskTitle, petName, durationSec, mood }) => {
    // End any in-flight session first — only one focus session at a
    // time keeps the model simple and matches the Dynamic Island's
    // single-active-activity expectation.
    if (get().current) {
      await get().end({ reason: 'cancelled' });
    }
    const activityId = await startTaskActivity({
      taskTitle,
      petName,
      durationSeconds: durationSec,
      mood,
    });
    const session: FocusSession = {
      questId,
      taskTitle,
      startedAt: Date.now(),
      durationSec,
      activityId,
    };
    set({ current: session });
    // Start the tick loop. Pass the current mood at each tick — the
    // caller updates it via repeated calls if mood changes.
    stopTick();
    tickHandle = setInterval(() => {
      void get()._tick(mood);
    }, TICK_MS);
  },

  end: async ({ reason } = {}) => {
    void reason;
    stopTick();
    const cur = get().current;
    if (cur?.activityId) {
      await endTaskActivity(cur.activityId, true);
    }
    set({ current: null });
  },

  _tick: async (mood) => {
    const cur = get().current;
    if (!cur) return;
    const elapsedSec = Math.floor((Date.now() - cur.startedAt) / 1000);
    // Auto-end at completion — the Live Activity also caps its own
    // progress visually at 100%, but we should actually .end() so the
    // pill clears from the Island.
    if (elapsedSec >= cur.durationSec) {
      await get().end({ reason: 'completed' });
      return;
    }
    if (cur.activityId) {
      await updateTaskActivity(cur.activityId, elapsedSec, mood);
    }
  },
}));

/** Cleanup helper called from app launch — kills any orphaned
 *  Live Activities left over from a previous process (crash, kill).
 *  No-op if ActivityKit isn't available. */
export const clearOrphanFocusActivities = async (): Promise<void> => {
  if (!isLiveActivityAvailable()) return;
  await endAllTaskActivities();
};

/** Re-export the availability check for UI use (gate the "Start
 *  focus" button on whether Live Activities are usable). */
export { isLiveActivityAvailable } from 'lumi-live-activity';
