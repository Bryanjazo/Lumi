// Lumi · spotlight tour steps.
//
// 3 short steps per the architecture (lumi-onboarding-architecture §6.1).
// Core actions only — short = high completion for ADHD. Each step
// targets a real UI element by `id`; the SpotlightTour component
// measures the element live and circles it.

export interface TourStep {
  id: string;
  /** Target the element registered under this id. */
  targetId: string;
  /** Short caption rendered in the card next to the cutout. */
  caption: string;
  /** Tab/route name the target lives on. */
  scope: 'home' | 'tabbar';
  /**
   * If true and the target isn't registered (e.g. no quests exist yet),
   * the tour skips this step gracefully instead of stalling.
   */
  optional?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'oracle',
    targetId: 'tour-oracle',
    scope: 'home',
    caption:
      "Dump your brain here. Type or speak it — I'll sort the mess into quests.",
  },
  {
    id: 'first-quest',
    targetId: 'tour-quest',
    scope: 'home',
    caption:
      'Tap a quest to clear it. Each thing you finish earns XP and keeps your world alive.',
    optional: true,
  },
  {
    id: 'me-tab',
    targetId: 'tour-nav-me',
    scope: 'tabbar',
    caption:
      'Your week lives here. Tap Me anytime for your recap, your world, and everything I’ve learned about you.',
  },
];
