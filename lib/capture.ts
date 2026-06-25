// Lumi · smart capture — the inline brain used by Home's quick-capture
// (and reusable by the Capture tab when it goes inline).
//
// Spec: lumi-smart-capture-spec.md.
//
// Goals (recap from §1):
//   1. Understand free text — clean title, multi-task split.
//   2. Infer tier (Trial/Task/Whim).
//   3. Parse time/date when given ("Friday 2pm", "tomorrow", "in an hour").
//   4. **The important one** — when there's NO time (most captures),
//      infer a smart window from the user's learned rhythms (NOT
//      default-to-someday). Hard Trials → sharp window; Whims → foggy
//      window; Mediums → current window.
//   5. Everything writes to the one tasks table so it shows on Home +
//      Time and feeds vitality + recap.
//
// This is the **deterministic fallback** per §5. It always runs and
// always captures — the LLM path (§2) can wrap this later for richer
// extraction, but the floor is "works with zero AI."

import { type Importance } from '../constants/importance';
import { type WindowKey, type WindowMeta } from '../constants/windows';
import { type RecurRule } from '../constants/recur';

// ═════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════

/** A single task extracted from a capture string. Shape mirrors §2. */
/**
 * How much mental energy the task demands (the spec's "energyDemand"
 * field). Importance is about stakes/load; demand is about *focus
 * required to do the thing*. They usually track but not always —
 * tax paperwork is low-stakes but high-demand. The placement
 * engine (pickSmartWindow) routes by demand: high → peak/sharp
 * window, low → slump/foggy, medium → neutral. Filled by the LLM
 * understanding pass; falls back to mirroring importance when the
 * deterministic engine is the only thing that ran.
 */
export type EnergyDemand = 'high' | 'medium' | 'low';

export interface SmartTask {
  /** Cleaned, human title. */
  title: string;
  importance: Importance;
  /** Mental demand for placement — see EnergyDemand. */
  energyDemand: EnergyDemand;
  timeMode: 'anchored' | 'windowed' | 'someday';
  /** Minutes since midnight, when explicitly given. */
  at: number | null;
  /** YYYY-MM-DD, when explicitly given or derived from day-of-week. */
  date: string | null;
  /** Part-of-day window — always set (even for anchored/someday). */
  window: WindowKey;
  recur: RecurRule | null;
  /** Original input fragment — kept verbatim for the learning layer. */
  raw: string;
  /**
   * True when the task is a deadline-type ("homework", "report due",
   * "pay bill") but the user didn't give a when. Home's guided
   * follow-up uses this to offer Today/Tomorrow/Weekend chips. The
   * task still saves on skip with the inferred window — never blocks.
   * (lumi-home-guided-capture-spec §3.)
   */
  needsFollowup: boolean;
  /**
   * Set when the user said a bare hour with "today" ("today at 9")
   * and both the AM and PM reading are still in the future — we
   * can't safely guess. The preview UI offers chips ("9 AM" / "9 PM")
   * so the user picks. `at` defaults to whichever is sooner.
   * Minutes since midnight on the same date.
   */
  timeOptions?: number[];
  /**
   * Length in minutes. Filled by the LLM understand pass when the
   * user implies one ("hour long meeting" → 60), or by the length
   * picker in the preview. When unset, Home falls back to a sane
   * default keyed off importance (high: 60 / med: 30 / low: 15).
   */
  durationMinutes?: number;
  /**
   * Short freeform context the LLM extracted from the raw input
   * ("bring the charger", "the blue folder"). Persisted to Quest
   * and rendered as a subtitle so the detail isn't dropped.
   */
  note?: string;
}

/**
 * Context the parser uses to make Layer-2 inferences (smart window
 * picks) and time arithmetic. Home builds this from the user's store +
 * learned digest + effective windows.
 */
export interface CaptureContext {
  /** User's self-reported sharp window from onboarding (or null). */
  sharpWindow: WindowKey | null;
  /** User's self-reported foggy window from onboarding (or null). */
  foggyWindow: WindowKey | null;
  /** Learned peak — minutes since midnight. From energy_curve. */
  peakStart: number | null;
  peakEnd: number | null;
  /**
   * Learned slump — minutes since midnight. From energy_curve. The
   * window where the user's follow-through dips. We use this two
   * ways: heavy tasks NEVER land here (waste of peak/sharp), but
   * easy tasks PREFER it (a small win restarts the brain).
   */
  slumpStart?: number | null;
  slumpEnd?: number | null;
  /** Window times the user has configured (or defaults). */
  effectiveWindows: Record<WindowKey, WindowMeta>;
  /** Current time — for "in 30 min" and "current window" picks. */
  now: Date;
  nowMin: number;
  /**
   * The user's wake-up anchor in minutes-since-midnight. Acts as the
   * "today starts here" boundary alongside sleepMin.
   */
  wakeMin?: number;
  /**
   * The user's bedtime anchor in minutes-since-midnight. THIS is the
   * real end-of-day, not the nominal evening window end (22). Without
   * it, captures past 10 PM would incorrectly roll to tomorrow even
   * though the user's still awake. (e.g. user at 10:15 PM with a
   * 11:45 PM bedtime — "pray before bed" must land tonight.)
   */
  sleepMin?: number;
}

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════

