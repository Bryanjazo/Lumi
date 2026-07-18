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

import { Platform } from 'react-native';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  startTaskActivity,
  updateTaskActivity,
  endTaskActivity,
  endAllTaskActivities,
  isLiveActivityAvailable,
} from 'lumi-live-activity';

// 5-second cadence — matches Apple's recommended ActivityKit update
// budget. The Dynamic Island cat is now a static image (no per-tick
// frame cycling), and the countdown text uses Text(timerInterval:)
// which iOS auto-refreshes every second natively, so we don't need
// aggressive JS-side pushes anymore. Reverted from 1s (which was
// only needed to drive the sprite animation before that was
// simplified to a still).
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
  /** Honest elapsed (pause-aware, ≤ planned) — the done screen says
   *  what really happened instead of claiming the full block. */
  actualSec: number;
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

let startInFlight = false;

// Session-end local notification — the hyperfocus goodbye. A locked
// phone otherwise never learns the block ended (the Live Activity
// just sits at 0:00). Scheduled at start for the remaining time,
// rescheduled around pauses, cancelled on any end.
const FOCUS_END_ID = 'lumi-focus-end';
const scheduleFocusEnd = async (seconds: number) => {
  if (Platform.OS === 'web' || seconds <= 5) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(FOCUS_END_ID).catch(
      () => {},
    );
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_END_ID,
      content: {
        title: 'Lumi',
        body: 'The block is done — that counts. Come stretch. 💛',
        // Tap → Home settles the session and shows the done screen.
        // Without an action the root tap handler ignores the response
        // entirely — "I tapped it and nothing happened".
        data: { action: 'focusdone' },
      },
      trigger: {
        type: 'timeInterval',
        seconds: Math.round(seconds),
        repeats: false,
      } as never,
    });
  } catch {
    // notifications unavailable — the in-app done screen still lands
  }
};
// Crash-safe snapshot of the running session. The store itself is
// deliberately in-memory (a stale "running" session resurrecting on
// cold start would be spooky), but a force-quit mid-block used to lose
// EVERY banked minute — and the leftover end notification then claimed
// "that counted" over minutes that were never counted. The snapshot
// lets the cold-start sweep bank honestly, then discards itself.
const SNAPSHOT_KEY = 'lumi.focusSnapshot';
const persistSnapshot = (cur: FocusSession | null) => {
  try {
    if (!cur) {
      void AsyncStorage.removeItem(SNAPSHOT_KEY);
      return;
    }
    void AsyncStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        startedAt: cur.startedAt,
        durationSec: cur.durationSec,
        pauseTotalMs: cur.pauseTotalMs ?? 0,
        pausedAt: cur.pausedAt ?? null,
      }),
    );
  } catch {
    // best-effort — losing the snapshot only reverts to old behavior
  }
};

const cancelFocusEnd = () => {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    void Notifications.cancelScheduledNotificationAsync(FOCUS_END_ID).catch(
      () => {},
    );
  } catch {
    // ignore
  }
};

