import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xpForQuest, todayKey } from '../lib/gamification';
import { Importance, importanceFromDifficulty } from '../constants/importance';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Quest {
  id: string;
  title: string;
  difficulty: Difficulty;
  importance: Importance;
  xpReward: number;
  completed: boolean;
  completedAt: string | null;
  date: string; // YYYY-MM-DD
  scheduledHour?: number;
  scheduledMinute?: number;
  durationMinutes?: number;
  accent?: 'plum' | 'terra' | 'moss' | 'caramel' | 'mist' | 'rose' | 'fog';
  createdAt: string;
}

interface QuestState {
  quests: Quest[];
  addQuest: (
    q: Omit<
      Quest,
      | 'id'
      | 'completed'
      | 'completedAt'
      | 'createdAt'
      | 'date'
      | 'xpReward'
      | 'importance'
    > & {
      date?: string;
      xpReward?: number;
      importance?: Importance;
    },
  ) => Quest;
  addMany: (
    q: { title: string; difficulty: Difficulty; importance?: Importance }[],
  ) => Quest[];
  toggle: (id: string) => Quest | undefined;
  remove: (id: string) => void;
  todayQuests: () => Quest[];
  completedToday: () => number;
  weekCompleted: () => number;
  reset: () => void;
}

const accents: Quest['accent'][] = ['plum', 'terra', 'moss', 'caramel', 'mist'];

const newId = () => `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useQuestStore = create<QuestState>()(
  persist(
    (set, get) => ({
      quests: [],
      addQuest: (q) => {
        const xpReward = q.xpReward ?? xpForQuest(q.difficulty);
        const importance =
          q.importance ?? importanceFromDifficulty(q.difficulty);
        const quest: Quest = {
          id: newId(),
          title: q.title,
          difficulty: q.difficulty,
          importance,
          xpReward,
          completed: false,
          completedAt: null,
          date: q.date ?? todayKey(),
          scheduledHour: q.scheduledHour,
          scheduledMinute: q.scheduledMinute,
          durationMinutes: q.durationMinutes,
          accent: q.accent ?? accents[get().quests.length % accents.length],
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ quests: [...s.quests, quest] }));
        return quest;
      },
      addMany: (list) => {
        const created: Quest[] = list.map((q, i) => ({
          id: `${newId()}_${i}`,
          title: q.title,
          difficulty: q.difficulty,
          importance: q.importance ?? importanceFromDifficulty(q.difficulty),
          xpReward: xpForQuest(q.difficulty),
          completed: false,
          completedAt: null,
          date: todayKey(),
          accent: accents[(get().quests.length + i) % accents.length],
          createdAt: new Date().toISOString(),
        }));
        set((s) => ({ quests: [...s.quests, ...created] }));
        return created;
      },
      toggle: (id) => {
        const q = get().quests.find((x) => x.id === id);
        if (!q) return undefined;
        const next: Quest = {
          ...q,
          completed: !q.completed,
          completedAt: !q.completed ? new Date().toISOString() : null,
        };
        set((s) => ({
          quests: s.quests.map((x) => (x.id === id ? next : x)),
        }));
        return next;
      },
      remove: (id) =>
        set((s) => ({ quests: s.quests.filter((q) => q.id !== id) })),
      todayQuests: () => {
        const d = todayKey();
        return get().quests.filter((q) => q.date === d);
      },
      completedToday: () => {
        const d = todayKey();
        return get().quests.filter((q) => q.date === d && q.completed).length;
      },
      weekCompleted: () => {
        const now = Date.now();
        const week = 7 * 86400000;
        return get().quests.filter(
          (q) => q.completed && q.completedAt && now - new Date(q.completedAt).getTime() < week,
        ).length;
      },
      reset: () => set({ quests: [] }),
    }),
    {
      name: 'lumi.quests',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

// Pure derivers — call from useMemo, not as Zustand selectors.
export const selectTodayQuests = (quests: Quest[]): Quest[] => {
  const d = todayKey();
  return quests.filter((q) => q.date === d);
};

export const selectCompletedToday = (quests: Quest[]): number => {
  const d = todayKey();
  return quests.filter((q) => q.date === d && q.completed).length;
};

export const selectWeekCompleted = (quests: Quest[]): number => {
  const now = Date.now();
  const week = 7 * 86400000;
  return quests.filter(
    (q) =>
      q.completed &&
      q.completedAt &&
      now - new Date(q.completedAt).getTime() < week,
  ).length;
};
