/**
 * Cloud sync for Lumi.
 *
 * Strategy (v1):
 *   - On sign-in: pull everything from Supabase into the local Zustand
 *     stores (cloud wins for profile fields; quests/checkins merge by id).
 *   - On every local change: debounce-push the relevant row(s) up.
 *   - Disabled when offlineMode is true or Supabase isn't configured.
 *
 * No conflict resolution beyond "last write wins" — we don't ship to
 * multi-device users yet.
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import { useUserStore } from '../store/userStore';
import { useQuestStore, UUID_V4_RE, type Quest } from '../store/questStore';
import { importanceFromDifficulty } from '../constants/importance';
import {
  deriveWindowFor,
  getEffectiveWindows,
  type WindowKey,
} from '../constants/windows';
import {
  useCheckinStore,
  pruneOldCheckins,
  type Checkin,
} from '../store/checkinStore';
import { readState, energyValue } from '../constants/moodMap';
import { getDeviceId } from './deviceId';
import { usePetStore } from '../store/petStore';

const DEBOUNCE_MS = 1500;

const debounce = <T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): T => {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
};

// ── push: user profile ──────────────────────────────────────────────────
const pushUser = async (userId: string, forceLedgers = false) => {
  const s = useUserStore.getState();
  const pulled = useSyncStatus.getState().pulledFor[userId];
  // PULL FIRST, PUSH SECOND. Between sign-in and the first completed
  // pull, the local store may be post-sign-out-wipe DEFAULTS — and this
  // upsert is a plain overwrite. One store write in that window (e.g.
  // Google sign-in setting the display name) used to clobber the cloud
  // profile with onboarded:false / xp:0 / adhd_type:null, making a
  // returning user look brand new on every device thereafter.
  if (!pulled && !forceLedgers) return;
  // The forced sign-out flush may legitimately run before a clean pull
  // (login pull failed all session). Local is the best record of THIS
  // session, but it never merged the cloud — read first so the flush
  // can only ever KEEP what the cloud already knew.
  let onboarded = s.onboarded;
  let adhdType = s.adhdType;
  let name = s.name;
  let streak = s.streak;
  let lastActiveDate = s.lastActiveDate;
  let petName = s.petName;
  let shieldAvailable = s.shieldAvailable;
  let shieldUsedThisWeek = s.shieldUsedThisWeek;
  let offlineMode = s.offlineMode;
  let avatar = s.avatar;
  let roomTint = s.roomTint;
  if (!pulled) {
    const { data: cur, error: readErr } = await supabase
      .from('users')
      .select(
        'onboarded, adhd_type, name, xp, streak, last_active_date, pet_name, shield_available, shield_used_this_week, offline_mode, avatar, room_tint',
      )
      .eq('id', userId)
      .maybeSingle();
    if (readErr) {
      // Can't see the cloud → don't risk overwriting it.
      console.warn('[sync] profile read (skip push)', readErr.message);
      return;
    }
    if (cur) {
      onboarded = onboarded || cur.onboarded === true;
      adhdType = adhdType ?? (cur.adhd_type as typeof adhdType) ?? null;
      name = name || ((cur.name as string | null) ?? '');
      const cloudDate = (cur.last_active_date as string | null) ?? '';
      if (cloudDate > (lastActiveDate ?? '')) {
        // Cloud reflects more recent activity — keep its streak pair.
        streak = (cur.streak as number | null) ?? 0;
        lastActiveDate = cloudDate;
      }
      // A session that never merged the cloud can't be trusted on the
      // shield either — a blind default-true push let a spent shield
      // regenerate. Used-if-either-says-used; available only if both
      // agree. Same conservatism for pet_name/offline_mode: prefer the
      // cloud (this session's local values are unmerged defaults).
      shieldUsedThisWeek =
        shieldUsedThisWeek || cur.shield_used_this_week === true;
      shieldAvailable =
        shieldAvailable && (cur.shield_available as boolean | null) !== false;
      const cloudPet = cur.pet_name as string | null;
      if (cloudPet) petName = cloudPet === 'Luna' ? 'Lumi' : cloudPet;
      offlineMode = (cur.offline_mode as boolean | null) ?? offlineMode;
      if (cur.avatar) avatar = cur.avatar as string;
      if (cur.room_tint) roomTint = cur.room_tint as typeof roomTint;
    }
  }
  // Subscription columns are owned by the server / IAP webhook — we read
  // them but don't push, to avoid the client accidentally extending its
  // own trial. Same for created_at.
  const { error } = await supabase.from('users').upsert(
    {
      id: userId,
      // Never overwrite a real cloud name with '' — the signup trigger
      // writes the name from auth metadata, and an empty local (post-
      // wipe, or Apple's nameless token) must not erase it. Omitting
      // the key leaves the column untouched on conflict-update.
      ...(name ? { name } : {}),
      pet_name: petName,
      adhd_type: adhdType,
      level: 1,
      // xp is NO LONGER written here — it moved into the per-device
      // ledger slice (below). users.xp freezes as the pre-cutover base
      // and the pull sums base + Σ slices for an exact cross-device
      // total. Writing the derived display xp back would double-count
      // it against this device's own slice on the next pull.
      streak,
      last_active_date: lastActiveDate,
      shield_available: shieldAvailable,
      shield_used_this_week: shieldUsedThisWeek,
      onboarded,
      offline_mode: offlineMode,
      // The picked cat skin + room color — device-local until
      // migration 20260719000000; without these a reinstall/2nd
      // device reverted everyone to the default cat.
      avatar,
      room_tint: roomTint,
    },
    { onConflict: 'id' },
  );
  if (error) console.warn('[sync] pushUser', error.message);

  // Lifetime ledgers: PER-DEVICE DELTA SLICE (migration 20260720000000).
  // The old aggregate max-merge silently under-counted when two devices
  // completed DIFFERENT tasks the same day (max(3,2)=3, truth 5). This
  // device now writes ONLY its own slice via an atomic own-key jsonb
  // merge — concurrent devices can't clobber each other, and the pull
  // sums legacy columns + all slices for an exact total. The legacy
  // done_log/tasks_ever/focus_min columns are no longer written by
  // updated clients (they freeze as the pre-cutover base; old builds
  // still max-merge into them, which stays correct).
  try {
    let slice = s.deviceLedger;
    const sliceEmpty =
      slice.tasksEver === 0 &&
      slice.focusMin === 0 &&
      slice.xp === 0 &&
      Object.keys(slice.doneLog).length === 0;
    if (!pulled) {
      // Before the pull adopts my cloud slice, local is only the
      // delta since the last wipe. A plain push would overwrite the
      // cumulative cloud slice with a near-empty one.
      if (!forceLedgers || sliceEmpty) return;
      // Forced sign-out flush after a failed pull. Fold the cloud
      // copy of MY slice in ONLY when local counted from zero since
      // a wipe (deviceLedgerSynced=false) — then sum = the true
      // cumulative. When a PRIOR session already adopted the cloud
      // slice (synced=true, e.g. force-quit then a failed-pull
      // session), local IS the cumulative superset and folding the
      // cloud copy in again double-counted lifetime totals for good.
      // Read fails → skip rather than risk loss.
      if (!s.deviceLedgerSynced) {
        const deviceIdF = await getDeviceId();
        const { data: cur, error: readErr } = await supabase
          .from('users')
          .select('ledgers')
          .eq('id', userId)
          .maybeSingle();
        if (readErr) {
          console.warn('[sync] ledger read (skip force)', readErr.message);
          return;
        }
        const mine = (cur?.ledgers as Record<string, LedgerSlice> | null)?.[
          deviceIdF
        ];
        if (mine) slice = addSlices(normalizeSlice(mine), slice);
      }
    }
    if (
      slice.tasksEver === 0 &&
      slice.focusMin === 0 &&
      slice.xp === 0 &&
      Object.keys(slice.doneLog).length === 0
    ) {
      return; // nothing to say — don't write an empty slice
    }
    const deviceId = await getDeviceId();
    const { error: ledgerErr } = await supabase.rpc('merge_device_ledger', {
      p_device: deviceId,
      p_slice: slice,
    });
    if (ledgerErr) console.warn('[sync] ledger slice', ledgerErr.message);
  } catch (e) {
    console.warn('[sync] ledger slice', e instanceof Error ? e.message : e);
  }
};

interface LedgerSlice {
  doneLog?: Record<string, number>;
  tasksEver?: number;
  focusMin?: number;
  // XP joined the slice (was a lossy max-merge on users.xp). Optional
  // on the wire so a pre-cutover slice with no xp key reads as 0.
  xp?: number;
}

const normalizeSlice = (
  raw: LedgerSlice | null | undefined,
): {
  doneLog: Record<string, number>;
  tasksEver: number;
  focusMin: number;
  xp: number;
} => {
  const doneLog: Record<string, number> = {};
  for (const [d, n] of Object.entries(raw?.doneLog ?? {})) {
    const v = Number(n);
    if (Number.isFinite(v) && v !== 0) doneLog[d] = v;
  }
  return {
    doneLog,
    tasksEver: Number(raw?.tasksEver) || 0,
    focusMin: Number(raw?.focusMin) || 0,
    xp: Number(raw?.xp) || 0,
  };
};

const addSlices = (
  a: ReturnType<typeof normalizeSlice>,
  b: ReturnType<typeof normalizeSlice>,
): ReturnType<typeof normalizeSlice> => {
  const doneLog: Record<string, number> = { ...a.doneLog };
  for (const [d, n] of Object.entries(b.doneLog)) {
    const v = (doneLog[d] ?? 0) + n;
    if (v === 0) delete doneLog[d];
    else doneLog[d] = v;
  }
  return {
    doneLog,
    tasksEver: a.tasksEver + b.tasksEver,
    focusMin: a.focusMin + b.focusMin,
    xp: a.xp + b.xp,
  };
};

// ── push: quests ────────────────────────────────────────────────────────
const pushQuests = async (userId: string) => {
  const store = useQuestStore.getState();
  // Flush deletion tombstones FIRST — even when the local list is
  // empty (deleting the last task must still reach the cloud, or it
  // resurrects on reinstall).
  const tombstones = store.deletedIds.filter((id) => UUID_V4_RE.test(id));
  if (tombstones.length > 0) {
    const { error: delErr } = await supabase
      .from('quests')
      .delete()
      .in('id', tombstones)
      .eq('user_id', userId);
    if (!delErr) {
      useQuestStore.getState().clearDeletedIds(tombstones);
    } else {
      console.warn('[sync] deleteQuests', delErr.message);
    }
  }
  const quests = store.quests;
  if (quests.length === 0) return;
  // Snapshot time — captured BEFORE the network write. On success it
  // becomes lastPushedAt, so every completion with completedAt <= this
  // is now known to be on the cloud. The pull merge reads it to tell an
  // un-pushed local completion (keep — the cloud just hasn't caught up)
  // from a genuine cross-device un-complete that already synced (adopt).
  // A completion made DURING the await isn't in this snapshot and has a
  // later completedAt, so it correctly still counts as un-pushed.
  const pushedAt = new Date().toISOString();
  // Skip legacy non-UUID ids (the old `q_<ts>_<rand>` format from
  // pre-1019 builds). The cloud column is `uuid`; sending strings
  // that don't parse trips a 400 on every push. Those quests stay
  // local-only until the user re-creates them.
  const rows = quests
    .filter((q) => UUID_V4_RE.test(q.id))
    .map((q) => ({
      id: q.id,
      user_id: userId,
      title: q.title,
      difficulty: q.difficulty,
      xp_reward: q.xpReward,
      completed: q.completed,
      completed_at: q.completedAt,
      date: q.date,
      scheduled_hour: q.scheduledHour ?? null,
      scheduled_minute: q.scheduledMinute ?? null,
      duration_minutes: q.durationMinutes ?? null,
      accent: q.accent ?? null,
      // Formerly local-only — now round-tripped (migration
      // 20260713000000) so recurrence, notes, window placement and the
      // once-ever xp_paid stamp survive reinstall / reach a 2nd device.
      window: q.window,
      note: q.note ?? null,
      comment: q.comment ?? null,
      recur: q.recur ?? null,
      last_spawned_date: q.lastSpawnedDate ?? null,
      xp_paid: q.xpPaid ?? false,
      recur_stopped: q.recurStopped ?? false,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('quests').upsert(rows, {
    onConflict: 'id',
  });
  if (error) {
    // Swallowed (offline / transient) — the completion stays local and
    // lastPushedAt is NOT advanced, so the pull's un-pushed guard keeps
    // protecting it. The retry is the foreground/reconnect flush
    // (pushDirtyNow) plus the next debounced store write.
    console.warn('[sync] pushQuests', error.message);
  } else {
    useQuestStore.getState().markQuestsPushed(pushedAt);
  }
};

// ── push: checkins (insert-only) ────────────────────────────────────────
const pushCheckins = async (userId: string) => {
  const checkins = useCheckinStore.getState().checkins;
  if (checkins.length === 0) return;
  const rows = checkins.map((c) => ({
    id: c.id,
    user_id: userId,
    mood: c.mood,
    text_input: c.text,
    ai_response: JSON.stringify({
      state: c.state,
      explanation: c.explanation,
      action: c.action,
    }),
    emotional_state: c.state,
    // The real coordinates the user placed — without these a 2nd
    // device planted every cloud check-in at a fabricated neutral 50.
    mood_x: c.x,
    mood_y: c.y,
  }));
  const { error } = await supabase.from('checkins').upsert(rows, {
    onConflict: 'id',
  });
  if (error) console.warn('[sync] pushCheckins', error.message);
};

// ── push: pet state ─────────────────────────────────────────────────────
const pushPet = async (userId: string) => {
  // Own receipt, not the shared pulledFor: pet_state/equipped are
  // plain overwrites, so pushing before THIS session merged the cloud
  // pet (pet pull failed while core succeeded) would reset the
  // account's skin/traits/bond on every device. Skipping loses at
  // most one unmerged session's care taps — the smaller harm.
  if (!useSyncStatus.getState().petMergedFor[userId]) return;
  const p = usePetStore.getState();
  const { error: petErr } = await supabase.from('pet_state').upsert(
    {
      user_id: userId,
      skin_id: p.skinId,
      trait_presence: p.traits.presence,
      trait_groundedness: p.traits.groundedness,
      trait_momentum: p.traits.momentum,
      trait_curiosity: p.traits.curiosity,
      adventure: p.adventure,
      last_care: p.lastCare,
    },
    { onConflict: 'user_id' },
  );
  if (petErr) console.warn('[sync] pushPet', petErr.message);

  // Equipped items: upsert one row per category.
  const equippedRows = (Object.entries(p.equipped) as [string, string][]).map(
    ([category, item_id]) => ({ user_id: userId, category, item_id }),
  );
  if (equippedRows.length) {
    const { error: eqErr } = await supabase
      .from('equipped_items')
      .upsert(equippedRows, { onConflict: 'user_id,category' });
    if (eqErr) console.warn('[sync] pushEquipped', eqErr.message);
  }

  // Owned items + skins.
  const ownedRows = [
    ...p.ownedItems.map((id) => ({
      user_id: userId,
      kind: 'item' as const,
      ref_id: id,
    })),
    ...p.ownedSkins.map((id) => ({
      user_id: userId,
      kind: 'skin' as const,
      ref_id: id,
    })),
  ];
  if (ownedRows.length) {
    // owned_items has SELECT/INSERT/DELETE RLS policies but no
    // UPDATE — supabase's default upsert (ON CONFLICT DO UPDATE)
    // hits the missing UPDATE policy and fails. These rows are
    // append-only (you only ever unlock new things, never edit
    // an existing one), so ignoreDuplicates flips this to ON
    // CONFLICT DO NOTHING which avoids the UPDATE path entirely.
    const { error: ownedErr } = await supabase
      .from('owned_items')
      .upsert(ownedRows, {
        onConflict: 'user_id,kind,ref_id',
        ignoreDuplicates: true,
      });
    if (ownedErr) console.warn('[sync] pushOwned', ownedErr.message);
  }

};

// ── pull: full snapshot → local stores ──────────────────────────────────
/**
 * Reactive "has the first pull finished for this uid" flag. The
 * cross-account wipe in _layout WAITS on this: wiping before the pull
 * has spoken is how returning Google/Apple sign-ins kept losing their
 * check-ins (rhythm reset to zero) — the wipe fired on a missing
 * local receipt that the pull was about to mint from the server.
 * Fail-safe: a failed pull never sets the flag, so no wipe happens on
 * flaky networks (it re-arms next launch).
 */
