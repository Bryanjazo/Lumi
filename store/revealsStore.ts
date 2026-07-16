// Lumi · learning reveals — the once-fired + learned-date ledger.
//
// Retention-loop spec §1: the learning layer works silently; this store
// is what lets the app SHOW it. Two jobs:
//   1. `seen` + `lastShownAt` — each "Lumi learned something about you"
//      reveal fires exactly once, and at most one reveal surfaces per
//      ~day (never a wall, never a slot-machine drip).
//   2. `learnedAt` — the first date each pattern crossed its threshold,
//      so the Patterns tab can date its insights ("learned this week")
//      and read as a living profile that fills in over time.
//
// Keys are stable strings minted by lib/learning/reveals.ts
// (e.g. 'curve:learned', 'window:morning', 'dow:3', 'arc:graduated').

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface RevealsState {
  /** Reveal keys the user has seen (card shown + dismissed/tapped). */
  seen: string[];
  /** key → local YYYY-MM-DD of the FIRST time the pattern crossed its
   *  threshold. Never overwritten — provenance, not recency. */
  learnedAt: Record<string, string>;
  /** Epoch ms the last reveal card was closed — arms the rate limit. */
  lastShownAt: number | null;
  markSeen: (key: string) => void;
  stampLearned: (key: string) => void;
  reset: () => void;
}

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const useRevealsStore = create<RevealsState>()(
  persist(
    (set, get) => ({
      seen: [],
      learnedAt: {},
      lastShownAt: null,

      markSeen: (key) =>
        set((s) => ({
          seen: Array.from(new Set([...s.seen, key])),
          lastShownAt: Date.now(),
        })),

      stampLearned: (key) => {
        // Idempotent — the first crossing wins; a pattern that flickers
        // out and back never gets a newer date (honest provenance).
        if (get().learnedAt[key]) return;
        set((s) => ({
          learnedAt: { ...s.learnedAt, [key]: todayIso() },
        }));
      },

      reset: () => set({ seen: [], learnedAt: {}, lastShownAt: null }),
    }),
    {
      name: 'lumi.reveals',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
