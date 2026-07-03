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

// Captions match the CURRENT Home (post lumi-home-capture-4 rework):
// the floating capture pill, the one-thing hero card, and the Me tab's
// hearthside room. If a section moves again, move these with it.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'oracle',
    targetId: 'tour-oracle',
    scope: 'home',
    caption:
      "Dump a thought here — type it or speak it. I'll sort the mess into your day.",
  },
  {
    id: 'first-quest',
    targetId: 'tour-quest',
    scope: 'home',
    caption:
      "One thing at a time. This card is my pick for right now — mark it done, or start a focus timer on it. The rest? I'm holding it for you.",
    optional: true,
  },
  {
    id: 'me-tab',
    targetId: 'tour-nav-me',
    scope: 'tabbar',
    caption:
      "Luna's room lives here — plus your road, your week's story, and everything I've learned about you.",
  },
];
