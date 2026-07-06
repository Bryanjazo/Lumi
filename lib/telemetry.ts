// Lumi · parse-quality telemetry
//
// Tier 1 — syncParseMetrics(): uploads the aiMetrics rows (route /
// reason / latency / edited — ZERO text content) to parse_metrics so
// we can see WHERE parsing fails in aggregate (edit-rate per route is
// the quality dial). Write-only table; falls under the Usage Data
// privacy label. Skipped entirely in offline mode.
//
// Tier 3 — logCaptureRaw(): RAW capture text + parse result, ONLY for
// accounts the server flagged is_tester (internal/TestFlight testers,
// disclosed in beta notes). The client checks the flag BEFORE sending
// so a non-tester's text never leaves the device; RLS enforces it
// again server-side.

import { supabase, isSupabaseConfigured } from './supabase';
import { useUserStore } from '../store/userStore';
import { useAiMetricsStore } from '../store/aiMetricsStore';
import type { SmartTask } from './capture';

let _syncing = false;

export const syncParseMetrics = async (): Promise<void> => {
  if (_syncing || !isSupabaseConfigured) return;
  const u = useUserStore.getState();
  if (u.offlineMode) return;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return;

  const { metrics, update } = useAiMetricsStore.getState();
  // Unsynced rows, plus rows whose edited flag flipped after upload
  // (server upsert refreshes them). Cap per batch to stay polite.
  const pending = metrics.filter((m) => !m.synced).slice(0, 100);
  if (pending.length === 0) return;

  _syncing = true;
  try {
    const { error } = await supabase.from('parse_metrics').upsert(
      pending.map((m) => ({
        user_id: uid,
        client_id: m.id,
        client_date: m.date,
        route: m.route,
        reason: m.reason,
        latency_ms: Math.round(m.latencyMs),
        edited: m.edited,
      })),
      { onConflict: 'user_id,client_id' },
    );
    if (!error) {
      for (const m of pending) update(m.id, { synced: true });
    }
  } catch {
    // Network blip — rows stay unsynced, next foreground retries.
  } finally {
    _syncing = false;
  }
};

/** An edit after upload matters (it's THE quality signal) — flip the
 *  row back to unsynced so the next sync upserts the truth. */
export const markMetricEdited = (id: string): void => {
  useAiMetricsStore.getState().update(id, { edited: true, synced: false });
};

export const logCaptureRaw = (
  raw: string,
  parsed: SmartTask[] | null,
  route: string,
  reason: string,
  meta?: Record<string, unknown>,
): void => {
  if (!isSupabaseConfigured) return;
  const u = useUserStore.getState();
  // The flag is server-granted (users.is_tester → sync pull). Raw
  // text NEVER leaves a non-tester device.
  if (!u.isTester || u.offlineMode) return;
  void (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      await supabase.from('capture_feedback').insert({
        user_id: uid,
        raw: raw.slice(0, 600),
        parsed: {
          tasks: (parsed ?? []).map((t) => ({
            title: t.title,
            window: t.window,
            at: t.at,
            date: t.date,
            importance: t.importance,
            recur: t.recur,
          })),
          ...(meta ?? {}),
        },
        route,
        reason,
      });
    } catch {
      // Fire-and-forget — testing telemetry must never bother the UI.
    }
  })();
};
