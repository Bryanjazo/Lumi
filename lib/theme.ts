// Accent token — the single source of truth for the user-action color.
//
// Why this exists:
//   The settings spec (lumi-profile-functional-spec §3) requires theme
//   swatches to live-recolor the app. The color law from the master
//   build spec is strict:
//     - The user-action accent (default ember) is themeable.
//     - Lumi's intelligence color (dusk #8EA0B4) is reserved — it is
//       NEVER swapped out, even if the user picks a "Dusk" accent.
//   So any screen that needs "the user's accent" reads from here, and
//   anything Lumi-noticed keeps using timeColors.dusk directly.

import { useUserStore, type ThemeKey } from '../store/userStore';

export interface Accent {
  /** Primary fill — buttons, progress bars, "you" actions. */
  fg: string;
  /** Darker shade for pressed/inactive states. */
  dk: string;
  /** Highlight — sparkles, premium glow. */
  glow: string;
  /** Translucent fill for accent cards. */
  bg: string;
  /** Translucent border for accent cards. */
  border: string;
}

const PALETTE: Record<ThemeKey, Accent> = {
  ember: {
    fg: '#E07A4F',
    dk: '#9C4E2E',
    glow: '#F4C98A',
    bg: 'rgba(224,122,79,0.12)',
    border: 'rgba(224,122,79,0.27)',
  },
  dusk: {
    fg: '#8EA0B4',
    dk: '#3E4A5C',
    glow: '#C7D1DE',
    bg: 'rgba(142,160,180,0.12)',
    border: 'rgba(142,160,180,0.27)',
  },
  lichen: {
    fg: '#869072',
    dk: '#52593F',
    glow: '#B8C29C',
    bg: 'rgba(134,144,114,0.12)',
    border: 'rgba(134,144,114,0.27)',
  },
  amethyst: {
    fg: '#9A85A8',
    dk: '#5E4D6B',
    glow: '#C7B5D4',
    bg: 'rgba(154,133,168,0.12)',
    border: 'rgba(154,133,168,0.27)',
  },
};

export const accentFor = (theme: ThemeKey): Accent => PALETTE[theme] ?? PALETTE.ember;

/**
 * Hook — read the active accent. Components that re-render on theme
 * change (every screen) call this near the top of render.
 */
export const useAccent = (): Accent => {
  const theme = useUserStore((s) => s.theme);
  return PALETTE[theme] ?? PALETTE.ember;
};

/**
 * Non-hook getter for static contexts (StyleSheet builders that need a
 * one-shot read at module init, or sub-render helpers). Prefer
 * useAccent() inside components so theme changes propagate.
 */
export const getAccent = (): Accent => {
  const theme = useUserStore.getState().theme;
  return PALETTE[theme] ?? PALETTE.ember;
};

/**
 * The locked Lumi-intelligence color. Anything "Lumi noticed",
 * suggestion-tinted, recurrence-marked, recap-insight stays this
 * color — even if the user accent happens to also be dusk. The point
 * is the *role*: this token says "this is Lumi speaking," and the
 * user can't accidentally re-tint it.
 */
export const LUMI_INTELLIGENCE = '#8EA0B4';