export const useSyncStatus = create<{
  pulledFor: Record<string, true>;
  /** pet_state/equipped are whole-row overwrites with no protective
   *  merge — they get their OWN receipt. Core success alone opening
   *  the shared push gate let a failed pet pull followed by any pet
   *  write clobber the account's skin/traits/bond with defaults. */
  petMergedFor: Record<string, true>;
}>(() => ({ pulledFor: {}, petMergedFor: {} }));

/**
 * Returns true only when EVERY section pulled cleanly. Supabase
 * queries don't throw — a dead network right after login returns
 * `{data: null, error}` on all six, which used to read as a
 * "successful" pull: no quests landed, no onboarding receipt was
 * minted, and the pulled flag was set anyway. The user stared at
 * "Nothing on the day yet" until a manual reload re-ran the pull.
 */
export const pullAll = async (userId: string): Promise<boolean> => {
  const [u, q, c, eq, owned, pet] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase.from('quests').select('*').eq('user_id', userId),
    supabase.from('checkins').select('*').eq('user_id', userId),
    supabase.from('equipped_items').select('*').eq('user_id', userId),
    supabase.from('owned_items').select('*').eq('user_id', userId),
    supabase.from('pet_state').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  // Profile — cloud wins for fields that exist remotely, else keep local.
  const userRow = u.data;
  if (userRow) {
    const localState = useUserStore.getState();
    // ── Ledger totals: legacy columns (frozen base) + Σ device slices.
    // My slice: LOCAL wins (this device is its only writer) — except
    // right after a wipe, when local is empty and the cloud copy IS
    // my cumulative history (re-sign-in adoption).
    const deviceId = await getDeviceId();
    const cloudLedgers = (userRow.ledgers ?? {}) as Record<
      string,
      LedgerSlice
    >;
    let mySlice = normalizeSlice(localState.deviceLedger);
    const myLocalEmpty =
      mySlice.tasksEver === 0 &&
      mySlice.focusMin === 0 &&
      Object.keys(mySlice.doneLog).length === 0;
    const myCloud = cloudLedgers[deviceId];
    // Adopt/fold the cloud copy when local doesn't contain it yet:
    // empty local (re-sign-in) OR a post-wipe delta that started
    // counting before this first successful pull (synced=false —
    // summing the two = the true cumulative; plain local-wins here
    // dropped the pre-wipe history). Once synced, local is the
    // superset and wins untouched.
    if ((myLocalEmpty || !localState.deviceLedgerSynced) && myCloud) {
      mySlice = addSlices(normalizeSlice(myCloud), mySlice);
    }
    const allSlices: ReturnType<typeof normalizeSlice>[] = [mySlice];
    for (const [dev, sl] of Object.entries(cloudLedgers)) {
      if (dev === deviceId) continue;
      allSlices.push(normalizeSlice(sl));
    }
    const ledgerDone: Record<string, number> = {};
    const legacyDone = (userRow.done_log ?? {}) as Record<string, number>;
    for (const [d, n] of Object.entries(legacyDone)) {
      const v = Number(n) || 0;
      if (v > 0) ledgerDone[d] = v;
    }
    let ledgerTasksEver =
      Number(userRow.tasks_ever_completed as number | null) || 0;
    let ledgerFocusMin =
      Number(userRow.focus_minutes_lifetime as number | null) || 0;
    // XP: same delta-slice treatment. users.xp is the FROZEN pre-cutover
    // base (updated clients no longer write it); every device's earned
    // XP lives in its own slice, so the sum is exact even when two
    // devices earn different amounts the same session (the old
    // Math.max(local, cloud) lost the smaller — max(110,110)=110 when
    // the truth was 120).
    let ledgerXp = Number(userRow.xp as number | null) || 0;
    for (const sl of allSlices) {
      for (const [d, n] of Object.entries(sl.doneLog)) {
        const v = (ledgerDone[d] ?? 0) + n;
        if (v <= 0) delete ledgerDone[d];
        else ledgerDone[d] = v;
      }
      ledgerTasksEver += sl.tasksEver;
      ledgerFocusMin += sl.focusMin;
      ledgerXp += sl.xp;
    }
    // Subscription source-of-truth precedence (top wins):
    //   1. Local 'active' from the RC SDK customer-info listener
    //      (optimistic on a fresh purchase) — never demote this just
    //      because the webhook hasn't reached the DB yet.
    //   2. DB value (set by the RC → Supabase webhook).
    //   3. 'free' fallback — free-first is the floor.
    const dbSub = userRow.subscription_status as
      | 'free'
      | 'trial'
      | 'active'
      | 'past_due'
      | 'cancelled'
      | 'expired'
      | null;
    const localIsActive = localState.subscriptionStatus === 'active';
    const dbIsActive = dbSub === 'active';
    // TRIAL PROTECTION: opting into the soft trial calls the
    // start_trial RPC once — if that single call failed (flaky network
    // at tap time), the server row stayed 'free' and this merge used
    // to flatten the local 'trial' to 'free' on the next pull. Since
    // trialStartedAt persisted, startTrial() then refused forever: the
    // trial was CONSUMED but never delivered. A local trial that's
    // still inside its window wins here, and we re-fire the idempotent
    // RPC (server uses coalesce — it can only ever set it once).
    const trialStartMs = localState.trialStartedAt
      ? Date.parse(localState.trialStartedAt)
      : NaN;
    const localTrialLive =
      localState.subscriptionStatus === 'trial' &&
      !isNaN(trialStartMs) &&
      Date.now() - trialStartMs < 7 * 86400000;
    if (localTrialLive && dbSub !== 'trial' && !dbIsActive) {
      void supabase
        .rpc('start_trial')
        .then(({ error }) => {
          if (error) console.warn('[sync] trial reconcile', error.message);
        });
    }
    const protectLocal =
      (localIsActive || localTrialLive) && !dbIsActive && dbSub !== 'trial';
    const nextSubStatus = protectLocal
      ? localState.subscriptionStatus // protect a fresh purchase / live trial
      : (dbSub ?? 'free');
    const nextSubTier = protectLocal
      ? localState.subscriptionTier
      : (userRow.subscription_tier ?? null);
    const nextSubEnd = protectLocal
      ? localState.subscriptionCurrentPeriodEnd
      : (userRow.subscription_current_period_end ?? null);

    useUserStore.setState({
      // `||`, not `??` — Apple's identity token carries no name, so the
      // trigger writes '' for Apple users; empty string is not nullish
      // and was overwriting the local name AuthDoor just captured.
      name: userRow.name || localState.name,
      // The cat is "Lumi" everywhere user-visible. Older rows still
      // carry the legacy 'Luna' pet_name; adopting it verbatim was
      // re-corrupting the local value the store migration had already
      // healed (why "Luna's look" / "LUNA'S ROOM" kept coming back).
      // Map on the way in; the next push writes 'Lumi' back to heal
      // the cloud permanently.
      petName:
        (userRow.pet_name === 'Luna' ? 'Lumi' : userRow.pet_name) ??
        localState.petName,
      adhdType: userRow.adhd_type ?? localState.adhdType,
      // XP — EXACT cross-device total: frozen users.xp base + Σ
      // per-device slices (ledgerXp, computed above). Was
      // Math.max(local, cloud), which silently under-counted when two
      // devices earned XP the same session; level math (levelFromXp)
      // reads this derived total and stays consistent.
      xp: Math.max(0, ledgerXp),
      // Streak is NOT monotonic — a blind max resurrected a streak the
      // user had already broken locally (local 0/1 vs a stale cloud
      // 15). Streak + lastActiveDate move together: adopt whichever
      // source reflects the MORE RECENT activity, so a broken streak
      // stays broken and a genuinely newer device wins.
      ...(function () {
        const cloudDate = userRow.last_active_date ?? '';
        const localDate = localState.lastActiveDate ?? '';
        if (cloudDate === localDate) {
          // Same day on both — neither is "newer"; take the higher
          // streak so a second device that logged more today isn't
          // under-reported (and a broken local streak on a NEW day
          // still falls to the branch below, where dates differ).
          return {
            streak: Math.max(localState.streak, userRow.streak ?? 0),
            lastActiveDate: localState.lastActiveDate ?? userRow.last_active_date,
          };
        }
        const cloudNewer = cloudDate > localDate;
        return {
          streak: cloudNewer ? (userRow.streak ?? 0) : localState.streak,
          lastActiveDate: cloudNewer ? userRow.last_active_date : localState.lastActiveDate,
        };
      })(),
      shieldAvailable: userRow.shield_available ?? true,
      shieldUsedThisWeek: userRow.shield_used_this_week ?? false,
      // Once onboarded, always onboarded — a cloud false (row created
      // by a trigger before the completion push, or clobbered by the
      // pre-pull-push bug this guards against) must not demote a user
      // who finished onboarding on this device.
      onboarded: userRow.onboarded === true || localState.onboarded,
      isTester: userRow.is_tester === true,
      offlineMode: userRow.offline_mode ?? false,
      // Cosmetic identity — the picked cat + room color follow the
      // account now. `||` so a null/'' cloud value never wipes local.
      // roomTint validates against the union: a corrupt cloud string
      // reached ROOM_TINTS[x] → undefined → hexA crash on the Me tab.
      avatar: (userRow.avatar as string | null) || localState.avatar,
      roomTint: ['none', 'rose', 'sage', 'sky', 'lavender', 'honey'].includes(
        (userRow.room_tint as string | null) ?? '',
      )
        ? (userRow.room_tint as typeof localState.roomTint)
        : localState.roomTint,
      // "Member since" = the EARLIEST known date. On a reinstall the
      // local onboardedAt resets, which dropped a long-time user back
      // to "day 1 together" in Profile/Me — restore it from the
      // server's created_at when that's older.
      onboardedAt: (() => {
        const cloud = (userRow.created_at as string | null) ?? null;
        const local = localState.onboardedAt;
        if (!cloud) return local;
        if (!local) return cloud;
        return cloud < local ? cloud : local;
      })(),
      // REGRESSION GUARD: Home auto-starts the spotlight tour when
      // onboardedAt exists and tourSeen is false. Restoring
      // onboardedAt above for a RETURNING user (local was null after
      // a wipe/reinstall) re-armed that effect — onboarding highlights
      // popped for someone long past onboarding, mid-normal-use. A
      // restored user is by definition not a first-run user: mark the
      // tour seen alongside the restore.
      // Gate on the server's onboarded flag, NOT created_at — the
      // trigger creates the row (with created_at) BEFORE a brand-new
      // user has onboarded, and stamping tourSeen off that killed the
      // first-run tour for every new account. `onboarded === true` is
      // the real "returning user" signal.
      ...(localState.onboardedAt == null && userRow.onboarded === true
        ? { tourSeen: true }
        : {}),
      // Lifetime ledgers — EXACT cross-device totals: frozen legacy
      // base + Σ per-device slices (computed above). Two devices doing
      // different work the same day now sum instead of max-merging
      // (the max silently under-counted, e.g. max(3,2)=3 vs truth 5).
      tasksEverCompleted: Math.max(0, ledgerTasksEver),
      focusMinutesLifetime: Math.max(0, ledgerFocusMin),
      doneLog: ledgerDone,
      deviceLedger: mySlice,
      // The cloud slice is folded in (or local already superseded
      // it) — from here on local is the cumulative record and no
      // later flush may fold the cloud copy in again.
      deviceLedgerSynced: true,
      subscriptionStatus: nextSubStatus,
      subscriptionTier: nextSubTier,
      subscriptionCurrentPeriodEnd: nextSubEnd,
      // Trial clock — adopt the server's start stamp when local has
      // none (reinstall / second device). Without this, the status
      // above became 'trial' but trialStartedAt stayed null, so
      // useAccessStatus computed inTrial=false and the account's live
      // trial "evaporated" on that device with no way to re-arm
      // (startTrial refuses on a non-'free' status). Local wins when
      // present: it's also the consumed-trial fingerprint.
      trialStartedAt:
        localState.trialStartedAt ??
        ((userRow.trial_started_at as string | null) ?? null),
    });

    // Mint the PER-USER onboarding receipt from the server signal.
    // The routing gate checks `onboardedUserIds[uid]` — a device-local
    // receipt — so a returning user on a fresh install (or one who
    // onboarded before receipts shipped) got bounced through
    // onboarding again even though the server knew them. The server's
    // `onboarded` flag (pushed on completion) or any existing quests
    // are proof enough.
    if (userRow.onboarded) {
      useUserStore.getState().markOnboardedForUser(userId);
      // Same reasoning for the one-time trial-choice screen: it was
      // offered right after this user's ORIGINAL onboarding. Without
      // this, every fresh install re-asked the upgrade question on
      // sign-in (the flag is device-local and defaulted false).
      useUserStore.getState().markTrialChoiceSeen();
    }
  }

  // Quests — merge by id. window/note/comment/recur/lastSpawnedDate/
  // xpPaid now round-trip (migration 20260713000000), but the merge
  // still prefers the LOCAL value and only falls back to the cloud
  // when this device has never seen the task (fresh install / 2nd
  // device). This is deliberately non-regressing: a pre-migration
  // cloud row carries NULL for these columns, so "cloud wins" would
  // re-wipe local recurrence/notes; "local, else cloud" can never
  // regress and still hydrates a genuinely new device from the cloud.
  // (calendarEventIds stays local-only — it's device-specific.)
  if (q.data) {
    const local = useQuestStore.getState().quests;
    // A row deleted on this device must not ride back in on the pull
    // before its tombstone has flushed.
    const tombstoned = new Set(useQuestStore.getState().deletedIds);
    const byId = new Map<string, Quest>();
    for (const lq of local) byId.set(lq.id, lq);
    const effective = getEffectiveWindows();
    for (const r of q.data) {
      if (tombstoned.has(r.id)) continue;
      const prior = byId.get(r.id); // local copy (richer), if any
      // Window: keep the local truth; only derive from the clock when
      // this device has never seen the task (fresh install / 2nd
      // device), where the cloud genuinely can't tell us the window.
      const win: WindowKey =
        prior?.window ??
        r.window ??
        (r.scheduled_hour != null
          ? deriveWindowFor(
              effective,
              r.scheduled_hour * 60 + (r.scheduled_minute ?? 0),
            )
          : 'midday');
      // RESPAWN GUARD (critical): on a morning cold start the local
      // refreshRecurring re-arms a daily habit BEFORE this pull lands.
      // The cloud row is still yesterday's (completed, dated yesterday)
      // — blindly adopting its completed/date silently marked the fresh
      // instance done, moved it off today, and the same-day spawn guard
      // then blocked a re-spawn: the habit vanished for the day. When
      // the LOCAL spawn stamp is strictly newer than the cloud's, the
      // local respawn is the truth for completion state and date.
      const localRespawnNewer =
        prior?.recur != null &&
        (prior.lastSpawnedDate ?? '') >
          ((r.last_spawned_date as string | null) ?? '');
      // UN-PUSHED-COMPLETION GUARD: a local completion the cloud row
      // hasn't caught up to must NEVER be reverted — that's silent data
      // loss (and the forced xpPaid stamp below then denies XP on
      // re-complete). The old guard only held for 10 minutes, so an
      // OFFLINE completion whose debounced push failed reverted on the
      // next pull once that window passed. Now we compare the completion
      // time to the last SUCCESSFUL quest push (lastPushedAt): if the
      // completion is newer than the last push — or there's been no
      // successful push at all — it hasn't reached the cloud yet, so
      // local wins regardless of age. A genuine cross-device un-complete
      // DID reach the cloud AFTER our push (completedAt <= lastPush) and
      // is correctly adopted. Both are ISO strings → lexicographic
      // compare is chronological.
      const lastPush = useQuestStore.getState().lastPushedAt;
      const localDoneUnpushed =
        !localRespawnNewer &&
        prior?.completed === true &&
        r.completed === false &&
        prior.completedAt != null &&
        (lastPush == null || prior.completedAt > lastPush);
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        difficulty: r.difficulty,
        importance: importanceFromDifficulty(r.difficulty),
        window: win,
        xpReward: r.xp_reward,
        completed: localRespawnNewer
          ? (prior?.completed ?? false)
          : localDoneUnpushed
            ? true
            : r.completed,
        completedAt: localRespawnNewer
          ? (prior?.completedAt ?? null)
          : localDoneUnpushed
            ? (prior?.completedAt ?? null)
            : r.completed_at,
        date: localRespawnNewer ? (prior?.date ?? r.date) : r.date,
        scheduledHour: r.scheduled_hour ?? undefined,
        scheduledMinute: r.scheduled_minute ?? undefined,
        durationMinutes: r.duration_minutes ?? undefined,
        accent: r.accent ?? undefined,
        createdAt: r.created_at,
        // ── Local-preferred, cloud-fallback (see block comment). ──
        ...((prior?.note ?? r.note) != null && {
          note: prior?.note ?? r.note,
        }),
        ...((prior?.comment ?? r.comment) != null && {
          comment: prior?.comment ?? r.comment,
        }),
        // An explicit stop (either side) beats any surviving rule —
        // the tombstone is what lets "turned the repeat off" on one
        // device actually reach the others.
        ...(prior?.recurStopped || r.recur_stopped
          ? { recurStopped: true }
          : {
              ...((prior?.recur ?? r.recur) != null && {
                recur: prior?.recur ?? r.recur,
              }),
              ...((prior?.lastSpawnedDate ?? r.last_spawned_date) != null && {
                lastSpawnedDate:
                  prior?.lastSpawnedDate ?? r.last_spawned_date,
              }),
            }),
        // calendarEventIds is DEVICE-specific (event ids differ per
        // OS calendar) — keep local only; never adopt from cloud.
        // Dropping it made mirrorDelete skip cleanup (orphaned events)
        // and mirrorUpsert create DUPLICATES on the next anchor/retitle.
        ...(prior?.calendarEventIds &&
          Object.keys(prior.calendarEventIds).length > 0 && {
            calendarEventIds: prior.calendarEventIds,
          }),
        // firstStep is DEVICE-LOCAL (no cloud column) — carry the prior
        // local value across the pull. Without this it fell out of the
        // rebuilt row on EVERY cold start, wiping the one small first
        // step the user was looking at.
        ...(prior?.firstStep != null && { firstStep: prior.firstStep }),
        // xpPaid: local stamp OR the cloud stamp OR completed (a
        // completed task has already been paid) — force true so a
        // re-complete after undo can never re-award XP/shards. For a
        // locally-respawned occurrence the STALE cloud row's paid/
        // completed stamps belong to the PREVIOUS occurrence — trusting
        // them would deny XP for today's completion.
        ...((localRespawnNewer
          ? prior?.xpPaid
          : prior?.xpPaid || r.xp_paid || r.completed) && { xpPaid: true }),
      });
    }
    useQuestStore.setState({ quests: Array.from(byId.values()) });
    // Backstop for rows that predate the `onboarded` column push:
    // having ANY quests server-side proves this user has been through
    // the app before — don't re-onboard them.
    if (q.data.length > 0) {
      useUserStore.getState().markOnboardedForUser(userId);
      useUserStore.getState().markTrialChoiceSeen();
    }
  }

  // Checkins — merge by id.
  if (c.data) {
    const local = useCheckinStore.getState().checkins;
    const byId = new Map<string, Checkin>();
    for (const lc of local) byId.set(lc.id, lc);
    for (const r of c.data) {
      // LOCAL WINS: coordinates (the real energy/zone the user placed)
      // aren't round-tripped to Supabase yet, so a cloud row carries
      // only a center placeholder. Overwriting a local row with it
      // FLATTENED every user's whole energy history to a constant 50
      // on each cold start (Patterns/Me/Recap all read from it). Only
      // adopt a cloud row this device has never seen.
      if (byId.has(r.id)) continue;
      let parsed: { state?: string; explanation?: string; action?: string } = {};
      try {
        parsed = r.ai_response ? JSON.parse(r.ai_response) : {};
      } catch {
        /* ignore malformed */
      }
      // Adopt the real coordinates when the cloud row carries them
      // (migration 20260719000000). Legacy rows without coords still
      // plant at center — a shrinking, honest-enough fallback.
      const x =
        typeof r.mood_x === 'number' && r.mood_x >= 0 && r.mood_x <= 1
          ? (r.mood_x as number)
          : 0.5;
      const y =
        typeof r.mood_y === 'number' && r.mood_y >= 0 && r.mood_y <= 1
          ? (r.mood_y as number)
          : 0.5;
      byId.set(r.id, {
        id: r.id,
        x,
        y,
        energy: energyValue(x, y),
        zone: readState(x, y).name,
        route: 'drag',
        aiCause: null,
        confirmed: null,
        note: null,
        mood: r.mood,
        text: r.text_input ?? '',
        state: parsed.state ?? r.emotional_state ?? '',
        explanation: parsed.explanation ?? '',
        action: parsed.action ?? '',
        createdAt: r.created_at,
      });
    }
    const merged = Array.from(byId.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    // Local retention: the pull would otherwise resurrect years of
    // server history onto the device — keep the local copy at the
    // store's 90-day window (the cloud remains the full archive).
    useCheckinStore.setState({ checkins: pruneOldCheckins(merged) });
  }

  // Pet: traits/skin/adventure/last_care.
  if (pet.data) {
    usePetStore.setState({
      skinId: pet.data.skin_id ?? 'cream',
      traits: {
        presence: pet.data.trait_presence ?? 40,
        groundedness: pet.data.trait_groundedness ?? 40,
        momentum: pet.data.trait_momentum ?? 35,
        curiosity: pet.data.trait_curiosity ?? 50,
      },
      adventure: pet.data.adventure ?? null,
      lastCare: pet.data.last_care ?? {
        checkin: null,
        meds: null,
        move: null,
        windDown: null,
      },
    });
  }

  // Equipped items.
  if (eq.data && eq.data.length) {
    const equipped = { ...usePetStore.getState().equipped };
    for (const r of eq.data) {
      (equipped as Record<string, string>)[r.category] = r.item_id;
    }
    usePetStore.setState({ equipped });
  }

  // Owned items + skins.
  if (owned.data) {
    const items = new Set(usePetStore.getState().ownedItems);
    const skins = new Set(usePetStore.getState().ownedSkins);
    for (const r of owned.data) {
      if (r.kind === 'item') items.add(r.ref_id);
      else if (r.kind === 'skin') skins.add(r.ref_id);
    }
    usePetStore.setState({
      ownedItems: Array.from(items),
      ownedSkins: Array.from(skins),
    });
  }


  // The wipe gate only opens when the CORE queries (profile + quests)
  // actually spoke — they're what mint the onboarding receipt. Setting
  // the flag after an all-error pull let the cross-account wipe run
  // against a receipt the server never got to send.
  const coreOk = !u.error && !q.error;
  if (u.error) console.warn('[sync] pull users', u.error.message);
  if (q.error) console.warn('[sync] pull quests', q.error.message);
  if (coreOk) {
    // Pull finished — the cross-account wipe may now make its call
    // (receipt was minted above if the server knew this user).
    useSyncStatus.setState((s) => ({
      pulledFor: { ...s.pulledFor, [userId]: true },
    }));
  }
  // Success = the CORE queries spoke. Grading on the secondary tables
  // too meant one persistently-failing side table (owned/pet) kept
  // the retry loop knocking every 60s for the whole session even
  // though profile+quests were fully merged and pushes were flowing.
  // Secondary hiccups self-heal on the next session's pull.
  if (c.error) console.warn('[sync] pull checkins', c.error.message);
  if (eq.error) console.warn('[sync] pull equipped', eq.error.message);
  if (owned.error) console.warn('[sync] pull owned', owned.error.message);
  if (pet.error) console.warn('[sync] pull pet', pet.error.message);
  // Pet receipt: the pet + equipped queries SPOKE (a missing row for a
  // new user still counts — there's nothing to clobber). Without this
  // receipt every pet push is skipped, so a failed pet pull keeps the
  // cloud pet safe for the whole session.
  if (!pet.error && !eq.error) {
    useSyncStatus.setState((s) => ({
      petMergedFor: { ...s.petMergedFor, [userId]: true },
    }));
  }
  return coreOk;
};

