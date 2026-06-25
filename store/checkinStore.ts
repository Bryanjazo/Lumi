import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayKey } from '../lib/gamification';
import { readState, energyValue, type ZoneName } from '../constants/moodMap';

// LOCAL Y-M-D from an ISO timestamp. `createdAt` is stored as UTC
// ISO; using `.slice(0,10)` for "what day was this" is wrong in any
// non-UTC timezone — a 9pm PT check-in shows up as the NEXT day's
// key under UTC, so todayMood() looks for "today PT" but finds
// nothing, and the Me tab's "today" tile silently goes blank.
const localYmdFromIso = (iso: string): string => {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Legacy mood bucket — kept for back-compat with profile tiles + home
// summary cards that still read `Checkin.mood`. The new check-in stores
// a precise coordinate; we derive a Mood from it on write so old code
// keeps working until it migrates to the zone field.
export type Mood =
  | 'Foggy'
  | 'Stuck'
  | 'Low'
  | 'Wired'
  | 'Anxious'
  | 'Focused'
  | 'Drained'
  | 'Good';

export type CheckinRoute = 'drag' | 'assist' | 'talk';

export interface Checkin {
  id: string;
  // ── new fields (cosmic check-in) ──
  /** Ease axis on the 2D field (0 = rough, 1 = good). */
  x: number;
  /** Energy axis (0 = low, 1 = high). */
  y: number;
  /** Derived 0–100 energy — fuel for the curve. */
  energy: number;
  /** Human-readable zone (e.g. "Steady"). */
  zone: ZoneName;
  /** How the user landed the coordinate. */
  route: CheckinRoute;
  /** What Lumi attributed the state to (optional). */
  aiCause: string | null;
  /** Did the user confirm Lumi's read? */
  confirmed: boolean | null;
  /** Optional verbatim note (only when route === 'talk'). */
  note: string | null;
  // ── legacy fields, still used by older surfaces ──
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

// Derive a legacy Mood from the (x, y) coordinate so old screens still
// have something to render until they switch to zone.
export const moodFromCoord = (x: number, y: number): Mood => {
  const hi = y > 0.62;
  const lo = y < 0.38;
  const pl = x > 0.62;
  const df = x < 0.38;
  if (hi && pl) return 'Focused';
  if (hi && df) return 'Wired';
  if (hi) return 'Wired';
  if (lo && pl) return 'Good';
  if (lo && df) return 'Low';
  if (lo) return 'Drained';
  if (df) return 'Anxious';
  if (pl) return 'Good';
  return 'Foggy';
};

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
        const c = get().checkins.find((x) => localYmdFromIso(x.createdAt) === t);
        return c ? c.mood : null;
      },
      weekMoods: () => {
        const out: { date: string; mood: Mood | null; score: number }[] = [];
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          // Local Y-M-D so today's check-ins (made locally) match
          // today's bar (also derived locally). UTC was off by a day.
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
            2,
            '0',
          )}-${String(d.getDate()).padStart(2, '0')}`;
          const c = get().checkins.find((x) => {
            const dx = new Date(x.createdAt);
            const k = `${dx.getFullYear()}-${String(
              dx.getMonth() + 1,
            ).padStart(2, '0')}-${String(dx.getDate()).padStart(2, '0')}`;
            return k === key;
          });
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
        return get().checkins.filter(
          (c) => now - new Date(c.createdAt).getTime() < week,
        ).length;
      },
      reset: () => set({ checkins: [] }),
    }),
    {
      name: 'lumi.checkins',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persisted: unknown, version) => {
        if (!persisted || typeof persisted !== 'object')
          return persisted as never;
        const state = persisted as { checkins?: Checkin[] };
        if (version < 2 && Array.isArray(state.checkins)) {
          // Backfill new coord/zone/etc. fields on legacy checkins so
          // selectors don't blow up. The coordinate is unknown for
          // pre-migration rows; we plant them at center.
          state.checkins = state.checkins.map((c) => {
            const x = (c as Partial<Checkin>).x ?? 0.5;
            const y = (c as Partial<Checkin>).y ?? 0.5;
            return {
              ...c,
              x,
              y,
              energy: (c as Partial<Checkin>).energy ?? energyValue(x, y),
              zone: (c as Partial<Checkin>).zone ?? readState(x, y).name,
              route: (c as Partial<Checkin>).route ?? 'drag',
              aiCause: (c as Partial<Checkin>).aiCause ?? null,
              confirmed: (c as Partial<Checkin>).confirmed ?? null,
              note: (c as Partial<Checkin>).note ?? null,
            } as Checkin;
          });
        }
        return state as never;
      },
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
export const selectWeekMoods = (
  checkins: Checkin[],
): { date: string; mood: Mood | null; score: number }[] => {
  const out: { date: string; mood: Mood | null; score: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(d.getDate()).padStart(2, '0')}`;
    const c = checkins.find((x) => {
      const dx = new Date(x.createdAt);
      const k = `${dx.getFullYear()}-${String(dx.getMonth() + 1).padStart(
        2,
        '0',
      )}-${String(dx.getDate()).padStart(2, '0')}`;
      return k === key;
    });
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
  const c = checkins.find((x) => localYmdFromIso(x.createdAt) === t);
  return c ? c.mood : null;
};

export const selectCountThisWeek = (checkins: Checkin[]): number => {
  const now = Date.now();
  const week = 7 * 86400000;
  return checkins.filter((c) => now - new Date(c.createdAt).getTime() < week)
    .length;
};

/** Returns the most-recent N check-ins (newest first). */
export const selectRecentCheckins = (
  checkins: Checkin[],
  n: number,
): Checkin[] => checkins.slice(0, n);
