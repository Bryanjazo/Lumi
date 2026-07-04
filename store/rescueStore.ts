// Lumi · rescue hand-off (emotional-model spec §3)
//
// Rescue Mode's third button — "Let me explain what's been going on"
// — routes the user into Untangle. This tiny session-only store
// carries the intent across the tab switch so Untangle can open with
// the right first words ("tell me what's been going on — I'll sort
// what can wait") instead of its normal greeting. Deliberately NOT
// persisted: a stale rescue intent after an app restart would be
// confusing.

import { create } from 'zustand';

interface RescueHandoffState {
  /** Untangle should open in "life happened, tell me everything"
   *  framing on its next focus. Cleared by the consumer. */
  pendingExplain: boolean;
  setPendingExplain: (v: boolean) => void;
}

export const useRescueStore = create<RescueHandoffState>()((set) => ({
  pendingExplain: false,
  setPendingExplain: (v) => set({ pendingExplain: v }),
}));