/**
 * Mount once at the root. Pulls on login, subscribes each store, debounces
 * pushes. No-ops when offline / unconfigured / signed out.
 */
/**
 * Immediate, undebounced push of everything local — the sign-out
 * flow runs this BEFORE wiping local data so the wipe can never
 * destroy unsynced work. Throws if any push fails (caller then
 * keeps the local data as the fail-safe).
 */
export const pushAllNow = async (userId: string): Promise<void> => {
  await Promise.all([
    // forceLedgers — this is the sign-out flush before the local wipe;
    // never let it drop the session's doneLog / lifetime counts.
    pushUser(userId, true),
    // Merge-by-id upserts — an empty/partial local set can't erase
    // cloud rows, so these are safe to flush even before a clean pull.
    pushQuests(userId),
    pushCheckins(userId),
    // pushPet self-gates on petMergedFor (its own receipt) — a session
    // whose pet pull failed must never flush default pet state over
    // the cloud skin/traits/bond.
    pushPet(userId),
  ]);
};

/**
 * Flush unsynced local work to the cloud NOW — the retry the debounced
 * subscription pushes never had. Those pushes swallow network errors
 * (offline / transient) and had no re-fire, so an offline completion
 * silently reverted on the next pull (data loss). Wire this from
 * app/_layout.tsx to AppState 'active' (and any reconnect signal) so
 * returning to the foreground re-attempts the flush.
 *
 * Unlike the sign-out flush (pushAllNow, forceLedgers) this uses the
 * NORMAL pushUser and only runs AFTER the pull has merged the cloud
 * (pulledFor) — pre-pull local can be post-wipe defaults, and it must
 * never fold ledger slices. Never throws; the inner pushes self-gate
 * and log their own failures.
 */
