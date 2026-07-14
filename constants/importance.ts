import { colors } from './colors';

export type Importance = 'high' | 'medium' | 'low';

export interface TierMeta {
  color: string;
  label: string;
  /** Legacy single icon (kept so existing screens don't break). */
  icon: string;
  /** New: stacked diamonds, used on the redesigned Home tab. */
  sigil: string;
  /** Drop-rate scalar — bigger = more loot per completion. */
  rank: number;
}

export const IMPORTANCE: Record<Importance, TierMeta> = {
  high: {
    color: '#E07A4F',
    label: 'Big',
    icon: '▲',
    sigil: '◆◆◆',
    rank: 3,
  },
  medium: {
    color: '#C9A06A',
    label: 'Regular',
    icon: '■',
    sigil: '◆◆',
    rank: 2,
  },
  low: {
    color: '#869072',
    label: 'Tiny',
    icon: '●',
    sigil: '◆',
    rank: 1,
  },
};

/** Back-compat alias — many older screens import IMPORTANCE.label as TIER. */
export const TIER = IMPORTANCE;

export const importanceFromDifficulty = (
  d: 'easy' | 'medium' | 'hard',
): Importance => (d === 'hard' ? 'high' : d === 'medium' ? 'medium' : 'low');

export const difficultyFromImportance = (
  i: Importance,
): 'easy' | 'medium' | 'hard' =>
  i === 'high' ? 'hard' : i === 'medium' ? 'medium' : 'easy';

// (Removed the unused XP_BY_IMPORTANCE table — it diverged from the
// live scale, lib/gamification.ts xpForQuest (easy 30 / medium 80 /
// hard 160), and was a latent trap for anyone who read the wrong one.
// XP is derived from difficulty via xpForQuest; there is one scale.)
