// Lumi · LLM benchmark suite
//
// A curated set of REAL ADHD-typed inputs with assertions about the
// expected `llmUnderstand` and `llmUntangle` outputs. Each case names
// a specific failure pattern the prompts must handle. Together they
// form the canary set we re-run any time UNDERSTAND_SYSTEM or
// UNTANGLE_SYSTEM is touched.
//
// HOW TO USE:
//   1. Make sure Supabase + the anthropic-proxy Edge Function are
//      configured (the benchmark calls the real LLM through them).
//   2. Run `npx ts-node lib/anthropic-benchmark-runner.ts` from the
//      project root (the runner script is below).
//   3. The runner prints a per-test pass/fail table + a summary.
//
// The benchmark intentionally uses MESSY inputs — brain dumps with
// run-ons, dropped articles, voice-transcription artifacts, and the
// emotional-language patterns ADHD users actually type. Sanitized
// inputs would test nothing useful.
//
// Each case carries:
//   - `name`           — short label for the report
//   - `category`       — which class of capability this tests
//   - `raw`            — the user's input
//   - `expect`         — a set of soft / hard assertions on the output
//   - `notes?`         — why this case matters (rationale for the rule)
//
// Assertions are intentionally LIBERAL — we don't require exact title
// matches, just semantic correctness. The LLM doesn't need to phrase
// "Call mom" exactly like "Call mom" — but it must NOT split it into
// two tasks, and the importance must read "medium" (a normal call).

import type { UnderstoodTask, UntangleTurnResponse } from './anthropic';

// ─────────────────────────────────────────────────────────────────────
// understand benchmark
// ─────────────────────────────────────────────────────────────────────

export interface UnderstandExpect {
  /** Exact task count we expect. */
  taskCount?: number;
  /** Minimum count (use when LLM splitting is acceptable). */
  taskCountMin?: number;
  /** Maximum count (the most important assertion — over-splitting is the
   *  most common failure). */
  taskCountMax?: number;
  /**
   * Per-task assertions. Each entry is checked in order against
   * tasks[i]. Use { skip: true } to ignore a slot.
   */
  tasks?: Array<{
    /** Substring(s) the title MUST contain (case-insensitive). */
    titleIncludes?: string[];
    /** Substring(s) the title must NOT contain (e.g. "I forgot", "user"). */
    titleExcludes?: string[];
    /** Expected importance bucket. */
    importance?: 'high' | 'medium' | 'low';
    /** Acceptable importance buckets (when more than one is valid — e.g.
     *  "Sarah is waiting on it" reads as either medium-commitment or
     *  high-blocker, both defensible). */
    importanceIn?: Array<'high' | 'medium' | 'low'>;
    /** Expected energyDemand bucket. */
    energyDemand?: 'high' | 'medium' | 'low';
    /** Note must be present (and non-empty). */
    noteRequired?: boolean;
    /** Note must NOT be present (or be empty). */
    noteForbidden?: boolean;
    /** Note must NOT contain these substrings (e.g. "user", "you"). */
    noteExcludes?: string[];
    /** Note must contain these substrings (case-insensitive). */
    noteIncludes?: string[];
    /** Date field present? */
    dateRequired?: boolean;
    /** Date field absent? */
    dateForbidden?: boolean;
    /** Time field present? */
    timeRequired?: boolean;
    /** Time field absent? */
    timeForbidden?: boolean;
    /** Recur field present? */
    recurRequired?: boolean;
    /** Recur every value when present. */
    recurEvery?: 'day' | 'week' | 'weekday' | '2week' | 'month';
    /** Duration in minutes (exact). */
    durationMin?: number;
    /** Skip this slot's assertions. */
    skip?: boolean;
  }>;
}

export interface UnderstandCase {
  name: string;
  category:
    | 'splitting'
    | 'avoidance'
    | 'activation'
    | 'commitment'
    | 'time-blind'
    | 'sequence'
    | 'voice'
    | 'overwhelm'
    | 'past-tense'
    | 'recurrence'
    | 'identity'
    | 'edge'
    | 'duration'
    | 'sanity'
    | 'chatter'
    | 'punctuation';
  raw: string;
  expect: UnderstandExpect;
  notes?: string;
}

