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
  let xp = s.xp;
  let streak = s.streak;
  let lastActiveDate = s.lastActiveDate;
  if (!pulled) {
    const { data: cur, error: readErr } = await supabase
      .from('users')
      .select('onboarded, adhd_type, name, xp, streak, last_active_date')
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
      xp = Math.max(xp, (cur.xp as number | null) ?? 0);
      const cloudDate = (cur.last_active_date as string | null) ?? '';
      if (cloudDate > (lastActiveDate ?? '')) {
        // Cloud reflects more recent activity — keep its streak pair.
        streak = (cur.streak as number | null) ?? 0;
        lastActiveDate = cloudDate;
      }
    }
  }
  // Subscription columns are owned by the server / IAP webhook — we read
  // them but don't push, to avoid the client accidentally extending its
  // own trial. Same for created_at.
  const { error } = await supabase.from('users').upsert(
    {
      id: userId,
      name,
      pet_name: s.petName,
      adhd_type: adhdType,
      level: 1,
      xp,
      streak,
      last_active_date: lastActiveDate,
      shield_available: s.shieldAvailable,
      shield_used_this_week: s.shieldUsedThisWeek,
      onboarded,
      offline_mode: s.offlineMode,
    },
    { onConflict: 'id' },
  );
  if (error) console.warn('[sync] pushUser', error.message);

  // Lifetime ledgers go in a SEPARATE, best-effort upsert — the
  // columns come from migration 20260713010000, which may not be
  // applied yet. PostgREST fails the WHOLE row on an unknown column,
  // so bundling these into the core upsert above would 400 and kill
  // ALL profile sync until the migration lands. Isolated here, a
  // missing-column error only skips the ledgers. Normally gated on a
  // completed pull so a not-yet-merged local copy can't briefly lower
  // the cloud ledger — but the SIGN-OUT flush forces it (forceLedgers)
  // so a session whose login pull failed doesn't lose its history to
  // the wipe; the receiving device's pull max-merges anyway.
  if (forceLedgers || pulled) {
    let doneLog = s.doneLog;
    let tasksEver = s.tasksEverCompleted;
    let focusMin = s.focusMinutesLifetime;
    // Forced flush BEFORE a completed pull (sign-out after a failed
    // login pull): local hasn't merged the cloud, and the upsert is a
    // plain overwrite with no server-side GREATEST — a blind write
    // could LOWER a higher cloud ledger (another device). Read + max
    // first so a forced push can only ever KEEP history. If the read
    // fails we skip the ledger push rather than risk lowering.
    if (forceLedgers && !pulled) {
      const { data: cur, error: readErr } = await supabase
        .from('users')
        .select('done_log, tasks_ever_completed, focus_minutes_lifetime')
        .eq('id', userId)
        .maybeSingle();
      if (readErr) {
        console.warn('[sync] ledger read (skip force)', readErr.message);
        return;
      }
      if (cur) {
        tasksEver = Math.max(tasksEver, (cur.tasks_ever_completed as number) ?? 0);
        focusMin = Math.max(focusMin, (cur.focus_minutes_lifetime as number) ?? 0);
        const merged: Record<string, number> = { ...doneLog };
        const cloud = (cur.done_log ?? {}) as Record<string, number>;
        for (const [ymd, n] of Object.entries(cloud)) {
          merged[ymd] = Math.max(merged[ymd] ?? 0, Number(n) || 0);
        }
        doneLog = merged;
      }
    }
    const { error: ledgerErr } = await supabase.from('users').upsert(
      {
        id: userId,
        done_log: doneLog,
        tasks_ever_completed: tasksEver,
        focus_minutes_lifetime: focusMin,
      },
      { onConflict: 'id' },
    );
    if (ledgerErr) console.warn('[sync] pushUser ledgers', ledgerErr.message);
  }
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
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('quests').upsert(rows, {
    onConflict: 'id',
  });
  if (error) console.warn('[sync] pushQuests', error.message);
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
  }));
  const { error } = await supabase.from('checkins').upsert(rows, {
    onConflict: 'id',
  });
  if (error) console.warn('[sync] pushCheckins', error.message);
};

