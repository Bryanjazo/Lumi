import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xpProgress } from '../lib/gamification';

export type AdhdType = 'inattentive' | 'hyperactive' | 'combined' | null;
export type SubscriptionStatus =
  /**
   * Default for a brand-new account. Free is the baseline forever —
   * the app never locks the core loop. Switches to 'trial' the
   * moment the user opts into the 7-day taste (either from the
   * trial-choice screen after onboarding or from a cap-hit prompt).
   */
  | 'free'
  /** Opted into the 7-day taste. trialStartedAt set on entry. */
  | 'trial'
  /** Active paid subscription (RevenueCat webhook flips it here). */
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'expired';
export type SubscriptionTier = 'monthly' | 'annual' | null;

// ── Onboarding seed types ──────────────────────────────────────────
// Captured by the canonical onboarding (lumi-onboarding-architecture)
// and reused throughout the app to personalize from minute one.

/** Multi-select struggle keys from onboarding step 1. */
export type StruggleKey =
  | 'paralysis'
  | 'time'
  | 'follow'
  | 'avoid'
  | 'overwhelm'
  | 'forget';

/** Part-of-day windows used for sharp/foggy energy seeds. */
export type EnergyWindowKey = 'morning' | 'midday' | 'afternoon' | 'evening';

// ── Settings (lumi-settings-architecture) ──────────────────────────
/** Notification toggles — defaults deliberately gentle. */
export interface NotificationPrefs {
  /** Rare "do this now" pokes. The only proactive surface. */
  nudges: boolean;
  /** Sunday-evening recap push (the retention keystone). */
  recap: boolean;
  /** Reminders for repeating quests. Off by default. */
  recurring: boolean;
  /** Suppress notifications after 9pm. */
  quiet: boolean;
}
/** App accent theme — recolors the user-action accent. */
export type ThemeKey = 'ember' | 'dusk' | 'lichen' | 'amethyst';

/**
 * How present the companion / game layer is. Per
 * `lumi-companion-mode-spec.md`. Default 'full' — Lumi's
 * differentiation IS the warm companion; we lead with it and let
 * the user dial down.
 */
export type CompanionMode = 'full' | 'minimal' | 'focused';

/**
 * Daily anchors — recurring fixtures the user's day is built around.
 * Seeded in onboarding (smart defaults if skipped). The Time tab reads
 * these so a fresh account still has real structure on day one — and
 * never shows fake personal tasks the user didn't create.
 *
 * Times are minutes since midnight (e.g. 8:00am = 480).
 */
export interface DailyAnchors {
  wake: number;
  breakfast: number;
  lunch: number;
  dinner: number;
  sleep: number;
}

export const DEFAULT_ANCHORS: DailyAnchors = {
  wake: 7 * 60,
  breakfast: 8 * 60,
  lunch: 12 * 60 + 30,
  dinner: 18 * 60 + 30,
  sleep: 22 * 60 + 30,
};

// Ordered list — used by the cascade logic in setAnchor and by any
// caller that needs to iterate anchors in chronological order. Adjust
// here if a new anchor (e.g. "snack") is ever added.
export const ANCHOR_ORDER: (keyof DailyAnchors)[] = [
  'wake',
  'breakfast',
  'lunch',
  'dinner',
  'sleep',
];

// Minimum gap between consecutive anchors (minutes). Prevents two
// from landing on the same minute and gives the day a sensible
// rhythm — breakfast can't be the same instant as wake, etc.
const ANCHOR_GAP = 15;

// Generous ceiling — 6 AM next day — so night-shift / late-night
// bedtimes (e.g. sleep at 1 AM) still display sanely without
// crossing through the next day's wake.
const ANCHOR_HARD_MAX = 30 * 60;

/**
 * Cascading bounds for a single anchor given the current map.
 *   - Each anchor must come AFTER the one before it by at least
 *     ANCHOR_GAP (15 min).
 *   - Each anchor must come BEFORE the one after it by ANCHOR_GAP.
 *   - Wake has no lower bound; sleep has no upper sibling.
 * Used by setAnchor (cascade-clamp on write) and by callers that
 * want to show min/max hints in the UI.
 */
