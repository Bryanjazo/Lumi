// Lumi · THE one completion fan-out.
//
// Marking a quest done from Home, Time, or Untangle must do the exact
// same economy work: flip it to done, pay XP + a shard EXACTLY ONCE
// per quest ever (the anti-farm guard), register activity for the
// streak/vitality, and end a focus session tied to it so the Dynamic
// Island pill clears. This lived copy-pasted in three places
// (index.tsx completeQuest, time.tsx markDone, checkin.tsx applyProposal
// 'complete') and had already drifted — the recurring-XP bug reproduced
// identically in all three. One choke point keeps the invariant honest.
//
// The store's toggle() is the choke point for the doneLog / tasksEver
// ledgers, so completing through here keeps those correct too.
//
// Callers keep their OWN surrounding concerns (undo snapshots, cheer
// chrome, floaters, haptics, dedup) — this owns only the shared
// data/economy fan-out.

import { useQuestStore } from '../store/questStore';
import { useUserStore } from '../store/userStore';
import { useFocusSession } from './focusSession';

export interface CompletionResult {
  /** XP/shards were awarded — i.e. this was the quest's first-ever
   *  completion (undo→re-complete never re-awards). */
  firstAward: boolean;
  /** XP granted on this call (0 when not a first award). */
  gain: number;
}

/**
 * Complete a quest and run the shared economy fan-out. Returns null
 * when it's a no-op — the quest is missing, already completed, or the
 * toggle didn't land in the done direction (a stale double-tap). On a
 * real completion returns whether XP/shards were paid and how much.
 *
 * Reads the store fresh (never a stale render-closure quest) so a
 * double-tap can't pay twice / un-complete a finished quest.
 */
export const completeQuestCore = (questId: string): CompletionResult | null => {
  const fresh = useQuestStore.getState().quests.find((x) => x.id === questId);
  if (!fresh || fresh.completed) return null;
  const next = useQuestStore.getState().toggle(questId);
  if (!next || !next.completed) return null;

  // Economy guard — XP/shards pay exactly ONCE per quest, ever.
  const firstAward = !fresh.xpPaid;
  const gain = fresh.xpReward;
  if (firstAward) {
    const u = useUserStore.getState();
    u.addXp(gain);
    u.addShard();
    useQuestStore.getState().markXpPaid(questId);
  }
  useUserStore.getState().registerActivity();

  // A focus session running on this quest ends now (reason 'cancelled'
  // — the celebration comes from the caller's completion path, not the
  // focus card's done screen), or the Island pill lingers.
  const fs = useFocusSession.getState();
  if (fs.current?.questId === questId) {
    void fs.end({ reason: 'cancelled' });
  }

  return { firstAward, gain: firstAward ? gain : 0 };
};
