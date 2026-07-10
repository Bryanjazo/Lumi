// Lumi · local personal-data reset (security audit §5 — sign-out
// completeness).
//
// One shared wipe used by BOTH:
//   - lib/auth.ts signOut() — after a successful final sync push, so
//     a signed-out device doesn't keep the previous user's tasks /
//     check-ins / learned preferences sitting in storage
//   - app/_layout.tsx cross-account guard — when a different account
//     signs in on a device that still has the previous user's data
//
// Deliberately NOT a factory reset: device-level prefs that aren't
// personal (companion mode, theme accent) stay put.

import { useQuestStore } from '../store/questStore';
import { useCheckinStore } from '../store/checkinStore';
import { useSuggestionsStore } from '../store/suggestionsStore';
import { useCorrectionsStore } from '../store/correctionsStore';
import { useAiMetricsStore } from '../store/aiMetricsStore';
import { cancelAllReminders } from './notifications';
import { useUserStore, DEFAULT_ANCHORS } from '../store/userStore';

export const resetLocalUserData = (): void => {
  // Scheduled notifications belong to the signed-out user's day —
  // a new account shouldn't inherit their reminder times.
  void cancelAllReminders().catch(() => {});
  useQuestStore.getState().reset();
  useCheckinStore.getState().reset();
  useSuggestionsStore.getState().reset();
  // Learned LLM corrections are per-user preferences, not device
  // defaults.
  useCorrectionsStore.getState().reset();
  // Routing/edit metrics describe the previous user's captures.
  useAiMetricsStore.getState().reset();
  useUserStore.setState({
    // identity
    name: '',
    // Default pet name matches the app brand — both are "Lumi".
    petName: 'Lumi',
    adhdType: null,
    avatar: 'default',
    // progression
    xp: 0,
    streak: 0,
    lastActiveDate: null,
    lastOpenedDate: null,
    rescueDismissedDate: null,
    backlogNudgeDismissedDate: null,
    heyLumiEnabled: false,
    activeDaysThisMonth: 0,
    focusMinutesLifetime: 0,
    tasksEverCompleted: 0,
    activeMonthKey: null,
    isTester: false,
    shieldAvailable: true,
    shieldUsedThisWeek: false,
    shards: 0,
    // onboarding seeds
    struggles: [],
    sharpWindow: null,
    foggyWindow: null,
    wakeHour: 7,
    anchors: DEFAULT_ANCHORS,
    windowOverrides: { midday: 11, afternoon: 14, evening: 17 },
    // legacy onboarding flag (per-user gate is onboardedUserIds)
    onboarded: false,
    onboardedAt: null,
    // First-run guidance is PER USER, not per device — without these
    // resets, a new account on a device that already saw the tour
    // (tourSeen persisted true) onboarded fine but never got the
    // spotlight tour or contextual hints.
    tourSeen: false,
    hintsSeen: [],
  });
};