const cap = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

// ── Title cleaner — the deterministic floor for "organize what I said
//    instead of the full sentence". Strips ADHD-speech fillers, leading
//    intent prefixes ("I need to / remember to"), and trailing hedges
//    ("or something", "I guess") so the saved title reads like a clean
//    imperative action. The LLM enhancement upgrades this further when
//    available (lib/anthropic.ts → llmCleanTitle).

const FILLER_WORDS = [
  'um',
  'uh',
  'erm',
  'hmm',
  'hm',
  'like',
  'basically',
  'literally',
  'kinda',
  'sorta',
  'kind of',
  'sort of',
  'you know',
  'i mean',
  'yeah',
  'yea',
  'yep',
  'okay',
  'well',
  'actually',
  'totally',
  'really',
  'just',
];

const INTENT_PREFIXES = [
  // Stacked prefixes — order matters; strip longest first.
  "i don'?t forget to",
  'i do not forget to',
  "don'?t forget to",
  'do not forget to',
  'i need to remember to',
  'need to remember to',
  'remember to',
  "i'?ve got to",
  "i'?ve gotta",
  "i'?d like to",
  "i'?m gonna",
  'i would like to',
  'would like to',
  'i want to',
  'want to',
  'wanna',
  'i wanna',
  'i need to',
  'need to',
  'i have to',
  'have to',
  'i gotta',
  'gotta',
  'got to',
  'i should',
  'should',
  'i must',
  'must',
  "i'll",
  'let me',
  "let'?s",
  'gonna',
  'maybe',
  'oh',
  'so',
  'um',
  'uh',
  'yeah',
  'okay',
  'ok',
];

const TRAILING_HEDGES = [
  'or something',
  'or whatever',
  'i guess',
  'i think',
  'somehow',
  'maybe',
  'kinda',
  'sorta',
  'right',
];

const cleanTitle = (s: string): string => {
  let t = s.trim();
  if (!t) return '';

  // ── Strip filler words anywhere they appear (case-insensitive).
  // Use word boundaries so we don't eat substrings ("like" doesn't
  // touch "likely").
  for (const filler of FILLER_WORDS) {
    const re = new RegExp(
      `\\b${filler.replace(/'/g, "[''']")}\\b`,
      'gi',
    );
    t = t.replace(re, '');
  }

  // ── Strip leading intent prefixes, iteratively so stacked ones
  // ("I need to remember to") collapse fully.
  let changed = true;
  let safety = 0;
  while (changed && safety++ < 6) {
    changed = false;
    const lc = t.toLowerCase().trimStart();
    for (const prefix of INTENT_PREFIXES) {
      const re = new RegExp(`^${prefix}\\b\\s*,?\\s*`, 'i');
      if (re.test(lc)) {
        // Compute how many chars were eaten in the lowercased form and
        // slice that many off the original (which has the right case).
        const match = lc.match(re);
        if (match) {
          const eaten = t.length - lc.length + match[0].length;
          t = t.slice(eaten).trimStart();
          changed = true;
          break;
        }
      }
    }
  }

  // ── Strip trailing hedges.
  for (const hedge of TRAILING_HEDGES) {
    const re = new RegExp(`[,\\s]+${hedge}\\s*[.!?]*\\s*$`, 'i');
    t = t.replace(re, '');
  }

  // ── Collapse whitespace and trim leading/trailing punctuation noise.
  t = t
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/^[.,;:!?\s]+|[.,;:\s]+$/g, '')
    .trim();

  return cap(t);
};

// Match todayKey()'s convention (LOCAL date). UTC would mismatch with
// the Time tab's local-midnight "today" reference whenever the user's
// local clock differs from UTC by enough that "now local" and "now
// UTC" fall on different calendar days — e.g. 8 PM Pacific = 4 AM
// UTC next day, which made captures land on tomorrow's thread.
const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const DAY_FULL: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const DAY_RECUR_KEY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const nextDayOfWeek = (base: Date, targetDow: number): Date => {
  const baseDow = base.getDay();
  let diff = targetDow - baseDow;
  if (diff <= 0) diff += 7;
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d;
};