export const UNDERSTAND_CASES: UnderstandCase[] = [
  // ── Splitting (the most common failure mode) ──────────────────────
  {
    name: 'topics-of-same-action',
    category: 'splitting',
    raw: 'Need to speak with David about project in regards to price and deadline',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['david'],
          titleExcludes: ['deadline'],
          importance: 'medium',
          noteRequired: true,
        },
      ],
    },
    notes:
      'The exact case the user flagged — "and" connects two topics, NOT two tasks.',
  },
  {
    name: 'descriptors-of-one-action',
    category: 'splitting',
    raw: 'Buy milk, eggs, and bread',
    expect: {
      taskCount: 1,
      tasks: [{ titleIncludes: ['buy'], noteRequired: true }],
    },
  },
  {
    name: 'genuine-two-tasks',
    category: 'splitting',
    raw: 'Call mom and pay rent',
    expect: { taskCount: 2 },
    notes:
      'The flip case — two unrelated verbs SHOULD split into two tasks.',
  },
  {
    name: 'brain-dump-three-tasks',
    category: 'splitting',
    raw: "ok so I need to call david about the q3 thing oh and also dentist hasn't been done in months and i should probably finally clean the garage",
    expect: {
      taskCountMin: 3,
      taskCountMax: 3,
      tasks: [
        { titleIncludes: ['david'] },
        { titleIncludes: ['dentist'] },
        { titleIncludes: ['garage'] },
      ],
    },
    notes:
      'Brain-dump style with run-ons + "oh and also". All three must be extracted, none lost in note.',
  },
  {
    name: 'at-event-reminder-work',
    category: 'splitting',
    raw: 'go to work at 5 and remind myself that I need to ask for a raise',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['work'],
          titleExcludes: ['raise', 'remind'],
          noteRequired: true,
          noteIncludes: ['raise'],
          timeRequired: true,
        },
      ],
    },
    notes:
      'The user flagged this exact case — "remind myself to X" while at an event is NOT a second task. Fold into the event\'s note.',
  },
  {
    name: 'at-event-reminder-doctor',
    category: 'splitting',
    raw: 'doctor at 9 tomorrow and ask about my back',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['doctor'],
          titleExcludes: ['back', 'ask'],
          noteRequired: true,
          noteIncludes: ['back'],
        },
      ],
    },
    notes:
      '"ask about X" during an appointment is a note, not a separate task with its own time.',
  },

  // ── Identity / first-person framing ─────────────────────────────
  {
    name: 'forgot-to-strip',
    category: 'identity',
    raw: "I forgot to ask Jenny for her son's birthday",
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['jenny'],
          titleExcludes: ['i ', 'forgot', 'user', 'you'],
          noteExcludes: ['user', 'you forgot', 'i forgot'],
        },
      ],
    },
    notes:
      'The exact case the user flagged — "user forgot" in the note is wrong. Strip first-person, NEVER write "user".',
  },
  {
    name: 'need-to-strip',
    category: 'identity',
    raw: 'I need to email Sarah back',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['email', 'sarah'],
          titleExcludes: ['i ', 'need', 'user'],
        },
      ],
    },
  },
  {
    name: 'should-to-strip',
    category: 'identity',
    raw: 'I really should finally clean the kitchen',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['kitchen'],
          titleExcludes: ['should', 'really', 'i '],
          importance: 'high',
        },
      ],
    },
    notes:
      'Avoidance language ("really should finally") signals HIGH importance even though it sounds soft.',
  },

  // ── Avoidance / dread ─────────────────────────────────────────────
  {
    name: 'avoidance-the-thing',
    category: 'avoidance',
    raw: "the thing with HR I've been avoiding",
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['hr'],
          importance: 'high',
          energyDemand: 'high',
        },
      ],
    },
  },
  {
    name: 'avoidance-ugh',
    category: 'avoidance',
    raw: 'ugh fine, taxes',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['tax'],
          importance: 'high',
          energyDemand: 'high',
        },
      ],
    },
  },

  // ── Activation / start small ─────────────────────────────────────
  {
    name: 'tiny-activation',
    category: 'activation',
    raw: 'literally just need to open the Q3 doc',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['open', 'q3'],
          titleExcludes: ['finish', 'complete'],
          importance: 'low',
          energyDemand: 'low',
        },
      ],
    },
    notes:
      'Activation framing — preserve "open the doc", do not upgrade to "finish the report".',
  },

  // ── Commitments to others ────────────────────────────────────────
  {
    name: 'promise-to-mom',
    category: 'commitment',
    raw: "I told mom I'd send her the photos",
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['photos'],
          titleExcludes: ['user', 'i told'],
          importance: 'medium',
        },
      ],
    },
  },
  {
    name: 'waiting-on-me',
    category: 'commitment',
    raw: 'Sarah is waiting on the contract',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['contract'],
          importanceIn: ['medium', 'high'],
        },
      ],
    },
    notes:
      'Both medium (normal commitment) and high (someone is blocked / implicit deadline) are defensible.',
  },

  // ── Time-blindness ───────────────────────────────────────────────
  {
    name: 'soon-no-date',
    category: 'time-blind',
    raw: 'Need to book the flight soon',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['flight'],
          dateForbidden: true,
          timeForbidden: true,
        },
      ],
    },
    notes:
      '"Soon" is intentionally vague — don\'t commit to a date. The app places it by importance.',
  },
  {
    name: 'eventually-no-date',
    category: 'time-blind',
    raw: 'Eventually clean the garage',
    expect: {
      taskCount: 1,
      tasks: [
        { titleIncludes: ['garage'], dateForbidden: true },
      ],
    },
  },

  // ── Past-tense complaints ────────────────────────────────────────
  {
    name: 'should-have-yesterday',
    category: 'past-tense',
    raw: 'I should have called Jim yesterday',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['jim'],
          titleExcludes: ['yesterday', 'should'],
          importance: 'high',
        },
      ],
    },
  },

  // ── Sequence ─────────────────────────────────────────────────────
  {
    name: 'sequence-then',
    category: 'sequence',
    raw: 'Pick up dry cleaning then groceries then home',
    expect: {
      taskCountMin: 2,
      taskCountMax: 2,
      tasks: [
        { titleIncludes: ['dry cleaning'] },
        { titleIncludes: ['groceries'] },
      ],
    },
    notes: '"Go home" is not a task. Two tasks, not three.',
  },

  // ── Recurrence ───────────────────────────────────────────────────
  {
    name: 'recur-daily',
    category: 'recurrence',
    raw: 'I want to start meditating every day',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['meditat'],
          titleExcludes: ['start'],
          recurRequired: true,
          recurEvery: 'day',
        },
      ],
    },
  },
  {
    name: 'recur-interval',
    category: 'recurrence',
    raw: 'Water the plants every 3 days',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['water'],
          recurRequired: true,
          recurEvery: 'day',
        },
      ],
    },
    notes:
      '"every 3 days" → recur.every:"day", interval:3 (asserted in runner separately).',
  },

  // ── Duration ─────────────────────────────────────────────────────
  {
    name: 'duration-hour-long',
    category: 'duration',
    raw: 'Hour long meeting with David tomorrow at 3pm',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['david'],
          durationMin: 60,
          dateRequired: true,
          timeRequired: true,
        },
      ],
    },
  },
  {
    name: 'duration-15-min',
    category: 'duration',
    raw: 'Quick 15 min sync with team',
    expect: {
      taskCount: 1,
      tasks: [{ titleIncludes: ['sync'], durationMin: 15 }],
    },
  },

  // ── Voice transcription artifacts ────────────────────────────────
  {
    name: 'voice-lowercase-proper-noun',
    category: 'voice',
    raw: 'call david about the q3 thing',
    expect: {
      taskCount: 1,
      tasks: [
        {
          // We expect "David" capitalized but don't ASSERT it
          // (the LLM might still write "david" — that's a low-risk
          // miss, not a quality failure).
          titleIncludes: ['david'],
          importance: 'medium',
        },
      ],
    },
  },

  // ── Edge / sanity ────────────────────────────────────────────────
  {
    name: 'question-no-task',
    category: 'edge',
    raw: 'when do I have time tomorrow?',
    expect: { taskCount: 0 },
  },
  {
    name: 'emoji-only',
    category: 'edge',
    raw: '😩😩😩',
    expect: { taskCount: 0 },
  },
  {
    name: 'vague-the-thing',
    category: 'edge',
    raw: 'the thing',
    expect: { taskCount: 1, tasks: [{ titleIncludes: ['thing'] }] },
  },
  {
    name: 'banned-words-just',
    category: 'sanity',
    raw: 'I just need to send the email',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleExcludes: ['just', 'should', 'try'],
          titleIncludes: ['email'],
        },
      ],
    },
    notes: 'Banned words: "just", "should", "try" never in titles.',
  },
  {
    name: 'all-caps-not-urgent',
    category: 'edge',
    raw: 'PICK UP MILK',
    expect: {
      taskCount: 1,
      tasks: [{ titleIncludes: ['milk'], importance: 'low' }],
    },
    notes:
      'All-caps is emphasis, not urgency. A milk run is still a low-importance whim.',
  },

  // ── Bare comma-list (the regression that hit prod) ───────────────
  //
  // splitFragments in lib/capture.ts only splits on and / then / . / ;
  // — plain comma-separated lists collapse to 1-2 fragments there.
  // The LLM is the source of truth for splitting; these cases pin
  // that behavior so a future prompt regression can't hide.
  {
    name: 'bare-comma-list-six-tasks',
    category: 'splitting',
    raw: "finish the pitch deck this morning, reply to Sam about the timeline by noon, book the dentist, edit this week's podcast at 4pm, send the client invoice by 5pm, tidy the desk",
    expect: {
      taskCountMin: 5,
      taskCountMax: 6,
      tasks: [
        { titleIncludes: ['pitch', 'deck'] },
        { titleIncludes: ['sam'] },
        { titleIncludes: ['dentist'] },
        { titleIncludes: ['podcast'] },
        { titleIncludes: ['invoice'] },
        { titleIncludes: ['desk'] },
      ],
    },
    notes:
      'The exact regression — 6 comma-separated actions must NOT collapse to 1-2 tasks.',
  },
  {
    name: 'bare-comma-list-chores',
    category: 'splitting',
    raw: 'call mom, pick up prescription, gas, dishes',
    expect: {
      taskCountMin: 3,
      taskCountMax: 4,
      tasks: [
        { titleIncludes: ['mom'] },
        { titleIncludes: ['prescription'] },
      ],
    },
    notes:
      'Short comma-list including single-word chore fragments ("gas", "dishes"). All should surface as tasks.',
  },

  // ── Comma-as-punctuation (the OPPOSITE — comma must NOT split) ────
  {
    name: 'comma-appositive-manager',
    category: 'punctuation',
    raw: 'Email Bob, the manager, about the deadline',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['bob'],
          titleExcludes: ['manager', 'deadline'],
          noteRequired: true,
        },
      ],
    },
    notes:
      'Commas set off an appositive ("the manager") and a topic — the whole thing is ONE task.',
  },
  {
    name: 'comma-appositive-mentor',
    category: 'punctuation',
    raw: 'talk to David, my mentor, tomorrow',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['david'],
          titleExcludes: ['mentor'],
          noteRequired: true,
          noteIncludes: ['mentor'],
        },
      ],
    },
  },
  {
    name: 'comma-descriptor-clause',
    category: 'punctuation',
    raw: 'send Sarah the file, the one from last week',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['sarah', 'file'],
          noteRequired: true,
          noteIncludes: ['last week'],
        },
      ],
    },
  },

  // ── Casual chatter + real tasks (venting alongside actions) ──────
  {
    name: 'chatter-single-task-with-time',
    category: 'chatter',
    raw:
      'man today sucks, gotta finish that report by 5pm otherwise the boss will kill me',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['report'],
          titleExcludes: ['boss', 'sucks'],
          timeRequired: true,
          importance: 'high',
        },
      ],
    },
    notes:
      'Pure venting ("man today sucks", "the boss will kill me") stripped; single real action ("finish report by 5pm") extracted.',
  },
  {
    name: 'chatter-ugh-still-need-to',
    category: 'chatter',
    raw: 'ugh so tired but I still need to send the invoice',
    expect: {
      taskCount: 1,
      tasks: [
        {
          titleIncludes: ['invoice'],
          titleExcludes: ['tired', 'ugh', 'need', 'i '],
        },
      ],
    },
  },
  {
    name: 'chatter-stress-two-tasks',
    category: 'chatter',
    raw:
      "I'm so stressed about the presentation, need to prep slides, also groceries",
    expect: {
      taskCountMin: 2,
      taskCountMax: 2,
      tasks: [
        {
          titleIncludes: ['slides'],
          importance: 'high',
        },
        { titleIncludes: ['grocer'] },
      ],
    },
    notes:
      'Stress framing ("so stressed about the presentation") signals HIGH importance on the associated task. Groceries stays medium.',
  },
];

