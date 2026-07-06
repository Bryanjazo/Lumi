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
import { COMMON_WORDS } from '../constants/commonWords';
import { type WindowKey, type WindowMeta } from '../constants/windows';
import { classifyKind, type TaskKindKey } from '../constants/taskKinds';
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
   * Semantic task kind (reach_out / errand / work / home / someday /
   * task) — the waitlist demo's beloved tags, now assigned by the
   * deterministic engine. Pure function of the text (see
   * constants/taskKinds), carried here so preview surfaces don't
   * re-derive it. Also seeds durationMinutes with the kind's
   * typical length when the user didn't give one.
   */
  kind?: TaskKindKey;
  /**
   * True when smart placement moved this task to TOMORROW (peak
   * protection / closed windows) even though the user gave no date.
   * Surfaces on the preview card so the move is never silent — the
   * user can Tweak it back to today (emotional-model: no silent
   * guessing).
   */
  rolledToTomorrow?: boolean;
  /**
   * Short freeform context the LLM extracted from the raw input
   * ("bring the charger", "the blue folder"). Persisted to Quest
   * and rendered as a subtitle so the detail isn't dropped.
   */
  note?: string;
  /**
   * Deadline vs start (goal §1.1): "by thursday / due friday /
   * before the 5th / by eod" = a DEADLINE (true); "on thursday /
   * at 3" = a start (false). Downstream can treat deadlines as
   * "no later than" instead of "do it then".
   */
  deadline?: boolean;
  /**
   * Per-field confidence, 0–1 (goal §1.6). Low confidence means the
   * parser GUESSED — surface follow-up chips / allow correction-memory
   * overrides instead of silently trusting the guess.
   *   time: 1.0 explicit clock · 0.8 window word or date · 0.6 recur
   *         cadence part · 0.35 smart-window guess
   *   importance: scales with how many scoring signals actually fired
   *   title: dinged when the cleaned title still reads long/rambly
   */
  confidence?: { title: number; time: number; importance: number };
  /**
   * Fields overridden by correction memory (lib/personalize.ts) —
   * zero-token personalization. Lets the UI whisper "placed in
   * morning, like last time" instead of looking arbitrary.
   */
  personalized?: Array<'window' | 'importance' | 'duration'>;
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
  /**
   * The user's daily anchors (minutes since midnight) — powers the
   * anchor-relative time grammar (goal §1.1): "after lunch" resolves
   * against THEIR lunch, not a hardcoded noon. Optional so old call
   * sites keep working; the grammar degrades to window hints without
   * it.
   */
  anchors?: {
    wake: number;
    breakfast: number;
    lunch: number;
    dinner: number;
    sleep: number;
  };
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
  "don'?t let me forget to",
  'do not let me forget to',
  "don'?t let me forget",
  'i keep meaning to',
  'keep meaning to',
  'i keep forgetting to',
  'make sure i',
  'make sure to',
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
  // State-of-things phrasings — "laundry is piling up" is the task
  // "Laundry", not a task titled with the complaint.
  'is piling up',
  'are piling up',
  'keeps piling up',
  'is overdue',
  'is late',
];

