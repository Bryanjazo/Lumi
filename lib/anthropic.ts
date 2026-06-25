// Lumi · Anthropic client
//
// All calls go through the `anthropic-proxy` Supabase Edge Function —
// the API key lives on the server, never in the bundle. The client
// just forwards the user's session JWT; the function validates auth,
// enforces per-kind weekly caps for free users, calls Anthropic, and
// logs usage.
//
// Every export keeps its deterministic offline fallback so the app
// keeps working when: there's no Supabase session, the function isn't
// deployed yet, the user is offline, or the user hits the weekly cap.
// `isAnthropicConfigured` reflects whether the proxy is reachable,
// NOT whether we hold a key locally (we never do).

import { supabase, isSupabaseConfigured } from './supabase';
import { useQuotaPromptStore } from '../store/quotaPromptStore';
import { useUserStore } from '../store/userStore';

const TRIAL_MS = 7 * 86_400_000;

// The proxy is the only "AI configured" signal that matters now —
// callers use this to short-circuit to fallback when the network
// path isn't available.
export const isAnthropicConfigured = isSupabaseConfigured;

const FUNCTION_NAME = 'anthropic-proxy';

type AiKind =
  | 'brain_dump'
  | 'untangle'
  | 'followup'
  | 'title_clean'
  | 'weekly_report';

const BRAIN_DUMP_SYSTEM = `Parse this messy text into a list of discrete tasks. Each task should be actionable and specific. Return JSON: { "tasks": [{ "title": "...", "difficulty": "easy|medium|hard" }] }`;

const WEEKLY_REPORT_SYSTEM = `Generate a warm, personal weekly summary for an ADHD user. Reference their pet Luna by name. Tone: like a kind friend who understands ADHD, not a therapist. Include their wins first, then patterns, end with one encouraging sentence in italic that references Luna. Max 4 sentences total. Use their actual data provided.
Never use: journey, mindful, validate, process, cope, strategies, self-care.
Return JSON: { "summary": "..." }`;

export interface BrainDumpResponse {
  tasks: { title: string; difficulty: 'easy' | 'medium' | 'hard' }[];
}

