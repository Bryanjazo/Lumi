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
  /** Cached mood at session start — carried on the object so pause /
   *  resume don't need the caller to re-pass it, and so the tick
   *  loop can push the same mood on every update. */
  mood: string;
  /** Total ms the user has spent paused across all pause spans in
   *  this session. Elapsed = (now − startedAt) − pauseTotalMs, so the
   *  countdown truly freezes during pauses and picks up exactly where
   *  it left off — no wall-clock drift. */
  pauseTotalMs: number;
  /** Epoch ms when the current pause started, or null when running.
   *  When non-null, elapsed is computed against pausedAt instead of
   *  Date.now() so the readout stays fixed on the pause moment. */
  pausedAt: number | null;
}

/**
 * Summary of the session that JUST completed — persisted so
 * LumiFocusCard can render its "done" mode with the finished task's
 * info even after the session itself is torn down. Cleared when the
 * user taps "Mark it done" (or dismisses the done screen).
 */
export interface CompletedFocus {
  questId: string;
  taskTitle: string;
  durationSec: number;
  completedAt: number;
}

interface FocusSessionState {
  current: FocusSession | null;
  lastCompleted: CompletedFocus | null;
  start: (args: {
    questId: string;
    taskTitle: string;
    petName: string;
    durationSec: number;
    mood: string;
  }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  end: (opts?: { reason?: 'completed' | 'cancelled' }) => Promise<void>;
  /** Clear the just-completed session — call after the user
   *  acknowledges the done screen (Mark it done or ×). */
  clearLastCompleted: () => void;
  /** Internal — called by the tick interval to push elapsed/mood. */
  _tick: () => Promise<void>;
}

/**
 * Pure helper — computes the elapsed seconds for a session
 * accounting for any accumulated pause time. Returns 0 when the
 * session is null. Callers (LumiFocusCard, tick loop) use this so
 * the paused countdown reads consistently everywhere.
 */
export const selectElapsedSeconds = (
  session: FocusSession | null,
): number => {
  if (!session) return 0;
  const referenceNow = session.pausedAt ?? Date.now();
  return Math.max(
    0,
    Math.floor(
      (referenceNow - session.startedAt - session.pauseTotalMs) / 1000,
    ),
  );
};

/**
 * Pure helper — remaining seconds. Clamped to [0, durationSec] so
 * ring math (frac = remain/duration) is always well-behaved.
 */
export const selectRemainingSeconds = (
  session: FocusSession | null,
): number => {
  if (!session) return 0;
  return Math.max(0, session.durationSec - selectElapsedSeconds(session));
};

let tickHandle: ReturnType<typeof setInterval> | null = null;

const stopTick = () => {
  if (tickHandle != null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
};

export const useFocusSession = create<FocusSessionState>((set, get) => ({
  current: null,
  lastCompleted: null,

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
      mood,
      pauseTotalMs: 0,
      pausedAt: null,
    };
    set({ current: session });
    stopTick();
    tickHandle = setInterval(() => {
      void get()._tick();
    }, TICK_MS);
  },

  pause: async () => {
    const cur = get().current;
    if (!cur || cur.pausedAt != null) return;
    // Freeze the tick loop and stamp the pause moment. Elapsed is
    // computed against `pausedAt` from here on, so the countdown
    // reads a fixed value until resume() runs. We deliberately do
    // NOT push a final "paused" update to the Live Activity — the
    // last-pushed elapsed value stays on-screen in the Dynamic
    // Island, which reads as a frozen timer (correct behavior).
    stopTick();
    set({ current: { ...cur, pausedAt: Date.now() } });
  },

  resume: async () => {
    const cur = get().current;
    if (!cur || cur.pausedAt == null) return;
    // Accumulate the just-completed pause span into pauseTotalMs so
    // subsequent elapsed math skips it — the wall clock kept running
    // during pause, but the SESSION time did not. Then restart the
    // tick loop so Live Activity updates flow again.
    const pausedFor = Date.now() - cur.pausedAt;
    set({
      current: {
        ...cur,
        pauseTotalMs: cur.pauseTotalMs + pausedFor,
        pausedAt: null,
      },
    });
    stopTick();
    tickHandle = setInterval(() => {
      void get()._tick();
    }, TICK_MS);
  },

  end: async ({ reason } = {}) => {
    stopTick();
    const cur = get().current;
    if (cur?.activityId) {
      await endTaskActivity(cur.activityId, true);
    }
    // Natural expiry AND user-initiated "Finish" both count as
    // completed — both surface the done screen so the user gets the
    // "you made it" payoff + the earned Mark-it-done tap. Cancels
    // (× button, session hijacked by a new start()) skip the done
    // screen and leave lastCompleted untouched.
    if (reason === 'completed' && cur) {
      set({
        current: null,
        lastCompleted: {
          questId: cur.questId,
          taskTitle: cur.taskTitle,
          durationSec: cur.durationSec,
          completedAt: Date.now(),
        },
      });
    } else {
      set({ current: null });
    }
  },

  clearLastCompleted: () => {
    set({ lastCompleted: null });
  },

  _tick: async () => {
    const cur = get().current;
    if (!cur || cur.pausedAt != null) return;
    const elapsedSec = selectElapsedSeconds(cur);
    // Auto-end at natural completion — the Live Activity also caps
    // its own progress visually at 100%, but we should actually
    // .end() so the pill clears from the Island.
    if (elapsedSec >= cur.durationSec) {
      await get().end({ reason: 'completed' });
      return;
    }
    if (cur.activityId) {
      await updateTaskActivity(cur.activityId, elapsedSec, cur.mood);
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