// ─────────────────────────────────────────────────────────────────────
// untangle benchmark
// ─────────────────────────────────────────────────────────────────────

export interface UntangleExpect {
  /** The reply text must contain one of these substrings. */
  sayIncludesAny?: string[];
  /** The reply must NOT contain these. */
  sayExcludes?: string[];
  /** Exact proposal length (use when we expect a specific shape). */
  proposalCount?: number;
  /** Max proposal length. */
  proposalCountMax?: number;
  /** Min proposal length. */
  proposalCountMin?: number;
  /** Per-proposal-item assertions. */
  proposal?: Array<{
    action?:
      | 'schedule'
      | 'reschedule'
      | 'defer'
      | 'surface'
      | 'create';
    /** Any-of variant — accepts either action name. Useful when
     *  the LLM legitimately picks between schedule / reschedule
     *  based on whether it wants to keep the window OR commit to
     *  a specific date+time. */
    actionAnyOf?: Array<
      'schedule' | 'reschedule' | 'defer' | 'surface' | 'create'
    >;
    /** Why must contain one of these. */
    whyIncludesAny?: string[];
    /** Title must contain one of these (case-insensitive). For
     *  'create' items the LLM provides a title directly. */
    titleIncludesAny?: string[];
    /** Required clock time for the action (HH:MM). */
    atEquals?: string;
    skip?: boolean;
  }>;
  /** Proactive note required? */
  proactiveRequired?: boolean;
  /** Proactive note must be absent? */
  proactiveForbidden?: boolean;
}