export const anchorBounds = (
  key: keyof DailyAnchors,
  anchors: DailyAnchors,
): { min: number; max: number } => {
  const i = ANCHOR_ORDER.indexOf(key);
  const prev = i > 0 ? ANCHOR_ORDER[i - 1] : null;
  const next = i < ANCHOR_ORDER.length - 1 ? ANCHOR_ORDER[i + 1] : null;
  const min = prev ? anchors[prev] + ANCHOR_GAP : 0;
  const max = next ? anchors[next] - ANCHOR_GAP : ANCHOR_HARD_MAX;
  return { min, max };
};

/**
 * Boundary hours for the part-of-day windows. Morning starts at the
 * user's wakeHour and evening ends at the sleep anchor (both already
 * customizable elsewhere), so the only knobs the Windows editor needs
 * are the three middle boundaries.
 */
export interface WindowOverrides {
  /** When midday begins (and morning ends). 24-hr clock hour. */
  midday: number;
  /** When afternoon begins. */
  afternoon: number;
  /** When evening begins. */
  evening: number;
}

export const DEFAULT_WINDOW_OVERRIDES: WindowOverrides = {
  midday: 11,
  afternoon: 14,
  evening: 17,
};

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
  /** ADHD struggle profile — seeds tone + which detectors to weight. */
  struggles: StruggleKey[];
  /** Part-of-day the user said they're sharpest. Seeds energy curve. */
  sharpWindow: EnergyWindowKey | null;
  /** Part-of-day the user said they hit a wall. Seeds energy curve. */
  foggyWindow: EnergyWindowKey | null;
  /** Hour the user wakes up (0–23). Shapes the morning window. */
  wakeHour: number;
  /**
   * Recurring daily fixtures (wake / meals / sleep). Seeded during
   * onboarding; the Time tab always renders these so a fresh account
   * has real structure — and never invented personal tasks.
   */
  anchors: DailyAnchors;
  /**
   * User overrides for the part-of-day window boundaries. The Windows
   * editor in profile writes here; Home/Time/Capture read from
   * `useEffectiveWindows()` so the customization shows up everywhere.
   */
  windowOverrides: WindowOverrides;
  /** First-run contextual hints already shown — never re-show. */
  hintsSeen: string[];
  /** ISO timestamp the user finished onboarding. */
  onboardedAt: string | null;
  /**
   * Per-user onboarding receipts — map of Supabase user.id → ISO
   * timestamp. The root layout reads this so switching accounts on
   * the same device triggers the new account's onboarding, while
   * signing back into the same account skips it. The legacy local
   * `onboarded` flag stays around as a dev-mode fallback (when
   * Supabase isn't configured there's no session to key on).
   */
  onboardedUserIds: Record<string, string>;
  /** The post-onboarding spotlight tour was shown — never re-show. */
  tourSeen: boolean;
  // ── Account & settings ──
  /** Granular notification toggles, driven by the Settings screen. */
  notifPrefs: NotificationPrefs;
  /** Master voice capture toggle (mic in Capture/Oracle/etc). */
  voiceEnabled: boolean;
  /**
   * Companion-mode preset — dials the playful layer up or down.
   * See `lumi-companion-mode-spec.md`.
   *   'full'    — Luna + room + XP + streaks visible (default, cozy companion)
   *   'minimal' — small Luna, gentle streaks, NO XP/level/unlocks (warm clean organizer)
   *   'focused' — no cat, no XP, no room (pure calm AI organizer; Me tab → "You & Lumi")
   *
   * CRITICAL: this gates RENDERING ONLY. XP, shards, streak, vitality
   * and the learning layer keep accruing in every mode so flipping
   * between presets is non-destructive — switch to Focused for a
   * month, switch back, your level/streak/room are intact.
   */
  companionMode: CompanionMode;
  /**
   * Calendar integration — when on, tasks with explicit times are
   * written through expo-calendar to whichever calendar the user
   * picked, alongside the rest of their day. Off by default; one-
   * shot enable in Profile → Calendar after granting OS permission.
   */
  calendarEnabled: boolean;
  /**
   * Calendar ids to mirror events to. Multi-select — when the user
   * picks more than one, every timed task gets written to ALL of
   * them. Resolved when the user picks from the writable list
   * (defaults to [getDefaultCalendarAsync().id] when they first
   * connect). Empty array until they pick.
   *
   * v14 used a single `calendarId: string | null`; v15 migrated to
   * the array shape. The first element is implicitly the "primary"
   * for any feature that needs a single target.
   */
  calendarIds: string[];
  /**
   * Global "auto-add timed tasks to my calendar" toggle. When on,
   * addQuest/anchor/setDate/remove for any task with a time fires
   * the corresponding calendar mutation. When off, the user can
   * still nothing-special-happens; per-task quick adds may be wired
   * later. Off by default — calendar writes are surprising; opt in.
   */
  autoSyncTasksWithTimes: boolean;
  /** BCP-47 capture language tag for transcription. */
  captureLang: string;
  /** Active accent theme (Premium-gated except 'ember'). */
  theme: ThemeKey;
  /**
   * Avatar choice — 'default' (the canonical Luna sprite) or a skin id
   * from `constants/skins.ts`. Picker only offers skins the user has
   * unlocked (xp >= skin.xpToUnlock). The header reads this so the
   * chosen Luna shows up app-wide.
   */
  avatar: string;
  /**
   * Dev escape only — set to true automatically when Supabase isn't
   * configured. We do not let signed-in users opt into "offline" once
   * required-auth is on.
   */
  offlineMode: boolean;
  /**
   * Loot shards earned from completing quests. Higher-tier quests
   * have a higher chance of dropping. Capped at the level threshold
   * for trade-in (future feature).
   */
  shards: number;
  subscriptionStatus: SubscriptionStatus;
  subscriptionTier: SubscriptionTier;
  subscriptionCurrentPeriodEnd: string | null;
  /**
   * ISO timestamp when the user opted into the 7-day Pro trial.
   * Source of truth for trialDaysLeft — derived from this, NOT
   * from account creation. Null until the user accepts.
   */
  trialStartedAt: string | null;
  /**
   * One-shot: true once the user has seen the post-onboarding
   * trial-choice screen. Prevents re-showing on every launch.
   */
  trialChoiceSeen: boolean;

  setName: (name: string) => void;
  setPetName: (petName: string) => void;
  setAdhdType: (t: AdhdType) => void;
  addXp: (amount: number) => void;
  registerActivity: () => void;
  consumeShield: () => void;
  rechargeShield: () => void;
  completeOnboarding: () => void;
  /**
   * Persist all onboarding answers in a single atomic write, mark the
   * user onboarded, and stamp the time. The flow uses this so the
   * reflection screen can read back consistent data.
   */
  completeOnboardingWith: (data: {
    struggles?: StruggleKey[];
    sharpWindow?: EnergyWindowKey | null;
    foggyWindow?: EnergyWindowKey | null;
    wakeHour?: number;
    anchors?: Partial<DailyAnchors>;
    name?: string;
  }) => void;
  /** Update one anchor — used by the Settings screen. */
  setAnchor: (key: keyof DailyAnchors, minutes: number) => void;
  /** Update window boundaries — used by the Windows editor sheet. */
  setWindowOverrides: (overrides: WindowOverrides) => void;
  /**
   * Record that a given Supabase user has finished onboarding on this
   * device. Adds to `onboardedUserIds`; the root layout reads this
   * to decide whether to show the interview after sign-in.
   */
  markOnboardedForUser: (userId: string) => void;
  /** Mark a one-time hint as seen so it never re-renders. */
  markHintSeen: (key: string) => void;
  /** Mark the spotlight tour finished or skipped. */
  setTourSeen: () => void;
  /** Flip a single notification toggle. */
  setNotifPref: (key: keyof NotificationPrefs, value: boolean) => void;
  setVoiceEnabled: (on: boolean) => void;
  setCaptureLang: (lang: string) => void;
  setTheme: (theme: ThemeKey) => void;
  setCompanionMode: (mode: CompanionMode) => void;
  /** Connect / disconnect calendar writes. Disconnect clears calendarIds. */
  setCalendarEnabled: (on: boolean) => void;
  /** Replace the full set of calendars Lumi writes to. */
  setCalendarIds: (ids: string[]) => void;
  /** Add or remove a single calendar id from the set. */
  toggleCalendarId: (id: string) => void;
  /** Global toggle for "auto-write timed tasks to my calendar". */
  setAutoSyncTasksWithTimes: (on: boolean) => void;
  setAvatar: (avatar: string) => void;
  setNotificationsEnabled: (on: boolean) => void;
  setOfflineMode: (on: boolean) => void;
  addShard: () => void;
  setSubscription: (params: {
    status: SubscriptionStatus;
    tier?: SubscriptionTier;
    currentPeriodEnd?: string | null;
  }) => void;
  /**
   * Opt into the 7-day Pro taste. Idempotent — only starts if the
   * user is currently on free (won't re-arm a lapsed trial). The
   * trial-choice screen calls this; cap-hit prompts call it; the
   * paywall's "Try free for 7 days" calls it.
   */
  startTrial: () => void;
  /** Mark the post-onboarding trial-choice screen as completed. */
  markTrialChoiceSeen: () => void;
  reset: () => void;
}