// ═════════════════════════════════════════════════════════════════════
// Tier (importance) inference — keyword heuristics. Default = medium.
// ═════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════
// Deadline-type detection — these task types usually need a due date.
// Used by Home's guided follow-up: if a task hits these keywords but
// no when was given, Lumi asks "When's it due?".
// (lumi-home-guided-capture-spec §3.)
// ═════════════════════════════════════════════════════════════════════
const DEADLINE_TYPE_PATTERN =
  /\b(homework|assignment|essay|paper|project|report|due|finish|submit|turn in|pay|bill|rent|invoice|appointment|rsvp|deadline|present|presentation|interview|exam|test|quiz|application|application|file|follow up|follow-up|review|prep|deliverable)\b/;

export const isDeadlineType = (text: string): boolean =>
  DEADLINE_TYPE_PATTERN.test(text.toLowerCase());

const inferImportance = (lc: string): Importance => {
  // High signals — explicit urgency, deadlines, "real work" verbs.
  // Date words like "today" / "tonight" are intentionally excluded —
  // they're timing hints, not difficulty hints ("call mom today" is
  // a medium task, not a Trial).
  if (
    /\b(asap|urgent|due|deadline|important|overdue|critical|report|finish|prep|submit|present|interview|deliverable)\b/.test(
      lc,
    )
  ) {
    return 'high';
  }
  // Low signals — open-ended / consumption / "someday".
  if (
    /\b(someday|maybe|eventually|sometime|could|might|read|watch|browse|article|video|movie|podcast|skim|look at)\b/.test(
      lc,
    )
  ) {
    return 'low';
  }
  return 'medium';
};

// ═════════════════════════════════════════════════════════════════════
// Recurrence parser — "every monday", "weekly", "daily".
// ═════════════════════════════════════════════════════════════════════
const parseRecur = (lc: string): RecurRule | null => {
  const dayMatch = lc.match(
    /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/,
  );
  if (dayMatch) {
    const dow = DAY_FULL[dayMatch[1]];
    if (dow != null) {
      return { every: 'week', day: DAY_RECUR_KEY[dow], part: 'midday' };
    }
  }
  if (/\bevery\s+morning\b/.test(lc)) {
    return { every: 'day', part: 'morning' };
  }
  if (/\bevery\s+evening\b/.test(lc) || /\bevery\s+night\b/.test(lc)) {
    return { every: 'day', part: 'evening' };
  }
  if (/\bevery\s+day\b/.test(lc) || /\bdaily\b/.test(lc)) {
    return { every: 'day', part: 'midday' };
  }
  if (/\bweekdays\b/.test(lc)) {
    return { every: 'weekday', part: 'midday' };
  }
  if (/\bweekly\b/.test(lc)) {
    return { every: 'week', part: 'midday' };
  }
  if (/\bmonthly\b/.test(lc)) {
    return { every: 'month', part: 'midday' };
  }
  return null;
};

// ═════════════════════════════════════════════════════════════════════
// Time + date parser. Returns matched tokens so the caller can strip
// them from the title.
// ═════════════════════════════════════════════════════════════════════
interface ParsedTime {
  date: Date | null;
  at: number | null;
  windowHint: WindowKey | null;
  matched: string[];
  /**
   * The raw, pre-PM-nudge hour the user typed. Only set when an
   * explicit clock time was matched (so we can recover AM/PM
   * ambiguity downstream). 0–23.
   */
  bareHour?: number;
  /**
   * True when the user typed a bare hour with no AM/PM marker. The
   * main flow uses this to ask the user when "today at 9" could mean
   * either 9 AM or 9 PM and both are still in the future.
   */
  bareNoAmPm?: boolean;
  /** Minutes part of the explicit clock time (0–59). */
  bareMinute?: number;
}

