// Luna's emotional state, derived from real app signals.
//
// Goal: the cat is never decorative. Whatever Luna is showing on
// screen reflects what's actually happening — the user's energy,
// what they just said, what time it is, whether they cleared the
// day. The sleeping cat at 2am isn't a hardcoded screensaver; she's
// asleep because the user's sleep anchor passed.
//
// Two exports:
//   useAmbientLunaMood()       hook — reactive, reads stores
//   inferMoodFromText(text)    pure — read tone of a single message
//
// Hard rule: no surface picks a mood literal anymore. Either it
// reads the ambient hook, or it derives the mood from a contextual
// signal (e.g. Untangle reads the last user turn through
// inferMoodFromText). The DAY CLEARED card is the one exception
// — its "happy" is bound to the just-completed achievement, which
// the hook will also detect, so they agree.

import { useMemo } from 'react';
import { useUserStore } from '../store/userStore';
import { useQuestStore } from '../store/questStore';
import { type LunaMood } from './luna-source';

// ─────────────────────────────────────────────────────────────────────
// Tone heuristics
//
// Cheap word-boundary regex match. We don't run an LLM for this —
// the chat avatar should update on every keystroke and we already
// pay for one Anthropic call per turn. Patterns lean on words ADHD
// users actually use (gathered from the benchmark + UNDERSTAND_SYSTEM
// edge cases) so this isn't generic sentiment analysis.
// ─────────────────────────────────────────────────────────────────────

const SAD_PATTERNS =
  /\b(tired|exhaust(ed|ing)?|wiped|fried|drained|sad|down|low|stress(ed|ing)?|overwhelm(ed|ing)?|drown(ing)?|burnt? ?out|hate|ugh+|suck(s|ed|ing)?|awful|terrible|hopeless|stuck|can'?t|cant|fed up|done with|crying?|cried|miserable|anxious|panic(ked|king)?|dread(ing)?|too much|so much)\b/i;

const HAPPY_PATTERNS =
  /\b(yay+|woo+|amazing|finally|crushed|nailed|love|thank(s| you)|grateful|happy|good|great|done|finished|cleared|complete|won|wins?|smashed|excited|stoked|proud)\b/i;

const SLEEPY_PATTERNS =
  /\b(sleepy|sleep|bed|tired|exhaust(ed|ing)?|knackered|wiped|crashed|gn(ight)?|good ?night)\b/i;

/**
 * Read the tone of a single string. Returns the mood the message
 * implies, or null if it's neutral. Used by Untangle's chat avatar
 * so Luna's expression matches the user's last turn.
 */
export const inferMoodFromText = (text: string): LunaMood | null => {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  // Order matters: sad before happy ("good but tired" → sad).
  // Sleepy is checked first because "tired" overlaps with sad
  // and we want late-night fatigue to feel restful, not gloomy.
  if (SLEEPY_PATTERNS.test(t) && t.length < 60) return 'sleep';
  if (SAD_PATTERNS.test(t)) return 'sad';
  if (HAPPY_PATTERNS.test(t)) return 'happy';
  return null;
};

// ─────────────────────────────────────────────────────────────────────
// Ambient mood — what Luna shows on surfaces that don't have a
// per-message tone signal (Home nook, Me room, Profile avatar,
// LunaHeader, Auth screens).
//
// Priority (first match wins):
//   1. Within sleep window (past sleep anchor, before wake)  → 'sleep'
//   2. All today's quests cleared                            → 'happy'
//   3. Long streak (≥5 days)                                 → 'happy'
//   4. Heavy overdue pile (≥5 items past their date)         → 'sad'
//   5. Default                                                → 'idle'
//
// These map naturally to the user's lived experience: late at night
// the cat is asleep, after a clean sweep she's happy, when too much
// has piled up she's commiserating.
// ─────────────────────────────────────────────────────────────────────

const localToday = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const minutesNow = (): number => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

const isInSleepWindow = (sleepMin: number, wakeMin: number): boolean => {
  const n = minutesNow();
  // Most users have sleep > wake (e.g. sleep 22:30, wake 07:00).
  // That window wraps midnight, so n must be >= sleep OR < wake.
  if (sleepMin > wakeMin) return n >= sleepMin || n < wakeMin;
  // Rare inverted schedule (e.g. nightshift sleeping 08:00 → 16:00):
  // sleep ≤ n < wake.
  return n >= sleepMin && n < wakeMin;
};

export const useAmbientLunaMood = (): LunaMood => {
  const anchors = useUserStore((s) => s.anchors);
  const streak = useUserStore((s) => s.streak);
  const quests = useQuestStore((s) => s.quests);

  return useMemo(() => {
    // 1. Sleep window — overrides everything else. Late at night
    //    showing a happy or sad cat would feel jarring; a sleeping
    //    one is honest and quiet.
    if (isInSleepWindow(anchors.sleep, anchors.wake)) return 'sleep';

    const today = localToday();
    const todays = quests.filter((q) => q.date === today);
    const hasWork = todays.length > 0;
    const allDone = hasWork && todays.every((q) => q.completed);
    const completedToday = todays.filter((q) => q.completed).length;

    // 2. Clean sweep today — the achievement moment.
    if (allDone) return 'happy';

    // 3. Strong momentum today — 3+ completions shows the user is
    //    actively grinding. This wins over historical overdue piles
    //    so a productive day with yesterday's backlog still reads
    //    as 'happy', not 'sad'. The cat should reward today's
    //    effort, not punish yesterday.
    if (completedToday >= 3) return 'happy';

    // 4. Long streak — Luna's been with them for a while.
    if (streak >= 5) return 'happy';

    // 5. Overwhelm — several overdue items AND no real momentum today.
    //    Threshold is 3 (was 5) — 5 was too patient; by then the user
    //    has already felt the weight. The "no momentum" guard still
    //    prevents the sad face for a user who's clearly chipping
    //    away — even 1 completion bumps them out of sad.
    const overdue = quests.filter(
      (q) => !q.completed && q.date && q.date < today,
    ).length;
    if (overdue >= 3 && completedToday === 0) return 'sad';

    // 6. Default ambient state.
    return 'idle';
    // `quests` is referentially stable while no quest changes; the
    // useMemo dep keeps this O(n) scan from running every render.
  }, [anchors.sleep, anchors.wake, streak, quests]);
};
