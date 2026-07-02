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
import { useUserStore, DEFAULT_ANCHORS } from '../store/userStore';

export const resetLocalUserData = (): void => {
  useQuestStore.getState().reset();
  useCheckinStore.getState().reset();
  useSuggestionsStore.getState().reset();
  // Learned LLM corrections are per-user preferences, not device
  // defaults.
  useCorrectionsStore.getState().reset();
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
  });
};
