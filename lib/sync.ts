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
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import { useUserStore } from '../store/userStore';
import { useQuestStore, type Quest } from '../store/questStore';
import { useCheckinStore, type Checkin } from '../store/checkinStore';
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
const pushUser = async (userId: string) => {
  const s = useUserStore.getState();
  // Subscription columns are owned by the server / IAP webhook — we read
  // them but don't push, to avoid the client accidentally extending its
  // own trial. Same for created_at.
  const { error } = await supabase.from('users').upsert(
    {
      id: userId,
      name: s.name,
      pet_name: s.petName,
      adhd_type: s.adhdType,
      level: 1,
      xp: s.xp,
      streak: s.streak,
      last_active_date: s.lastActiveDate,
      shield_available: s.shieldAvailable,
      shield_used_this_week: s.shieldUsedThisWeek,
      onboarded: s.onboarded,
      offline_mode: s.offlineMode,
    },
    { onConflict: 'id' },
  );
  if (error) console.warn('[sync] pushUser', error.message);
};

// ── push: quests ────────────────────────────────────────────────────────
const pushQuests = async (userId: string) => {
  const quests = useQuestStore.getState().quests;
  if (quests.length === 0) return;
  const rows = quests.map((q) => ({
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
  }));
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
    const { error: ownedErr } = await supabase
      .from('owned_items')
      .upsert(ownedRows, { onConflict: 'user_id,kind,ref_id' });
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
export const pullAll = async (userId: string): Promise<void> => {
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
    useUserStore.setState({
      name: userRow.name ?? useUserStore.getState().name,
      petName: userRow.pet_name ?? useUserStore.getState().petName,
      adhdType: userRow.adhd_type ?? useUserStore.getState().adhdType,
      xp: Math.max(useUserStore.getState().xp, userRow.xp ?? 0),
      streak: Math.max(useUserStore.getState().streak, userRow.streak ?? 0),
      lastActiveDate:
        userRow.last_active_date ?? useUserStore.getState().lastActiveDate,
      shieldAvailable: userRow.shield_available ?? true,
      shieldUsedThisWeek: userRow.shield_used_this_week ?? false,
      onboarded: userRow.onboarded ?? useUserStore.getState().onboarded,
      offlineMode: userRow.offline_mode ?? false,
      subscriptionStatus: userRow.subscription_status ?? 'trial',
      subscriptionTier: userRow.subscription_tier ?? null,
      subscriptionCurrentPeriodEnd:
        userRow.subscription_current_period_end ?? null,
    });
  }

  // Quests — merge by id, cloud version wins on conflict.
  if (q.data) {
    const local = useQuestStore.getState().quests;
    const byId = new Map<string, Quest>();
    for (const lq of local) byId.set(lq.id, lq);
    for (const r of q.data) {
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        difficulty: r.difficulty,
        xpReward: r.xp_reward,
        completed: r.completed,
        completedAt: r.completed_at,
        date: r.date,
        scheduledHour: r.scheduled_hour ?? undefined,
        scheduledMinute: r.scheduled_minute ?? undefined,
        durationMinutes: r.duration_minutes ?? undefined,
        accent: r.accent ?? undefined,
        createdAt: r.created_at,
      });
    }
    useQuestStore.setState({ quests: Array.from(byId.values()) });
  }

  // Checkins — merge by id.
  if (c.data) {
    const local = useCheckinStore.getState().checkins;
    const byId = new Map<string, Checkin>();
    for (const lc of local) byId.set(lc.id, lc);
    for (const r of c.data) {
      let parsed: { state?: string; explanation?: string; action?: string } = {};
      try {
        parsed = r.ai_response ? JSON.parse(r.ai_response) : {};
      } catch {
        /* ignore malformed */
      }
      byId.set(r.id, {
        id: r.id,
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
    useCheckinStore.setState({ checkins: merged });
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
};

/**
 * Mount once at the root. Pulls on login, subscribes each store, debounces
 * pushes. No-ops when offline / unconfigured / signed out.
 */
export const useCloudSync = (session: Session | null) => {
  const offlineMode = useUserStore((s) => s.offlineMode);
  const pulledRef = useRef<string | null>(null);

  const userId = session?.user.id ?? null;
  const active = isSupabaseConfigured && !offlineMode && !!userId;

  // Pull on first transition into authenticated state.
  useEffect(() => {
    if (!active || !userId) return;
    if (pulledRef.current === userId) return;
    pulledRef.current = userId;
    void pullAll(userId).catch((e) =>
      console.warn('[sync] pullAll failed', e),
    );
  }, [active, userId]);

  // Subscribe to all stores; debounce-push.
  useEffect(() => {
    if (!active || !userId) return;

    const pushUserD = debounce(() => void pushUser(userId), DEBOUNCE_MS);
    const pushQuestsD = debounce(() => void pushQuests(userId), DEBOUNCE_MS);
    const pushCheckinsD = debounce(
      () => void pushCheckins(userId),
      DEBOUNCE_MS,
    );
    const pushPetD = debounce(() => void pushPet(userId), DEBOUNCE_MS);

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