export const useFocusSession = create<FocusSessionState>((set, get) => ({
  current: null,
  lastCompleted: null,

  start: async ({ questId, taskTitle, petName, durationSec, mood }) => {
    // Re-entrancy latch (audit B2): a double-tap on "Start" used to
    // request TWO ActivityKit activities — the first pill orphaned on
    // the lock screen for hours.
    if (startInFlight) return;
    startInFlight = true;
    try {
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
    persistSnapshot(session);
    void scheduleFocusEnd(durationSec);
    stopTick();
    tickHandle = setInterval(() => {
      void get()._tick();
    }, TICK_MS);
    } finally {
      startInFlight = false;
    }
  },

  pause: async () => {
    cancelFocusEnd();
    const cur = get().current;
    if (!cur || cur.pausedAt != null) return;
    // Freeze the tick loop and stamp the pause moment. Elapsed is
    // computed against `pausedAt` from here on, so the countdown
    // reads a fixed value until resume() runs. We deliberately do
    // NOT push a final "paused" update to the Live Activity — the
    // last-pushed elapsed value stays on-screen in the Dynamic
    // Island, which reads as a frozen timer (correct behavior).
    stopTick();
    const paused = { ...cur, pausedAt: Date.now() };
    set({ current: paused });
    persistSnapshot(paused);
  },

  resume: async () => {
    const cur = get().current;
    if (!cur || cur.pausedAt == null) return;
    // Accumulate the just-completed pause span into pauseTotalMs so
    // subsequent elapsed math skips it — the wall clock kept running
    // during pause, but the SESSION time did not. Then restart the
    // tick loop so Live Activity updates flow again.
    const pausedFor = Date.now() - cur.pausedAt;
    const next = {
      ...cur,
      pauseTotalMs: cur.pauseTotalMs + pausedFor,
      pausedAt: null,
    };
    set({ current: next });
    persistSnapshot(next);
    // Re-arm the session-end notification AFTER folding the pause in
    // — computing remaining first counted the pause as elapsed and
    // fired "the block is done" early by exactly the pause length.
    void scheduleFocusEnd(next.durationSec - selectElapsedSeconds(next));
    stopTick();
    tickHandle = setInterval(() => {
      void get()._tick();
    }, TICK_MS);
  },

  end: async ({ reason } = {}) => {
    stopTick();
    cancelFocusEnd();
    persistSnapshot(null);
    const cur = get().current;
    if (cur?.activityId) {
      await endTaskActivity(cur.activityId, true);
    }
    // Natural expiry AND user-initiated "Finish" both count as
    // completed — both surface the done screen so the user gets the
    // "you made it" payoff + the earned Mark-it-done tap. Cancels
    // (× button, session hijacked by a new start()) skip the done
    // screen and leave lastCompleted untouched.
    // Bank the hearth minutes on EVERY teardown (audit B3) — ending
    // early, completing the task from Home, or a session hijack all
    // COUNT. "12 minutes is 12 minutes" — anti-perfectionism is the
    // whole thesis; only completed used to bank.
    if (cur) {
      // Lifetime hearth minutes — actual time spent, pause-aware,
      // capped at the planned length.
      try {
        const elapsedMs =
          (cur.pausedAt ?? Date.now()) - cur.startedAt - (cur.pauseTotalMs ?? 0);
        const mins = Math.max(
          1,
          Math.min(
            Math.round(cur.durationSec / 60),
            Math.round(elapsedMs / 60000),
          ),
        );
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useUserStore } = require('../store/userStore') as typeof import('../store/userStore');
        useUserStore.getState().addFocusMinutes(mins);
      } catch {
        // ledger miss is fine
      }
      // The done screen only appears for natural/finish completions —
      // cancels stay quiet (unchanged behavior); the banking above is
      // what's new for them.
      if (reason === 'completed') {
        const actualSec = Math.min(
          cur.durationSec,
          Math.max(
            0,
            Math.round(
              ((cur.pausedAt ?? Date.now()) -
                cur.startedAt -
                (cur.pauseTotalMs ?? 0)) /
                1000,
            ),
          ),
        );
        set({
          current: null,
          lastCompleted: {
            questId: cur.questId,
            taskTitle: cur.taskTitle,
            durationSec: cur.durationSec,
            actualSec,
            completedAt: Date.now(),
          },
        });
      } else {
        set({ current: null });
      }
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

/**
 * Re-arm the session-end notification from live state. Called by
 * lib/notifications after its blanket cancelAllScheduledNotifications
 * — which otherwise silently killed the hyperfocus goodbye whenever
 * the nudge schedule re-synced mid-session (e.g. completing a daily
 * habit changes recurSignature → sync → cancel-all).
 */
export const rearmFocusEnd = (): void => {
  const cur = useFocusSession.getState().current;
  if (!cur || cur.pausedAt != null) return;
  void scheduleFocusEnd(
    Math.max(0, cur.durationSec - selectElapsedSeconds(cur)),
  );
};

/** Cleanup helper called from app launch — kills any orphaned
 *  Live Activities left over from a previous process (crash, kill),
 *  banks the orphaned session's real minutes from the crash-safe
 *  snapshot ("12 minutes is 12 minutes" must survive a force-quit),
 *  and cancels the stale end notification so it can't fire over a
 *  session that no longer exists. */
export const clearOrphanFocusActivities = async (): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (raw) {
      await AsyncStorage.removeItem(SNAPSHOT_KEY);
      const snap = JSON.parse(raw) as {
        startedAt: number;
        durationSec: number;
        pauseTotalMs?: number;
        pausedAt?: number | null;
      };
      const elapsedMs =
        (snap.pausedAt ?? Date.now()) -
        snap.startedAt -
        (snap.pauseTotalMs ?? 0);
      const mins = Math.min(
        Math.round(snap.durationSec / 60),
        Math.round(elapsedMs / 60000),
      );
      // No ≥1 floor here — a sub-30s accidental start that crashed
      // shouldn't pad the ledger.
      if (mins > 0 && Number.isFinite(mins)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useUserStore } = require('../store/userStore') as typeof import('../store/userStore');
        useUserStore.getState().addFocusMinutes(mins);
      }
      cancelFocusEnd();
    }
  } catch {
    // snapshot unreadable — fall through to the activity sweep
  }
  if (!isLiveActivityAvailable()) return;
  await endAllTaskActivities();
};

/** Re-export the availability check for UI use (gate the "Start
 *  focus" button on whether Live Activities are usable). */
export { isLiveActivityAvailable } from 'lumi-live-activity';