// ── push: pet state ─────────────────────────────────────────────────────
const pushPet = async (userId: string) => {
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

  // SOS events: insert any not yet known by remote.
  if (p.sosEvents.length) {
    const rows = p.sosEvents.map((e) => ({
      id: e.id,
      user_id: userId,
      type: e.type,
      duration_seconds: e.durationSeconds,
    }));
    const { error: sosErr } = await supabase
      .from('sos_events')
      .upsert(rows, { onConflict: 'id' });
    if (sosErr) console.warn('[sync] pushSos', sosErr.message);
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
}>(() => ({ pulledFor: {} }));

/**
 * Returns true only when EVERY section pulled cleanly. Supabase
 * queries don't throw — a dead network right after login returns
 * `{data: null, error}` on all seven, which used to read as a
 * "successful" pull: no quests landed, no onboarding receipt was
 * minted, and the pulled flag was set anyway. The user stared at
 * "Nothing on the day yet" until a manual reload re-ran the pull.
 */
export const pullAll = async (userId: string): Promise<boolean> => {
  const [u, q, c, eq, owned, pet, sos] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase.from('quests').select('*').eq('user_id', userId),
    supabase.from('checkins').select('*').eq('user_id', userId),
    supabase.from('equipped_items').select('*').eq('user_id', userId),
    supabase.from('owned_items').select('*').eq('user_id', userId),
    supabase.from('pet_state').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('sos_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  // Profile — cloud wins for fields that exist remotely, else keep local.
  const userRow = u.data;
  if (userRow) {
    const localState = useUserStore.getState();
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
    const nextSubStatus = localIsActive && !dbIsActive
      ? localState.subscriptionStatus // protect a fresh purchase
      : (dbSub ?? 'free');
    const nextSubTier = localIsActive && !dbIsActive
      ? localState.subscriptionTier
      : (userRow.subscription_tier ?? null);
    const nextSubEnd = localIsActive && !dbIsActive
      ? localState.subscriptionCurrentPeriodEnd
      : (userRow.subscription_current_period_end ?? null);

    useUserStore.setState({
      name: userRow.name ?? localState.name,
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
      // XP is a monotonic lifetime total — max is the honest merge.
      xp: Math.max(localState.xp, userRow.xp ?? 0),
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
      ...(localState.onboardedAt == null && userRow.created_at != null
        ? { tourSeen: true }
        : {}),
      // Lifetime ledgers — monotonic merge (never lose history): counts
      // by max, done_log by per-day max so neither device's record is
      // erased. Cloud columns may be absent on pre-migration rows → 0.
      tasksEverCompleted: Math.max(
        localState.tasksEverCompleted,
        (userRow.tasks_ever_completed as number | null) ?? 0,
      ),
      focusMinutesLifetime: Math.max(
        localState.focusMinutesLifetime,
        (userRow.focus_minutes_lifetime as number | null) ?? 0,
      ),
      doneLog: (() => {
        const merged: Record<string, number> = { ...localState.doneLog };
        const cloud = (userRow.done_log ?? {}) as Record<string, number>;
        for (const [ymd, n] of Object.entries(cloud)) {
          merged[ymd] = Math.max(merged[ymd] ?? 0, Number(n) || 0);
        }
        return merged;
      })(),
      subscriptionStatus: nextSubStatus,
      subscriptionTier: nextSubTier,
      subscriptionCurrentPeriodEnd: nextSubEnd,
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
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        difficulty: r.difficulty,
        importance: importanceFromDifficulty(r.difficulty),
        window: win,
        xpReward: r.xp_reward,
        completed: r.completed,
        completedAt: r.completed_at,
        date: r.date,
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
        ...((prior?.recur ?? r.recur) != null && {
          recur: prior?.recur ?? r.recur,
        }),
        ...((prior?.lastSpawnedDate ?? r.last_spawned_date) != null && {
          lastSpawnedDate: prior?.lastSpawnedDate ?? r.last_spawned_date,
        }),
        // calendarEventIds is DEVICE-specific (event ids differ per
        // OS calendar) — keep local only; never adopt from cloud.
        // Dropping it made mirrorDelete skip cleanup (orphaned events)
        // and mirrorUpsert create DUPLICATES on the next anchor/retitle.
        ...(prior?.calendarEventIds &&
          Object.keys(prior.calendarEventIds).length > 0 && {
            calendarEventIds: prior.calendarEventIds,
          }),
        // xpPaid: local stamp OR the cloud stamp OR completed (a
        // completed task has already been paid) — force true so a
        // re-complete after undo can never re-award XP/shards.
        ...((prior?.xpPaid || r.xp_paid || r.completed) && { xpPaid: true }),
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
      // Coordinate fields aren't yet round-tripped to Supabase — plant
      // never-seen cloud rows at center and derive zone/energy from it.
      const x = 0.5;
      const y = 0.5;
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

  // SOS events.
  if (sos.data) {
    const local = usePetStore.getState().sosEvents;
    const byId = new Map(local.map((e) => [e.id, e]));
    for (const r of sos.data) {
      byId.set(r.id, {
        id: r.id,
        type: r.type,
        durationSeconds: r.duration_seconds,
        createdAt: r.created_at,
      });
    }
    usePetStore.setState({
      sosEvents: Array.from(byId.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
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
  return (
    coreOk &&
    !c.error &&
    !eq.error &&
    !owned.error &&
    !pet.error &&
    !sos.error
  );
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
    // pet_state is a whole-row overwrite with no protective merge. If
    // this session never completed a pull, local pet is defaults (or
    // near it) and flushing it would reset the cloud skin/traits/bond
    // on every device. Skipping loses at most one unpulled session's
    // care taps — the far smaller harm.
    ...(useSyncStatus.getState().pulledFor[userId]
      ? [pushPet(userId)]
      : []),
  ]);
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