// ── Vent stripping ───────────────────────────────────────────────────
// Brain dumps carry feelings alongside tasks ("…by thursday it's
// stressing me out"). The feeling is real but it isn't a task title.
// VENT_TAILS strips a trailing stress clause off a fragment;
// VENT_ONLY drops fragments that are PURE vent — no action inside.
const VENT_TAILS =
  /[,\s]*\b(?:(?:it'?s|this is|which is|that'?s)\s+)?(?:really\s+)?(?:stress(?:ing|es)?\s+me(?:\s+out)?|freaking\s+me\s+out|driving\s+me\s+(?:crazy|nuts|insane)|killing\s+me|i'?m\s+(?:so\s+)?(?:stressed|overwhelmed|anxious)(?:\s+about\s+(?:it|this))?)\s*$/i;

const VENT_ONLY = [
  // NOTE the \s+ between "brain" and "is" — the alternation `(?:'?s| is)`
  // already eats the space, so a literal space after the group demanded
  // TWO spaces and silently never matched "brain is all over the place".
  /\bbrain(?:'?s|\s+is)?\s+(?:all\s+)?over the place\b/i,
  /^(?:ok(?:ay)?|ugh|whew|man|god|jeez|honestly|anyway|so yeah|yeah)$/i,
  /^never do$/i,
  /^(?:i'?m|im) (?:so )?(?:stressed|overwhelmed|tired|anxious|behind)(?: out)?$/i,
  /^it'?s stressing me(?: out)?$/i,
  /^(?:so\s+)?(?:yeah\s+)?wish me luck$/i,
];

// ── Status → task templates (goal §1.4) ─────────────────────────────
// "laundry is piling up" isn't a task titled with the complaint — the
// TASK is "Do laundry". Pattern templates turn state-of-the-world
// statements into clean imperatives, zero tokens. Applied to the raw
// fragment BEFORE title cleaning; also used by the splitter to know a
// clause stands on its own ("…, laundry is piling up," has no verb
// but is definitely its own task).
const STATUS_RULES: Array<{ re: RegExp; make: (s: string) => string }> = [
  {
    re: /^(?:the\s+|my\s+)?(.+?)\s+(?:is|are|keeps?)\s+piling\s+up\b.*$/i,
    make: (s) => `Do ${s}`,
  },
  {
    re: /^(?:the\s+|my\s+)?(.+?)\s+(?:is|are)\s+(?:such\s+)?(?:a\s+)?(?:total\s+|complete\s+)?mess(?:y)?\b.*$/i,
    make: (s) => `Clean the ${s}`,
  },
  {
    // Overdue things: bills get "Pay", everything else "Sort out".
    re: /^(?:the\s+|my\s+)?(.+?)\s+(?:is|are)\s+(?:over\s?due|past\s+due)\b.*$/i,
    make: (s) =>
      /\b(rent|bill|invoice|payment|fee|tax(?:es)?|loan|card|subscription|dues)\b/i.test(
        s,
      )
        ? `Pay ${s}`
        : `Sort out ${s}`,
  },
  {
    re: /^(?:the\s+|my\s+)?(.+?)\s+needs?\s+(?:doing|to\s+be\s+done)\b.*$/i,
    make: (s) => `Do the ${s}`,
  },
  {
    re: /^(?:the\s+|my\s+)?(.+?)\s+needs?\s+(?:cleaning|a\s+(?:good\s+)?clean)\b.*$/i,
    make: (s) => `Clean the ${s}`,
  },
  {
    re: /^(?:the\s+|my\s+)?(.+?)\s+needs?\s+washing\b.*$/i,
    make: (s) => `Wash the ${s}`,
  },
  {
    re: /^(?:the\s+|my\s+)?(.+?)\s+(?:is|are)\s+(?:getting\s+)?(?:really\s+|so\s+)?(?:dirty|filthy|gross)\b.*$/i,
    make: (s) => `Clean the ${s}`,
  },
  {
    re: /^(?:i'?m|i am|we'?re|we are)\s+(?:almost\s+|nearly\s+)?out\s+of\s+(.+)$/i,
    make: (s) => `Buy ${s}`,
  },
];

const applyStatusTemplate = (raw: string): string => {
  for (const { re, make } of STATUS_RULES) {
    const m = raw.match(re);
    if (m) return make(m[1].trim());
  }
  return raw;
};

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
  // Collapse the double spaces filler removal leaves behind BEFORE
  // prefix matching — "i really need to" → "i  need to" otherwise
  // fails the single-space "i need to" prefix and survives into the
  // title.
  t = t.replace(/\s{2,}/g, ' ').trim();

  // Location hints read as errand context, not title material —
  // "pick up dog food on the way home" is "Pick up dog food". The
  // "on" is optional because stripTokens aggressively removes "on "
  // before this runs.
  t = t.replace(
    /\b(?:on )?(?:the|my) way (?:home|back|there|in|out|over)\b/gi,
    '',
  );

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

  // ── Strip dangling trailing prepositions/qualifiers left by token
  // removal ("finish the report by <thursday>" → "…report by" →
  // "…report"; "groceries this <weekend>" → "…this" → "groceries").
  // The + quantifier collapses stacked leftovers ("…by the" → "").
  t = t.replace(
    /(?:\s+(?:by|on|at|in|for|to|before|after|until|till|this|next|the|a|an))+\s*$/i,
    '',
  );

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

// Weighted signals (goal §1.3) — a SCORE, not first-keyword-wins.
// "study for the biology exam" is high because stakes (+2) AND an
// effort verb (+1) stack; "grab paper towels" is low because a quick
// verb (−1) pulls it down. Date words ("today"/"tonight") stay out —
// they're timing hints, not difficulty hints.
const STAKES_RE =
  /\b(asap|urgent|due|deadline|important|overdue|critical|report|submit|present|presentation|interview|exam|midterm|final|quiz|tax(?:es)?|rent|mortgage|bill|invoice|payment|insurance|visa|passport|application|apply|essay|thesis|deliverable|license|registration|lease|contract|court|flight|prescription)\b/;
const EFFORT_RE =
  /\b(finish|write|prepare|prep|study|draft|build|deep clean|pack for|research|plan out|rehearse|practice for)\b/;
const QUICK_RE =
  /\b(call|text|email|message|reply|grab|buy|pick up|order|swing by|drop off|send|water|feed)\b/;
const LOW_RE =
  /\b(someday|maybe|eventually|sometime|could|might|read|watch|browse|article|video|movie|podcast|skim|look at|no rush|no hurry|whenever|optional|low priority|not urgent)\b/;

const scoreImportance = (
  lc: string,
  bonus = 0,
): { tier: Importance; score: number; signals: number } => {
  let score = bonus;
  let signals = bonus !== 0 ? 1 : 0;
  const hit = (re: RegExp, delta: number) => {
    if (re.test(lc)) {
      score += delta;
      signals++;
    }
  };
  hit(STAKES_RE, 2);
  hit(EFFORT_RE, 1);
  hit(QUICK_RE, -1);
  hit(LOW_RE, -2);
  // Duration hints nudge the scale ("all day" vs "real quick").
  hit(/\b(all day|all[- ]?nighter|big|huge|massive)\b/, 1);
  hit(/\b(quick(?:ly)?|real quick|tiny|small|little)\b/, -1);
  const tier: Importance =
    score >= 2 ? 'high' : score <= -1 ? 'low' : 'medium';
  return { tier, score, signals };
};

const inferImportance = (lc: string, bonus = 0): Importance =>
  scoreImportance(lc, bonus).tier;

// ═════════════════════════════════════════════════════════════════════
// Recurrence parser — "every monday", "weekly", "daily".
// ═════════════════════════════════════════════════════════════════════
const parseRecur = (lc: string): RecurRule | null => {
  // ── Richer cadences FIRST (goal §1.1) — these all contain simpler
  // patterns as substrings ("every other tuesday" contains a weekday;
  // "every 3 days" must not fall through to a plain match).
  const otherDay = lc.match(
    /\bevery\s+other\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/,
  );
  if (otherDay) {
    const dow = DAY_FULL[otherDay[1]];
    if (dow != null) {
      return { every: '2week', day: DAY_RECUR_KEY[dow], part: 'midday' };
    }
  }
  if (/\bevery\s+other\s+week\b|\bbiweekly\b|\bfortnightly\b/.test(lc)) {
    return { every: '2week', part: 'midday' };
  }
  // "twice/three times a week" — the recur model can't hold N-per-
  // week yet, so land on weekly (visible in the preview, one tap to
  // adjust) instead of silently making a one-off.
  if (/\b(?:twice|two times|three times|\d+\s*x)\s+(?:a|per)\s+week\b/.test(lc)) {
    return { every: 'week', part: 'midday' };
  }
  if (/\bevery\s+other\s+day\b/.test(lc)) {
    return { every: 'day', interval: 2, part: 'midday' };
  }
  const everyN = lc.match(/\bevery\s+(\d+)\s+(days?|weeks?|months?)\b/);
  if (everyN) {
    const n = Math.max(1, parseInt(everyN[1], 10));
    const unit = everyN[2];
    if (/^day/.test(unit)) {
      return n === 1
        ? { every: 'day', part: 'midday' }
        : { every: 'day', interval: n, part: 'midday' };
    }
    if (/^week/.test(unit)) {
      if (n === 1) return { every: 'week', part: 'midday' };
      if (n === 2) return { every: '2week', part: 'midday' };
      return { every: 'week', interval: n, part: 'midday' };
    }
    return n === 1
      ? { every: 'month', part: 'midday' }
      : { every: 'month', interval: n, part: 'midday' };
  }
  // "first monday of the month" → monthly on that day.
  const firstDow = lc.match(
    /\b(?:every\s+)?first\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+of\s+(?:the\s+|every\s+)?month\b/,
  );
  if (firstDow) {
    const dow = DAY_FULL[firstDow[1]];
    if (dow != null) {
      return { every: 'month', day: DAY_RECUR_KEY[dow], part: 'midday' };
    }
  }
  // "every weekend" / "on weekends" — weekly, anchored to Saturday.
  if (/\bevery\s+weekend\b|\bweekends\b/.test(lc)) {
    return { every: 'week', day: 'Sat', part: 'midday' };
  }
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
  /**
   * True when the when-phrase reads as a DEADLINE ("by thursday",
   * "due friday", "by eod") rather than a start ("on thursday").
   */
  deadline?: boolean;
  /** Explicit inline length ("for 30 min", "1-hour call"). */
  durationMin?: number;
}

// Shorthand → canonical phrase (goal §1.1). Detection runs on the
// canonical form; the shorthand itself is pushed into `matched` so it
// still gets stripped from the visible title.
const TIME_SYNONYMS: Array<[RegExp, string]> = [
  // t + any jumble of m/r/w ("tmrw", "tmmrw", "tmw", "tmrrw" — no
  // real English word is t followed by only those letters), classic
  // typo spellings, and the "2moro" texting family.
  // t + any jumble of o/m/r/w, 5-9 letters total — covers tomrrw,
  // tomorow, tommorrow, tmmrw AND plain tomorrow (harmless self-
  // replace). No common English word fits t[omrw]{4,} ("toro"/"trow"
  // are 4 letters and stay under the minimum); plurals stay
  // untouched because 's' breaks the match. Short texting forms are
  // explicit.
  [
    /\bt[omrw]{4,8}\b|\btmrw\b|\btmr\b|\btmw\b|\b2m(?:o?rr?ow?|oro|rw)\b/g,
    'tomorrow',
  ],
  [
    /\bnxt\s+(week|month|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g,
    'next $1',
  ],
  // "a couple/few/several hours" → numeric so every downstream
  // relative-time pattern just works. Unit-anchored so quantities in
  // titles ("grab a few beers") stay untouched.
  [
    /\ba couple(?: of)?\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/g,
    '2 $1',
  ],
  [
    /\b(?:a few|several)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/g,
    '3 $1',
  ],
  [/\bthis coming\s+/g, 'this '],
  [/\btonite\b/g, 'tonight'],
  [/\bwknds?\b/g, 'weekend'],
  [/\beod\b/g, 'end of day'],
  [/\beow\b/g, 'end of week'],
  [/\beom\b/g, 'end of month'],
];

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseTimeAndDate = (lc: string, ctx: CaptureContext): ParsedTime => {
  const matched: string[] = [];
  let date: Date | null = null;
  let at: number | null = null;
  let windowHint: WindowKey | null = null;
  let deadline = false;

  // ── Normalize shorthand ("tmrw", "eod") to canonical phrases. The
  // shorthand found in the raw text goes into `matched` so stripTokens
  // can remove it from the title.
  for (const [re, canon] of TIME_SYNONYMS) {
    const found = lc.match(re);
    if (found) {
      for (const f of found) matched.push(f);
      lc = lc.replace(re, canon);
    }
  }

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

  // ── Relative dates: "in 3 days / in 2 weeks / in a month" ──
  const inRel = lc.match(
    /\bin\s+(a|an|one|two|three|four|five|six|seven|\d+)\s+(days?|weeks?|months?)\b/,
  );
  if (inRel && !date) {
    const NUM_WORDS: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    };
    const n = NUM_WORDS[inRel[1]] ?? parseInt(inRel[1], 10);
    const unit = inRel[2];
    date = new Date(ctx.now);
    date.setHours(0, 0, 0, 0);
    if (/^day/.test(unit)) date.setDate(date.getDate() + n);
    else if (/^week/.test(unit)) date.setDate(date.getDate() + n * 7);
    else date.setMonth(date.getMonth() + n);
    matched.push(inRel[0]);
  }

  // ── "this week" / "next week" — "this week" reads as a soft
  // deadline (by Sunday); "next week" starts Monday of next week.
  // \bweek\b can't match inside "weekend", so no collision below.
  const weekRel = lc.match(/\b(this|next)\s+week\b/);
  if (weekRel && !date) {
    if (weekRel[1] === 'next') {
      const sunday = nextDayOfWeek(ctx.now, 0); // start of next week
      date = new Date(sunday);
      date.setDate(date.getDate() + 1); // its Monday
    } else {
      date = nextDayOfWeek(ctx.now, 0); // upcoming Sunday
      deadline = true;
    }
    matched.push(weekRel[0]);
  }

  // ── "this weekend" / "next weekend" — the upcoming Saturday (today
  // if it IS the weekend), one more week out for "next". Skip when
  // it's a recurrence ("every weekend").
  if (!/\bevery\s+weekend\b|\bweekends\b/.test(lc)) {
    const wk = lc.match(/\b(?:(this|next)\s+)?weekend\b/);
    if (wk && !date) {
      const isWeekendNow = ctx.now.getDay() === 6 || ctx.now.getDay() === 0;
      date =
        isWeekendNow && wk[1] !== 'next'
          ? new Date(ctx.now)
          : nextDayOfWeek(ctx.now, 6);
      date.setHours(0, 0, 0, 0);
      if (wk[1] === 'next') date.setDate(date.getDate() + 7);
      matched.push(wk[0].trim());
    }
  }

  // ── "end of day / week / month", "first of the month", "mid-month".
  // The end-of family reads as a DEADLINE ("by end of week").
  if (/\bend of (?:the )?day\b/.test(lc)) {
    if (!date) date = new Date(ctx.now);
    if (!windowHint) windowHint = 'evening';
    deadline = true;
    matched.push('end of day', 'end of the day');
  } else if (/\bend of (?:the )?week\b/.test(lc)) {
    if (!date) date = nextDayOfWeek(ctx.now, 0); // upcoming Sunday
    deadline = true;
    matched.push('end of week', 'end of the week');
  } else if (/\bend of (?:the )?month\b/.test(lc)) {
    if (!date) {
      date = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, 0);
    }
    deadline = true;
    matched.push('end of month', 'end of the month');
  } else if (/\b(?:the\s+)?first of the month\b/.test(lc) && !date) {
    date = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, 1);
    matched.push('the first of the month', 'first of the month');
  } else if (/\bmid[- ]?month\b/.test(lc) && !date) {
    const mm =
      ctx.now.getDate() < 15
        ? new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 15)
        : new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, 15);
    date = mm;
    matched.push('mid-month', 'mid month', 'midmonth');
  }

  // ── Ordinal day-of-month: "by the 5th", "on the 23rd" ──
  const ord = lc.match(
    /\b(?:on|by|before|until|till|due)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/,
  );
  if (ord && !date) {
    const dayNum = parseInt(ord[1], 10);
    if (dayNum >= 1 && dayNum <= 31) {
      const thisMonth = new Date(
        ctx.now.getFullYear(),
        ctx.now.getMonth(),
        dayNum,
      );
      date =
        dayNum > ctx.now.getDate()
          ? thisMonth
          : new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, dayNum);
      if (/^(?:by|before|until|till|due)/.test(ord[0])) deadline = true;
      matched.push(ord[0]);
    }
  }

  // Day of week — only the FIRST match (avoid grabbing the recurrence
  // "every monday" twice). Skip if "every <day>" already parsed.
  // "this friday" = the coming one; "next friday" = the one after,
  // ── "a week from friday" / "two weeks from monday" ──
  const weekFrom = lc.match(
    /\b(a|one|two|three|four|\d+)\s+weeks?\s+from\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (weekFrom && !date) {
    const dow = DAY_FULL[weekFrom[2]];
    if (dow != null) {
      const nRaw = weekFrom[1];
      const n =
        nRaw === 'a' || nRaw === 'one'
          ? 1
          : nRaw === 'two'
            ? 2
            : nRaw === 'three'
              ? 3
              : nRaw === 'four'
                ? 4
                : parseInt(nRaw, 10) || 1;
      date = nextDayOfWeek(ctx.now, dow);
      date.setDate(date.getDate() + 7 * n);
      matched.push(weekFrom[0]);
    }
  }

  // when the plain next occurrence still falls in THIS calendar week.
  if (!/\bevery\s+\w+/.test(lc)) {
    const dowMatch = lc.match(
      /\b(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/,
    );
    if (dowMatch && !date) {
      const dow = DAY_FULL[dowMatch[2]];
      if (dow != null) {
        date = nextDayOfWeek(ctx.now, dow);
        if (dowMatch[1] === 'next') {
          // If the plain occurrence lands within this calendar week
          // (Sunday-start), "next X" means a week further out.
          const endOfWeek = new Date(ctx.now);
          endOfWeek.setHours(0, 0, 0, 0);
          endOfWeek.setDate(endOfWeek.getDate() + (6 - ctx.now.getDay()));
          if (date.getTime() <= endOfWeek.getTime()) {
            date.setDate(date.getDate() + 7);
          }
        }
        matched.push(dowMatch[0]);
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

  let bareHour: number | undefined;
  let bareNoAmPm: boolean | undefined;
  let bareMinute: number | undefined;

  // ── "half past 2" / "quarter to 3" / "quarter past 9" ──
  if (at == null) {
    const hq = lc.match(/\b(?:at\s+)?(half|quarter)\s+(past|to)\s+(\d{1,2})\b/);
    if (hq) {
      let h = parseInt(hq[3], 10) % 24;
      let m = hq[1] === 'half' ? 30 : hq[2] === 'past' ? 15 : 45;
      if (hq[1] === 'quarter' && hq[2] === 'to') h = (h + 23) % 24;
      if (hq[1] === 'half' && hq[2] === 'to') {
        h = (h + 23) % 24; // "half to 3" (rare) = 2:30
      }
      // Everyday-speech default: small bare hours mean PM.
      if (h >= 1 && h <= 6 && !/\b(morning|am|breakfast|wake)\b/.test(lc)) {
        h += 12;
      }
      at = h * 60 + m;
      matched.push(hq[0]);
    }
  }

  // ── Fuzzy clock: "around 3", "about 4pm", "3ish" — the intent is a
  // time, just soft. Parse it; confidence stays lower via bareNoAmPm.
  if (at == null) {
    const fz =
      lc.match(/\b(?:around|about|~)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ??
      lc.match(/\b(\d{1,2})\s*ish\b/);
    if (fz) {
      let h = parseInt(fz[1], 10);
      const m = fz[2] ? parseInt(fz[2], 10) : 0;
      const ap = fz[3];
      if (h >= 0 && h <= 23 && m >= 0 && m < 60) {
        if (ap === 'pm' && h < 12) h += 12;
        else if (ap === 'am' && h === 12) h = 0;
        else if (!ap && h >= 1 && h <= 6 && !/\b(morning|am|breakfast|wake)\b/.test(lc)) {
          h += 12;
        }
        bareHour = h % 24;
        bareMinute = m;
        bareNoAmPm = !ap;
        at = (h % 24) * 60 + m;
        matched.push(fz[0]);
      }
    }
  }

  // ── Explicit clock time ──
  // "at 2", "at 2pm", "2pm", "14:00", "2:30 pm"
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

  // ── Anchor-relative times (goal §1.1) — "after lunch" resolves
  // against the USER's lunch anchor, not a hardcoded noon. This is a
  // deterministic superpower: zero tokens, personally correct.
  const anch = lc.match(/\b(after|before)\s+(breakfast|lunch|dinner|work)\b/);
  if (anch && at == null) {
    const rel = anch[1];
    const which = anch[2];
    if (which === 'work') {
      // No work anchor exists — "after work" = the evening window,
      // "before work" = the morning window.
      windowHint = rel === 'after' ? 'evening' : 'morning';
    } else if (ctx.anchors) {
      const anchorMin =
        ctx.anchors[which as 'breakfast' | 'lunch' | 'dinner'];
      // After a meal: +15 min buffer. Before: −30 so it FINISHES by then.
      const rawAt = rel === 'after' ? anchorMin + 15 : anchorMin - 30;
      at = Math.max(0, Math.min(24 * 60 - 1, rawAt));
    } else {
      // No anchors known — degrade to the meal's part of day.
      windowHint =
        which === 'breakfast'
          ? 'morning'
          : which === 'lunch'
            ? 'midday'
            : 'evening';
    }
    matched.push(anch[0]);
  }

  // ── noon / midnight ──
  if (at == null && /\bnoon\b/.test(lc)) {
    at = 12 * 60;
    matched.push('noon');
  } else if (at == null && /\bmidnight\b/.test(lc)) {
    at = 23 * 60 + 59;
    if (!windowHint) windowHint = 'evening';
    matched.push('midnight');
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

  // ── Deadline vs start (goal §1.1) — "by/due <token>" marks the
  // matched date as a deadline, not a start time. Adjacency check so
  // "stop by the store tomorrow" (by ≠ by-tomorrow) stays a start.
  if (!deadline && (date != null || at != null)) {
    deadline = matched.some((tok) =>
      new RegExp(
        `\\b(?:by|due(?:\\s+on|\\s+by)?|no later than)\\s+(?:the\\s+)?${escapeRe(tok)}`,
        'i',
      ).test(lc),
    );
  }

  // ── Inline durations (A7): "for 30 minutes", "1-hour call",
  // "quick 15 min sync", "hour-long", "half-hour". EXPLICIT lengths
  // only — never guessed from task type (that stays the kind
  // default). Skips "in 30 minutes" (that's a start time, matched
  // above).
  let durationMin: number | undefined;
  const durFor =
    lc.match(/\bfor\s+(\d{1,3})\s*(?:minutes?|mins?)\b/) ??
    lc.match(/\bfor\s+(\d{1,2})\s*(?:hours?|hrs?)\b/);
  if (durFor) {
    const n = parseInt(durFor[1], 10);
    durationMin = /hour|hr/.test(durFor[0]) ? n * 60 : n;
    matched.push(durFor[0]);
  } else if (/\bfor\s+half\s+an?\s+hour\b/.test(lc)) {
    durationMin = 30;
    matched.push('for half an hour', 'for half a hour');
  } else if (/\bfor\s+an?\s+hour\b/.test(lc)) {
    durationMin = 60;
    matched.push('for an hour', 'for a hour');
  } else {
    // Adjective forms — guard against "in 15 minutes" (start time).
    const adj =
      lc.match(/\b(\d{1,3})[- ](?:minute|min)\b/) ??
      lc.match(/\b(\d{1,2})[- ]hour\b/);
    if (adj && !new RegExp(`\\bin\\s+${adj[1]}\\b`).test(lc)) {
      const n = parseInt(adj[1], 10);
      durationMin = /hour/.test(adj[0]) ? n * 60 : n;
      matched.push(adj[0]);
    } else if (/\bhour[- ]long\b/.test(lc)) {
      durationMin = 60;
      matched.push('hour-long', 'hour long');
    } else if (/\bhalf[- ]hour\b/.test(lc)) {
      durationMin = 30;
      matched.push('half-hour', 'half hour');
    }
  }
  if (durationMin != null) {
    durationMin = Math.max(5, Math.min(720, durationMin));
  }

  return {
    date,
    at,
    windowHint,
    matched,
    bareHour,
    bareNoAmPm,
    bareMinute,
    deadline,
    ...(durationMin != null ? { durationMin } : {}),
  };
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
// ── Verb lexicon (goal §1.2) — a comma/"and" clause only stands on
// its own when it carries its own verb. "pick up coffee beans and dog
// food" (one verb) stays ONE task; "call the dentist and pay the
// bill" (two verbs) splits into TWO.
const VERB_RE =
  /\b(?:call|text|email|message|reply|respond|buy|get|grab|pick|order|book|schedule|reschedule|cancel|pay|send|submit|finish|start|begin|write|draft|read|review|study|clean|tidy|organize|wash|fold|vacuum|mop|dust|cook|bake|prep|make|plan|fix|repair|water|feed|walk|run|take|bring|drop|return|renew|sign|fill|apply|research|check|update|upload|download|install|backup|charge|print|scan|practice|exercise|stretch|meditate|journal|work|go|visit|attend|meet|prepare|pack|unpack|empty|shop|register|do|hang|move|clear|wrap|mail|ship|deposit|transfer|budget|file|shower|sort|figure|set up|put away|swing by|follow up|look into|deal with|drop off|pick up|back up)\b/i;

// Signals that a verbless clause is still its OWN thought — a date
// fact ("mom's birthday is next weekend") or a recurrence.
const CLAUSE_DATEISH =
  /\b(?:today|tomorrow|tmrw|tonight|tonite|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|wknd|next week|nxt week|this week|next month|noon|midnight|eod|eow|eom|every|daily|weekly|monthly|at \d|due\b|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i;

// A clause introduced by a soft separator (comma / "and") stands
// alone if it's vent (so it can be dropped), a status statement, has
// its own verb, carries a date, or is long enough to be its own
// thought. Otherwise it's a noun continuation of the previous clause.
const standsAlone = (clause: string): boolean => {
  if (VENT_ONLY.some((re) => re.test(clause))) return true;
  if (STATUS_RULES.some((r) => r.re.test(clause))) return true;
  if (VERB_RE.test(clause)) return true;
  if (CLAUSE_DATEISH.test(clause)) return true;
  return clause.split(/\s+/).length > 6;
};

// ── Self-corrections (goal: speak naturally, land right) ────────────
// "call mom— no wait, call dad" must produce ONE task: "Call dad".
// The marker splits a clause into head (abandoned) and tail (meant).
// If the tail carries its own verb it simply replaces the head; if
// it's just the corrected object ("buy milk no wait oat milk"), we
// keep the head's verb and swap the object: "buy oat milk".
const CORRECTION_RE =
  /\s*(?:,\s*)?\b(?:no,? wait|wait,? no|scratch that|actually,? make (?:that|it)|no,? actually|i mean)\b[,.]?\s+/i;

const applySelfCorrection = (fragment: string): string => {
  const m = fragment.match(CORRECTION_RE);
  if (!m || m.index == null) return fragment;
  const head = fragment.slice(0, m.index).trim();
  // Recurse so chained corrections keep only the final intent.
  const tail = applySelfCorrection(
    fragment.slice(m.index + m[0].length).trim(),
  );
  if (!tail) return head;
  if (!head) return tail;
  if (VERB_RE.test(tail)) return tail; // full restatement wins
  // Object-only correction: keep the head's verb (+ particle), swap
  // the rest. "buy milk" + "oat milk" → "buy oat milk".
  const vm = head.match(VERB_RE);
  if (vm && vm.index != null) {
    let end = vm.index + vm[0].length;
    const after = head.slice(end);
    const particle = after.match(/^\s+(?:up|out|off|on|in|back|over)\b/i);
    if (particle) end += particle[0].length;
    return `${head.slice(0, end).trim()} ${tail}`.trim();
  }
  return tail;
};

const INTENT_START =
  /^(?:don'?t let me forget|remember to\b|i keep meaning to)/i;

// One capture group so split() hands back the separators — merging a
// noun continuation needs the original joiner (", and " vs " and ").
const SPLIT_SEP =
  /(,?\s+(?:and then|and also|oh and|and|then|also|plus|but)\s+|,?\s*(?=don'?t let me forget|remember to |i keep meaning to )|\s*[.;]\s*|\s*[—–]\s*|\s+-\s+|\s*,\s*)/i;

const CORRECTION_GLUE =
  /[,;]?\s*\b(no,? wait|wait,? no|scratch that|actually,? make (?:that|it)|no,? actually|i mean)\b[,.;]?\s*/gi;

// ── Run-on subdivision (unpunctuated typing) ───────────────────────
// "call mom buy milk finish the report" has no separators, so the
// splitter sees ONE fragment. Subdivide at verb boundaries: a new
// lexicon verb starts a new task — UNLESS the previous word marks it
// as part of the same clause ("to call", "a quick walk", "go get").
// Conservative on purpose: each piece must keep >=2 words and its
// own verb; anything ambiguous stays whole (the LLM path handles it
// when available — this is the deterministic floor).
const RUNON_GUARD_PREV =
  /^(?:to|and|or|then|also|just|go|gonna|please|a|an|the|this|that|my|your|our|his|her|their|i|you|we|they|will|would|wanna|can|can'?t|should|don'?t|must|lets|let'?s|me|quick|long|short|big|small|little|deep|fast|slow|daily|nice|good|morning|evening|really|finally)$/i;

const splitRunOn = (frag: string): string[] => {
  const words = frag.split(/\s+/).filter(Boolean);
  if (words.length < 4) return [frag];
  const pieces: string[] = [];
  let start = 0;
  let verbsInPiece = 0;
  for (let i = 0; i < words.length; i++) {
    const token = words[i].replace(/[^\w'']/g, '');
    const isVerb = token.length > 1 && VERB_RE.test(token);
    if (
      isVerb &&
      i > start &&
      verbsInPiece >= 1 &&
      i - start >= 2 &&
      words.length - i >= 2 &&
      !RUNON_GUARD_PREV.test(words[i - 1].replace(/[^\w'']/g, '')) &&
      !/[''']s$/i.test(words[i - 1]) // possessive → "sarah's email" is a noun
    ) {
      pieces.push(words.slice(start, i).join(' '));
      start = i;
      verbsInPiece = 1;
      continue;
    }
    if (isVerb) verbsInPiece++;
  }
  pieces.push(words.slice(start).join(' '));
  return pieces;
};

const splitFragments = (text: string): string[] => {
  // Fuse correction markers to their neighbors BEFORE splitting so
  // "buy milk, no wait, oat milk" stays one fragment (one task, one
  // deterministic fix, zero tokens) instead of three.
  const fused = text.replace(CORRECTION_GLUE, ' $1 ');
  // Bullet / numbered-list markers are hard separators, and their
  // symbols must never leak into titles ("1) Email sarah").
  const debulleted = fused
    .replace(/(?:^|\n)\s*(?:[-•*·▪◦]|\d{1,2}[.)])\s+/g, '\n')
    .replace(/\s+\d{1,2}\)\s+/g, '. ')
    .replace(/\s*[•▪◦]\s*/g, '. ');
  const parts = debulleted.replace(/\n+/g, '. ').split(SPLIT_SEP);
  const frags: string[] = [];
  let current = (parts[0] ?? '').trim();
  for (let i = 1; i < parts.length; i += 2) {
    const sep = parts[i] ?? '';
    const clause = (parts[i + 1] ?? '').trim();
    if (!clause) continue;
    // Sentence boundaries, dashes, and mid-string intent markers
    // ALWAYS split; soft separators split only when the clause
    // stands on its own (the verb heuristic).
    const hard =
      /[.;—–]/.test(sep) || /\s-\s/.test(sep) || INTENT_START.test(clause);
    if (hard || standsAlone(clause)) {
      if (current) frags.push(current);
      current = clause;
    } else {
      // Noun continuation ("…and dog food", "…, milk") — same task.
      const t = sep.replace(/\s+/g, ' ').trim(); // ',' | ', and' | 'and'
      const joiner = t.startsWith(',')
        ? t.length > 1
          ? `${t} `
          : ', '
        : ` ${t} `;
      current = current ? `${current}${joiner}${clause}` : clause;
    }
  }
  if (current) frags.push(current);
  return (
    frags
      // Corrections resolve BEFORE run-on subdivision — otherwise
      // "call mom no wait call dad" splits at the second verb into
      // two tasks instead of collapsing to the corrected one.
      .map(applySelfCorrection)
      .flatMap(splitRunOn)
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
  );
};

/**
 * Complexity signal (goal §1.2 cap + §2.1 routing gate). A 1–2
 * fragment capture is deterministic territory; a 12-clause monster
 * with feelings woven through is LLM territory. One source of truth
 * so the splitter and the routing gate can never disagree.
 */
export type CaptureComplexity = 'simple' | 'multi' | 'complex';
export const assessComplexity = (text: string): CaptureComplexity => {
  const frags = splitFragments(text);
  if (frags.length >= 6 || text.length > 240) return 'complex';
  if (frags.length > 1) return 'multi';
  return 'simple';
};

// ═════════════════════════════════════════════════════════════════════
// The routing gate (goal §2.1) — when NOT to call the LLM.
//
// Runs AFTER the deterministic parse (which is the prior + guaranteed
// fallback either way, §2.2) and decides whether the LLM would
// genuinely add understanding. "clean car" / "gym at 6" → the local
// result ships instantly, free, no spinner. Multi-task dumps, long
// rambles, and emotional language → the LLM earns its tokens.
//
// Single source of truth: reuses the §1.1/§1.2 signals (fragment
// count, per-field confidence) so the gate automatically keeps MORE
// local as the grammar grows.
// ═════════════════════════════════════════════════════════════════════
const EMOTIONAL_RE =
  /\b(stress(?:ed|ing|es)?|overwhelm\w*|anxious|anxiety|dread(?:ed|ing)?|avoid(?:ed|ing)\w*|hate|scared|panic\w*|freaking|ugh|exhaust\w*|behind on everything|drowning|spiral\w*)\b/i;

export interface CaptureRoute {
  route: 'local' | 'llm';
  /** Why — feeds the metrics log so tuning is real (§2.5). */
  reason: string;
}

export const routeCapture = (
  text: string,
  detTasks: SmartTask[],
): CaptureRoute => {
  const t = text.trim();
  // True multi-task ALWAYS goes to the LLM (spec §2.1) — splitting a
  // dump wrong is the costliest mistake, so the specialist handles it.
  const complexity = assessComplexity(t);
  if (complexity !== 'simple') return { route: 'llm', reason: complexity };
  // Long single-fragment rambles carry context a regex can't hold.
  if (t.length > 90) return { route: 'llm', reason: 'long' };
  // Emotional language signals task WEIGHT the LLM reads better.
  if (EMOTIONAL_RE.test(t)) return { route: 'llm', reason: 'emotional' };
  const parsed = detTasks[0];
  if (!parsed) return { route: 'llm', reason: 'no-parse' };
  // A rambly leftover title means cleaning failed — let the LLM try.
  if ((parsed.confidence?.title ?? 0.9) < 0.7) {
    return { route: 'llm', reason: 'messy-title' };
  }
  // Note: guessed timing / AM-PM ambiguity are NOT LLM reasons — the
  // deterministic path resolves those with tappable chips (§1.6),
  // which beats a model guess anyway.
  return { route: 'local', reason: 'clean-single' };
};

// Strip parsed time/date tokens (and recurrence words) from the title
// so the human-facing title reads clean.
const stripTokens = (raw: string, tokens: string[]): string => {
  let out = raw;
  // Recurrence phrasings FIRST — before single-token strips can punch
  // holes in them ("every morning" with "morning" already removed
  // becomes "every  do…", and a greedy `every \w+` strip would then
  // eat the verb).
  out = out
    .replace(/\bevery\s+other\s+\w+\b/gi, '')
    .replace(/\bevery\s+\d+\s+(?:days?|weeks?|months?)\b/gi, '')
    .replace(
      /\bevery\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|day|morning|evening|night|afternoon|week|weekday|weekend|month)s?\b/gi,
      '',
    )
    // NOTE: "weekends" (plural only) — the singular "weekend" is a
    // DATE word ("this weekend"), and stripping it here ran before
    // the token loop, orphaning the qualifier ("groceries this
    // weekend" → "Groceries this").
    .replace(
      /\b(?:weekdays?|weekends|weekly|daily|monthly|biweekly|fortnightly|(?:twice|two times|three times)\s+(?:a|per)\s+week)\b/gi,
      '',
    );
  for (const tok of tokens) {
    const escaped = escapeRe(tok.trim());
    if (!escaped) continue;
    // Take the preposition/article that introduced the token with it
    // ("finish it BY thursday", "run IN THE morning") — a global
    // "strip every at/on" mangled titles like "work ON the side
    // project", so the strip is now anchored to the token.
    out = out
      .replace(
        new RegExp(
          `\\b(?:at|on|by|in|until|till|due|for)\\s+(?:the\\s+)?${escaped}\\b`,
          'gi',
        ),
        '',
      )
      .replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }
  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*(?=,)/g, '')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  return out;
};

// ═════════════════════════════════════════════════════════════════════
// Transcript tidy + "did you mean" (goal: soft-confirm garbled voice
// BEFORE any parse — the LLM never has to guess, and a confirmed
// clean transcript often routes local instead of paying tokens).
// ═════════════════════════════════════════════════════════════════════
export interface TidiedTranscript {
  /** Cleaned text — stutters deduped, edge fillers trimmed. */
  tidied: string;
  /** The tidy actually changed something (beyond whitespace). */
  changed: boolean;
  /** The transcript looks OFF — cut short, dangling, or gibberish.
   *  Callers should show "did you mean this?" instead of parsing. */
  suspicious: boolean;
}

const GIBBERISH_TOKEN_RE = /^[^aeiouy\s]{4,}$/i; // no-vowel consonant runs

// Known ASR mishears of DATE words in trailing position ("call emori
// tomato" = "…tomorrow"). Trailing-only + guarded so real groceries
// survive ("buy tomato" stays a tomato). A hit applies the fix AND
// raises the did-you-mean card — the user confirms the swap.
const GROCERY_VERB_RE = /\b(buy|get|grab|order|shop|pick up|add)\b/i;
const TRAILING_MISHEARS: Array<[RegExp, string]> = [
  [/\btomato\s*$/i, 'tomorrow'],
  [/\bto morrow\s*$/i, 'tomorrow'],
  [/\btwo morrow\s*$/i, 'tomorrow'],
  [/\bto day\s*$/i, 'today'],
  [/\bto night\s*$/i, 'tonight'],
  [/\bsum day\s*$/i, 'someday'],
];
const DANGLING_END_RE =
  /\b(?:the|a|an|to|and|or|by|at|for|with|my|your|of)$/i;

// ── Near-miss DATE/TIME words ("tomorrws", "tonigt", "wendsday") ──
// The synonym table catches KNOWN shorthand; this catches novel
// typos of the words that change parsing the most. Strict on
// purpose: distance 1 for 5–7 letters, 2 only at 8+ — so "money"
// (2 from "monday") and "fridge" (2 from "friday", but 6 long)
// never fuzz. A hit auto-fixes AND raises did-you-mean; on Pro the
// clarify pass then repairs the REST of the string ("mam" → "mom"),
// and the confirmed send routes through the deterministic engine.
const DATE_VOCAB = [
  'today',
  'tomorrow',
  'tonight',
  'morning',
  'afternoon',
  'evening',
  'weekend',
  'someday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
// Real words that sit within the fuzz thresholds of a date word —
// never rewrite these ("check the warning light" ≠ morning).
const FUZZ_STOP = new Set([
  'warning',
  'moaning',
  'mourning',
  'sundae',
  'sundry',
]);

/** Optimal-string-alignment distance (Levenshtein + adjacent
 *  transposition, so "toady"→"today" counts as 1), capped early. */
const osaDistance = (a: string, b: string, cap: number): number => {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
};

/** Rewrite near-miss date words in place; returns null when nothing
 *  fuzzed. Skips exact vocab words, their plurals ("weekends" drives
 *  recurrence — must survive), and the FUZZ_STOP real words. */
const fuzzDateWords = (text: string): string | null => {
  let hit = false;
  const out = text
    .split(/(\s+)/)
    .map((tok) => {
      if (!/^[a-z]{5,}$/i.test(tok)) return tok;
      const lc = tok.toLowerCase();
      if (FUZZ_STOP.has(lc)) return tok;
      if (DATE_VOCAB.includes(lc)) return tok;
      if (DATE_VOCAB.includes(lc.replace(/s$/, ''))) return tok;
      const cap = lc.length >= 8 ? 2 : 1;
      for (const v of DATE_VOCAB) {
        if (osaDistance(lc, v, cap) <= cap) {
          hit = true;
          return v;
        }
      }
      return tok;
    })
    .join('');
  return hit ? out : null;
};

export const tidyTranscript = (raw: string): TidiedTranscript => {
  const original = raw.trim();
  let t = original;

  // 1. Stutter dedupe — "call call the the dentist" (ASR loves this).
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
  // 2. Edge fillers — leading/trailing um/uh/like/so noise.
  t = t
    .replace(/^(?:\s*(?:um+|uh+|erm|hmm?|like|so|yeah|ok(?:ay)?)[,\s]+)+/i, '')
    .replace(/(?:[,\s]+(?:um+|uh+|erm|hmm?))+\s*$/i, '');
  // 3. Whitespace + stray punctuation runs.
  t = t.replace(/\s{2,}/g, ' ').replace(/([,.!?])\1+/g, '$1').trim();

  const changed =
    t.toLowerCase().replace(/\s+/g, ' ') !==
    original.toLowerCase().replace(/\s+/g, ' ');

  // Suspicion — the transcript probably isn't what they meant:
  const words = t.split(/\s+/).filter(Boolean);
  const gibberish =
    words.length > 0 &&
    words.filter((w) => GIBBERISH_TOKEN_RE.test(w)).length / words.length >
      0.34;
  const cutShort = words.length >= 1 && DANGLING_END_RE.test(t);
  const tooThin =
    t.length > 0 &&
    words.length === 1 &&
    (t.length <= 2 ||
      /^(?:um+|uh+|erm|hmm?|like|so|yeah|ok(?:ay)?|oh)$/i.test(t));
  let suspicious = gibberish || cutShort || tooThin;

  // Date-word mishears: fix + flag for confirmation. Skipped inside
  // grocery-verb fragments where "tomato" is probably a tomato.
  let misheard = false;
  if (!GROCERY_VERB_RE.test(t)) {
    for (const [re, fix] of TRAILING_MISHEARS) {
      if (re.test(t)) {
        t = t.replace(re, fix);
        misheard = true;
        break;
      }
    }
  }
  if (misheard) suspicious = true;

  // Near-miss date words — auto-fix + confirm (see fuzzDateWords).
  let fuzzed = false;
  const fz = fuzzDateWords(t);
  if (fz != null) {
    t = fz;
    fuzzed = true;
    suspicious = true;
  }

  return { tidied: t, changed: changed || misheard || fuzzed, suspicious };
};

// ═════════════════════════════════════════════════════════════════════
// Spell-pass trigger (goal: LLM formats, the deterministic side
// builds). Counts tokens that look MISSPELLED against a ~10k common-
// word list. The caller (Home, Pro only) runs the tiny Haiku clarify
// pass over the whole string when this is > 0, then parses the
// cleaned text locally — "gym cook dinner at 6 and tomorow call
// danny" costs one ~0.03¢ format call instead of a 1¢ understand.
//
// Deliberately loose in BOTH directions:
//   - lowercase names ("danny") count as unknown ON PURPOSE — the
//     format pass capitalizes them, which we want anyway.
//   - a rare-but-real word costs one no-op clarify. Cheap.
// Skips: short tokens (<4), Capitalized words (names — except the
// first word, where the capital is just the sentence), ALL-CAPS
// acronyms, anything with digits, and the date shorthand the parser
// already owns.
// ═════════════════════════════════════════════════════════════════════
const KNOWN_SHORTHAND_RE =
  /^(?:t[omrw]{2,8}|2m\w+|tonite|wknds?|eod|eow|eom|nxt|asap)$/i;

export const countUnknownWords = (text: string): number => {
  const tokens = text.match(/[A-Za-z''][A-Za-z'']*/g) ?? [];
  let unknown = 0;
  tokens.forEach((rawTok, i) => {
    const tok = rawTok.replace(/[''‛`]/g, '');
    if (tok.length < 4) return;
    if (/\d/.test(rawTok)) return;
    const isCapitalized = /^[A-Z]/.test(tok);
    const isAllCaps = /^[A-Z]+$/.test(tok) && tok.length > 1;
    if (isAllCaps) return; // acronym / emphasis
    if (isCapitalized && i > 0) return; // mid-sentence name
    const lc = tok.toLowerCase();
    if (KNOWN_SHORTHAND_RE.test(lc)) return;
    if (COMMON_WORDS.has(lc)) return;
    // simple plural/verb endings — "groceries"→groceri? handle the
    // common suffixes before declaring unknown.
    if (lc.endsWith('s') && COMMON_WORDS.has(lc.slice(0, -1))) return;
    if (lc.endsWith('es') && COMMON_WORDS.has(lc.slice(0, -2))) return;
    if (lc.endsWith('ed') && COMMON_WORDS.has(lc.slice(0, -2))) return;
    if (lc.endsWith('ing') && COMMON_WORDS.has(lc.slice(0, -3))) return;
    if (lc.endsWith('ly') && COMMON_WORDS.has(lc.slice(0, -2))) return;
    unknown++;
  });
  return unknown;
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
  let droppedVent = false;

  for (const frag of fragments) {
    // Vent stripping: cut a trailing stress clause ("…it's stressing
    // me out"), then drop fragments that are PURE vent — the feeling
    // is real, it just isn't a task.
    const raw = applySelfCorrection(frag.trim())
      .replace(VENT_TAILS, '')
      .trim();
    if (raw.length < 2) continue;
    if (VENT_ONLY.some((re) => re.test(raw))) {
      droppedVent = true;
      continue;
    }
    const lc = ' ' + raw.toLowerCase() + ' ';

    const recur = parseRecur(lc);
    const time = parseTimeAndDate(lc, ctx);
    // Deadline presence is an importance signal (goal §1.3) — things
    // with a "by when" carry stakes.
    const impScore = scoreImportance(lc, time.deadline ? 1 : 0);
    const importance = impScore.tier;
    // Status statements become imperatives BEFORE title cleaning
    // ("laundry is piling up" → "Do laundry", goal §1.4).
    //
    // A8 — "call mom about the doctor" splits the TOPIC into the
    // note, exactly like the LLM's title rule, so free/offline
    // captures get the same clean-title + context treatment. Guards:
    // action part needs ≥2 words (kills "think about X"), verbs that
    // TAKE about-objects stay whole, "about <number>" is a fuzzy
    // time (parsed above), and atomic noun-phrase tasks keep their
    // topic.
    let noteText: string | undefined;
    let titleSource = applyStatusTemplate(raw);
    const aboutM = titleSource.match(
      /^(.+?\S)\s+(about|regarding|re:)\s+(?!\d)(.{3,})$/i,
    );
    if (
      aboutM &&
      aboutM[1].trim().split(/\s+/).length >= 2 &&
      !/\b(think(?:ing)?|worry(?:ing)?|talk|chat|wonder(?:ing)?|forget|care|complain(?:ing)?)$/i.test(
        aboutM[1].trim(),
      )
    ) {
      titleSource = aboutM[1];
      const kw = aboutM[2].toLowerCase();
      const prefix =
        kw === 're:' ? 'Re:' : kw === 'regarding' ? 'Regarding' : 'About';
      noteText = `${prefix} ${aboutM[3].trim()}`.slice(0, 120);
    }
    const title = cleanTitle(stripTokens(titleSource, time.matched));
    // Anything under 3 chars after cleaning is split debris, not a
    // task ("ok", "so", a stray word).
    if (!title || title.length < 3) continue;

    // Decide placement.
    let timeMode: SmartTask['timeMode'];
    let at: number | null = null;
    let date: string | null = null;
    let window: WindowKey;
    let timeOptions: number[] | undefined;
    let rolledFlag = false;

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
        rolledFlag = true;
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
        rolledFlag = true;
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

    // ── Per-field confidence (goal §1.6) ─────────────────────────────
    const timeConfidence =
      time.at != null
        ? 1
        : time.windowHint != null || time.date != null
          ? 0.8
          : recur != null
            ? 0.6
            : 0.35; // pure smart-window guess
    const importanceConfidence =
      impScore.signals === 0
        ? 0.4 // nothing fired — it's the default, not a judgment
        : Math.min(0.95, 0.55 + 0.15 * impScore.signals);
    const titleWords = title.split(/\s+/).length;
    const titleConfidence =
      titleWords > 8 || title.length > 60 ? 0.6 : 0.9;

    // Guided-follow-up flag — deadline-type tasks without an explicit
    // when, plus (goal §1.6) high-stakes tasks whose timing was a pure
    // guess. A tappable "When?" chip beats a silent wrong guess.
    const hasExplicitWhen =
      time.at != null ||
      time.date != null ||
      time.windowHint != null ||
      recur != null;
    const needsFollowup =
      (DEADLINE_TYPE_PATTERN.test(lc) && !hasExplicitWhen) ||
      (importance === 'high' && timeConfidence < 0.5);

    // Semantic kind (waitlist-demo tags, now in the engine) — read
    // from the RAW fragment so verbs eaten by title cleaning still
    // count. Kind also pre-sizes the task with its typical length.
    const kind = classifyKind(raw);

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
      kind: kind.key,
      ...(rolledFlag ? { rolledToTomorrow: true } : {}),
      ...(noteText ? { note: noteText } : {}),
      ...(time.durationMin != null
        ? { durationMinutes: time.durationMin }
        : kind.defaultMinutes != null
          ? { durationMinutes: kind.defaultMinutes }
          : {}),
      confidence: {
        title: titleConfidence,
        time: timeConfidence,
        importance: importanceConfidence,
      },
      ...(time.deadline ? { deadline: true } : {}),
      ...(timeOptions ? { timeOptions } : {}),
    });
  }

  // Single-fragment safety net — if splitFragments produced nothing
  // (the whole input was too short / all punctuation), treat the raw
  // input as one task. We never drop a capture (spec §1.5) — UNLESS
  // it was dropped on purpose because it was pure vent.
  if (tasks.length === 0 && !droppedVent && text.trim().length > 0) {
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
      kind: classifyKind(raw).key,
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
