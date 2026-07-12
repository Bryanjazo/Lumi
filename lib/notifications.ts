import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ROTATIONS = {
  morning: [
    "Good morning. One small task is enough.",
    "Hey — today's brain doesn't have to be yesterday's brain.",
    "Pick the thing that already feels half-done.",
  ],
  meds: [
    "Meds + something to eat. That's it.",
    "Tiny pill, tiny bite. Future you says thanks.",
    "Med check. Pair it with water if nothing else.",
  ],
  midday: [
    "Quick scan — what's the one task that's still movable?",
    "Halfway. No pressure — a check-in.",
    "If everything's stalled, switch to the smallest item.",
  ],
  windDown: [
    "Soft close. What worked today, even one thing?",
    "Tomorrow's first task — pick it now while it's easy.",
    "Lights low. You don't owe anyone a full day.",
  ],
  recap: [
    "Your week, told warmly — the recap's ready when you are.",
    "Sunday read: what worked, what wandered, and one win worth keeping.",
    "Lumi wrote your week up. No numbers-shaming, promise.",
  ],
  // Recovery lines OFFER something (emotional-model spec §6) — never
  // report a deficit or imply Luna was hurt by the absence ("Luna
  // missed you" reads as gentle guilt; gone). Each line is an action
  // Lumi can actually do the moment the app opens.
  recovery: [
    "Want me to shrink today to one small win?",
    "Need a fresh start? I can reorganize everything.",
    "Coming back is the whole win today.",
    "Today looking crowded? I can lighten it.",
  ],
} as const;

type Bucket = keyof typeof ROTATIONS;

const rotKey = (bucket: Bucket) => `lumi.notif.rotation.${bucket}`;

const nextLine = async (bucket: Bucket): Promise<string> => {
  const stored = await AsyncStorage.getItem(rotKey(bucket));
  const idx = stored ? parseInt(stored, 10) : 0;
  const lines = ROTATIONS[bucket];
  const next = (idx + 1) % lines.length;
  await AsyncStorage.setItem(rotKey(bucket), String(next));
  return lines[idx % lines.length];
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export const requestNotificationPermissions = async (): Promise<boolean> => {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const result = await Notifications.requestPermissionsAsync();
  return result.status === 'granted';
};

const schedule = async (
  bucket: Bucket,
  hour: number,
  minute: number,
  identifier: string,
  action: string,
) => {
  const body = await nextLine(bucket);
  // Night-owl anchors legally run past midnight (sleep at 25:30) —
  // iOS calendar triggers with hour >= 24 silently never fire, so
  // wrap into the real clock (audit: wind-down + recap vanished for
  // exactly the late-night users the anchors were widened for).
  const wrapped = (((hour * 60 + minute) % 1440) + 1440) % 1440;
  hour = Math.floor(wrapped / 60);
  minute = wrapped % 60;
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: 'Lumi',
      body,
      // Tap → the app performs this action (store/notifIntentStore).
      data: { action },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
    } as Notifications.CalendarTriggerInput,
  });
};

export interface NotifSyncResult {
  /** False only when the user just tried to enable and iOS said no. */
  granted: boolean;
}

// Quiet-hours guard: with prefs.quiet on, nothing lands between the
// sleep anchor and wake. Returns true when the minute is speakable.
const withinWakingHours = (
  min: number,
  wake: number,
  sleep: number,
  quiet: boolean,
): boolean => {
  if (!quiet) return true;
  return min >= wake && min < sleep;
};

const WEEKDAY_INDEX: Record<string, number> = {
  // expo-notifications calendar weekday: 1 = Sunday … 7 = Saturday.
  Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7,
};

/**
 * THE notification sync — reads the stores and makes the scheduled
 * set match the prefs exactly. Called from the profile toggles
 * (interactive: may prompt for permission) and from app start /
 * anchor changes (passive: never prompts).
 *
 *   nudges    → 4 anchored daily lines + the 48h come-back nudge
 *   recap     → Sunday at the dinner anchor
 *   recurring → one reminder per recurring quest (daily/weekly), cap 20
 *   quiet     → nothing scheduled inside the sleep window
 */