const parseTimeAndDate = (lc: string, ctx: CaptureContext): ParsedTime => {
  const matched: string[] = [];
  let date: Date | null = null;
  let at: number | null = null;
  let windowHint: WindowKey | null = null;

  // ── Date words ──
  if (/\btoday\b/.test(lc)) {
    date = new Date(ctx.now);
    matched.push('today');
  }
  if (/\btomorrow\b/.test(lc)) {
    date = new Date(ctx.now);
    date.setDate(date.getDate() + 1);
    matched.push('tomorrow');
  }
  if (/\btonight\b/.test(lc)) {
    if (!date) date = new Date(ctx.now);
    windowHint = 'evening';
    matched.push('tonight');
  }

  // "before bed" / "by bed" / "before sleep" — pin near the sleep
  // anchor. Tasks like "pray before bed" should land tonight, not
  // tomorrow, even when captured past the nominal evening window.
  if (
    /\b(before\s+bed|by\s+bed|before\s+sleep|before\s+i\s+sleep|before\s+going\s+to\s+bed)\b/.test(
      lc,
    )
  ) {
    if (!date) date = new Date(ctx.now);
    windowHint = 'evening';
    if (ctx.sleepMin != null && at == null) {
      // 20 min before bedtime — leaves a small buffer to wind down.
      // Clamp to "now + 10 min" so it doesn't land in the past if
      // the user captures within 20 min of bedtime.
      at = Math.max(ctx.nowMin + 10, ctx.sleepMin - 20);
      // Sanity guard — don't roll past midnight.
      if (at >= 24 * 60) at = 24 * 60 - 1;
    }
    matched.push(
      lc.includes('before sleep')
        ? 'before sleep'
        : lc.includes('by bed')
          ? 'by bed'
          : lc.includes('before going to bed')
            ? 'before going to bed'
            : 'before bed',
    );
  }

  // Day of week — only the FIRST match (avoid grabbing the recurrence
  // "every monday" twice). Skip if "every <day>" already parsed.
  if (!/\bevery\s+\w+/.test(lc)) {
    const dowMatch = lc.match(
      /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/,
    );
    if (dowMatch && !date) {
      const dow = DAY_FULL[dowMatch[1]];
      if (dow != null) {
        date = nextDayOfWeek(ctx.now, dow);
        matched.push(dowMatch[1]);
      }
    }
  }

  // ── Relative time "in N min/hours" ──
  const inMatch = lc.match(
    /\bin\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|hr|h)\b/,
  );
  if (inMatch) {
    const num = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const mins = /^(h|hour|hr)/.test(unit) ? num * 60 : num;
    at = (ctx.nowMin + mins) % (24 * 60);
    if (!date) date = new Date(ctx.now);
    matched.push(inMatch[0]);
  } else if (/\bin\s+an?\s+hour\b/.test(lc)) {
    at = (ctx.nowMin + 60) % (24 * 60);
    if (!date) date = new Date(ctx.now);
    matched.push('in an hour');
  } else if (/\bin\s+half\s+an?\s+hour\b/.test(lc)) {
    at = (ctx.nowMin + 30) % (24 * 60);
    if (!date) date = new Date(ctx.now);
    matched.push('in half an hour');
  }

  // ── Explicit clock time ──
  // "at 2", "at 2pm", "2pm", "14:00", "2:30 pm"
  let bareHour: number | undefined;
  let bareNoAmPm: boolean | undefined;
  let bareMinute: number | undefined;
  if (at == null) {
    const timeMatch = lc.match(
      /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?\b/,
    );
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const apRaw = timeMatch[3];
      const isPm = apRaw === 'pm' || apRaw === 'p.m.' || apRaw === 'p';
      const isAm = apRaw === 'am' || apRaw === 'a.m.' || apRaw === 'a';
      const hasAt = /\bat\s/.test(lc);
      const hasColon = !!timeMatch[2];
      // Only treat as a time if there's enough context — bare numbers
      // are too ambiguous ("call mom 3" doesn't mean 3pm).
      const isContextual = apRaw != null || hasColon || (hasAt && h <= 23);
      if (isContextual && h >= 0 && h <= 23 && m >= 0 && m < 60) {
        // Record what the user typed BEFORE any PM-nudge so the main
        // flow can offer an AM/PM choice when "today at 9" is ambiguous.
        bareHour = h;
        bareMinute = m;
        bareNoAmPm = !apRaw;
        if (isPm && h < 12) h += 12;
        else if (isAm && h === 12) h = 0;
        else if (!apRaw) {
          // Bare "at X" with no am/pm — disambiguate by context.
          //
          // (1) Strong evening context wins: if "tonight" / "before
          //     bed" / "evening" was matched OR the user captured
          //     past 5 PM, then any plausible PM hour (1–11) means
          //     PM. This fixes "pray tonight at 11" → 11 PM (not
          //     11 AM, which would past-time-roll to tomorrow).
          // (2) Otherwise the everyday-speech default: bare hours
          //     ≤ 6 mean PM unless explicit morning context.
          const eveningCtx =
            windowHint === 'evening' ||
            matched.includes('tonight') ||
            matched.some((t) =>
              /before bed|before sleep|by bed|before going to bed/.test(t),
            ) ||
            ctx.nowMin >= 17 * 60;
          if (eveningCtx && h >= 1 && h <= 11) {
            h += 12;
          } else if (
            h <= 6 &&
            !/\b(morning|am|breakfast|wake)\b/.test(lc)
          ) {
            h += 12;
          }
        }
        at = h * 60 + m;
        matched.push(timeMatch[0]);
      }
    }
  }

  // ── Window hint words (set last so explicit time wins for `at`). ──
  if (/\bmorning\b/.test(lc) && !matched.includes('morning')) {
    windowHint = 'morning';
    matched.push('morning');
  } else if (/\bafternoon\b/.test(lc) && !matched.includes('afternoon')) {
    windowHint = 'afternoon';
    matched.push('afternoon');
  } else if (
    !windowHint &&
    /\b(evening|after dinner)\b/.test(lc) &&
    !matched.includes('evening')
  ) {
    windowHint = 'evening';
    matched.push('evening');
  } else if (
    !windowHint &&
    /\b(midday|noon|lunchtime)\b/.test(lc) &&
    !matched.includes('midday')
  ) {
    windowHint = 'midday';
    matched.push('midday');
  }

  return { date, at, windowHint, matched, bareHour, bareNoAmPm, bareMinute };
};

