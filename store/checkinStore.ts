import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayKey } from '../lib/gamification';

export type Mood =
  | 'Foggy'
  | 'Stuck'
  | 'Low'
  | 'Wired'
  | 'Anxious'
  | 'Focused'
  | 'Drained'
  | 'Good';

export interface Checkin {
  id: string;
  mood: Mood;
  text: string;
  state: string;
  explanation: string;
  action: string;
  createdAt: string;
}

interface CheckinState {
  checkins: Checkin[];
  add: (c: Omit<Checkin, 'id' | 'createdAt'>) => Checkin;
  todayMood: () => Mood | null;
  weekMoods: () => { date: string; mood: Mood | null; score: number }[];
  countThisWeek: () => number;
  reset: () => void;
}

const moodScore: Record<Mood, number> = {
  Foggy: 2,
  Stuck: 2,
  Low: 1,
  Wired: 3,
  Anxious: 2,
  Focused: 4,
  Drained: 1,
  Good: 5,
};

const newId = () => `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useCheckinStore = create<CheckinState>()(
  persist(
    (set, get) => ({
      checkins: [],
      add: (c) => {
        const created: Checkin = {
          ...c,
          id: newId(),
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ checkins: [created, ...s.checkins] }));
        return created;
      },
      todayMood: () => {
        const t = todayKey();
        const c = get().checkins.find((x) => x.createdAt.slice(0, 10) === t);
        return c ? c.mood : null;
      },
      weekMoods: () => {
        const out: { date: string; mood: Mood | null; score: number }[] = [];
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          const c = get().checkins.find((x) => x.createdAt.slice(0, 10) === key);
          out.push({
            date: key,
            mood: c?.mood ?? null,
            score: c ? moodScore[c.mood] : 0,
          });
        }
        return out;
      },
      countThisWeek: () => {
        const now = Date.now();
        const week = 7 * 86400000;
        return get().checkins.filter((c) => now - new Date(c.createdAt).getTime() < week).length;
      },
      reset: () => set({ checkins: [] }),
    }),
    {
      name: 'lumi.checkins',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export const moodEmoji: Record<Mood, string> = {
  Foggy: '😶‍🌫️',
  Stuck: '🧱',
  Low: '😔',
  Wired: '⚡',
  Anxious: '😰',
  Focused: '🔥',
  Drained: '😴',
  Good: '🌿',
};

export const moodList: Mood[] = [
  'Foggy',
  'Stuck',
  'Low',
  'Wired',
  'Anxious',
  'Focused',
  'Drained',
  'Good',
];

// Pure derivers — call these inside useMemo, not as Zustand selectors.
// (Selectors that return fresh arrays each call create infinite re-renders
// in React 19 + useSyncExternalStore.)
export const selectWeekMoods = (
  checkins: Checkin[],
): { date: string; mood: Mood | null; score: number }[] => {
  const out: { date: string; mood: Mood | null; score: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const c = checkins.find((x) => x.createdAt.slice(0, 10) === key);
    out.push({
      date: key,
      mood: c?.mood ?? null,
      score: c ? moodScore[c.mood] : 0,
    });
  }
  return out;
};

export const selectTodayMood = (checkins: Checkin[]): Mood | null => {
  const t = todayKey();
  const c = checkins.find((x) => x.createdAt.slice(0, 10) === t);
  return c ? c.mood : null;
};

export const selectCountThisWeek = (checkins: Checkin[]): number => {
  const now = Date.now();
  const week = 7 * 86400000;
  return checkins.filter((c) => now - new Date(c.createdAt).getTime() < week)
    .length;
};
