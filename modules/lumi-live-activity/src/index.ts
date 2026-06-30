// Lumi Live Activity — JS interface to the LumiLiveActivityModule
// Expo Module. Wraps the iOS-only ActivityKit bridge with a thin
// TypeScript surface. All methods are safe to call on non-iOS or
// when ActivityKit isn't available (they resolve to null / false).
//
// Typical flow from app code:
//   const id = await startTaskActivity({ ... });
//   // tick every second: await updateTaskActivity(id, elapsed, mood);
//   // on stop / completion: await endTaskActivity(id);

import { requireOptionalNativeModule } from 'expo';

// requireOptionalNativeModule returns null if the module isn't
// linked (Expo Go, web, Android, or a build that didn't include
// the lumi-live-activity module). All calls below null-check so
// the rest of the app never breaks.
const Native = requireOptionalNativeModule<{
  isAvailable: () => boolean;
  startTaskActivity: (
    taskTitle: string,
    petName: string,
    durationSeconds: number,
    mood: string,
  ) => Promise<string | null>;
  updateTaskActivity: (
    activityId: string,
    elapsedSeconds: number,
    mood: string,
  ) => Promise<boolean>;
  endTaskActivity: (
    activityId: string,
    dismissImmediately: boolean,
  ) => Promise<boolean>;
  endAllTaskActivities: () => Promise<boolean>;
}>('LumiLiveActivity');

/**
 * Whether Live Activities are available on this device + permitted
 * by the user. iOS 16.1+ only; user may have disabled them in
 * Settings → Lumi → Live Activities.
 */
export const isLiveActivityAvailable = (): boolean => {
  if (!Native) return false;
  try {
    return Native.isAvailable();
  } catch {
    return false;
  }
};

export interface StartTaskActivityArgs {
  taskTitle: string;
  petName: string;
  durationSeconds: number;
  /** Initial mood — one of "idle" | "happy" | "sad" | "sleep". */
  mood: string;
}

/**
 * Start a Lumi task Live Activity. Returns the activity id (use it
 * for subsequent update / end calls) or null on any failure.
 */
export const startTaskActivity = async (
  args: StartTaskActivityArgs,
): Promise<string | null> => {
  if (!Native) return null;
  try {
    return await Native.startTaskActivity(
      args.taskTitle,
      args.petName,
      args.durationSeconds,
      args.mood,
    );
  } catch {
    return null;
  }
};

/**
 * Update an in-flight task activity with new elapsed seconds + mood.
 * Returns false if the activity id is gone (e.g., user dismissed it
 * from the Lock Screen).
 */
export const updateTaskActivity = async (
  activityId: string,
  elapsedSeconds: number,
  mood: string,
): Promise<boolean> => {
  if (!Native) return false;
  try {
    return await Native.updateTaskActivity(activityId, elapsedSeconds, mood);
  } catch {
    return false;
  }
};

/**
 * End a specific task activity. dismissImmediately removes it from
 * the Island / Lock Screen instantly; otherwise it shows a completed
 * state for a few minutes.
 */
export const endTaskActivity = async (
  activityId: string,
  dismissImmediately = true,
): Promise<boolean> => {
  if (!Native) return false;
  try {
    return await Native.endTaskActivity(activityId, dismissImmediately);
  } catch {
    return false;
  }
};

/**
 * Cleanup — ends every Lumi task activity. Call on app foreground
 * if there's no active focus session in JS state, to clear any
 * stale activities left over from a crash or kill.
 */
export const endAllTaskActivities = async (): Promise<boolean> => {
  if (!Native) return false;
  try {
    return await Native.endAllTaskActivities();
  } catch {
    return false;
  }
};