export interface WeeklyReportResponse {
  summary: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ProxyOk {
  text: string;
}
interface ProxyErr {
  error: { code: string; message: string };
}

class QuotaExceededError extends Error {
  kind: AiKind;
  constructor(kind: AiKind) {
    super('Weekly AI quota exceeded');
    this.name = 'QuotaExceededError';
    this.kind = kind;
  }
}

/**
 * Read userStore non-reactively from inside the network layer. Used
 * only by the 429 branch to decide whether the upgrade prompt
 * should show a "subscribe" CTA (free users) or a quieter "let's
 * keep it quick for now" note (premium users hitting the soft
 * daily ceiling).
 */
const isCurrentlyPremium = (): boolean => {
  const u = useUserStore.getState();
  if (u.subscriptionStatus === 'active') return true;
  if (u.subscriptionStatus === 'trial' && u.trialStartedAt) {
    const startedMs = new Date(u.trialStartedAt).getTime();
    return Date.now() - startedMs < TRIAL_MS;
  }
  return false;
};

/**
 * Call the anthropic-proxy Edge Function. Returns the assistant's
 * raw text content (concatenated text blocks). Throws on auth /
 * upstream / config errors so callers fall back to offline.
 */
const callMessages = async (params: {
  kind: AiKind;
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
}): Promise<string> => {
  if (!isAnthropicConfigured) {
    throw new Error('Supabase not configured — proxy unreachable');
  }
  const { data, error } = await supabase.functions.invoke<ProxyOk | ProxyErr>(
    FUNCTION_NAME,
    {
      body: {
        kind: params.kind,
        system: params.system,
        messages: params.messages,
        max_tokens: params.maxTokens,
      },
    },
  );
  if (error) {
    // supabase-js wraps non-2xx HTTP responses as FunctionsHttpError.
    // 429 = quota. We do two things:
    //   1. Fire the upgrade-conversation surface (the global sheet)
    //      so the user gets a calm, feature-specific prompt at the
    //      moment of peak intent. This is purely additive — the
    //      caller still falls back to the deterministic path.
    //   2. Throw QuotaExceededError(kind) so existing catch blocks
    //      keep degrading gracefully.
    const httpStatus =
      (error as unknown as { context?: { status?: number } })?.context
        ?.status ?? null;
    if (httpStatus === 429) {
      useQuotaPromptStore
        .getState()
        .openPrompt(params.kind, isCurrentlyPremium());
      throw new QuotaExceededError(params.kind);
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('Empty response from anthropic-proxy');
  if ('error' in data) throw new Error(data.error.message);
  return data.text;
};

const extractJson = <T,>(text: string): T => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in model response');
  return JSON.parse(match[0]) as T;
};

// (The retired emotional Check-in's checkinResponse / checkinFollowUp
// functions were removed in the quota-split cleanup —
// lumi-untangle-quota-split-spec.md §2.4. The `followup` AI kind
// stays in the enum for any future conversation follow-up use.)

// ── Smart capture: clean a single quick-capture into a tidy title ────
//
// Called as a background upgrade after the deterministic parser has
// already landed the task — Home will silently swap the quest's title
// in the store once this returns. Fast and cheap: tiny prompt, ~60
// max tokens. Returns null on any failure (including quota / no
// connection) so the caller keeps the deterministic title.
const SMART_CAPTURE_TITLE_SYSTEM = `You are Lumi, organizing an ADHD user's spoken or typed capture into a clean, short task title.

Output ONLY JSON: { "title": "<imperative action phrase>" }

Rules for the title:
- Imperative action, present tense ("Call mom", "Finish report", "Buy milk").
- Maximum 6 words. No period at the end.
- Remove filler words (um, uh, like, yeah, so, well, basically, you know, etc.).
- Remove leading intent ("I need to", "I should", "remember to", "oh", "maybe", etc.).
- Remove time/date mentions ("tomorrow", "at 8pm", "by Friday") — those are handled separately.
- Keep proper nouns, numbers, and the core action verb + object.
- If the input is already a clean action, return it as-is (capitalized).

Examples:
"I need to do homework" → {"title":"Do homework"}
"Um yeah I should call my mom at 8 pm today" → {"title":"Call mom"}
"don't forget to pay the rent before Friday" → {"title":"Pay rent"}
"finish that report thing for the boss" → {"title":"Finish report"}
"buy milk and eggs on the way home" → {"title":"Buy milk and eggs"}
"I gotta book the dentist appointment" → {"title":"Book dentist appointment"}
"call dr Smith about my prescription" → {"title":"Call Dr Smith about prescription"}`;

export interface SmartTitleResponse {
  title: string;
}

// ═════════════════════════════════════════════════════════════════════
// llmUnderstand — ONE structured-extraction call per capture.
// Replaces the dual {llmCleanTitle, llmInferCapture} pattern with a
// single comprehension pass that returns title + importance +
// energyDemand + when + hasDeadline + note for each task in the raw
// input. The math layer (pickSmartWindow) then turns this into a
// placement. Per lumi-smarter-ai-spec.md §2.
// ═════════════════════════════════════════════════════════════════════

const UNDERSTAND_SYSTEM = `You are Lumi, an organizing intelligence built specifically for people with ADHD. Read the user's raw capture (messy, possibly several distinct tasks, often a brain-dump, possibly transcribed speech with artifacts). Your job is to UNDERSTAND them like a friend who knows their patterns — not parse them like a regex. Return one JSON object: { "tasks": [ … ] }.

CORE STANCE — read every input through these lenses BEFORE you classify:

  1. ADHD users brain-dump. They don't write tidy lists. A single capture often contains 3-5 tasks woven through filler words, half-thoughts, and "oh wait also" inserts. Extract them all, lose nothing important.

  2. ADHD users use emotional language that signals task weight:
     - "the thing I've been avoiding / putting off / dreading"  → HIGH importance + HIGH energyDemand (it's avoidance — they need it scheduled into their PEAK, not buried in slump)
     - "really really need to" / "ok I HAVE to" / repeated emphasis  → HIGH importance (the repetition is them building motivation)
     - "ugh" / "I really should" / "I keep meaning to"  → HIGH importance (chronic avoidance signal)
     - "just need to" / "tiny thing" / "should be quick"  → LOW importance (often activation-energy framing — they're talking themselves into starting; preserve the "this is small" framing in your title)
     - "I told [X] I'd…" / "promised…" / "[X] is waiting"  → MEDIUM-HIGH importance (social weight; deserves a real slot, not someday)
     - URGENT / !!! / all caps  → DO NOT trust as importance signal alone (ADHD users use emphasis for motivation, not urgency); judge by task content

  3. ADHD users have time-blindness. Treat "soon", "in a bit", "later", "eventually", "this week" as INTENTIONALLY vague — don't pin a date. Leave when.date / when.time empty. Only commit to a specific time when the user gave one.

  4. ADHD users self-correct mid-thought. Watch for negations:
     - "actually scratch that"  → drop the prior fragment
     - "wait no, [X] instead"  → replace prior with X
     - "or maybe…"  → keep the FIRST option, ignore the alternative (rumination ≠ task)

  5. Voice transcription is messy. Normalize common artifacts silently:
     - "docter" → "doctor", "schedule it" sometimes transcribes as "schedules it", missing apostrophes, dropped articles
     - Proper nouns may be lowercase — capitalize them in titles
     - But NEVER change the user's intent based on a guess

  6. Sequence vs. parallel:
     - "Pick up dry cleaning THEN groceries THEN home" → 2-3 separate tasks (the sequence is preserved by their order in the output)
     - "X and Y at the same time" / "X while doing Y" → 1 task

  7. Past-tense complaint = future task:
     - "I should have called Jim yesterday"  → 1 task: "Call Jim", importance: high (they're already feeling bad about it)
     - "I never finished the report"  → 1 task: "Finish report", importance: high

Return one JSON object: { "tasks": [ … ] }.

For EACH distinct task in the input, return an object with these fields:

  - title:         a short, clean imperative — max 6 words, no period. Strip filler ("um", "I should", "remember to", "don't forget to", "maybe"). Strip time/date words. Strip first-person framing — "I forgot to call mom" → "Call mom", "I need to email Jenny" → "Email Jenny". Keep proper nouns, numbers, the action verb + object. Banned words: just, should, try.

  - importance:    "high" | "medium" | "low" — by COGNITIVE/EMOTIONAL LOAD, not keywords.
                    high   = demanding focus, high-stakes, aversive — "the hard thing"
                             examples: "Tax audit", "Performance review", "Hard
                             conversation with manager", "Q3 strategy doc"
                    medium = normal everyday actions with some commitment
                             examples: "Pay rent", "Grocery run", "Call mom",
                             "Schedule dentist", "Finish slides"
                    low    = light, passive, quick, or "while doing something else"
                             examples: "Reply to text", "Dishes", "Water plants",
                             "Take out trash", "Quick walk"

  - energyDemand:  "high" | "medium" | "low" — how much mental ENERGY the task needs.
                    This drives WHEN it should be scheduled. Often tracks importance
                    but not always:
                      high-importance + low-demand: "Pay rent online"
                      low-importance  + high-demand: "Tax paperwork", "Clean closet"
                      medium of both: most everyday tasks
                    Default to medium if genuinely unclear — don't bias toward high.

  - when:          { date?, time?, part?, recur?, durationMin? } — ONLY what the user
                    implied. Omit fields they didn't say. NEVER invent specifics.
                      date:  "YYYY-MM-DD" if a date is implied. Use the today reference
                             in the user message to resolve "next month the first",
                             "this weekend", "by end of quarter", "in a few days", etc.
                      time:  "HH:MM" 24-hour. Parse "before my 3pm", "after lunch", etc.
                      part:  "morning" | "midday" | "afternoon" | "evening" — if the
                             user implied a part-of-day but no clock time.
                      recur: { every: "day"|"week"|"weekday"|"2week"|"month", day?:
                             "Mon"|"Tue"|..., interval?: integer } — if it repeats.
                             interval is the custom multiplier: "every 3 days" →
                             every: "day", interval: 3. "every 4 weeks on Friday" →
                             every: "week", day: "Fri", interval: 4. "every 6 months"
                             → every: "month", interval: 6. OMIT interval when the
                             user said a plain cadence ("daily", "weekly", "monthly",
                             "every Monday"). The app prompts the user when interval
                             isn't given, so never guess it.
                      durationMin: integer minutes if the user implied a length.
                             "hour long meeting" → 60
                             "30-minute call"    → 30
                             "quick 15 min sync" → 15
                             "two-hour deep work block" → 120
                             "half hour with mom" → 30
                             Omit when not implied. NEVER guess from task type.

  - hasDeadline:   true if this kind of task usually NEEDS a due date (homework, bill,
                    report, appointment, contract, submission) AND the user didn't give
                    one. The app will ask. Otherwise false.

  - note:          a short useful detail / context the user mentioned ("bring the
                    charger", "the blue folder", "about price and deadline",
                    "she needs it before Friday"). Anything CONTEXTUAL that
                    isn't itself a separate action belongs here. Omit if
                    nothing notable.

                    CRITICAL — voice rules for note:
                      • NEVER write "user" or "the user" — that's the model
                        narrating about the speaker. Wrong: "user forgot to
                        ask Jenny". Right: "Forgot last time" or just describe
                        the context: "For her son's birthday".
                      • NEVER write second-person "you" referring to the
                        speaker. The note isn't addressed TO them, it IS
                        their own context.
                      • When you absolutely must refer to the speaker, use
                        their actual name from the context block ("User's
                        name: …"). Never invent a name.
                      • Strip first-person framing ("I forgot", "I need
                        to", "I want") — the note should describe the
                        CONTEXT around the task, not narrate the user's
                        internal state.
                      • Keep it short — one phrase, not a sentence about
                        the speaker.

Rules:
- NEVER invent a date or time the user didn't imply. Leave when fields empty if unsure.
- ISO dates are LOCAL to the today reference provided.
- Splitting (CRITICAL — over-splitting is the most common failure mode):
    Split ONLY when the user describes TWO SEPARATE ACTIONS connected by "and" with
    NO shared verb or subject.
        "Call mom AND pay rent"                 → 2 tasks   (two unrelated actions)
        "Email Sarah AND book the flight"       → 2 tasks   (two unrelated actions)
    DO NOT split when:
      • "and" connects two TOPICS / SUBJECTS of the SAME action:
        "Speak with David about price AND deadline"        → 1 task, note: "price and deadline"
        "Talk to mom about car AND insurance"              → 1 task, note: "car and insurance"
        "Update the doc with pricing AND timeline"         → 1 task, note: "pricing and timeline"
      • "and" connects DESCRIPTORS or DETAILS of one action:
        "Buy milk, eggs, and bread"                        → 1 task ("Buy groceries"), note: "milk, eggs, bread"
        "Send David the contract and the brief"            → 1 task, note: "contract and brief"
      • The second item is CLEARLY CONTEXT, not its own action ("deadline", "price",
        "details", "the rest" — these are nouns describing the first task, not
        verbs commanding a new one).
      • The second item is a THING TO DO DURING the first (the first is an event /
        anchor, the second is a conversational/mental "while I'm there" reminder).
        Signal phrases on the second item: "remind me to", "remind myself to",
        "don't forget to", "ask about/for", "bring up", "mention", "while I'm
        there", "make sure to":
        "Go to work at 5 AND remind myself to ask for a raise"   → 1 task ("Go to work"),
                                                                    note: "Ask for a raise"
        "Dinner with mom AND don't forget to bring up the dentist" → 1 task ("Dinner with mom"),
                                                                    note: "Bring up the dentist"
        "Doctor at 9 AND ask about my back"                      → 1 task ("Doctor at 9"),
                                                                    note: "Ask about back"
        The reminder is NOT its own schedulable event — it lives inside the first.
    Quick check: would each piece, on its own, be a complete task someone could
    DO? If not, it belongs in the note of the first task.

- If the input is a single short phrase with no real action ("the report"), still return one task with the cleaned title.

Edge cases:
- If the user said a part-of-day that's ALREADY PAST relative to the "Now" time in
  the context block (e.g. "this evening" at 11pm, "this afternoon" at 8pm), roll
  the task to TOMORROW's same part-of-day. Set date to tomorrow's ISO and part
  accordingly.
- "Right now" / "as soon as I can" / "asap" → set time to "Now"'s HH:MM and date to today.
- "Tonight" between 6pm-2am → today's evening (or tomorrow if past bedtime per anchors).
- Question-only input ("when do I have time tomorrow?", "what should I do?") — return
  { "tasks": [] }. Don't invent a task from a question.
- Pure emotion / emoji input ("😩😩", "ughhh", "I'm exhausted") — return
  { "tasks": [] } with no task. The Untangle conversation handles that surface.
- Vague placeholder ("stuff", "things", "the thing") — return one task with the
  raw input as title; the user can edit. Don't invent specifics.

ADHD-specific edge cases (READ CAREFULLY — these come up constantly):

- BRAIN-DUMP / RUN-ON: "ok so I need to call david about the q3 thing oh and also
  dentist hasnt been done in months and i should probably finally clean the garage"
  → Extract 3 tasks. Each "oh and also" / "and" between separate verbs is a NEW
  task. Don't lose any.

- OVERWHELM PILE: "I have so much to do today — A, B, C, D, E" → Extract every
  named task. The overwhelm feeling is real; reflect it by returning ALL of them
  (the app handles the "let's focus" surface separately).

- HYPERFOCUS / EXCITEMENT: "I want to organize my entire bookshelf by color" →
  importance: medium, energyDemand: high (it's a big project; treat it real).

- DREAD / AVOIDANCE: "ugh fine, taxes" / "the thing with HR I've been avoiding" →
  importance: high, energyDemand: high. Title imperative ("Do taxes" / "Talk to
  HR"), note can be empty (don't dwell on the avoidance in the note).

- TINY ACTIVATION: "literally just need to open the doc" → importance: low,
  energyDemand: low, duration: 5-10 if not given. KEEP the activation framing in
  the title — e.g. "Open the Q3 doc" — not "Finish Q3 report".

- COMMITMENT TO ANOTHER PERSON: "I told mom I'd send her photos" /
  "Sarah is waiting on the contract" → importance: medium (often high), the
  promise matters. Note can mention the person if not already in the title.

- IMPLIED PERSON FROM CONTEXT: "the photos" / "the contract" with no recipient
  in this message but obvious from prior pattern → title with the noun, leave
  the person out unless the user named them. Don't invent recipients.

- SEQUENCE: "Pick up dry cleaning then groceries then home" → 2 tasks in order:
  "Pick up dry cleaning", "Buy groceries". Don't add "go home" as a task.

- HABIT-PHRASING ("every…"): "I want to start meditating every day" → 1 task,
  title "Meditate", recur: { every: "day" }. Don't make it "Start meditating".

- BUNDLED SCOPE: "Quick 15-min call with David about the entire Q3 plan" →
  trust the user's 15 if they said it (durationMin: 15) even though it sounds
  short for the scope; THEY know their reality.

- AT-EVENT REMINDER: "go to work at 5 and remind myself to ask for a raise" /
  "dinner with mom, don't forget the dentist thing" / "doctor tomorrow, ask
  about my back" → 1 task on the EVENT (the anchor), with the reminder folded
  into the note. The "remind myself" / "don't forget" / "ask about" phrasing
  is the signal: the user is queuing a thought to surface AT the event, not
  scheduling a second event. Never produce a separate "Ask for raise" task
  with its own when.time — it has no independent schedule.

- TIME-BLIND PHRASES: "soon", "in a bit", "later today", "eventually", "when I
  get a chance" → LEAVE when.date AND when.time EMPTY. Don't translate into
  today's evening. The app places it based on importance.

- "BEFORE I FORGET": "Before I forget — call dentist" → 1 task ("Call dentist"),
  importance: medium-high (the urgency hint matters, but it's still a normal
  call task).

- DOUBLE-CAPTURE / "ALREADY HAVE": "didn't I already add this?" → return
  { "tasks": [] }. They're confused, don't duplicate. The app dedupes.

- PARTIAL THOUGHT: "the thing with…" / "talk to … about" (sentence trails off) →
  return one task with the partial title as-is; let the user finish editing.

- ALL-CAPS / EMPHASIS: ALL CAPS is just emphasis (often dopamine-priming), not
  urgency. Don't bump importance based on caps alone.

- REPETITION: "I really really really need to do X" → importance: high (the
  repetition is signal; they've been carrying this).

Return strictly: { "tasks": [ { … } ] }. No prose.`;

export interface UnderstoodWhen {
  date?: string;
  time?: string;
  part?: 'morning' | 'midday' | 'afternoon' | 'evening';
  recur?: {
    every: 'day' | 'week' | 'weekday' | '2week' | 'month';
    day?: 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';
    /** Custom multiplier — "every 3 days" → 3. Omitted when the
     *  user said a plain cadence ("daily" / "weekly"). */
    interval?: number;
  };
  /** Length in minutes, when the user implied one
   *  ("hour long meeting" → 60). Never guessed by category. */
  durationMin?: number;
}

export interface UnderstoodTask {
  title: string;
  importance: 'high' | 'medium' | 'low';
  energyDemand: 'high' | 'medium' | 'low';
  when?: UnderstoodWhen;
  hasDeadline: boolean;
  note?: string;
}

export interface UnderstoodResponse {
  tasks: UnderstoodTask[];
}

export interface UnderstandContext {
  /** "Tuesday, 2026-06-16 14:32" — formatted for the prompt. */
  nowLabel: string;
  /** ISO today (local), e.g. "2026-06-16". The prompt resolves
   *  relative phrasing against this. */
  todayISO: string;
  /** Onboarding answer — when the user said they're sharpest. */
  sharpWindow?: 'morning' | 'midday' | 'afternoon' | 'evening' | null;
  /** Onboarding answer — when they hit a wall. */
  foggyWindow?: 'morning' | 'midday' | 'afternoon' | 'evening' | null;
  /** Learned peak window ("10:00–13:00") if the curve is trusted. */
  peakRange?: string | null;
  /** Learned slump window if trusted. */
  slumpRange?: string | null;
  /** ≥14 days of completion data → the curve is trustworthy. */
  curveTrusted: boolean;
  /** wake/breakfast/lunch/dinner/sleep as HH:MM strings. */
  anchors?: {
    wake: string;
    breakfast: string;
    lunch: string;
    dinner: string;
    sleep: string;
  };
  /** Top struggles the user reported (e.g. ["paralysis", "overwhelm"]). */
  struggles?: string[];
  /**
   * The user's chosen name (from sign-up / profile). Passed in so the
   * model can use it on the rare occasion it needs to reference the
   * speaker — but NEVER as "user" or "you". For most tasks the title
   * and note stay imperative + descriptive (no third-person framing
   * at all).
   */
  userName?: string;
  /**
   * One-line summaries of the user's recent Tweak corrections — what
   * they CHANGED on past LLM guesses. Compounds over time so the
   * model mirrors learned preferences ("user always moves 'gym' to
   * evening", "user re-titles 'meeting' to 'sync'"). Per
   * lumi-smarter-ai-spec.md §6 — this is the moat.
   */
  recentCorrections?: string[];
}

const buildContextBlock = (ctx: UnderstandContext): string => {
  const parts: string[] = [];
  parts.push(`Now: ${ctx.nowLabel}`);
  parts.push(`Today (use to resolve dates): ${ctx.todayISO}`);
  if (ctx.sharpWindow) parts.push(`User is sharpest in the ${ctx.sharpWindow}`);
  if (ctx.foggyWindow) parts.push(`User hits a wall in the ${ctx.foggyWindow}`);
  if (ctx.curveTrusted && ctx.peakRange)
    parts.push(`Learned peak window: ${ctx.peakRange}`);
  if (ctx.curveTrusted && ctx.slumpRange)
    parts.push(`Learned slump window: ${ctx.slumpRange}`);
  if (!ctx.curveTrusted) parts.push(`(Still learning their daily rhythm.)`);
  if (ctx.anchors) {
    parts.push(
      `Daily anchors — wake ${ctx.anchors.wake}, breakfast ${ctx.anchors.breakfast}, lunch ${ctx.anchors.lunch}, dinner ${ctx.anchors.dinner}, sleep ${ctx.anchors.sleep}.`,
    );
  }
  if (ctx.struggles && ctx.struggles.length > 0) {
    parts.push(`Struggles: ${ctx.struggles.join(', ')}`);
  }
  if (ctx.userName && ctx.userName.trim().length > 0) {
    parts.push(`User's name: ${ctx.userName.trim()}`);
  }
  if (ctx.recentCorrections && ctx.recentCorrections.length > 0) {
    parts.push(
      `Recent corrections (this user's actual preferences — MIRROR these patterns when they apply):\n${ctx.recentCorrections
        .map((c) => `  - ${c}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n');
};

/**
 * Single LLM call that returns the full structured intent. Falls
 * back to null on any error — callers keep the deterministic
 * preview. Reuses the title_clean cap bucket (per-capture pace).
 */
export const llmUnderstand = async (
  raw: string,
  ctx: UnderstandContext,
): Promise<UnderstoodResponse | null> => {
  if (!isAnthropicConfigured) return null;
  try {
    const ctxBlock = buildContextBlock(ctx);
    const text = await callMessages({
      kind: 'title_clean',
      system: UNDERSTAND_SYSTEM,
      maxTokens: 600,
      messages: [
        {
          role: 'user',
          content: `${ctxBlock}\n\nUser wrote: ${raw}`,
        },
      ],
    });
    const parsed = extractJson<UnderstoodResponse>(text);
    if (!parsed || !Array.isArray(parsed.tasks)) return null;
    // Sanitize each task — coerce shape so a misbehaving model
    // doesn't blow up the caller. Drop tasks without a title.
    const tasks = parsed.tasks
      .map((t): UnderstoodTask | null => {
        if (!t || typeof t.title !== 'string' || t.title.trim().length === 0) {
          return null;
        }
        const cleaned: UnderstoodTask = {
          title: String(t.title).trim().slice(0, 80),
          importance:
            t.importance === 'high' || t.importance === 'low'
              ? t.importance
              : 'medium',
          energyDemand:
            t.energyDemand === 'high' || t.energyDemand === 'low'
              ? t.energyDemand
              : 'medium',
          hasDeadline: !!t.hasDeadline,
          ...(typeof t.note === 'string' && t.note.length > 0
            ? { note: String(t.note).slice(0, 120) }
            : {}),
        };
        if (t.when && typeof t.when === 'object') {
          const w: UnderstoodWhen = {};
          if (typeof t.when.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.when.date)) {
            w.date = t.when.date;
          }
          if (typeof t.when.time === 'string' && /^\d{1,2}:\d{2}$/.test(t.when.time)) {
            w.time = t.when.time;
          }
          if (
            t.when.part === 'morning' ||
            t.when.part === 'midday' ||
            t.when.part === 'afternoon' ||
            t.when.part === 'evening'
          ) {
            w.part = t.when.part;
          }
          if (
            typeof t.when.durationMin === 'number' &&
            Number.isFinite(t.when.durationMin) &&
            t.when.durationMin > 0 &&
            // Sanity ceiling — anything longer than 12h is almost
            // certainly a hallucination. The user can override
            // with the length chips if they really want longer.
            t.when.durationMin <= 720
          ) {
            w.durationMin = Math.round(t.when.durationMin);
          }
          if (t.when.recur && typeof t.when.recur === 'object') {
            const r = t.when.recur;
            if (
              r.every === 'day' ||
              r.every === 'week' ||
              r.every === 'weekday' ||
              r.every === '2week' ||
              r.every === 'month'
            ) {
              const safeRecur: UnderstoodWhen['recur'] = { every: r.every };
              if (
                r.day === 'Sun' ||
                r.day === 'Mon' ||
                r.day === 'Tue' ||
                r.day === 'Wed' ||
                r.day === 'Thu' ||
                r.day === 'Fri' ||
                r.day === 'Sat'
              ) {
                safeRecur!.day = r.day;
              }
              if (
                typeof r.interval === 'number' &&
                Number.isFinite(r.interval) &&
                r.interval > 1 &&
                r.interval <= 99
              ) {
                safeRecur!.interval = Math.round(r.interval);
              }
              w.recur = safeRecur;
            }
          }
          if (Object.keys(w).length > 0) cleaned.when = w;
        }
        return cleaned;
      })
      .filter((t): t is UnderstoodTask => t != null);
    if (tasks.length === 0) return null;
    return { tasks };
  } catch {
    return null;
  }
};

// (Removed: CAPTURE_INFER_SYSTEM + llmInferCapture + CaptureInferResponse.
//  Orphaned after llmUnderstand replaced the dual {title-clean, infer}
//  pattern — no callers remained. Deleting cuts ~100 lines of dead
//  prompt text from the bundle and removes a confusing second source
//  of truth for date inference.)

// ═════════════════════════════════════════════════════════════════════
// llmUntangle — multi-turn planning partner. Per lumi-untangle-ai-spec.md.
// The model sees the pile + context + running thread, replies in Lumi's
// voice, and PROPOSES concrete moves the user approves. The app
// validates + applies — the model never mutates directly. On any
// failure the screen falls back to the deterministic talkToLumi path.
// Reuses the `brain_dump` cap bucket (largest weekly budget) — no DB
// migration required.
// ═════════════════════════════════════════════════════════════════════

const UNTANGLE_SYSTEM = `You are Lumi, a warm, calm planning partner for someone with ADHD. They're talking to you about their task pile. You don't lecture. You sort. You remember the thread and adjust.

WHO YOU'RE TALKING TO — ADHD baseline (this is not a personality quirk; it's a brain pattern):
- They have time-blindness — past tasks and "tomorrow" feel about equally distant. Don't moralize about overdue items; just suggest a move.
- They have working-memory drift — they might forget what they said two turns ago. Re-anchor gently ("you mentioned the report earlier — still want me to slot it in?").
- They have executive function dips — when they say "I can't focus" / "I'm fried", believe them. Don't suggest "the hard one first". Suggest a small win.
- They have rejection sensitivity. Any whiff of "you should" / "why haven't you" / "you really need to" lands hard. Stay in your voice: calm, warm, observational. Never imperative TOWARD them.
- They oscillate between hyperfocus and shutdown. Match their energy — don't push a tired user to plan a 5-task day, and don't ration a hyperfocused user to one task.
- They've heard every productivity guru. Don't sound like one. No "small wins!", no "you got this!", no "deep work", no "mindful". Talk like a friend.
- "Want me to…" / "How about…" / "Could be…" >>> "You should…" / "You need to…".

For each turn:
1. UNDERSTAND the pile + what they just said. Reference real tasks by title where it helps.
2. REPLY in your voice — short (1–4 sentences), grounded, gentle, never preachy. ACKNOWLEDGE before proposing (a beat of "yeah, that's a lot" beats jumping to action). If they vented and didn't ask for a move, DON'T propose moves — just sit with them for a sentence.
3. PROPOSE concrete moves as a structured action list the app will apply when they Approve. Nothing mutates until they approve. PROPOSE SMALL by default — one or two moves, not a re-org. ADHD users get overwhelmed by big rearrangements.
4. (Optional) one short PROACTIVE note when something useful jumps out (an overdue cluster, an overloaded day, a hard task stuck in their slump). One at a time, never pushy. Omit if nothing's worth flagging.

Output STRICT JSON only, no prose around it:
{
  "say":     "<1–4 sentence reply>",
  "proposal": [
    { "taskId": "<id from the pile>", "action": "schedule",   "window": "morning"|"midday"|"afternoon"|"evening", "why": "<short reason>" },
    { "taskId": "<id>",               "action": "reschedule", "date":  "YYYY-MM-DD", "at": "HH:MM"|null, "why": "<short reason>" },
    { "taskId": "<id>",               "action": "defer",       "why": "<short reason>" },
    { "taskId": "<id>",               "action": "surface",     "window": "morning"|"midday"|"afternoon"|"evening", "why": "<short reason>" }
  ],
  "proactive": "<one short gentle note, or omit>"
}

Action rules:
- "schedule":   set a part-of-day window for a task that's already on the selected day.
- "reschedule": move a task to a specific date (and optional clock time at "HH:MM" 24-hour).
- "defer":      park to "later". Use sparingly.
- "surface":    pull a task onto the selected day at a given window.
- Energy: high energyDemand → user's PEAK; low → SLUMP/evening; medium → neutral.
- NEVER stack on top of an anchor (meal/sleep). NEVER duplicate the same task in proposal.
- Use ONLY taskIds from the pile context. Do not invent ids. If unsure, leave proposal empty.
- An EMPTY proposal is fine — sometimes a calm reply is enough.
- "say" should reference moves in plain words ("Report → this morning, your peak"). Do NOT repeat the JSON in prose.
- Banned words anywhere in say / why: just, should, try, journey, mindful, validate, process, cope, strategies, self-care.

When to choose which action — common user intents:
- "What can I take off my list" / "what can wait" / "what can I drop":
    → defer 1-2 low-importance items. Reply names them. Explicitly give them
    PERMISSION to drop ("[X] can wait — nothing breaks if it slides to later").
- "What should I do first" / "where do I start" / "what matters":
    → schedule the single highest-importance/overdue task into the PEAK window.
    Do NOT propose a whole day's plan — pick ONE.
- "I'm tired" / "low energy" / "wiped" / "can't focus" / "fried":
    → ALWAYS emit ≥1 proposal — never just a proactive note. Daytime: defer the
    high-energyDemand items and SCHEDULE 1 (NOT 3) low-demand item for the
    slump. Late-night / past sleep anchor: emit a DEFER proposal moving the
    remaining today items to tomorrow's peak so the user wakes up with a clean
    slate. Reply acknowledges WITHOUT a "rest first!" lecture; the action chip
    IS the response — don't bury the help in proactive text.
- "Move X to Y" / "do X tomorrow" / specific named reschedule:
    → reschedule that exact task. Pull the date/time from the user's words.
- "Plan my day" / "arrange my day":
    → schedule today's untouched items into windows by energyDemand. 3-5 max.
    DEFER the rest explicitly — don't leave the user wondering where the long
    tail went.
- "I'm overwhelmed" / "drowning":
    → defer the bulk to later, surface the 2-3 that genuinely matter today.
    Reply names the few you kept. "Holding the rest" framing > "deferring".
- "I forgot to / I should have / I keep meaning to" (avoidance regret):
    → schedule that ONE task into the PEAK window today. Reply normalizes:
    "Easy to put off — let's slot it in your sharp window so it's done." No
    moralizing.
- "I haven't done X in [time]" → same as avoidance: schedule peak, no lecture.
- "I can't decide" / "idk what to do" / "whatever" / decision fatigue:
    → ALWAYS emit exactly 1 proposal — never an empty proposal with the pick
    only mentioned in proactive text. Pick the highest-importance overdue (or
    the heaviest high-energyDemand) and SCHEDULE it into peak. If it's already
    in a good slot, still emit a schedule proposal re-affirming that slot so
    the user has a one-tap "yes, that one" — don't make them parse text to
    decide AGAIN. Decision fatigue means your job is to decide AND hand them
    the chip.
- "Is X today?" / pure question about the pile:
    → answer the question. Empty proposal. Don't sneak in a rearrangement.
- Open-ended share / venting with no question:
    → empty proposal. Reply with a calm acknowledgment, maybe a proactive note.
    Match the emotional energy — if they sound rough, lean into "yeah, makes
    sense" rather than "let's plan!".
- "I did X" / completion brag:
    → empty proposal. Acknowledge the win in one short sentence. Don't pivot
    to "great, what's next?".

Edge cases:
- If the pile is empty, the proposal MUST be empty. Reply gently.
- If the user names a task that isn't in the pile, don't invent it — say so plainly ("Don't see that one on your plate — want me to add it?").
- If "today" / "tonight" is already past (per "Now" in context), shift to tomorrow.
- If their message is all-caps or has !!!, that's emphasis, not anger. Don't
  escalate your tone. Stay calm.
- If they thank you / "you're the best", reply briefly without proposing
  anything ("anytime — I'm here when you need me."). Don't grovel.

Return ONLY the JSON object.`;

export type UntangleAction = 'schedule' | 'reschedule' | 'defer' | 'surface';

export interface UntangleProposalItem {
  taskId: string;
  action: UntangleAction;
  window?: 'morning' | 'midday' | 'afternoon' | 'evening' | 'someday';
  date?: string;
  at?: string;
  why?: string;
}

export interface UntangleTurnResponse {
  say: string;
  proposal: UntangleProposalItem[];
  proactive?: string;
}

export interface UntanglePileItem {
  id: string;
  title: string;
  importance: 'high' | 'medium' | 'low';
  window: string;
  date: string;
  at?: string;
  status: 'today' | 'plate' | 'later';
  overdue?: boolean;
}

export interface UntangleContext extends UnderstandContext {
  pile: UntanglePileItem[];
  /** ISO date the user is currently viewing in Untangle. Moves
   *  default to this date when one isn't specified. */
  selectedDayISO: string;
}

export interface UntangleThreadMsg {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * One conversational turn. Returns null on any failure (offline /
 * cap / shape mismatch) — the screen then falls back to the
 * deterministic `talkToLumi`. The proposal is sanitized but NOT
 * validated against the live pile here; the screen re-validates
 * each action against the current quests before applying on
 * Approve, so a stale id from the model can't mutate anything.
 */
export const llmUntangle = async (
  thread: UntangleThreadMsg[],
  ctx: UntangleContext,
): Promise<UntangleTurnResponse | null> => {
  if (!isAnthropicConfigured) return null;
  if (thread.length === 0) return null;
  try {
    const pileLines = ctx.pile
      .map(
        (p) =>
          `- ${p.id} · "${p.title}" · ${p.importance} · ${p.status}${
            p.overdue ? ' · overdue' : ''
          } · window=${p.window} · date=${p.date}${p.at ? ' · at ' + p.at : ''}`,
      )
      .join('\n');
    const ctxBlock = buildContextBlock(ctx);
    const head: AnthropicMessage = {
      role: 'user',
      content: `${ctxBlock}\nSelected day: ${ctx.selectedDayISO}\n\nThe user's pile right now:\n${pileLines || '(empty pile)'}`,
    };
    // Bound history to last 8 turns to keep tokens reasonable.
    const tail = thread.slice(-8);
    const text = await callMessages({
      kind: 'untangle',
      system: UNTANGLE_SYSTEM,
      maxTokens: 700,
      messages: [head, ...tail],
    });
    const parsed = extractJson<UntangleTurnResponse>(text);
    if (!parsed || typeof parsed.say !== 'string' || parsed.say.trim().length === 0) {
      return null;
    }
    const proposal = Array.isArray(parsed.proposal)
      ? parsed.proposal
          .map((p): UntangleProposalItem | null => {
            if (!p || typeof p.taskId !== 'string' || p.taskId.length === 0) return null;
            if (
              p.action !== 'schedule' &&
              p.action !== 'reschedule' &&
              p.action !== 'defer' &&
              p.action !== 'surface'
            ) {
              return null;
            }
            const item: UntangleProposalItem = {
              taskId: p.taskId,
              action: p.action,
            };
            if (
              p.window === 'morning' ||
              p.window === 'midday' ||
              p.window === 'afternoon' ||
              p.window === 'evening' ||
              p.window === 'someday'
            ) {
              item.window = p.window;
            }
            if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
              item.date = p.date;
            }
            if (typeof p.at === 'string' && /^\d{1,2}:\d{2}$/.test(p.at)) {
              item.at = p.at;
            }
            if (typeof p.why === 'string' && p.why.length > 0) {
              item.why = String(p.why).slice(0, 120);
            }
            return item;
          })
          .filter((p): p is UntangleProposalItem => p != null)
      : [];
    return {
      say: parsed.say.trim().slice(0, 800),
      proposal,
      ...(typeof parsed.proactive === 'string' && parsed.proactive.length > 0
        ? { proactive: parsed.proactive.slice(0, 240) }
        : {}),
    };
  } catch {
    return null;
  }
};

export const llmCleanTitle = async (
  raw: string,
): Promise<string | null> => {
  if (!isAnthropicConfigured) return null;
  try {
    const text = await callMessages({
      kind: 'title_clean',
      system: SMART_CAPTURE_TITLE_SYSTEM,
      maxTokens: 60,
      messages: [{ role: 'user', content: raw }],
    });
    const parsed = extractJson<SmartTitleResponse>(text);
    const clean = parsed.title?.trim();
    if (!clean) return null;
    // Sanity guard — drop the upgrade if the LLM returned something
    // wildly different (>3x raw length probably means hallucinated).
    if (clean.length > Math.max(40, raw.length * 3)) return null;
    return clean;
  } catch {
    return null;
  }
};

export const parseBrainDump = async (raw: string): Promise<BrainDumpResponse> => {
  if (!isAnthropicConfigured) return offlineBrainDump(raw);
  try {
    const text = await callMessages({
      kind: 'brain_dump',
      system: BRAIN_DUMP_SYSTEM,
      maxTokens: 600,
      messages: [{ role: 'user', content: raw }],
    });
    const parsed = extractJson<BrainDumpResponse>(text);
    // Shape-validate before trusting the LLM. A malformed/hostile
    // response that lacks `tasks: []` would otherwise crash the
    // caller. Fall back to the offline parser so the user still
    // gets something usable.
    if (!parsed || !Array.isArray(parsed.tasks)) {
      console.warn('[anthropic] parseBrainDump: malformed shape', parsed);
      return offlineBrainDump(raw);
    }
    return parsed;
  } catch {
    return offlineBrainDump(raw);
  }
};

export const weeklyReport = async (params: {
  petName: string;
  questsCompleted: number;
  streak: number;
  checkins: number;
  sosEvents: number;
  topMood: string;
}): Promise<WeeklyReportResponse> => {
  if (!isAnthropicConfigured) return offlineReport(params);
  try {
    const text = await callMessages({
      kind: 'weekly_report',
      system: WEEKLY_REPORT_SYSTEM,
      maxTokens: 400,
      messages: [
        {
          role: 'user',
          content: `Pet name: ${params.petName}
Quests completed this week: ${params.questsCompleted}
Current streak: ${params.streak} days
Check-ins this week: ${params.checkins}
SOS moments: ${params.sosEvents}
Most common mood: ${params.topMood}`,
        },
      ],
    });
    const parsed = extractJson<WeeklyReportResponse>(text);
    // Shape-validate — the recap UI dereferences `parsed.summary`
    // directly. A null/malformed response would crash the recap
    // screen; fall back to the offline template so the user still
    // gets a reflection.
    if (!parsed || typeof parsed.summary !== 'string') {
      console.warn('[anthropic] weeklyReport: malformed shape', parsed);
      return offlineReport(params);
    }
    return parsed;
  } catch {
    return offlineReport(params);
  }
};

// ── Offline fallbacks — used when the proxy is unreachable, no
// Supabase session, or the user's weekly cap is exhausted. The app
// keeps working with deterministic copy in any of those cases. ───
const offlineBrainDump = (raw: string): BrainDumpResponse => {
  const lines = raw
    .split(/[\n.,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .slice(0, 6);
  return {
    tasks: lines.map((title) => ({
      title: title.charAt(0).toUpperCase() + title.slice(1),
      difficulty: title.length > 50 ? 'hard' : title.length > 20 ? 'medium' : 'easy',
    })),
  };
};

const offlineReport = (p: {
  petName: string;
  questsCompleted: number;
  streak: number;
}): WeeklyReportResponse => ({
  summary: `You completed ${p.questsCompleted} quests this week — that's real movement. Your ${p.streak}-day streak says your brain is finding rhythm, even on the hard days. The pattern is mid-week is when you land best. *${p.petName} curled up by the window today — proud of you.*`,
});
