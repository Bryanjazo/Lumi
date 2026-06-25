// Companion Mode selectors.
//
// The single `companionMode` field on `userStore` ('full' | 'minimal'
// | 'focused') gates a lot of UI decisions. Rather than scatter
// `mode === 'focused'` literals across every surface, we expose
// derived booleans here so callers read intent:
//
//   const { showLuna, showXp, showRoom, showStreak, isFocused } =
//     useCompanionMode();
//
// CRITICAL: this gates rendering ONLY. XP, shards, streak, vitality
// and the learning layer keep computing in every mode (companion-
// mode-spec §2). Switching modes is non-destructive and instant.

import { useUserStore, type CompanionMode } from '../store/userStore';

export interface CompanionFlags {
  /** Raw mode for the few places that genuinely need it (e.g. the
   *  Me tab's three-way layout swap). */
  mode: CompanionMode;
  /** True only on 'full'. */
  isFull: boolean;
  /** True only on 'minimal'. */
  isMinimal: boolean;
  /** True only on 'focused'. */
  isFocused: boolean;
  /** Render the Luna cat sprite anywhere? Hidden in 'focused' only —
   *  in 'minimal' she stays as a quiet brand presence. */
  showLuna: boolean;
  /** Show the full Me-tab room ('full' only). 'minimal' uses a calm
   *  version (small Luna, soft vitality) and 'focused' replaces the
   *  tab with the "You & Lumi" stats screen. */
  showRoom: boolean;
  /** Show XP numbers, level, "+N xp" floaters, unlocks/shop, the
   *  level progress bar. Hidden in 'minimal' AND 'focused'. */
  showXp: boolean;
  /** Show the streak chip + flame counter. Kept in 'minimal' (gentle
   *  habit nudge); off by default in 'focused' but the user could
   *  enable separately. For now we tie it to the mode. */
  showStreak: boolean;
  /** Show celebratory completion bursts (XP floater, Luna cheer
   *  ring). Suppressed in 'minimal' / 'focused' — completion stays
   *  a quiet check. */
  showCheer: boolean;
}

export const useCompanionMode = (): CompanionFlags => {
  const mode = useUserStore((s) => s.companionMode);
  const isFull = mode === 'full';
  const isMinimal = mode === 'minimal';
  const isFocused = mode === 'focused';
  return {
    mode,
    isFull,
    isMinimal,
    isFocused,
    showLuna: !isFocused,
    showRoom: isFull,
    showXp: isFull,
    showStreak: !isFocused,
    showCheer: isFull,
  };
};

/**
 * Phrase-helper for the Recap / Insights surfaces — they should
 * speak the user's mode's language. In Focused we strip game words
 * ("XP" → "things done", "quest" → "task", etc.) so the surface
 * reads as a calm AI organizer, not a Tamagotchi report.
 */
export const phrasingFor = (mode: CompanionMode) => ({
  unit: mode === 'focused' ? 'things done' : 'XP',
  task: mode === 'focused' ? 'task' : 'quest',
  tasks: mode === 'focused' ? 'tasks' : 'quests',
});