// ═════════════════════════════════════════════════════════════════════
// Layer-2 window inference — the heart of this spec. When no explicit
// time is given, pick the right part-of-day from the user's learned
// rhythms instead of dumping to someday.
// ═════════════════════════════════════════════════════════════════════
const windowForMinutes = (
  m: number,
  effective: Record<WindowKey, WindowMeta>,
): WindowKey => {
  const h = m / 60;
  const order: WindowKey[] = ['morning', 'midday', 'afternoon', 'evening'];
  for (const k of order) {
    const w = effective[k];
    if (w.start != null && w.end != null && h >= w.start && h < w.end) {
      return k;
    }
  }
  return h < 11 ? 'morning' : h < 17 ? 'midday' : 'evening';
};

// ── Window availability helpers ────────────────────────────────────
// A window is "still available today" if its end is still in the future.
const isWindowOpenToday = (
  k: WindowKey,
  ctx: CaptureContext,
): boolean => {
  const w = ctx.effectiveWindows[k];
  if (w.end == null) return false;
  return w.end * 60 > ctx.nowMin;
};

const isCurrentlyIn = (
  k: WindowKey,
  ctx: CaptureContext,
): boolean => {
  const w = ctx.effectiveWindows[k];
  if (w.start == null || w.end == null) return false;
  return w.start * 60 <= ctx.nowMin && w.end * 60 > ctx.nowMin;
};

const ORDER: WindowKey[] = ['morning', 'midday', 'afternoon', 'evening'];

/**
 * Smart window placement honoring "don't put it at a passed time."
 * Returns both the chosen window AND a date — when no slot remains
 * today, the task rolls to tomorrow so it never lands stranded in
 * the past.
 *
 * ENERGY-AWARE ROUTING (the "smarter LLM" the user asked for):
 *   - HEAVY tasks (importance: 'high', "Trial") → sharp/peak window.
 *     Trials get the user's best brain. We will NOT silently dump
 *     a Trial into a slump window when peak is past today; we'd
 *     rather roll to tomorrow's peak.
 *   - EASY tasks (importance: 'low', "Whim") → slump/foggy window.
 *     This is the request's key insight: a small win during slump
 *     restarts the brain. Whims are perfect activation fodder, so
 *     we ACTIVELY route them into slump rather than just avoiding
 *     it.
 *   - MEDIUM tasks (importance: 'medium', "Task") → neutral
 *     window. Avoid peak (save for Trials) and avoid slump (save
 *     for Whims). Land in whatever is open and not a peak/slump
 *     edge.
 */
/**
 * Energy-aware placement. Routes by `demand` when provided (the LLM
 * understanding pass fills this with a semantic judgment); otherwise
 * falls back to `importance`. The deterministic call sites pass
 * importance; the LLM patch path will pass the LLM's energyDemand
 * field.
 */