export interface UntanglePileSeed {
  id: string;
  title: string;
  importance: 'high' | 'medium' | 'low';
  window:
    | 'morning'
    | 'midday'
    | 'afternoon'
    | 'evening'
    | 'someday';
  status?: 'today' | 'plate' | 'later';
  overdue?: boolean;
  at?: string;
  date?: string;
}

export interface UntangleCase {
  name: string;
  category:
    | 'intent-defer'
    | 'intent-first'
    | 'intent-plan'
    | 'tired'
    | 'overwhelm'
    | 'avoidance-regret'
    | 'vent'
    | 'thank'
    | 'question'
    | 'decision-fatigue'
    | 'empty-pile'
    | 'tone'
    | 'create';
  message: string;
  pile: UntanglePileSeed[];
  expect: UntangleExpect;
  notes?: string;
}

const STANDARD_PILE: UntanglePileSeed[] = [
  {
    id: 'q1',
    title: 'Finish Q3 report',
    importance: 'high',
    window: 'morning',
    status: 'today',
    overdue: true,
  },
  {
    id: 'q2',
    title: 'Call dentist',
    importance: 'medium',
    window: 'midday',
    status: 'today',
  },
  {
    id: 'q3',
    title: 'Reply to Sarah',
    importance: 'low',
    window: 'afternoon',
    status: 'today',
  },
  {
    id: 'q4',
    title: 'Buy groceries',
    importance: 'low',
    window: 'evening',
    status: 'today',
  },
  {
    id: 'q5',
    title: 'Read that article',
    importance: 'low',
    window: 'someday',
    status: 'later',
  },
];

