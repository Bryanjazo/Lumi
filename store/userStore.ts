import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xpProgress } from '../lib/gamification';

export type AdhdType = 'inattentive' | 'hyperactive' | 'combined' | null;

interface UserState {
  name: string;
  petName: string;
  adhdType: AdhdType;
  xp: number;
  streak: number;
  lastActiveDate: string | null;
  shieldAvailable: boolean;
  shieldUsedThisWeek: boolean;
  onboarded: boolean;
  notificationsEnabled: boolean;

  setName: (name: string) => void;
  setPetName: (petName: string) => void;
  setAdhdType: (t: AdhdType) => void;
  addXp: (amount: number) => void;
  registerActivity: () => void;
  consumeShield: () => void;
  rechargeShield: () => void;
  completeOnboarding: () => void;
  setNotificationsEnabled: (on: boolean) => void;
  reset: () => void;
}

const dayDiff = (a: string, b: string) => {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
};

const today = () => new Date().toISOString().slice(0, 10);

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      name: '',
      petName: 'Luna',
      adhdType: null,
      xp: 0,
      streak: 0,
      lastActiveDate: null,
      shieldAvailable: true,
      shieldUsedThisWeek: false,
      onboarded: false,
      notificationsEnabled: false,

      setName: (name) => set({ name }),
      setPetName: (petName) => set({ petName }),
      setAdhdType: (adhdType) => set({ adhdType }),

      addXp: (amount) => set((s) => ({ xp: s.xp + amount })),

      registerActivity: () => {
        const last = get().lastActiveDate;
        const t = today();
        if (last === t) return;
        if (!last) {
          set({ streak: 1, lastActiveDate: t });
          return;
        }
        const diff = dayDiff(last, t);
        if (diff === 1) {
          set({ streak: get().streak + 1, lastActiveDate: t });
        } else if (diff > 1) {
          if (get().shieldAvailable && !get().shieldUsedThisWeek) {
            set({
              streak: get().streak + 1,
              shieldAvailable: false,
              shieldUsedThisWeek: true,
              lastActiveDate: t,
            });
          } else {
            set({ streak: 1, lastActiveDate: t });
          }
        }
      },

      consumeShield: () =>
        set({ shieldAvailable: false, shieldUsedThisWeek: true }),
      rechargeShield: () =>
        set({ shieldAvailable: true, shieldUsedThisWeek: false }),

      completeOnboarding: () => set({ onboarded: true }),
      setNotificationsEnabled: (on) => set({ notificationsEnabled: on }),

      reset: () =>
        set({
          name: '',
          petName: 'Luna',
          adhdType: null,
          xp: 0,
          streak: 0,
          lastActiveDate: null,
          shieldAvailable: true,
          shieldUsedThisWeek: false,
          onboarded: false,
          notificationsEnabled: false,
        }),
    }),
    {
      name: 'lumi.user',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export const useLevel = () => {
  const xp = useUserStore((s) => s.xp);
  return xpProgress(xp);
};
