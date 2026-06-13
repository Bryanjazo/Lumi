import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xpProgress } from '../lib/gamification';

export type AdhdType = 'inattentive' | 'hyperactive' | 'combined' | null;
export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'expired';
export type SubscriptionTier = 'monthly' | 'annual' | null;

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
  /**
   * Dev escape only — set to true automatically when Supabase isn't
   * configured. We do not let signed-in users opt into "offline" once
   * required-auth is on.
   */
  offlineMode: boolean;
  subscriptionStatus: SubscriptionStatus;
  subscriptionTier: SubscriptionTier;
  subscriptionCurrentPeriodEnd: string | null;

  setName: (name: string) => void;
  setPetName: (petName: string) => void;
  setAdhdType: (t: AdhdType) => void;
  addXp: (amount: number) => void;
  registerActivity: () => void;
  consumeShield: () => void;
  rechargeShield: () => void;
  completeOnboarding: () => void;
  setNotificationsEnabled: (on: boolean) => void;
  setOfflineMode: (on: boolean) => void;
  setSubscription: (params: {
    status: SubscriptionStatus;
    tier?: SubscriptionTier;
    currentPeriodEnd?: string | null;
  }) => void;
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
      offlineMode: false,
      subscriptionStatus: 'trial',
      subscriptionTier: null,
      subscriptionCurrentPeriodEnd: null,

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
      setOfflineMode: (on) => set({ offlineMode: on }),
      setSubscription: ({ status, tier, currentPeriodEnd }) =>
        set({
          subscriptionStatus: status,
          subscriptionTier: tier ?? null,
          subscriptionCurrentPeriodEnd: currentPeriodEnd ?? null,
        }),

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
          offlineMode: false,
          subscriptionStatus: 'trial',
          subscriptionTier: null,
          subscriptionCurrentPeriodEnd: null,
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
