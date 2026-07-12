// Lumi · notification tap intent (session-only)
//
// A tapped notification must DO the thing it promised — "bring a
// task into today", "shrink today to one small win" — not just open
// the app. The _layout response listener writes the intent here and
// routes to the right screen; the screen consumes it on focus and
// performs the action. Deliberately NOT persisted: a stale intent
// firing days later would be spooky.

import { create } from 'zustand';

export type NotifAction =
  | 'hero' // morning — spotlight the top pick
  | 'meds' // meds line — gentle echo
  | 'smallest' // midday — swap hero to the smallest open thing
  | 'tomorrow' // wind-down — set up tomorrow's first thread
  | 'rescue' // recovery — open Rescue Mode (shrink/lighten)
  | 'quest' // recurring reminder — surface THAT quest
  | 'recap' // Sunday — open the weekly recap
  | 'focusdone'; // focus block ended — settle the session, show done

export interface NotifIntent {
  action: NotifAction;
  questId?: string;
  questTitle?: string;
}

interface NotifIntentState {
  intent: NotifIntent | null;
  setIntent: (i: NotifIntent | null) => void;
  /** Read-and-clear — consumers call this exactly once per intent. */
  consume: () => NotifIntent | null;
}

export const useNotifIntentStore = create<NotifIntentState>()((set, get) => ({
  intent: null,
  setIntent: (i) => set({ intent: i }),
  consume: () => {
    const i = get().intent;
    if (i) set({ intent: null });
    return i;
  },
}));