const pickSmartWindow = (
  importance: Importance,
  ctx: CaptureContext,
  demand?: Importance,
): { window: WindowKey; rolledToTomorrow: boolean } => {
  // Demand wins when present — it's the better signal (semantic
  // mental load, not keyword-derived stakes).
  const routeBy: Importance = demand ?? importance;

  // ── Wind-down guard ─────────────────────────────────────────────
  //
  //  When the user is past their sleep anchor (or within ~30 min of
  //  it), forcing a windowed task onto today's already-passed
  //  windows is dishonest — the user can't realistically do it
  //  tonight. Roll to tomorrow's importance-appropriate slot so the
  //  task lands somewhere they can actually act on it.
  //
  //  This sits at the top so EVERY branch (high/medium/low) gets the
  //  same protection, rather than only the medium-branch fallback
  //  which used to return today's evening even when evening was
  //  long closed.
  if (ctx.sleepMin != null && ctx.nowMin >= ctx.sleepMin - 30) {
    const tomorrowSlot: WindowKey =
      routeBy === 'high'
        ? ctx.sharpWindow && ctx.sharpWindow !== 'someday'
          ? ctx.sharpWindow
          : 'morning'
        : routeBy === 'low'
          ? 'afternoon'
          : 'morning';
    return { window: tomorrowSlot, rolledToTomorrow: true };
  }
  // Derive the learned peak + slump windows once. Either may be null
  // if there isn't enough data yet (new account).
  const peakWindow: WindowKey | null =
    ctx.peakStart != null && ctx.peakEnd != null
      ? windowForMinutes(
          (ctx.peakStart + ctx.peakEnd) / 2,
          ctx.effectiveWindows,
        )
      : null;
  const slumpWindow: WindowKey | null =
    ctx.slumpStart != null && ctx.slumpEnd != null
      ? windowForMinutes(
          (ctx.slumpStart + ctx.slumpEnd) / 2,
          ctx.effectiveWindows,
        )
      : null;

  // ── HEAVY (Trial): peak/sharp first ──────────────────────────────
  if (routeBy === 'high') {
    // 1. User-stated sharp window if still open today.
    if (
      ctx.sharpWindow &&
      ctx.sharpWindow !== 'someday' &&
      isWindowOpenToday(ctx.sharpWindow, ctx)
    ) {
      return { window: ctx.sharpWindow, rolledToTomorrow: false };
    }
    // 2. Learned peak window if still open today.
    if (peakWindow && isWindowOpenToday(peakWindow, ctx)) {
      return { window: peakWindow, rolledToTomorrow: false };
    }
    // 3. Any non-slump open window today — refuse to land a Trial
    //    in slump or foggy, even if it's the only thing open.
    const safeToday = ORDER.find(
      (k) =>
        isWindowOpenToday(k, ctx) &&
        k !== slumpWindow &&
        k !== ctx.foggyWindow,
    );
    if (safeToday) return { window: safeToday, rolledToTomorrow: false };
    // 4. Nothing safe today — roll to tomorrow's peak/sharp slot.
    const slot: WindowKey =
      ctx.sharpWindow && ctx.sharpWindow !== 'someday'
        ? ctx.sharpWindow
        : peakWindow ?? 'morning';
    return { window: slot, rolledToTomorrow: true };
  }

  // ── EASY (Whim): slump/foggy actively preferred ─────────────────
  // Small task during low energy = brain warmup; don't waste peak on
  // these.
  if (routeBy === 'low') {
    // 1. Learned slump window — the prime spot for a Whim.
    if (slumpWindow && isWindowOpenToday(slumpWindow, ctx)) {
      return { window: slumpWindow, rolledToTomorrow: false };
    }
    // 2. User-stated foggy window.
    if (
      ctx.foggyWindow &&
      ctx.foggyWindow !== 'someday' &&
      isWindowOpenToday(ctx.foggyWindow, ctx)
    ) {
      return { window: ctx.foggyWindow, rolledToTomorrow: false };
    }
    // 3. Currently-active window — easy tasks are flexible.
    const current = ORDER.find((k) => isCurrentlyIn(k, ctx));
    if (current && isWindowOpenToday(current, ctx)) {
      return { window: current, rolledToTomorrow: false };
    }
    // 4. Any open window today.
    const open = ORDER.find((k) => isWindowOpenToday(k, ctx));
    if (open) return { window: open, rolledToTomorrow: false };
    // 5. Roll to tomorrow's slump/foggy.
    const slot: WindowKey =
      slumpWindow ??
      (ctx.foggyWindow && ctx.foggyWindow !== 'someday'
        ? ctx.foggyWindow
        : 'evening');
    return { window: slot, rolledToTomorrow: true };
  }

  // ── MEDIUM (Task): neutral — avoid both peak and slump ──────────
  // Peak is reserved for Trials, slump is reserved for Whims. Tasks
  // get the everyday in-between.
  const neutralToday = ORDER.find(
    (k) =>
      isWindowOpenToday(k, ctx) &&
      k !== peakWindow &&
      k !== slumpWindow &&
      k !== ctx.sharpWindow &&
      k !== ctx.foggyWindow,
  );
  if (neutralToday) {
    return { window: neutralToday, rolledToTomorrow: false };
  }
  // No neutral slot? Fall through to "any open today" (peak/slump
  // are acceptable if they're the only thing left).
  const current = ORDER.find((k) => isCurrentlyIn(k, ctx));
  if (current && isWindowOpenToday(current, ctx)) {
    return { window: current, rolledToTomorrow: false };
  }
  const stillToday = ORDER.find((k) => isWindowOpenToday(k, ctx));
  if (stillToday) {
    return { window: stillToday, rolledToTomorrow: false };
  }
  // No window still open today AND no window currently active. The
  // older "if before sleep, return today's evening" fallback was
  // wrong — evening's window can be closed (e.g. ended at 22:00)
  // even when we're still before the sleep anchor (e.g. 22:30 with
  // sleep at 23:30). The wind-down guard at the top already handled
  // the late-night case; if we reached here without it firing, all
  // windows are simply spoken for. Roll to tomorrow.
  return { window: 'morning', rolledToTomorrow: true };
};

const inferWindowFromContext = (
  importance: Importance,
  ctx: CaptureContext,
): WindowKey => pickSmartWindow(importance, ctx).window;

/**
 * Public wrapper around the energy-aware placer for the LLM patch
 * path. The deterministic parser picks a window from importance
 * alone; once `llmUnderstand` returns an explicit `energyDemand`,
 * Home and Capture call this to re-place the task in the slot
 * that matches the actual mental load (a high-demand task hidden
 * inside a "low importance" wrapper should land in peak, not
 * slump). Returns the new window + whether it had to roll to
 * tomorrow.
 */
