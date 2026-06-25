import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Importance } from '../constants/importance';
import { RecurRule } from '../constants/recur';

// Lumi · "noticed" suggestions — the learning layer.
//
// Spec: lumi-learning-recurrence-architecture.md §3.
// v1 only handles the recurrence suggestion kind. The store carries the
// dismissed-title suppression set so a "not it" actually sticks across
// future re-detections.

export type SuggestionKind = 'recurrence';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  /** What we'd name the recurring quest. */
  title: string;
  importance: Importance;
  /** Human copy shown on the card ("4 Sundays in a row"). */
  span: string;
  /** Pre-filled cadence — usually one tap to confirm. */
  guess: RecurRule;
  /** Completion stamps shown on the card; what builds trust. */
  evidence: string[];
}

interface SuggestionsState {
  suggestions: Suggestion[];
  /** Normalized titles the user has waved off — never re-suggest. */
  suppressed: string[];
  /** Wave the card off (and suppress the title from future detections). */
  dismiss: (id: string) => void;
  /** Drop the card without suppressing (used after accept). */
  consume: (id: string) => void;
  /** Bulk-replace the list — what a real detector job would call. */
  setAll: (next: Suggestion[]) => void;
  reset: () => void;
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Until the nightly detector job ships, seed a handful of representative
// patterns so the UI surface is real. The dates here are sample evidence —
// production replaces this with rows produced by the detector.
const SEED: Suggestion[] = [
  {
    id: 'seed_groceries',
    kind: 'recurrence',
    title: 'Grocery run',
    importance: 'medium',
    span: '4 Sundays in a row',
    guess: { every: 'week', day: 'Sun', part: 'afternoon' },
    evidence: ['May 5 · Sun', 'May 12 · Sun', 'May 19 · Sun', 'May 26 · Sun'],
  },
  {
    id: 'seed_standup',
    kind: 'recurrence',
    title: 'Standup notes',
    importance: 'medium',
    span: 'every weekday this week',
    guess: { every: 'weekday', part: 'morning' },
    evidence: ['Mon 9:05a', 'Tue 9:02a', 'Wed 9:08a', 'Thu 9:01a', 'Fri 9:04a'],
  },
  {
    id: 'seed_plants',
    kind: 'recurrence',
    title: 'Water the plants',
    importance: 'low',
    span: 'about every 4 days',
    guess: { every: 'week', day: 'Wed', part: 'evening' },
    evidence: ['May 14 · eve', 'May 18 · eve', 'May 22 · eve'],
  },
];

export const useSuggestionsStore = create<SuggestionsState>()(
  persist(
    (set, get) => ({
      suggestions: SEED,
      suppressed: [],
      dismiss: (id) => {
        const item = get().suggestions.find((s) => s.id === id);
        set((s) => ({
          suggestions: s.suggestions.filter((x) => x.id !== id),
          suppressed: item
            ? Array.from(new Set([...s.suppressed, normalize(item.title)]))
            : s.suppressed,
        }));
      },
      consume: (id) =>
        set((s) => ({
          suggestions: s.suggestions.filter((x) => x.id !== id),
        })),
      setAll: (next) => {
        const suppressed = new Set(get().suppressed);
        set({
          suggestions: next.filter((s) => !suppressed.has(normalize(s.title))),
        });
      },
      reset: () => set({ suggestions: [], suppressed: [] }),
    }),
    {
      name: 'lumi.suggestions',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
