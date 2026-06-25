import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xpForQuest, todayKey } from '../lib/gamification';
import { Importance, importanceFromDifficulty } from '../constants/importance';
import {
  WindowKey,
  deriveWindow,
  deriveWindowFor,
  getEffectiveWindows,
  WIN_ORDER,
} from '../constants/windows';
import { RecurRule, nextOccurrence } from '../constants/recur';
import { useUserStore } from './userStore';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Quest {
  id: string;
  title: string;
  difficulty: Difficulty;
  importance: Importance;
  /**
   * Which part of day this quest belongs to. The Time tab reads this
   * to project the quest onto the radar arc. Always set.
   */
  window: WindowKey;
  xpReward: number;
  completed: boolean;
  completedAt: string | null;
  date: string; // YYYY-MM-DD
  /** Anchored quests: exact time (hour + minute). If null → windowed. */
  scheduledHour?: number;
  scheduledMinute?: number;
  durationMinutes?: number;
  accent?: 'plum' | 'terra' | 'moss' | 'caramel' | 'mist' | 'rose' | 'fog';
  createdAt: string;
  /**
   * When set, this quest auto-resets to "open" on its cadence's next
   * occurrence — see refreshRecurring(). v1 conflates template +
   * instance into a single row to avoid stacking; future v2 may split
   * them per lumi-learning-recurrence-architecture.md §2.
   */
  recur?: RecurRule;
  /** ISO date the recurring quest was last surfaced (or last completed). */
  lastSpawnedDate?: string;
  /**
   * Short freeform context the LLM extracted ("bring the charger",
   * "the blue folder") or the user added. Surfaced as a subtitle
   * under the title on Home / Time so contextual details aren't
   * silently dropped on the floor.
   */
  note?: string;
  /**
   * User-added comment, distinct from `note` (description). Pins
   * ABOVE the description in the hero card as a boxed "YOUR COMMENT"
   * section so the user's own annotations stand apart from Lumi's
   * extracted context. Capped at 280 chars to keep the card calm.
   */
  comment?: string;
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
      | 'window'
      | 'recur'
      | 'lastSpawnedDate'
    > & {
      date?: string;
      xpReward?: number;
      importance?: Importance;
      note?: string;
      window?: WindowKey;
      recur?: RecurRule;
    },
  ) => Quest;
  addMany: (
    q: {
      title: string;
      difficulty: Difficulty;
      importance?: Importance;
      window?: WindowKey;
    }[],
  ) => Quest[];
  /** Move a quest to a different window (and un-anchor it). */
  moveWindow: (id: string, window: WindowKey) => void;
  /** Anchor a quest to an exact time; window is derived to match. */
  anchor: (id: string, hour: number, minute: number) => void;
  /**
   * Move a quest to a different day. Used by the check-in re-planner
   * to push a heavy Trial off today when the user is low energy.
   * Clears any time anchor so the deferred quest doesn't loom on the
   * Time radar at its old slot.
   */
  setDate: (id: string, dateISO: string) => void;
  toggle: (id: string) => Quest | undefined;
  /**
   * Replace a quest's title in place — used by the LLM background
   * upgrade pass on smart captures (lib/anthropic.ts → llmCleanTitle),
   * which polishes the deterministic title once Claude responds.
   * No-op if id doesn't exist or the new title is blank.
   */
  updateTitle: (id: string, title: string) => void;
  /** Replace the freeform note on a quest. Empty/whitespace clears it. */
  setNote: (id: string, note: string) => void;
  /** Replace the user-added comment on a quest. Empty/whitespace clears it. */
  setComment: (id: string, comment: string) => void;
  remove: (id: string) => void;
  /** Stop a quest from repeating (clears the recur rule). */
  stopRecurring: (id: string) => void;
  /**
   * Walk recurring quests and reset any that are due — flips
   * completed back to false, advances date to today, updates the
   * lastSpawnedDate stamp. Idempotent; safe to call on every Home
   * mount. ADHD-safe: never stacks more than one open instance per
   * recurring quest per day (architecture §6).
   */
  refreshRecurring: () => void;
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
        // Derive window from scheduledHour when provided; otherwise
        // honor the caller's choice or default to midday.
        const win =
          q.window ??
          (q.scheduledHour != null
            ? deriveWindowFor(
                getEffectiveWindows(),
                q.scheduledHour * 60 + (q.scheduledMinute ?? 0),
              )
            : 'midday');
        // A recurring quest's window is bound to its cadence's part —
        // never let it drift away from rule.part.
        const finalWin = q.recur ? q.recur.part : win;
        const quest: Quest = {
          id: newId(),
          title: q.title,
          difficulty: q.difficulty,
          importance,
          window: finalWin,
          xpReward,
          completed: false,
          completedAt: null,
          date: q.date ?? todayKey(),
          // Recurring quests use rule.at when set (chosen via the
          // "Schedule habit" sheet). Without an explicit time, the
          // quest floats on its part-of-day window.
          scheduledHour:
            q.recur && q.recur.at != null
              ? Math.floor(q.recur.at / 60)
              : q.recur
                ? undefined
                : q.scheduledHour,
          scheduledMinute:
            q.recur && q.recur.at != null
              ? q.recur.at % 60
              : q.recur
                ? undefined
                : q.scheduledMinute,
          durationMinutes: q.durationMinutes,
          accent: q.accent ?? accents[get().quests.length % accents.length],
          createdAt: new Date().toISOString(),
          recur: q.recur,
          lastSpawnedDate: q.recur ? todayKey() : undefined,
          ...(q.note && q.note.length > 0 ? { note: q.note } : {}),
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
          // Smart placement when the caller doesn't specify a window:
          //   high importance → user's sharpWindow (their peak)
          //   low  importance → user's foggyWindow (their slump)
          //   medium / unknown → midday as a neutral default
          // Previously batch imports always landed at midday, which
          // made onboarding seeds and brain-dumps feel generic.
          window:
            q.window ??
            (() => {
              const imp =
                q.importance ?? importanceFromDifficulty(q.difficulty);
              const u = useUserStore.getState();
              if (imp === 'high' && u.sharpWindow) return u.sharpWindow;
              if (imp === 'low' && u.foggyWindow) return u.foggyWindow;
              return 'midday';
            })(),
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
      moveWindow: (id, window) => {
        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === id
              ? {
                  ...q,
                  window,
                  // moving to a window un-anchors (user chose fuzzy)
                  scheduledHour: undefined,
                  scheduledMinute: undefined,
                }
              : q,
          ),
        }));
      },
      anchor: (id, hour, minute) => {
        const win = deriveWindowFor(getEffectiveWindows(), hour * 60 + minute);
        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === id
              ? {
                  ...q,
                  scheduledHour: hour,
                  scheduledMinute: minute,
                  window: win,
                  // Default duration so the Time tab can mode-switch
                  // to "in-it" while we're inside the block.
                  durationMinutes: q.durationMinutes ?? 45,
                }
              : q,
          ),
        }));
      },
      setDate: (id, dateISO) => {
        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === id
              ? {
                  ...q,
                  date: dateISO,
                  // Deferred quests lose their anchor — they'll need
                  // re-scheduling on the new day.
                  scheduledHour: undefined,
                  scheduledMinute: undefined,
                }
              : q,
          ),
        }));
      },
      updateTitle: (id, title) => {
        const t = title.trim();
        if (!t) return;
        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === id ? { ...q, title: t } : q,
          ),
        }));
      },
      setNote: (id, note) => {
        const trimmed = note.trim();
        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === id
              ? trimmed.length > 0
                ? { ...q, note: trimmed }
                : (() => {
                    const { note: _drop, ...rest } = q;
                    return rest;
                  })()
              : q,
          ),
        }));
      },
      setComment: (id, comment) => {
        // Same pattern as setNote — cap at 280 to match the spec
        // ("Long comment (max 280)"). Empty input removes the
        // field entirely rather than leaving an empty string.
        const trimmed = comment.trim().slice(0, 280);
        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === id
              ? trimmed.length > 0
                ? { ...q, comment: trimmed }
                : (() => {
                    const { comment: _drop, ...rest } = q;
                    return rest;
                  })()
              : q,
          ),
        }));
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
      stopRecurring: (id) =>
        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === id ? { ...q, recur: undefined, lastSpawnedDate: undefined } : q,
          ),
        })),
      refreshRecurring: () => {
        const today = todayKey();
        set((s) => ({
          quests: s.quests.map((q) => {
            if (!q.recur) return q;
            // Already shows today and still open — leave alone.
            if (q.date === today && !q.completed) return q;
            // IDEMPOTENCY GUARD — if we already spawned this recurring
            // quest today (whether the user has completed it or not),
            // don't reset it. Without this, refreshRecurring() running
            // twice in quick succession (component remount, Zustand
            // subscriber storm) could un-complete a finished quest
            // and re-charge the user XP/streak. The completion path
            // does NOT clear lastSpawnedDate, so this guard is safe.
            if (q.lastSpawnedDate === today) return q;
            const next = nextOccurrence(
              q.recur,
              q.lastSpawnedDate ?? q.date,
            );
            if (next > today) return q;
            // Due today (or overdue): reset the row, advance the
            // lastSpawned stamp, and re-anchor `date` to today so it
            // surfaces in Home's today list. Sync scheduledHour/Minute
            // to the rule's `at` if it has one — that's the source
            // of truth after the user customized via the schedule sheet.
            const recurAt = q.recur.at;
            return {
              ...q,
              completed: false,
              completedAt: null,
              date: today,
              lastSpawnedDate: today,
              scheduledHour:
                recurAt != null ? Math.floor(recurAt / 60) : q.scheduledHour,
              scheduledMinute:
                recurAt != null ? recurAt % 60 : q.scheduledMinute,
            };
          }),
        }));
      },
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
      version: 3,
      migrate: (persisted: unknown, version) => {
        if (!persisted || typeof persisted !== 'object')
          return persisted as never;
        const state = persisted as { quests?: Quest[] };
        if (version < 2 && Array.isArray(state.quests)) {
          state.quests = state.quests.map((q) => ({
            ...q,
            importance:
              q.importance ?? importanceFromDifficulty(q.difficulty ?? 'easy'),
          }));
        }
        if (version < 3 && Array.isArray(state.quests)) {
          state.quests = state.quests.map((q) => ({
            ...q,
            window:
              q.window ??
              (q.scheduledHour != null
                ? deriveWindow(
                    q.scheduledHour * 60 + (q.scheduledMinute ?? 0),
                  )
                : 'midday'),
          }));
        }
        return state as never;
      },
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
