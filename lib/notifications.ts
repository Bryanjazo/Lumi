import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ROTATIONS = {
  morning: [
    "Good morning. One small quest is enough.",
    "Hey — today's brain doesn't have to be yesterday's brain.",
    "Pick the thing that already feels half-done.",
  ],
  meds: [
    "Meds + something to eat. That's it.",
    "Tiny pill, tiny bite. Future you says thanks.",
    "Med check. Pair it with water if nothing else.",
  ],
  midday: [
    "Quick scan — what's the one quest that's still movable?",
    "Halfway. No pressure — a check-in.",
    "If everything's stalled, switch to the smallest item.",
  ],
  windDown: [
    "Soft close. What worked today, even one thing?",
    "Tomorrow's first quest — pick it now while it's easy.",
    "Lights low. You don't owe anyone a full day.",
  ],
  recovery: [
    "Hey. No streak to defend. Open the app.",
    "Coming back is the whole win today.",
    "Luna missed you. One tap is enough.",
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
) => {
  const body = await nextLine(bucket);
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: 'Lumi',
      body,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
    } as Notifications.CalendarTriggerInput,
  });
};

export const scheduleDailyReminders = async () => {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  // Anchor the daily nudges to the USER's day, not a hardcoded
  // 8:30 / 9:00 / 12:00 / 21:00 template (which assumed a
  // working-hours 9-5er and woke night-shifters in the middle of
  // their sleep). Each nudge lands at a sensible offset from the
  // anchor it relates to.
  //   morning  → 30 min after wake
  //   meds     → at breakfast (or wake + 1h if breakfast unset)
  //   midday   → at lunch
  //   windDown → 90 min before sleep
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useUserStore } = require('../store/userStore') as typeof import('../store/userStore');
  const u = useUserStore.getState();
  const a = u.anchors;
  const morningMin = Math.max(0, a.wake + 30);
  const medsMin = a.breakfast > 0 ? a.breakfast : a.wake + 60;
  const middayMin = a.lunch;
  const windDownMin = Math.max(0, a.sleep - 90);
  await schedule(
    'morning',
    Math.floor(morningMin / 60),
    morningMin % 60,
    'lumi-morning',
  );
  await schedule(
    'meds',
    Math.floor(medsMin / 60),
    medsMin % 60,
    'lumi-meds',
  );
  await schedule(
    'midday',
    Math.floor(middayMin / 60),
    middayMin % 60,
    'lumi-midday',
  );
  await schedule(
    'windDown',
    Math.floor(windDownMin / 60),
    windDownMin % 60,
    'lumi-winddown',
  );
};

export const cancelAllReminders = async () => {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
};

export const scheduleRecoveryNudge = async () => {
  if (Platform.OS === 'web') return;
  const body = await nextLine('recovery');
  await Notifications.scheduleNotificationAsync({
    identifier: 'lumi-recovery',
    content: { title: 'Lumi', body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 60 * 60 * 24,
      repeats: false,
    } as Notifications.TimeIntervalTriggerInput,
  });
};