export const pushDirtyNow = async (userId: string): Promise<void> => {
  if (!isSupabaseConfigured) return;
  if (useUserStore.getState().offlineMode) return;
  // Only after this device merged the cloud — same gate the debounced
  // pushes fire behind (see whenPulled in useCloudSync).
  if (!useSyncStatus.getState().pulledFor[userId]) return;
  await Promise.all([
    pushUser(userId),
    pushQuests(userId),
    pushCheckins(userId),
    pushPet(userId),
  ]).catch((e) => {
    console.warn('[sync] pushDirtyNow', e instanceof Error ? e.message : e);
  });
};

export const useCloudSync = (session: Session | null) => {
  const offlineMode = useUserStore((s) => s.offlineMode);
  const pulledRef = useRef<string | null>(null);

  const userId = session?.user.id ?? null;
  const active = isSupabaseConfigured && !offlineMode && !!userId;

  // Pull on first transition into authenticated state. Retries with
  // backoff — the pull races the network coming up right after login
  // (or cold start), and a silently failed pull used to leave the
  // Home screen at "Nothing on the day yet" until a full JS reload.
  // Merges are idempotent by id, so re-running a partial pull is safe.
  useEffect(() => {
    if (!active || !userId) return;
    if (pulledRef.current === userId) return;
    pulledRef.current = userId;
    let cancelled = false;
    let succeeded = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delays = [2_000, 5_000, 15_000, 30_000, 60_000];
    let attempt = 0;
    const run = async () => {
      try {
        succeeded = await pullAll(userId);
      } catch (e) {
        console.warn('[sync] pullAll failed', e);
      }
      if (succeeded || cancelled) return;
      // Backoff to 60s, then keep knocking — a signed-in session with
      // no cloud data is a broken state worth 7 tiny queries a minute.
      timer = setTimeout(
        () => void run(),
        delays[Math.min(attempt, delays.length - 1)],
      );
      attempt += 1;
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Re-arm on ANY deactivation — not just failed pulls. Sign-out
      // wipes local state, so a same-session re-sign-in (even as the
      // SAME user) must pull again: keeping the "already pulled" guard
      // across sessions left the user on an empty app with the push
      // gate wide open against a stale pulledFor (audit C1 — the
      // same-session clobber the pulledFor gate was built to stop).
      if (pulledRef.current === userId) {
        pulledRef.current = null;
      }
    };
  }, [active, userId]);

  // Subscribe to all stores; debounce-push.
  useEffect(() => {
    if (!active || !userId) return;

    // Fire-time gate: no subscription push until this device has merged
    // the cloud (pulledFor). Pre-pull local state can be post-wipe
    // defaults, and pushPet/pushUser overwrite whole rows — a premature
    // push wiped a returning user's profile (see pushUser). The pull's
    // own merge writes trigger these subscriptions too, but by then
    // pulledFor is being set and the debounce reads it at fire time.
    const whenPulled = (fn: () => void) => () => {
      if (!useSyncStatus.getState().pulledFor[userId]) return;
      fn();
    };
    const pushUserD = debounce(whenPulled(() => void pushUser(userId)), DEBOUNCE_MS);
    const pushQuestsD = debounce(whenPulled(() => void pushQuests(userId)), DEBOUNCE_MS);
    const pushCheckinsD = debounce(
      whenPulled(() => void pushCheckins(userId)),
      DEBOUNCE_MS,
    );
    const pushPetD = debounce(whenPulled(() => void pushPet(userId)), DEBOUNCE_MS);

    const unsubUser = useUserStore.subscribe(pushUserD);
    const unsubQuests = useQuestStore.subscribe(pushQuestsD);
    const unsubCheckins = useCheckinStore.subscribe(pushCheckinsD);
    const unsubPet = usePetStore.subscribe(pushPetD);

    return () => {
      unsubUser();
      unsubQuests();
      unsubCheckins();
      unsubPet();
    };
  }, [active, userId]);
};