export const syncNotifications = async (opts?: {
  interactive?: boolean;
}): Promise<NotifSyncResult> => {
  if (Platform.OS === 'web') return { granted: true };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useUserStore } = require('../store/userStore') as typeof import('../store/userStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useQuestStore } = require('../store/questStore') as typeof import('../store/questStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getEffectiveWindows } = require('../constants/windows') as typeof import('../constants/windows');

  const u = useUserStore.getState();
  const prefs = u.notifPrefs;
  const anyOn = prefs.nudges || prefs.recap || prefs.recurring;

  if (!anyOn) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return { granted: true };
  }

  // Permission: prompt only on an interactive enable — a passive
  // sync (app start) must never surprise the user with a dialog.
  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.status === 'granted';
  if (!granted && opts?.interactive) {
    const res = await Notifications.requestPermissionsAsync();
    granted = res.status === 'granted';
  }
  if (!granted) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return { granted: false };
  }

  await Notifications.cancelAllScheduledNotificationsAsync();
  // The blanket cancel above also killed an in-flight focus session's
  // end notification — re-arm it from live session state.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rearmFocusEnd } = require('./focusSession') as typeof import('./focusSession');
    rearmFocusEnd();
  } catch {
    // focus session module unavailable — nothing to re-arm
  }
  const a = u.anchors;
  const speakable = (min: number) =>
    withinWakingHours(min, a.wake, a.sleep, prefs.quiet);

  // ── Daily nudges, anchored to the user's real day ──
  if (prefs.nudges) {
    const slots: Array<[Bucket, number, string, string]> = [
      ['morning', Math.max(0, a.wake + 30), 'lumi-morning', 'hero'],
      // Meds copy is OPT-IN only — never assume medication.
      ...(u.medsNudge
        ? ([
            [
              'meds',
              a.breakfast > 0 ? a.breakfast : a.wake + 60,
              'lumi-meds',
              'meds',
            ],
          ] as Array<[Bucket, number, string, string]>)
        : []),
      ['midday', a.lunch, 'lumi-midday', 'smallest'],
      ['windDown', Math.max(0, a.sleep - 90), 'lumi-winddown', 'tomorrow'],
    ];
    for (const [bucket, min, id, action] of slots) {
      if (!speakable(min)) continue;
      await schedule(bucket, Math.floor(min / 60), min % 60, id, action);
    }
    // Come-back nudge: 48h out, re-pushed every sync (each app open
    // runs a passive sync, so it only ever fires after real absence).
    const recoverySeconds = 60 * 60 * 48;
    const body = await nextLine('recovery');
    await Notifications.scheduleNotificationAsync({
      identifier: 'lumi-recovery',
      content: { title: 'Lumi', body, data: { action: 'rescue' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: recoverySeconds,
        repeats: false,
      } as Notifications.TimeIntervalTriggerInput,
    });
  }

  // ── Sunday recap, at the dinner anchor ──
  if (prefs.recap) {
    const min = a.dinner;
    if (speakable(min)) {
      const body = await nextLine('recap');
      const recapMin = min % 1440;
      await Notifications.scheduleNotificationAsync({
        identifier: 'lumi-recap',
        content: { title: 'Lumi', body, data: { action: 'recap' } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          weekday: 1, // Sunday
          hour: Math.floor(recapMin / 60),
          minute: recapMin % 60,
          repeats: true,
        } as Notifications.CalendarTriggerInput,
      });
    }
  }

  // ── Recurring-quest reminders ──
  if (prefs.recurring) {
    const effective = getEffectiveWindows();
    const quests = useQuestStore
      .getState()
      .quests.filter((q) => q.recur && !q.completed)
      .slice(0, 20); // sane ceiling on scheduled ids
    for (const q of quests) {
      const r = q.recur!;
      const winStart = effective[q.window]?.start;
      const min =
        r.at ?? (winStart != null ? winStart * 60 + 15 : 9 * 60);
      if (!speakable(min)) continue;
      const content = {
        title: 'Lumi',
        body: q.title,
        data: { action: 'quest', questId: q.id, questTitle: q.title },
      };
      const base = {
        hour: Math.floor(min / 60),
        minute: min % 60,
        repeats: true,
      };
      if (r.every === 'day') {
        await Notifications.scheduleNotificationAsync({
          identifier: `lumi-recur-${q.id}`,
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            ...base,
          } as Notifications.CalendarTriggerInput,
        });
      } else if (
        (r.every === 'week' || r.every === '2week') &&
        r.day &&
        WEEKDAY_INDEX[r.day]
      ) {
        // 2week approximated weekly — expo calendar triggers can't
        // express biweekly; a gentle extra reminder beats a missing
        // one for a habit surface.
        await Notifications.scheduleNotificationAsync({
          identifier: `lumi-recur-${q.id}`,
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            weekday: WEEKDAY_INDEX[r.day],
            ...base,
          } as Notifications.CalendarTriggerInput,
        });
      } else if (r.every === 'weekday') {
        for (let wd = 2; wd <= 6; wd++) {
          await Notifications.scheduleNotificationAsync({
            identifier: `lumi-recur-${q.id}-${wd}`,
            content,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
              weekday: wd,
              ...base,
            } as Notifications.CalendarTriggerInput,
          });
        }
      }
      // monthly cadence: skipped v1 (rare + iOS day-of-month quirks)
    }
  }

  return { granted: true };
};

export const cancelAllReminders = async () => {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
};