const dayDiff = (a: string, b: string) => {
  // Parse as LOCAL midnight (no Z suffix). Streak math compares Y-M-D
  // strings written by today() below, which are now local — both sides
  // agree, so a user crossing midnight in their own zone gets the
  // expected +1 streak, not a phantom 0 or 2.
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((db - da) / 86400000);
};

// LOCAL Y-M-D for streak math. Was UTC, which meant a user in PT
// completing a quest at 10 PM Monday saw their "today" key roll to
// Tuesday UTC — registerActivity then read Monday's lastActiveDate
// and treated Monday→Tuesday-UTC as a streak miss. Now device-local.
const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      name: '',
      // The pet's default name matches the app: both are "Lumi".
      // Users can rename via Profile → Edit (petName field). Every
      // user-facing string that names the cat reads this value.
      petName: 'Lumi',
      adhdType: null,
      xp: 0,
      streak: 0,
      lastActiveDate: null,
      shieldAvailable: true,
      shieldUsedThisWeek: false,
      onboarded: false,
      notificationsEnabled: false,
      offlineMode: false,
      shards: 0,
      struggles: [],
      sharpWindow: null,
      foggyWindow: null,
      wakeHour: 7,
      anchors: DEFAULT_ANCHORS,
      windowOverrides: DEFAULT_WINDOW_OVERRIDES,
      hintsSeen: [],
      onboardedAt: null,
      onboardedUserIds: {},
      tourSeen: false,
      notifPrefs: {
        nudges: true,
        recap: true,
        recurring: false,
        quiet: true,
      },
      voiceEnabled: true,
      captureLang: 'en-US',
      theme: 'ember',
      // Default to the cozy companion — let users dial down, don't
      // bury the charm. Per companion-mode-spec §1.
      companionMode: 'full',
      calendarEnabled: false,
      calendarIds: [],
      autoSyncTasksWithTimes: false,
      avatar: 'default',
      subscriptionStatus: 'free',
      subscriptionTier: null,
      subscriptionCurrentPeriodEnd: null,
      trialStartedAt: null,
      trialChoiceSeen: false,

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

      completeOnboarding: () =>
        set({ onboarded: true, onboardedAt: new Date().toISOString() }),
      completeOnboardingWith: (data) =>
        set((s) => {
          const mergedAnchors: DailyAnchors = {
            ...s.anchors,
            ...(data.anchors ?? {}),
          };
          // Keep wakeHour and anchors.wake in sync — they're the same
          // thing in two units. The Time tab uses anchors.wake; older
          // surfaces still read wakeHour.
          if (data.wakeHour != null) {
            mergedAnchors.wake = data.wakeHour * 60;
          }
          return {
            struggles: data.struggles ?? s.struggles,
            sharpWindow: data.sharpWindow ?? s.sharpWindow,
            foggyWindow: data.foggyWindow ?? s.foggyWindow,
            wakeHour: Math.floor(mergedAnchors.wake / 60),
            anchors: mergedAnchors,
            name: data.name ?? s.name,
            onboarded: true,
            onboardedAt: new Date().toISOString(),
          };
        }),
      markOnboardedForUser: (userId) =>
        set((s) => ({
          onboardedUserIds: {
            ...s.onboardedUserIds,
            [userId]: s.onboardedUserIds[userId] ?? new Date().toISOString(),
          },
        })),
      setWindowOverrides: (overrides) => set({ windowOverrides: overrides }),
      setAnchor: (key, minutes) =>
        set((s) => {
          // Cascading clamp — enforces the daily ordering invariant
          // (wake < breakfast < lunch < dinner < sleep with a 15-min
          // gap each). Two passes:
          //   1) Clamp the changed value to its own bounds against
          //      its CURRENT neighbors.
          //   2) Walk forward and bump any subsequent anchor that
          //      would now sit too close to its predecessor — so
          //      pushing wake from 7→11am drags breakfast/lunch/etc
          //      forward instead of leaving them in the past.
          // ALSO walk backward (rare: lowering sleep below dinner)
          // so the chain stays monotonic in both directions.
          const next: DailyAnchors = { ...s.anchors };
          const { min: ownMin, max: ownMax } = anchorBounds(key, next);
          next[key] = Math.max(ownMin, Math.min(ownMax, minutes));

          const idx = ANCHOR_ORDER.indexOf(key);
          // Forward cascade
          for (let i = idx + 1; i < ANCHOR_ORDER.length; i++) {
            const cur = ANCHOR_ORDER[i];
            const prev = ANCHOR_ORDER[i - 1];
            if (next[cur] < next[prev] + ANCHOR_GAP) {
              next[cur] = Math.min(ANCHOR_HARD_MAX, next[prev] + ANCHOR_GAP);
            }
          }
          // Backward cascade
          for (let i = idx - 1; i >= 0; i--) {
            const cur = ANCHOR_ORDER[i];
            const after = ANCHOR_ORDER[i + 1];
            if (next[cur] > next[after] - ANCHOR_GAP) {
              next[cur] = Math.max(0, next[after] - ANCHOR_GAP);
            }
          }

          // Mirror wake into wakeHour for back-compat with surfaces
          // that still read s.wakeHour.
          if (key === 'wake' || next.wake !== s.anchors.wake) {
            return {
              anchors: next,
              wakeHour: Math.floor(next.wake / 60),
            };
          }
          return { anchors: next };
        }),
      markHintSeen: (key) =>
        set((s) =>
          s.hintsSeen.includes(key)
            ? s
            : { hintsSeen: [...s.hintsSeen, key] },
        ),
      setTourSeen: () => set({ tourSeen: true }),
      setNotifPref: (key, value) =>
        set((s) => ({ notifPrefs: { ...s.notifPrefs, [key]: value } })),
      setVoiceEnabled: (on) => set({ voiceEnabled: on }),
      setCaptureLang: (lang) => set({ captureLang: lang }),
      setCompanionMode: (mode) => set({ companionMode: mode }),
      setCalendarEnabled: (on) =>
        set((s) =>
          on
            ? { calendarEnabled: true }
            : // Disconnect also clears the picked calendars and the
              // auto-sync toggle — re-connecting starts clean.
              {
                calendarEnabled: false,
                calendarIds: [],
                autoSyncTasksWithTimes: false,
              },
        ),
      setCalendarIds: (ids) => set({ calendarIds: ids }),
      toggleCalendarId: (id) =>
        set((s) => ({
          calendarIds: s.calendarIds.includes(id)
            ? s.calendarIds.filter((x) => x !== id)
            : [...s.calendarIds, id],
        })),
      setAutoSyncTasksWithTimes: (on) => set({ autoSyncTasksWithTimes: on }),
      setTheme: (theme) => set({ theme }),
      setAvatar: (avatar) => set({ avatar }),
      setNotificationsEnabled: (on) => set({ notificationsEnabled: on }),
      setOfflineMode: (on) => set({ offlineMode: on }),
      addShard: () => set((s) => ({ shards: s.shards + 1 })),
      setSubscription: ({ status, tier, currentPeriodEnd }) =>
        set({
          subscriptionStatus: status,
          subscriptionTier: tier ?? null,
          subscriptionCurrentPeriodEnd: currentPeriodEnd ?? null,
        }),

      startTrial: () =>
        set((s) => {
          // Only arm the trial from a clean 'free' state. If the
          // user is already on trial or active, don't overwrite.
          // If they've previously trialed (trialStartedAt set) and
          // lapsed back to free, also don't re-arm — one taste per
          // account.
          if (s.subscriptionStatus !== 'free') return s;
          if (s.trialStartedAt) return s;
          return {
            subscriptionStatus: 'trial',
            trialStartedAt: new Date().toISOString(),
          };
        }),

      markTrialChoiceSeen: () => set({ trialChoiceSeen: true }),

      reset: () =>
        set({
          name: '',
          petName: 'Lumi',
          adhdType: null,
          xp: 0,
          streak: 0,
          lastActiveDate: null,
          shieldAvailable: true,
          shieldUsedThisWeek: false,
          onboarded: false,
          notificationsEnabled: false,
          offlineMode: false,
          shards: 0,
          struggles: [],
          sharpWindow: null,
          foggyWindow: null,
          wakeHour: 7,
          anchors: DEFAULT_ANCHORS,
          windowOverrides: DEFAULT_WINDOW_OVERRIDES,
          hintsSeen: [],
          onboardedAt: null,
          onboardedUserIds: {},
          tourSeen: false,
          notifPrefs: {
            nudges: true,
            recap: true,
            recurring: false,
            quiet: true,
          },
          voiceEnabled: true,
          captureLang: 'en-US',
          theme: 'ember',
          companionMode: 'full',
          calendarEnabled: false,
          calendarIds: [],
          autoSyncTasksWithTimes: false,
          avatar: 'default',
          subscriptionStatus: 'free',
          subscriptionTier: null,
          subscriptionCurrentPeriodEnd: null,
          trialStartedAt: null,
          trialChoiceSeen: false,
        }),
    }),
    {
      name: 'lumi.user',
      storage: createJSONStorage(() => AsyncStorage),
      version: 15,
      /**
       * v1 → v2: re-trigger the canonical onboarding for anyone who
       * went through the OLD terracotta-era flow. We can tell them
       * apart from new-flow users by the presence of `onboardedAt`
       * (only the new flow sets it). If onboarded is true but the
       * stamp is missing, flip onboarded back to false so the root
       * layout routes them into the new 7-step interview.
       *
       * v2 → v3: backfill the post-onboarding spotlight-tour flag so
       * existing testers see the tour exactly once on next launch.
       */
      migrate: (persisted: unknown, version) => {
        if (!persisted || typeof persisted !== 'object')
          return persisted as never;
        const state = persisted as Partial<UserState>;
        if (version < 2) {
          if (state.onboarded && !state.onboardedAt) {
            state.onboarded = false;
          }
          // Backfill the new fields so reads never see undefined.
          if (!state.struggles) state.struggles = [];
          if (state.sharpWindow === undefined) state.sharpWindow = null;
          if (state.foggyWindow === undefined) state.foggyWindow = null;
          if (state.wakeHour == null) state.wakeHour = 7;
          if (!state.hintsSeen) state.hintsSeen = [];
          if (state.onboardedAt === undefined) state.onboardedAt = null;
        }
        if (version < 3) {
          if (state.tourSeen === undefined) state.tourSeen = false;
        }
        if (version < 4) {
          if (!state.notifPrefs)
            state.notifPrefs = {
              nudges: true,
              recap: true,
              recurring: false,
              quiet: true,
            };
          if (state.voiceEnabled === undefined) state.voiceEnabled = true;
          if (!state.captureLang) state.captureLang = 'en-US';
          if (!state.theme) state.theme = 'ember';
        }
        if (version < 5) {
          // Backfill anchors from wakeHour (or smart defaults).
          const wakeMin = (state.wakeHour ?? 7) * 60;
          state.anchors = {
            wake: wakeMin,
            breakfast: DEFAULT_ANCHORS.breakfast,
            lunch: DEFAULT_ANCHORS.lunch,
            dinner: DEFAULT_ANCHORS.dinner,
            sleep: DEFAULT_ANCHORS.sleep,
          };
        }
        if (version < 6) {
          // New per-user onboarding receipts. We can't backfill the
          // map at migration time (no session yet) — the root layout
          // does a one-shot legacy adoption: if local onboarded+
          // onboardedAt exist when the user signs in, the layout
          // copies the timestamp into the map for that user.id.
          if (!state.onboardedUserIds) state.onboardedUserIds = {};
        }
        if (version < 7) {
          // The v6 legacy bridge ran for every fresh sign-up while the
          // local `onboarded` flag was true, polluting the map so new
          // accounts skipped the interview. Wipe the map and clear the
          // local flag so the now-conservative bridge starts clean and
          // each fresh account gets its own onboarding pass.
          state.onboardedUserIds = {};
          state.onboarded = false;
        }
        if (version < 8) {
          // The first cross-account wipe (added at v7) reset
          // questStore/checkinStore/suggestionsStore but did NOT zero
          // out userStore progression fields (xp, shards, streak,
          // shield, identity). Any device that signed into a new
          // account between v7 and v8 inherited the previous
          // account's progression. One-time scrub of progression so
          // those devices return to baseline. Onboarded users keep
          // their per-user receipts and onboarding seeds.
          state.xp = 0;
          state.streak = 0;
          state.lastActiveDate = null;
          state.shieldAvailable = true;
          state.shieldUsedThisWeek = false;
          state.shards = 0;
          state.adhdType = null;
          state.petName = 'Lumi';
        }
        if (version < 9) {
          // Avatar field added — backfill default Luna for existing
          // users. They can pick an unlocked skin in profile→Edit.
          if (!state.avatar) state.avatar = 'default';
        }
        if (version < 10) {
          // Window overrides added — seed with the static defaults so
          // existing users start where the static WINDOWS constant
          // had them (11/14/17). The Windows editor changes these.
          if (!state.windowOverrides) {
            state.windowOverrides = DEFAULT_WINDOW_OVERRIDES;
          }
        }
        if (version < 11) {
          // Monetization model swap (lumi-monetization-model-spec-2):
          // free is now the baseline, the 7-day Pro taste is opt-in.
          // - Any existing user on 'trial' had their trial implicitly
          //   derived from created_at. We don't have that here, so
          //   the safest non-regressive move is to drop them to
          //   'free' (no forced lock; they keep all their data and
          //   can opt into the new 7-day taste from the trial-choice
          //   screen or any cap-hit prompt).
          // - Users on 'active' keep their access.
          // - Users on past_due / cancelled / expired drop to 'free'
          //   too — same reasoning, plus we never want to lock the
          //   core loop anymore.
          if (state.subscriptionStatus !== 'active') {
            state.subscriptionStatus = 'free';
          }
          if (state.trialStartedAt === undefined) state.trialStartedAt = null;
          // Existing users have already seen onboarding; don't
          // bother them with the trial-choice screen at next launch.
          if (state.trialChoiceSeen === undefined) {
            state.trialChoiceSeen = !!state.onboarded;
          }
        }
        if (version < 12) {
          // Default pet name rebrand: 'Luna' → 'Lumi'.
          //
          //  The app and the cat are both "Lumi" now (cat name was
          //  previously seeded as 'Luna' but the brand says one
          //  word, not two). Only flip users still on the legacy
          //  default — anyone who renamed their cat keeps the
          //  name they picked.
          if (state.petName === 'Luna') {
            state.petName = 'Lumi';
          }
        }
        if (version < 13) {
          // Companion-mode field added (companion-mode-spec). Existing
          // users default to 'full' so the cozy companion stays put
          // for everyone who was using the app before this feature.
          if (state.companionMode === undefined) state.companionMode = 'full';
        }
        if (version < 14) {
          // Calendar integration added. Default everything off — we
          // do not write to anyone's calendar without an explicit
          // opt-in, even for existing users. v14 originally stored
          // a single calendarId; v15 promotes it to an array.
          if (state.calendarEnabled === undefined) state.calendarEnabled = false;
          if (state.calendarIds === undefined) state.calendarIds = [];
          if (state.autoSyncTasksWithTimes === undefined) {
            state.autoSyncTasksWithTimes = false;
          }
        }
        if (version < 15) {
          // Multi-calendar — the v14 single `calendarId: string | null`
          // becomes `calendarIds: string[]`. Users who had a calendar
          // picked under v14 land with that one calendar in the array;
          // never-connected users land with an empty array. The legacy
          // field is dropped from persisted state so future reads can't
          // accidentally trust it.
          const persistedWithLegacy = state as Partial<UserState> & {
            calendarId?: string | null;
          };
          const legacy = persistedWithLegacy.calendarId;
          if (!Array.isArray(state.calendarIds)) {
            state.calendarIds = legacy ? [legacy] : [];
          }
          delete persistedWithLegacy.calendarId;
        }
        return state as never;
      },
    },
  ),
);

export const useLevel = () => {
  const xp = useUserStore((s) => s.xp);
  return xpProgress(xp);
};
