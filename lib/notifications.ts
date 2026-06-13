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
    "Halfway. No pressure, just a check-in.",
    "If everything's stalled, switch to the smallest item.",
  ],
  windDown: [
    "Soft close. What worked today, even one thing?",
    "Tomorrow's first quest — pick it now while it's easy.",
    "Lights low. You don't owe anyone a full day.",
  ],
  recovery: [
    "Hey. No streak to defend. Just open the app.",
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
  await schedule('morning', 8, 30, 'lumi-morning');
  await schedule('meds', 9, 0, 'lumi-meds');
  await schedule('midday', 12, 0, 'lumi-midday');
  await schedule('windDown', 21, 0, 'lumi-winddown');
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
