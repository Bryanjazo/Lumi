// Lumi · learning reveals — "I learned something new about you."
//
// Retention-loop spec §1a/§1c: the digest computes patterns silently;
// this module watches for POSITIVE capability crossings and turns each
// into ONE warm reveal, exactly once, at most one per ~day. Avoidance /
// decline patterns deliberately never fire here — a reveal is always
// "look what I know about your strengths", never a tally of misses
// (soul rule: never guilt; §6 no slot-machine drip).
//
// Keys are stable so revealsStore can persist seen/learnedAt:
//   'curve:learned'      — the energy curve graduated (≥15 completions
//                          across ≥5 distinct days — the new activity
//                          signal now that check-ins are gone)
//   'window:<key>'       — a clearly-stronger follow-through window
//   'dow:<n>'            — a best day-of-week emerged
//   'arc:graduated'      — the relationship arc reached "I know you"
//
// stampAll() also mints §1b provenance keys ('win:*', 'recur:*',
// 'avoid:*') so the Patterns tab can date every insight — those are
// DATE-ONLY: they never surface as Home reveals.

import type { WindowKey } from '../../constants/windows';
import type { LearningDigest } from './index';
import { useLearningDigest } from './index';
import { useRevealsStore } from '../../store/revealsStore';
import { normalizeForSuppression } from './recurrence';

const DAY_NAMES = [
  'sundays',
  'mondays',
  'tuesdays',
  'wednesdays',
  'thursdays',
  'fridays',
  'saturdays',
];

const WINDOW_LABEL: Record<WindowKey, string> = {
  morning: 'mornings',
  midday: 'middays',
  afternoon: 'afternoons',
  evening: 'evenings',
  someday: 'somedays', // unreachable — strong window is never someday
};

export interface LearningReveal {
  key: string;
  /** Eyebrow over the card — where this came from. */
  origin: string;
  /** The warm reveal line, Lumi's voice (dusk = her intelligence). */
  copy: string;
  /** Plain-register variant for the Focused companion mode (calm
   *  organizer — cozy first-person stripped, insight kept). */
  copyFocused: string;
}

/** Minimum gap between two reveal cards — "one at a time, never a
 *  wall". 20h (not 24) so a daily-morning user still gets at most one
 *  per morning without drift locking them out. */
const REVEAL_GAP_MS = 20 * 3_600_000;

/** The arc tier (§1c) — driven by REAL active days (curve.sampleDays,
 *  the distinct days you actually finished something), never
 *  time-since-install, so a lapsed user is never falsely told Lumi
 *  knows their rhythm. */
export const arcTier = (digest: LearningDigest): 0 | 1 | 2 => {
  if (digest.curve.source === 'learned') return 2;
  if (digest.curve.source === 'learning') return 1;
  return 0;
};

/** First-person arc copy for the Patterns header (§1c). */
export const arcLine = (tier: 0 | 1 | 2, sparse: boolean): string => {
  if (tier === 2) return "i've got a good sense of your rhythm now.";
  if (tier === 1) return "i'm starting to see your shape.";
  return sparse
    ? "i'm still getting to know you — a few days of showing up and this page starts drawing your picture."
    : "i'm still getting to know you — every day teaches me a little more.";
};

/** All POSITIVE pattern keys currently crossed, priority-ordered.
 *  (Reveal candidates only — see stampAll for the date-only keys.) */
export const crossedKeys = (
  digest: LearningDigest,
): LearningReveal[] => {
  const out: LearningReveal[] = [];

  // 1 · the energy curve graduated — the single biggest "I know you".
  // (No separate 'arc:graduated' reveal — it read as an echo of this
  // one a day later; the arc milestone lives on the Patterns header.)
  if (digest.curve.source === 'learned') {
    out.push({
      key: 'curve:learned',
      origin: 'Lumi learned something',
      copy: "i think i've got your rhythm now — i can tell when you run strongest. want to see it?",
      copyFocused:
        'Your energy pattern is mapped — drawn from when you actually finish things. See it on Patterns.',
    });
  }

  // 2 · a clearly-stronger window emerged (strongWindowInsight already
  // gates on a real gap, ≥20 points).
  if (digest.pattern) {
    const w = WINDOW_LABEL[digest.pattern.strong];
    out.push({
      key: `window:${digest.pattern.strong}`,
      origin: 'Lumi learned something',
      copy: `noticed something — your ${w} carry the hard stuff best. want me to lean on that?`,
      copyFocused: `Pattern found: your ${w} have the strongest follow-through.`,
    });
  }

  // 3 · a best day-of-week emerged (same ≥5-day guard Patterns uses).
  if (digest.curve.sampleDays >= 5 && digest.peakDow != null) {
    out.push({
      key: `dow:${digest.peakDow}`,
      origin: 'Lumi learned something',
      copy: `small thing i picked up — ${DAY_NAMES[digest.peakDow]} tend to be your day.`,
      copyFocused: `Pattern found: ${DAY_NAMES[digest.peakDow]} tend to be your strongest day.`,
    });
  }

  return out;
};

/**
 * At most ONE unseen, threshold-crossed reveal — or null. Rate-limited
 * so two can never land the same day. Pure read; callers mark seen via
 * useRevealsStore.markSeen(key).
 */
export const useLearningReveal = (): LearningReveal | null => {
  const digest = useLearningDigest();
  const seen = useRevealsStore((s) => s.seen);
  const lastShownAt = useRevealsStore((s) => s.lastShownAt);

  if (lastShownAt != null && Date.now() - lastShownAt < REVEAL_GAP_MS) {
    return null;
  }
  const seenSet = new Set(seen);
  const next = crossedKeys(digest).find((c) => !seenSet.has(c.key));
  return next ?? null;
};

/**
 * Side-effect: stamp `learnedAt` for every currently-crossed pattern —
 * including the date-only §1b keys (win / recurrence / avoidance) — so
 * the Patterns tab can date insights the moment they first exist, even
 * if their reveal never shows. Call from a useEffect, never in render.
 */
export const stampAll = (digest: LearningDigest): void => {
  const stamp = useRevealsStore.getState().stampLearned;
  for (const c of crossedKeys(digest)) stamp(c.key);
  if (digest.win) {
    stamp(`win:${normalizeForSuppression(digest.win.quest.title)}`);
  }
  for (const r of digest.recurrence) {
    stamp(`recur:${normalizeForSuppression(r.title)}`);
  }
  if (digest.avoidance) {
    stamp(`avoid:${digest.avoidance.tag}`);
  }
};

/** "learned this week" / "learned Jun 3" provenance tag for a key, or
 *  null when the pattern hasn't been stamped yet. Neutral wording only
 *  — never elapsed-time-since ("no insight in N days" is forbidden). */
export const learnedTag = (
  learnedAt: Record<string, string>,
  key: string,
): string | null => {
  const iso = learnedAt[key];
  if (!iso) return null;
  const then = new Date(iso + 'T12:00');
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 7) return 'learned this week';
  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `learned ${MONTHS[then.getMonth()]} ${then.getDate()}`;
};
