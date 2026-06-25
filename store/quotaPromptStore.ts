// Lumi · quota-prompt store
//
// Tiny event channel between `lib/anthropic.ts` and the global
// UpgradePromptSheet. When the proxy returns 429 for a free user,
// the LLM call's catch block routes the AiKind through this store;
// the sheet listens and pops up with a calm, feature-specific
// "you've used your free X this week — try 7 days of Pro?" prompt.
//
// The 429 still triggers the deterministic fallback in the LLM
// caller — this is purely the upgrade-conversation surface, never
// a blocker.

import { create } from 'zustand';

/**
 * Which AI bucket the user just bumped into. Matches the AiKind
 * enum on the proxy but kept as its own type so we don't import
 * `lib/anthropic.ts` from the store (avoids a cycle).
 */
export type QuotaKind =
  | 'brain_dump'
  | 'untangle'
  | 'followup'
  | 'title_clean'
  | 'weekly_report';

interface QuotaPromptState {
  /** True when the upgrade sheet is currently visible. */
  open: boolean;
  /** Which feature triggered the prompt (drives the wording). */
  kind: QuotaKind | null;
  /**
   * True if the failure was the premium daily ceiling (very heavy
   * use on a paid account) rather than the free weekly cap. We
   * show a "let's keep it quick for now" line in that case — never
   * a Premium CTA, since they're already Premium.
   */
  premiumDailyHit: boolean;
  /** Show the sheet for a given kind. Idempotent. */
  openPrompt: (kind: QuotaKind, premiumDailyHit?: boolean) => void;
  close: () => void;
}

export const useQuotaPromptStore = create<QuotaPromptState>((set) => ({
  open: false,
  kind: null,
  premiumDailyHit: false,
  openPrompt: (kind, premiumDailyHit = false) =>
    set({ open: true, kind, premiumDailyHit }),
  close: () => set({ open: false, kind: null, premiumDailyHit: false }),
}));