export const UNTANGLE_CASES: UntangleCase[] = [
  // ── "What can I take off" — defer with permission ───────────────
  {
    name: 'take-off-list',
    category: 'intent-defer',
    message: 'what can I take off my list today',
    pile: STANDARD_PILE,
    expect: {
      proposalCountMin: 1,
      proposalCountMax: 2,
      proposal: [{ action: 'defer' }],
      sayExcludes: ['should', 'need to', 'just'],
    },
    notes:
      'User wants permission to drop something. Defer 1-2 light items. No moralizing.',
  },

  // ── "What should I do first" — single highest task ─────────────
  {
    name: 'where-to-start',
    category: 'intent-first',
    message: 'where should I even start today',
    pile: STANDARD_PILE,
    expect: {
      proposalCount: 1,
      // Accept either action — the LLM legitimately picks
      // "reschedule" when it wants to commit to a specific
      // date+time (like "tomorrow at 9:30 in your peak"), or
      // "schedule" when a window is enough. Either is a valid
      // "place the task somewhere" response.
      proposal: [{ actionAnyOf: ['schedule', 'reschedule'] }],
      sayExcludes: ['should', 'try'],
    },
    notes:
      'Decision fatigue + paralysis. ONE task, not a plan. "just" removed from sayExcludes — the word appears naturally in reflective phrasing ("just wrapping up", "the one that just matters").',
  },

  // ── "I'm tired" — defer hard, surface ONE light ─────────────────
  {
    name: 'tired-give-light',
    category: 'tired',
    message: "I'm so wiped today, can't think straight",
    pile: STANDARD_PILE,
    expect: {
      proposalCountMin: 1,
      proposalCountMax: 3,
      sayExcludes: ['hard one', 'push through', 'come on', 'should'],
    },
    notes:
      "Tired user. Don't lecture. Give them one light thing and defer the heavy stuff.",
  },

  // ── Avoidance regret — slot it in peak, no lecture ─────────────
  {
    name: 'avoidance-regret',
    category: 'avoidance-regret',
    message: "I keep meaning to finish that report and haven't",
    pile: STANDARD_PILE,
    expect: {
      proposalCountMin: 1,
      // Either schedule (window only) or reschedule (specific
      // date+time). Both are valid "give it a real slot" responses.
      proposal: [{ actionAnyOf: ['schedule', 'reschedule'] }],
      sayExcludes: ['why haven\'t', 'you should', 'really need to'],
    },
    notes:
      'User is already shame-spiraling. Normalize ("easy to put off"), give it a real slot, move on.',
  },

  // ── Pure vent — no proposal ─────────────────────────────────────
  {
    name: 'vent-no-action',
    category: 'vent',
    message: 'today is just so much',
    pile: STANDARD_PILE,
    expect: {
      proposalCount: 0,
      sayExcludes: ['should', 'need to', 'just'],
    },
    notes:
      'No question, no ask. Acknowledge + sit with them. Empty proposal.',
  },

  // ── Thank you — no proposal ─────────────────────────────────────
  {
    name: 'thank-you',
    category: 'thank',
    message: 'thanks, you actually help a lot',
    pile: STANDARD_PILE,
    expect: { proposalCount: 0 },
  },

  // ── Decision fatigue — pick for them ────────────────────────────
  {
    name: 'cant-decide',
    category: 'decision-fatigue',
    message: "idk just whatever",
    pile: STANDARD_PILE,
    expect: {
      proposalCountMin: 1,
      proposalCountMax: 2,
    },
    notes:
      "When they can't decide, the model decides. ONE task, the most overdue/important.",
  },

  // ── Empty pile — empty proposal ─────────────────────────────────
  {
    name: 'empty-pile',
    category: 'empty-pile',
    message: 'help me plan',
    pile: [],
    expect: { proposalCount: 0 },
  },

  // ── Create flow — user surfaces something they forgot ───────────
  {
    name: 'forgot-meeting-create',
    category: 'create',
    message: "i'm stressed i forgot i had a client meeting at 8am",
    pile: STANDARD_PILE,
    expect: {
      proposalCountMin: 1,
      proposal: [
        {
          action: 'create',
          titleIncludesAny: ['meeting', 'client'],
          atEquals: '08:00',
        },
      ],
      sayExcludes: ['should', 'try', 'just'],
    },
    notes:
      'The user just surfaced a NEW task not on the pile — the LLM must emit a "create" proposal with a sensible title and the 8am time, not invent a reschedule against an existing item.',
  },
  {
    name: 'oh-also-call-david',
    category: 'create',
    message: 'oh wait I also need to call david today',
    pile: STANDARD_PILE,
    expect: {
      proposalCountMin: 1,
      proposal: [
        {
          action: 'create',
          titleIncludesAny: ['call', 'david'],
        },
      ],
    },
    notes:
      'Mid-conversation surfacing of a new commitment. Should land as a create, not be ignored or merged into another item.',
  },

  // ── Question about pile — answer, no rearrange ──────────────────
  {
    name: 'pure-question',
    category: 'question',
    message: 'is the report on today?',
    pile: STANDARD_PILE,
    expect: { proposalCount: 0 },
    notes:
      'A question about the pile is not a request to rearrange it.',
  },

  // ── Completion brag — no proposal ───────────────────────────────
  {
    name: 'finished-something',
    category: 'thank',
    message: 'just finished the report, finally',
    pile: STANDARD_PILE,
    expect: { proposalCount: 0 },
    notes: "Don't pivot to 'great, what's next'. Acknowledge briefly.",
  },
];

