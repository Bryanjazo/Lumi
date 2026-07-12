// Lumi · Untangle → Home "focus this" handoff (session-only)
//
// When a conversation in Untangle switches the user onto a specific
// task — surfaces an easier one, recommends a first move, mints a new
// "start here" — Home's main card should show THAT task, mirroring
// what Untangle just did. Untangle writes the pick on apply; Home
// consumes it on focus and promotes the task to the hero card.
//
// Deliberately NOT persisted: a stale pick surfacing days later (the
// user long since moved on) would be spooky — same reasoning as the
// notification intent store.

import { create } from 'zustand';

// The handoff is a "just switched" gesture — if Home isn't visited
// within a few minutes the intent is stale (the user wandered off and
// the moment passed), so consume() drops it rather than surface an old
// task hours later.
const PICK_TTL_MS = 10 * 60 * 1000;

interface HomeFocusState {
  /** Quest id Untangle wants Home to start on, or null. */
  pick: string | null;
  /** Epoch ms the pick was set — powers the staleness guard. */
  pickAt: number | null;
  setPick: (id: string | null) => void;
  /** Read-and-clear — Home calls this exactly once per pick. Returns
   *  null if the pick has gone stale (older than PICK_TTL_MS). */
  consume: () => string | null;
}

export const useHomeFocusStore = create<HomeFocusState>()((set, get) => ({
  pick: null,
  pickAt: null,
  setPick: (id) => set({ pick: id, pickAt: id ? Date.now() : null }),
  consume: () => {
    const { pick, pickAt } = get();
    if (!pick) return null;
    set({ pick: null, pickAt: null });
    if (pickAt != null && Date.now() - pickAt > PICK_TTL_MS) return null;
    return pick;
  },
}));