export const pickWindowForDemand = (
  importance: Importance,
  demand: Importance,
  ctx: CaptureContext,
): { window: WindowKey; rolledToTomorrow: boolean } =>
  pickSmartWindow(importance, ctx, demand);

// ═════════════════════════════════════════════════════════════════════
// Split a multi-task input into fragments. Reuses the same split
// patterns as the Capture-tab makeSense so the two engines stay aligned.
// ═════════════════════════════════════════════════════════════════════
const splitFragments = (text: string): string[] =>
  text
    .replace(/\n+/g, '. ')
    .split(
      /(?:,?\s+(?:and then|and also|and|then|also|plus|oh|but|so)\b|[.;])/i,
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

// Strip parsed time/date tokens (and recurrence words) from the title
// so the human-facing title reads clean.
const stripTokens = (raw: string, tokens: string[]): string => {
  let out = raw;
  for (const tok of tokens) {
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }
  out = out
    .replace(/\bat\s+/gi, '')
    .replace(/\bon\s+/gi, '')
    .replace(/\bevery\s+\w+/gi, '')
    .replace(/\b(weekdays|weekly|daily|monthly)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  return out;
};

// ═════════════════════════════════════════════════════════════════════
// Main entry point
// ═════════════════════════════════════════════════════════════════════
export const parseSmartCapture = (
  text: string,
  ctx: CaptureContext,
): SmartTask[] => {
  const fragments = splitFragments(text);
  const tasks: SmartTask[] = [];

  for (const frag of fragments) {
    const raw = frag.trim();
    if (raw.length < 2) continue;
    const lc = ' ' + raw.toLowerCase() + ' ';

    const importance = inferImportance(lc);
    const recur = parseRecur(lc);
    const time = parseTimeAndDate(lc, ctx);
    const title = cleanTitle(stripTokens(raw, time.matched));
    if (!title) continue;

    // Decide placement.
    let timeMode: SmartTask['timeMode'];
    let at: number | null = null;
    let date: string | null = null;
    let window: WindowKey;
    let timeOptions: number[] | undefined;

    if (time.at != null) {
      // Layer 1 — explicit time given.
      timeMode = 'anchored';
      at = time.at;
      const targetDate = time.date ?? ctx.now;
      const targetIsToday = ymd(targetDate) === ymd(ctx.now);

      // ── Bare-hour disambiguation ──────────────────────────────────
      // "call at 7" with no AM/PM and no date should mean TODAY's next
      // 7 — not tomorrow's 7 AM. Users almost never type the word
      // "today"; if there's no date hint we treat the day as today.
      //   - both AM and PM still future → offer chips
      //   - AM past, PM future → use PM today (don't roll!)
      //   - both past → roll AM to tomorrow (next "7" is tomorrow AM)
      if (
        targetIsToday &&
        time.bareNoAmPm &&
        time.bareHour != null &&
        time.bareMinute != null &&
        time.bareHour >= 1 &&
        time.bareHour <= 11
      ) {
        const minute = time.bareMinute;
        const amTime = time.bareHour * 60 + minute;
        const pmTime = (time.bareHour + 12) * 60 + minute;
        const amFuture = amTime > ctx.nowMin;
        const pmFuture = pmTime > ctx.nowMin;
        if (amFuture && pmFuture) {
          // Both reachable today — offer the choice. Default to the
          // sooner of the two so a one-tap Accept feels right.
          timeOptions = [amTime, pmTime];
          at = amFuture && amTime - ctx.nowMin < pmTime - ctx.nowMin
            ? amTime
            : pmTime;
          date = ymd(targetDate);
        } else if (!amFuture && pmFuture) {
          // 7 AM is gone, 7 PM is still ahead → use PM today. THE BUG
          // FIX: this branch used to require the user say "today",
          // which nobody does. A bare hour with no date is implicitly
          // today's next 7.
          at = pmTime;
          date = ymd(targetDate);
        } else if (amFuture && !pmFuture) {
          // Unusual (very late hour reading) — keep AM today.
          at = amTime;
          date = ymd(targetDate);
        } else {
          // Both past — roll the AM reading to tomorrow.
          const rolled = new Date(ctx.now);
          rolled.setDate(rolled.getDate() + 1);
          at = amTime;
          date = ymd(rolled);
        }
      } else if (targetIsToday && at <= ctx.nowMin) {
        // Past-time guard — explicit AM/PM was given (or bare-hour
        // outside the 1–11 range), and the time has passed today.
        // Roll to tomorrow's same hour.
        const rolled = new Date(ctx.now);
        rolled.setDate(rolled.getDate() + 1);
        date = ymd(rolled);
      } else {
        date = ymd(targetDate);
      }
      window = windowForMinutes(at, ctx.effectiveWindows);
    } else if (time.windowHint) {
      // Window word given but no exact hour. If that window has
      // already ended today (and the user didn't specify a date),
      // push to tomorrow — UNLESS the user said "tonight" and is
      // still before bed (the bedtime extension).
      timeMode = 'windowed';
      window = time.windowHint;
      const stillBeforeBed =
        ctx.sleepMin != null && ctx.nowMin < ctx.sleepMin;
      if (time.date) {
        date = ymd(time.date);
      } else if (
        !isWindowOpenToday(time.windowHint, ctx) &&
        !stillBeforeBed
      ) {
        const rolled = new Date(ctx.now);
        rolled.setDate(rolled.getDate() + 1);
        date = ymd(rolled);
      } else if (stillBeforeBed) {
        // Late-night "tonight"-style hint — anchor near now so the
        // task doesn't render at the window's start hours in the past.
        const winEnd = ctx.effectiveWindows[time.windowHint].end;
        if (winEnd != null && ctx.nowMin >= winEnd * 60) {
          at = Math.min(ctx.nowMin + 15, ctx.sleepMin! - 5);
          timeMode = 'anchored';
        }
      }
    } else if (time.date) {
      // Date but no time — windowed on that date, Layer-2 placement
      // against today's rhythms (or just pick a sensible window).
      timeMode = 'windowed';
      date = ymd(time.date);
      window = inferWindowFromContext(importance, ctx);
    } else if (recur) {
      // Recurring with no explicit time — use cadence's part.
      timeMode = 'windowed';
      window = recur.part as WindowKey;
    } else {
      // Layer 2 — no time. Smart window from learned rhythms, with
      // "active period passed → use whatever's available" fallback.
      timeMode = 'windowed';
      const pick = pickSmartWindow(importance, ctx);
      window = pick.window;
      if (pick.rolledToTomorrow) {
        const rolled = new Date(ctx.now);
        rolled.setDate(rolled.getDate() + 1);
        date = ymd(rolled);
      } else {
        // Late-night "still today" pick — we're past the window's
        // nominal end (e.g. 10:30 PM, evening ends at 10 PM) but
        // before bed. Without anchoring, the task would render at
        // the window's START (5 PM) which is hours in the past.
        // Anchor near now so it lands sensibly on Time + Home.
        const winEnd = ctx.effectiveWindows[window].end;
        if (
          winEnd != null &&
          ctx.nowMin >= winEnd * 60 &&
          ctx.sleepMin != null
        ) {
          at = Math.min(ctx.nowMin + 15, ctx.sleepMin - 5);
          timeMode = 'anchored';
        }
      }
    }

    // Guided-follow-up flag — deadline-type tasks without an explicit
    // when. (Home pulls the user forward with quick chips instead of
    // silently inferring.)
    const hasExplicitWhen =
      time.at != null ||
      time.date != null ||
      time.windowHint != null ||
      recur != null;
    const needsFollowup = DEADLINE_TYPE_PATTERN.test(lc) && !hasExplicitWhen;

    tasks.push({
      title,
      importance,
      // Deterministic fallback — mirror importance into demand. The
      // LLM understanding pass overwrites this with a semantic
      // judgment ("tax paperwork" = high demand even if low stakes).
      energyDemand: importance,
      timeMode,
      at,
      date,
      window,
      recur,
      raw,
      needsFollowup,
      ...(timeOptions ? { timeOptions } : {}),
    });
  }

  // Single-fragment safety net — if splitFragments produced nothing
  // (the whole input was too short / all punctuation), treat the raw
  // input as one task. We never drop a capture (spec §1.5).
  if (tasks.length === 0 && text.trim().length > 0) {
    const raw = text.trim();
    const lc = ' ' + raw.toLowerCase() + ' ';
    const importance = inferImportance(lc);
    const time = parseTimeAndDate(lc, ctx);
    const title = cleanTitle(stripTokens(raw, time.matched)) || cap(raw);
    const hasExplicitWhen =
      time.at != null || time.date != null || time.windowHint != null;
    const needsFollowup =
      DEADLINE_TYPE_PATTERN.test(lc) && !hasExplicitWhen;
    tasks.push({
      title,
      importance,
      energyDemand: importance,
      timeMode: 'windowed',
      at: null,
      date: null,
      window: inferWindowFromContext(importance, ctx),
      recur: null,
      raw,
      needsFollowup,
    });
  }

  return tasks;
};

// ═════════════════════════════════════════════════════════════════════
// Difficulty mapping — questStore wants `difficulty` (easy/medium/hard)
// alongside `importance`. Keep them in lock-step.
// ═════════════════════════════════════════════════════════════════════
export const difficultyFromImportance = (
  imp: Importance,
): 'easy' | 'medium' | 'hard' =>
  imp === 'high' ? 'hard' : imp === 'low' ? 'easy' : 'medium';