// ─────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────

export interface UnderstandRunResult {
  case: UnderstandCase;
  output: UnderstoodTask[] | null;
  errors: string[]; // empty = pass
}

export interface UntangleRunResult {
  case: UntangleCase;
  output: UntangleTurnResponse | null;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Assertion helpers (used by the runner)
// ─────────────────────────────────────────────────────────────────────

const ci = (s: string) => s.toLowerCase();

export const assertUnderstand = (
  tasks: UnderstoodTask[],
  expect: UnderstandExpect,
): string[] => {
  const errs: string[] = [];

  if (expect.taskCount != null && tasks.length !== expect.taskCount) {
    errs.push(
      `task count: expected ${expect.taskCount}, got ${tasks.length}`,
    );
  }
  if (
    expect.taskCountMin != null &&
    tasks.length < expect.taskCountMin
  ) {
    errs.push(
      `task count: expected ≥${expect.taskCountMin}, got ${tasks.length}`,
    );
  }
  if (
    expect.taskCountMax != null &&
    tasks.length > expect.taskCountMax
  ) {
    errs.push(
      `task count: expected ≤${expect.taskCountMax}, got ${tasks.length}`,
    );
  }

  if (expect.tasks) {
    expect.tasks.forEach((t, i) => {
      if (t.skip) return;
      const got = tasks[i];
      if (!got) {
        errs.push(`task[${i}]: missing`);
        return;
      }
      const title = ci(got.title);
      if (t.titleIncludes) {
        for (const sub of t.titleIncludes) {
          if (!title.includes(ci(sub))) {
            errs.push(
              `task[${i}].title: missing "${sub}" — got "${got.title}"`,
            );
          }
        }
      }
      if (t.titleExcludes) {
        for (const sub of t.titleExcludes) {
          if (title.includes(ci(sub))) {
            errs.push(
              `task[${i}].title: must not contain "${sub}" — got "${got.title}"`,
            );
          }
        }
      }
      if (t.importance && got.importance !== t.importance) {
        errs.push(
          `task[${i}].importance: expected ${t.importance}, got ${got.importance}`,
        );
      }
      if (t.importanceIn && !t.importanceIn.includes(got.importance)) {
        errs.push(
          `task[${i}].importance: expected one of [${t.importanceIn.join(', ')}], got ${got.importance}`,
        );
      }
      if (t.energyDemand && got.energyDemand !== t.energyDemand) {
        errs.push(
          `task[${i}].energyDemand: expected ${t.energyDemand}, got ${got.energyDemand}`,
        );
      }
      const note = got.note ?? '';
      if (t.noteRequired && note.length === 0) {
        errs.push(`task[${i}].note: required but empty`);
      }
      if (t.noteForbidden && note.length > 0) {
        errs.push(`task[${i}].note: must be empty — got "${note}"`);
      }
      if (t.noteExcludes) {
        const nl = ci(note);
        for (const sub of t.noteExcludes) {
          if (nl.includes(ci(sub))) {
            errs.push(
              `task[${i}].note: must not contain "${sub}" — got "${note}"`,
            );
          }
        }
      }
      if (t.noteIncludes) {
        const nl = ci(note);
        for (const sub of t.noteIncludes) {
          if (!nl.includes(ci(sub))) {
            errs.push(
              `task[${i}].note: must contain "${sub}" — got "${note}"`,
            );
          }
        }
      }
      const when = got.when ?? {};
      if (t.dateRequired && !when.date) {
        errs.push(`task[${i}].when.date: required`);
      }
      if (t.dateForbidden && when.date) {
        errs.push(
          `task[${i}].when.date: must be absent — got ${when.date}`,
        );
      }
      if (t.timeRequired && !when.time) {
        errs.push(`task[${i}].when.time: required`);
      }
      if (t.timeForbidden && when.time) {
        errs.push(
          `task[${i}].when.time: must be absent — got ${when.time}`,
        );
      }
      if (t.recurRequired && !when.recur) {
        errs.push(`task[${i}].when.recur: required`);
      }
      if (t.recurEvery && when.recur?.every !== t.recurEvery) {
        errs.push(
          `task[${i}].when.recur.every: expected ${t.recurEvery}, got ${when.recur?.every}`,
        );
      }
      if (t.durationMin != null && when.durationMin !== t.durationMin) {
        errs.push(
          `task[${i}].when.durationMin: expected ${t.durationMin}, got ${when.durationMin}`,
        );
      }
    });
  }

  return errs;
};

export const assertUntangle = (
  r: UntangleTurnResponse,
  expect: UntangleExpect,
): string[] => {
  const errs: string[] = [];
  const say = ci(r.say ?? '');

  if (expect.sayIncludesAny && expect.sayIncludesAny.length > 0) {
    const ok = expect.sayIncludesAny.some((s) => say.includes(ci(s)));
    if (!ok) {
      errs.push(
        `say: must contain one of ${JSON.stringify(expect.sayIncludesAny)} — got "${r.say}"`,
      );
    }
  }
  if (expect.sayExcludes) {
    for (const sub of expect.sayExcludes) {
      if (say.includes(ci(sub))) {
        errs.push(`say: must not contain "${sub}" — got "${r.say}"`);
      }
    }
  }

  const proposal = r.proposal ?? [];
  if (
    expect.proposalCount != null &&
    proposal.length !== expect.proposalCount
  ) {
    errs.push(
      `proposal count: expected ${expect.proposalCount}, got ${proposal.length}`,
    );
  }
  if (
    expect.proposalCountMin != null &&
    proposal.length < expect.proposalCountMin
  ) {
    errs.push(
      `proposal count: expected ≥${expect.proposalCountMin}, got ${proposal.length}`,
    );
  }
  if (
    expect.proposalCountMax != null &&
    proposal.length > expect.proposalCountMax
  ) {
    errs.push(
      `proposal count: expected ≤${expect.proposalCountMax}, got ${proposal.length}`,
    );
  }

  if (expect.proposal) {
    expect.proposal.forEach((p, i) => {
      if (p.skip) return;
      const got = proposal[i];
      if (!got) {
        errs.push(`proposal[${i}]: missing`);
        return;
      }
      if (p.action && got.action !== p.action) {
        errs.push(
          `proposal[${i}].action: expected ${p.action}, got ${got.action}`,
        );
      }
      if (p.actionAnyOf && p.actionAnyOf.length > 0) {
        const ok = (p.actionAnyOf as readonly string[]).includes(
          got.action ?? '',
        );
        if (!ok) {
          errs.push(
            `proposal[${i}].action: expected one of ${JSON.stringify(p.actionAnyOf)}, got ${got.action ?? '(none)'}`,
          );
        }
      }
      if (p.whyIncludesAny && p.whyIncludesAny.length > 0) {
        const why = ci(got.why ?? '');
        const ok = p.whyIncludesAny.some((s) => why.includes(ci(s)));
        if (!ok) {
          errs.push(
            `proposal[${i}].why: must contain one of ${JSON.stringify(p.whyIncludesAny)} — got "${got.why}"`,
          );
        }
      }
      if (p.titleIncludesAny && p.titleIncludesAny.length > 0) {
        const title = ci(got.title ?? '');
        const ok = p.titleIncludesAny.some((s) => title.includes(ci(s)));
        if (!ok) {
          errs.push(
            `proposal[${i}].title: must contain one of ${JSON.stringify(p.titleIncludesAny)} — got "${got.title}"`,
          );
        }
      }
      if (p.atEquals && got.at !== p.atEquals) {
        errs.push(
          `proposal[${i}].at: expected ${p.atEquals}, got ${got.at ?? '(none)'}`,
        );
      }
    });
  }

  if (expect.proactiveRequired && !r.proactive) {
    errs.push(`proactive: required`);
  }
  if (expect.proactiveForbidden && r.proactive) {
    errs.push(`proactive: must be absent — got "${r.proactive}"`);
  }

  return errs;
};
