import type { Quest } from '../store/questStore';

// expo-calendar is lazy-loaded — mirrors lib/auth.ts so the bundle
// still boots in Expo Go (no native modules) and on web. Every
// public helper here returns null / void instead of throwing when
// the SDK isn't available, so the app keeps working uncalendar'd.
type CalendarMod = typeof import('expo-calendar');

let _cal: CalendarMod | null = null;
const loadCalendar = (): CalendarMod | null => {
  if (_cal) return _cal;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _cal = require('expo-calendar') as CalendarMod;
  } catch {
    // Native module not bundled (Expo Go / web).
  }
  return _cal;
};

export const isCalendarSdkAvailable = (): boolean => loadCalendar() !== null;

// ── Permissions ─────────────────────────────────────────────────────

/**
 * Permission result with enough detail for the caller to render
 * the right copy. Splits "denied" from "SDK missing" so the UI can
 * point the user at iOS Settings vs. tell them they need a dev
 * build vs. surface an unexpected throw.
 */
export type CalendarAccessResult =
  | { ok: true }
  | { ok: false; reason: 'no-sdk' }
  | { ok: false; reason: 'denied' }
  | { ok: false; reason: 'error'; message: string };

/**
 * Request OS calendar access. Returns a tagged result so the caller
 * can render the right error. Idempotent — safe to call before every
 * write to handle the case where the user revoked perms in Settings
 * since they last connected.
 */
export const requestCalendarAccess = async (): Promise<CalendarAccessResult> => {
  const Cal = loadCalendar();
  if (!Cal) return { ok: false, reason: 'no-sdk' };
  try {
    const { status } = await Cal.requestCalendarPermissionsAsync();
    if (status === 'granted') return { ok: true };
    return { ok: false, reason: 'denied' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[calendar] requestCalendarPermissionsAsync threw', message);
    return { ok: false, reason: 'error', message };
  }
};

// ── Calendar discovery ───────────────────────────────────────────────

export interface WritableCalendar {
  id: string;
  title: string;
  color: string;
  source: string;
  isPrimary: boolean;
}

/**
 * Return the calendars on this device the user can actually write
 * to (filters out subscribed / read-only ones). Empty list if perms
 * not granted or the SDK isn't bundled — the caller renders the
 * "Connect calendar" affordance in that case.
 */
export const listWritableCalendars = async (): Promise<WritableCalendar[]> => {
  const Cal = loadCalendar();
  if (!Cal) return [];
  try {
    const cals = await Cal.getCalendarsAsync(Cal.EntityTypes.EVENT);
    return cals
      .filter((c) => c.allowsModifications)
      .map((c) => ({
        id: c.id,
        title: c.title,
        color: c.color,
        source: c.source?.name ?? '',
        isPrimary: Boolean(
          (c as unknown as { isPrimary?: boolean }).isPrimary ?? false,
        ),
      }));
  } catch (e) {
    // Log the real failure so the caller can show it. Returning []
    // lets the caller decide whether to treat "no writable calendars"
    // as fatal or as a "ask the user to add one in iOS Calendar" case.
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[calendar] getCalendarsAsync threw', message);
    throw new Error(`Calendar read failed: ${message}`);
  }
};

/** Best-effort default writable calendar id, or null. */
export const getDefaultCalendarId = async (): Promise<string | null> => {
  const Cal = loadCalendar();
  if (!Cal) return null;
  try {
    const def = await Cal.getDefaultCalendarAsync();
    if (def?.allowsModifications) return def.id;
  } catch {
    // iOS without a default calendar throws — fall through.
  }
  const writable = await listWritableCalendars();
  return writable[0]?.id ?? null;
};

// ── Event upsert ────────────────────────────────────────────────────

const DEFAULT_DURATION_MIN = 30;

const buildEventPayload = (quest: Quest, calendarId: string) => {
  if (quest.scheduledHour == null) return null;
  const minute = quest.scheduledMinute ?? 0;
  const [y, m, d] = quest.date.split('-').map((x) => parseInt(x, 10));
  // LOCAL clock — same convention questStore uses for `date`.
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, quest.scheduledHour, minute);
  const durationMin = quest.durationMinutes ?? DEFAULT_DURATION_MIN;
  const end = new Date(start.getTime() + durationMin * 60_000);
  // Combine user comment + LLM-extracted note into the event notes
  // so context written in Lumi shows up in the calendar app.
  const noteParts = [quest.comment, quest.note].filter(
    (s): s is string => !!s && s.length > 0,
  );
  return {
    calendarId,
    title: quest.title,
    startDate: start,
    endDate: end,
    notes: noteParts.length ? noteParts.join('\n\n') : 'Lumi task',
  };
};

/**
 * Mirror a quest into the user's calendar. Creates if no
 * calendarEventId yet, updates in place if there is one. Returns
 * the event id on success, or null on any failure (perms revoked,
 * SDK missing, untimed quest). Never throws — callers are mutation
 * paths and a calendar write should never break a task save.
 */
export const upsertEventForQuest = async (
  quest: Quest,
  calendarId: string,
): Promise<string | null> => {
  const Cal = loadCalendar();
  if (!Cal) return null;
  const payload = buildEventPayload(quest, calendarId);
  if (!payload) return null;
  try {
    if (quest.calendarEventId) {
      await Cal.updateEventAsync(quest.calendarEventId, payload);
      return quest.calendarEventId;
    }
    const id = await Cal.createEventAsync(calendarId, payload);
    return id;
  } catch {
    return null;
  }
};

/**
 * Remove a quest's mirrored event from the user's calendar.
 * No-op if the quest never had one. Silent on failure (the user
 * may have revoked perms or removed the event manually).
 */
export const deleteEventForQuest = async (
  quest: Pick<Quest, 'calendarEventId'>,
): Promise<void> => {
  const Cal = loadCalendar();
  if (!Cal || !quest.calendarEventId) return;
  try {
    await Cal.deleteEventAsync(quest.calendarEventId);
  } catch {
    // Already gone or perms gone — either way, we tried.
  }
};
