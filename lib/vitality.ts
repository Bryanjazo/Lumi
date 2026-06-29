// Lumi · vitality — pure derivation.
//
// Luna's whole world is driven by ONE 0–100 number that's a weighted
// blend of the user's overall self-care. No single signal dominates,
// so a low day in one area doesn't kill the bloom — keeps it gentle.
//
// Weights (sum = 100):
//   38 · quests cleared today / goal
//   28 · streak / 7
//   18 · used Untangle today
//   16 · captured something today
//
// Why these four (Untangle-era rebalance, replaces the dead
// `checkedIn` + `avgEnergy` from the manual-checkin era):
//   - Quests = action taken (the biggest signal).
//   - Streak = consistency over time.
//   - Untangle = self-care in the form of organizing what's already
//     in your head — the new check-in equivalent (Untangle replaced
//     the old daily check-in).
//   - Capture = getting things out of your head into the system
//     (preventive self-care).
//
// Energy is now inferred PASSIVELY (lib/learning/energy.ts) from
// completion timing rather than logged manually — so it stops being
// a discrete vitality lever the way it was when the user used to
// rate it on a slider.
//
// Read alongside the strategy guardrails: a bad week is neurological
// load, not failure. The world dims, never scolds.

export interface VitalitySignals {
  questsToday: number;
  questGoal: number;
  streak: number;
  untangledToday: boolean;
  capturedToday: boolean;
}

export interface VitalityStage {
  key: 'dormant' | 'waking' | 'growing' | 'flourishing';
  label: string;
  note: string;
  glow: string;
}

const STAGES: VitalityStage[] = [
  {
    key: 'flourishing',
    label: 'Flourishing',
    note: "Your world is in full bloom. You've been taking care of you.",
    glow: '#F4C98A',
  },
  {
    key: 'growing',
    label: 'Growing',
    note: "Things are coming to life. You're showing up for yourself.",
    glow: '#E0A488',
  },
  {
    key: 'waking',
    label: 'Waking up',
    note: 'Stirring back to life. A little care goes a long way.',
    glow: '#8EA0B4',
  },
  {
    key: 'dormant',
    label: 'Resting',
    note: 'Quiet and dim right now. No guilt — tend to you, and it follows.',
    glow: '#6E655A',
  },
];

export const stageOf = (vitality: number): VitalityStage => {
  if (vitality >= 75) return STAGES[0];
  if (vitality >= 50) return STAGES[1];
  if (vitality >= 25) return STAGES[2];
  return STAGES[3];
};

export const computeVitality = (signals: VitalitySignals): number => {
  const vQuests =
    Math.min(1, signals.questsToday / Math.max(1, signals.questGoal)) * 38;
  const vStreak = Math.min(1, signals.streak / 7) * 28;
  const vUntangle = signals.untangledToday ? 18 : 0;
  const vCapture = signals.capturedToday ? 16 : 0;
  return Math.round(vQuests + vStreak + vUntangle + vCapture);
};

export interface VitalityPart {
  label: string;
  val: string;
  on: boolean;
  color: string;
}

/**
 * Per-signal contribution chips shown on the Me tab — "What Luna's
 * world runs on." Same four inputs as computeVitality(), labeled.
 */
export const vitalityParts = (signals: VitalitySignals): VitalityPart[] => [
  {
    label: 'Quests',
    val: `${signals.questsToday}/${signals.questGoal}`,
    on: signals.questsToday > 0,
    color: '#E07A4F',
  },
  {
    label: 'Streak',
    val: `${signals.streak}d`,
    on: signals.streak > 0,
    color: '#C9A06A',
  },
  {
    label: 'Untangle',
    val: signals.untangledToday ? '✓' : '—',
    on: signals.untangledToday,
    color: '#869072',
  },
  {
    label: 'Capture',
    val: signals.capturedToday ? '✓' : '—',
    on: signals.capturedToday,
    color: '#9A85A8',
  },
];
