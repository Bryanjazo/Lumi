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
import { isPaidThrough } from './subscription';

const TRIAL_MS = 7 * 86_400_000;

// The proxy is the only "AI configured" signal that matters now —
// callers use this to short-circuit to fallback when the network
// path isn't available.
export const isAnthropicConfigured = isSupabaseConfigured;

const FUNCTION_NAME = 'anthropic-proxy';

// ═════════════════════════════════════════════════════════════════════
// Outage circuit breaker (goal §1.7) — the single kill-switch path.
//
// When the proxy errors or times out repeatedly (Anthropic down,
// Supabase down, dead network), we OPEN the breaker for a cooldown:
// every AI surface then short-circuits to its deterministic twin
// INSTANTLY — no spinner, no waiting out the race timeout on every
// single capture during an outage. One success (or cooldown expiry)
// closes it again. Quota 429s do NOT trip it — the service is up,
// the user just hit their cap.
//
// `simulateLlmDown` is the dev drill: flip it in the dev screen and
// the whole app runs deterministically, which must feel complete.
// ═════════════════════════════════════════════════════════════════════
const BREAKER_THRESHOLD = 2; // consecutive failures to trip
const BREAKER_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let breakerOpenUntil = 0; // epoch ms
let simulateLlmDown = false;

const recordLlmFailure = () => {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    if (__DEV__) {
      console.warn(
        `[llm] circuit OPEN after ${consecutiveFailures} failures — deterministic-only for ${BREAKER_COOLDOWN_MS / 1000}s`,
      );
    }
  }
};

const recordLlmSuccess = () => {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
};

/**
 * Should a surface even ATTEMPT the LLM right now? False when the
 * proxy isn't configured, the breaker is open, or the dev drill is
 * on. Callers use this instead of `isAnthropicConfigured` to decide
 * whether to show a "Lumi is sorting…" wait state — when this is
 * false the deterministic result ships instantly.
 */
export const isLlmAvailable = (): boolean =>
  isAnthropicConfigured && !simulateLlmDown && Date.now() >= breakerOpenUntil;

/** Dev drill toggle — run the whole app as if Anthropic is down. */
export const setSimulateLlmDown = (down: boolean): void => {
  simulateLlmDown = down;
  if (!down) recordLlmSuccess(); // also reset the breaker on re-enable
};
export const isSimulatingLlmDown = (): boolean => simulateLlmDown;

type AiKind =
  | 'brain_dump'
  | 'untangle'
  | 'followup'
  | 'title_clean'
  | 'clarify'
  | 'weekly_report';

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
  if (isPaidThrough(u.subscriptionStatus, u.subscriptionCurrentPeriodEnd)) {
    return true;
  }
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
// NOTE: system prompts are SERVER-pinned per kind (anthropic-proxy/
// prompts.ts). The client no longer sends them — the local consts
// below are the reference copies used to regenerate the server file.
const callMessages = async (params: {
  kind: AiKind;
  messages: AnthropicMessage[];
  maxTokens: number;
}): Promise<string> => {
  if (!isAnthropicConfigured) {
    throw new Error('Supabase not configured — proxy unreachable');
  }
  if (simulateLlmDown) {
    throw new Error('[dev] simulated LLM outage');
  }
  if (Date.now() < breakerOpenUntil) {
    throw new Error('LLM circuit open — cooling down after failures');
  }
  let data: ProxyOk | ProxyErr | null;
  let error: { message: string } | null;
  try {
    ({ data, error } = await supabase.functions.invoke<ProxyOk | ProxyErr>(
      FUNCTION_NAME,
      {
        body: {
          kind: params.kind,
          messages: params.messages,
          max_tokens: params.maxTokens,
        },
      },
    ));
  } catch (e) {
    // Network-level throw (fetch failed, DNS, airplane mode) — the
    // clearest outage signal there is.
    recordLlmFailure();
    throw e;
  }
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
      // Quota is NOT an outage — the service is fine, the user hit
      // their cap. Don't trip the breaker.
      useQuotaPromptStore
        .getState()
        .openPrompt(params.kind, isCurrentlyPremium());
      throw new QuotaExceededError(params.kind);
    }
    recordLlmFailure();
    throw new Error(error.message);
  }
  if (!data) {
    recordLlmFailure();
    throw new Error('Empty response from anthropic-proxy');
  }
  if ('error' in data) {
    recordLlmFailure();
    throw new Error(data.error.message);
  }
  recordLlmSuccess();
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
// ═════════════════════════════════════════════════════════════════════
// llmClarify — the TINY "what did they mean" pass (goal: any mistake
// gets fixed by Lumi's suggestion, cheaply).
//
// When a transcript looks wrong and the deterministic rules couldn't
// confidently repair it, this asks the model ONLY to recover the
// intended text — ~100 output tokens vs ~3000 for the full
// understand pass. The fixed text then flows through the
// DETERMINISTIC engine (and usually routes local), so the expensive
// call never happens for a capture that just needed de-garbling.
// ═════════════════════════════════════════════════════════════════════
const CLARIFY_SYSTEM = `You repair speech-to-text and typing mistakes in a short task capture. Return ONLY JSON: {"fixed":"..."}. Reply in the SAME language as the input — never translate.
Rules:
- Recover what the user MEANT: mishears ("call emori tomato" → "call Emory tomorrow"), split words ("to morrow"), typos, dropped words.
- Keep names and words you cannot confidently fix exactly as given.
- NEVER add, remove, or reorder tasks. NEVER invent details, times, or dates that aren't implied by the mistake itself.
- Keep the user's casual voice. No punctuation beautification beyond what meaning requires.`;

// Same dedupe idea as understandCache — repeated sends of the same
// garble (double-tap, edit-and-retry) must not bill Haiku twice.
let clarifyCache: { raw: string; fixed: string | null; at: number } | null =
  null;
const CLARIFY_CACHE_MS = 5 * 60_000;

export const llmClarify = async (raw: string): Promise<string | null> => {
  if (!isAnthropicConfigured) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300) return null;
  if (
    clarifyCache &&
    clarifyCache.raw === trimmed &&
    Date.now() - clarifyCache.at < CLARIFY_CACHE_MS
  ) {
    return clarifyCache.fixed;
  }
  try {
    const text = await Promise.race([
      callMessages({
        kind: 'clarify',
        maxTokens: 120,
        messages: [{ role: 'user', content: trimmed }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('clarify timeout')), 4000),
      ),
    ]);
    const parsed = extractJson<{ fixed?: unknown }>(text);
    if (typeof parsed.fixed !== 'string') return null;
    const fixed = parsed.fixed.trim().slice(0, 300);
    const out = fixed.length > 0 ? fixed : null;
    clarifyCache = { raw: trimmed, fixed: out, at: Date.now() };
    return out;
  } catch {
    return null; // deterministic tidy already parked a usable version
  }
};

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

  1b. SELF-CORRECTIONS: spoken input contains disruptions — "no wait",
     "scratch that", "actually make that 4pm", "…I mean…". Honor ONLY
     the corrected version. NEVER create a task from an abandoned
     first attempt ("call mom no wait call dad" = ONE task: call dad).

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

                    CRITICAL — split "about X" / "for X" / "regarding X" / "re: X"
                    out of the title and into the NOTE. The title is the
                    ACTION + WHO/WHERE; the topic belongs in the note. The
                    title gets shorter AND the note carries the why. This
                    applies even when the title is already under 6 words.
                      "Call mom about doctor appointment"
                          → title: "Call mom"
                            note:  "About doctor appointment"
                      "Email Sarah about the Q3 report"
                          → title: "Email Sarah"
                            note:  "About the Q3 report"
                    SAME RULE for em-dash / comma context appended to an action:
                      "Get the vase — the ceramic one she liked"
                          → title: "Get the vase"
                            note:  "The ceramic one she liked"
                      "Email Sarah, she's waiting"
                          → title: "Email Sarah"
                            note:  "She's waiting"
                    EXCEPTION — keep the topic in the title when the action
                    is meaningless without it ("doctor appointment", "tax
                    return", "rent payment" are atomic noun phrases that
                    READ as the task itself).
                      "Schedule a doctor appointment"  → title: "Schedule doctor appointment" (no note — "schedule" alone is too vague)
                      "Pay rent"                       → title: "Pay rent" (no note — "pay" alone is too vague)

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

                    Voice rules for note: never write "user"/"the
                    user" or second-person "you" — the note IS the
                    speaker's own context, not narration about them.
                    Strip first-person framing ("I forgot" → "Forgot
                    last time"). One short phrase, not a sentence.

Rules:
- NEVER invent a date or time the user didn't imply. Leave when fields empty if unsure.
- ISO dates are LOCAL to the today reference provided.
- Splitting (CRITICAL — split every real action, but don't invent extras):
    SPLIT when the input contains MULTIPLE SEPARATE ACTIONS. All of these
    are split signals; treat each equally:
      • "and" between two verb phrases:
          "Call mom AND pay rent"                     → 2 tasks
          "Email Sarah AND book the flight"           → 2 tasks
      • COMMAS between action fragments — EACH fragment starts with a verb
        (or is a familiar chore noun like "gas", "dishes", "groceries"):
          "finish the deck, reply to Sam, book dentist, tidy the desk"
                                                       → 4 tasks
          "call mom, groceries, dishes"               → 3 tasks
          "email Bob, text Sarah, buy milk"           → 3 tasks
        A comma-list with NO "and" is still a list — the missing connector
        word is just how people type when they're brain-dumping. Extract
        every fragment; don't collapse them into one task.
      • Period or newline between sentences:
          "Pay rent. Buy milk. Clean the sink."       → 3 tasks
      • "then" / "oh and also" / "and then":
          "Get gas then groceries then home"          → 2 tasks (skip "go home")

    DO NOT split when:
      • "and" connects two TOPICS / SUBJECTS of the SAME action:
          "Speak with David about price AND deadline" → 1 task, note: "price and deadline"
          "Talk to mom about car AND insurance"       → 1 task, note: "car and insurance"
      • "and" or "," connects DESCRIPTORS or DETAILS of one action:
          "Buy milk, eggs, and bread"                 → 1 task ("Buy groceries"), note: "milk, eggs, bread"
          "Send David the contract and the brief"     → 1 task, note: "contract and brief"
      • A comma sets off an APPOSITIVE (a name / role / descriptor for the
        subject of the same action):
          "Email Bob, the manager, about the deadline" → 1 task ("Email Bob"),
                                                          note: "The manager — about deadline"
          "Talk to David, my mentor, tomorrow"         → 1 task, note: "My mentor"
        Signal: the fragment after the comma is a NOUN PHRASE describing
        someone/something in the previous fragment, NOT a new verb.
      • The second item is CLEARLY CONTEXT, not its own action ("deadline",
        "price", "details", "the rest" — nouns describing the first task).
      • The second item is a THING TO DO DURING the first (the first is an
        event / anchor, the second is a "while I'm there" reminder).
        Signal phrases: "remind me to", "remind myself to", "don't forget
        to", "ask about/for", "bring up", "mention", "while I'm there",
        "make sure to":
          "Go to work at 5 AND remind myself to ask for a raise"
                                                      → 1 task ("Go to work"), note: "Ask for a raise"
          "Dinner with mom, don't forget to bring up the dentist"
                                                      → 1 task ("Dinner with mom"), note: "Bring up the dentist"
          "Doctor at 9 AND ask about my back"         → 1 task ("Doctor at 9"), note: "Ask about back"
        The reminder is NOT its own schedulable event — it lives inside the first.

    Quick check for EACH fragment: does it start with a VERB or is it a
    complete task noun that someone could DO on its own? If yes → own task.
    Is it a noun-phrase describing something in the previous fragment? If
    yes → belongs in the previous task's note.

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

- CASUAL CHATTER + REAL TASKS: users vent while they capture. Extract ONLY the
  actionable parts; drop the pure venting.
    "man today sucks, gotta finish that report by 5pm otherwise the boss
     will kill me"
        → 1 task ("Finish report"), when.time: "17:00", importance: high
    "ugh so tired but I still need to send the invoice"
        → 1 task ("Send invoice"), importance: medium
    "I'm so stressed about the presentation, need to prep slides, also
     groceries"
        → 2 tasks: "Prep slides" (importance: high — dread + presentation
          weight), "Buy groceries" (importance: medium)
    Signal: strip clauses that are pure feeling ("man today sucks", "ugh",
    "so stressed") — they're context, not tasks. Keep the ACTION clauses.

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

- HABIT-PHRASING ("every…"): "I want to start meditating every day" → 1 task,
  title "Meditate", recur: { every: "day" }. Don't make it "Start meditating".

- BUNDLED SCOPE: "Quick 15-min call with David about the entire Q3 plan" →
  trust the user's 15 if they said it (durationMin: 15) even though it sounds
  short for the scope; THEY know their reality.

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

LANGUAGE: the capture may be in ANY language. Write title and note in
the USER'S language (the language they wrote in) — never translate
their words to English. Field NAMES and enum VALUES (importance,
energyDemand, part, recur.every, recur.day) stay the canonical English
tokens exactly as specified; dates stay ISO. "llamar a mamá mañana" →
{"tasks":[{"title":"Llamar a mamá","when":{"date":"<tomorrow>"}}]}.

OUTPUT FORMAT (COST-CRITICAL — follow EXACTLY):
- Return RAW MINIFIED JSON on ONE line: {"tasks":[...]} — no markdown fences, no prose before or after, no spaces after ":" or ",", no newlines, no indentation.
- OMIT every field that sits at its default instead of writing it:
    importance "medium" → omit it. energyDemand "medium" → omit it.
    hasDeadline false → omit it. No note → omit it. Empty when → omit it.
- Only these keys may appear: title, importance, energyDemand, when (date, time, part, recur, durationMin), hasDeadline, note.

EXAMPLES (input → the EXACT output shape expected):

Input (Today: 2026-03-10, Now 14:00): "ok so call mom no wait call dad tomorrow and I really really need to finally do my taxes ugh also groceries"
Output: {"tasks":[{"title":"Call dad","when":{"date":"2026-03-11"}},{"title":"Do taxes","importance":"high","energyDemand":"high"},{"title":"Buy groceries"}]}

Input: "dinner with mom at 7, don't forget to bring up the dentist"
Output: {"tasks":[{"title":"Dinner with mom","when":{"time":"19:00"},"note":"Bring up the dentist"}]}

Input: "email sarah about the q3 report by 5pm"
Output: {"tasks":[{"title":"Email Sarah","when":{"time":"17:00"},"note":"About the Q3 report"}]}

Input: "finish the deck, reply to sam, book dentist"
Output: {"tasks":[{"title":"Finish the deck"},{"title":"Reply to Sam"},{"title":"Book dentist","hasDeadline":true}]}

Input: "man today sucks, gotta finish that report by 5 or the boss will kill me"
Output: {"tasks":[{"title":"Finish report","importance":"high","when":{"time":"17:00"}}]}

Input: "I want to start meditating every morning"
Output: {"tasks":[{"title":"Meditate","when":{"part":"morning","recur":{"every":"day"}}}]}

Input: "when do I have time tomorrow?"
Output: {"tasks":[]}

Input (Today: 2026-03-10): "cant sleep too much to do tmrw rent gym call mom ugh"
Output: {"tasks":[{"title":"Pay rent","when":{"date":"2026-03-11"},"importance":"high"},{"title":"Gym","when":{"date":"2026-03-11"}},{"title":"Call mom","when":{"date":"2026-03-11"}}]}

Input: "everything is piling up rent due friday moms bday saturday gotta buy smth"
Output: {"tasks":[{"title":"Pay rent","when":{"date":"<that friday>"},"importance":"high","hasDeadline":false},{"title":"Buy mom a birthday gift","when":{"date":"<that saturday>"},"note":"Mom's birthday Saturday"}]}

WORST-CASE STANCE: people capture at their lowest — no punctuation,
no capitals, typos, despair wrapped around real tasks. The despair
("cant sleep", "im screwed", "why cant i just do things") is NEVER a
task and never poisons a title. Find every real action buried in the
mess; if the whole capture is only despair, return {"tasks":[]} and
let the app's gentler surfaces catch them.`;

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
   * Titles (+ window) of the tasks ALREADY on today's plan — lets
   * the model spot duplicates and weigh placement against real load
   * (a 10th task lands differently than a 2nd). Cap ~12; dynamic
   * (uncached) input but short.
   */
  todayTasks?: string[];

  /**
   * One-line summaries of the user's recent Tweak corrections — what
   * they CHANGED on past LLM guesses. Compounds over time so the
   * model mirrors learned preferences ("user always moves 'gym' to
   * evening", "user re-titles 'meeting' to 'sync'"). Per
   * lumi-smarter-ai-spec.md §6 — this is the moat.
   */
  recentCorrections?: string[];
}

// Sanitize USER-CONTROLLED strings before they join the context block
// (security audit §4 — prompt-injection surface). A name or struggle
// set to "Bryan\n\nIgnore all previous instructions…" must not be able
// to open a new instruction line: newlines/control chars collapse to
// spaces and length is capped so a hostile value can't crowd out the
// real instructions. Trusted labels never pass through this.
const safeCtx = (s: string, max = 80): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .slice(0, max);

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
    parts.push(
      `Struggles: ${ctx.struggles.map((s) => safeCtx(s)).join(', ')}`,
    );
  }
  if (ctx.userName && ctx.userName.trim().length > 0) {
    parts.push(`User's name: ${safeCtx(ctx.userName, 40)}`);
  }
  if (ctx.todayTasks && ctx.todayTasks.length > 0) {
    parts.push(
      `Already on today's plan (${ctx.todayTasks.length} task${
        ctx.todayTasks.length === 1 ? '' : 's'
      }) — if the capture repeats one of these, still return it (the app dedupes), but use the load to judge placement:\n${ctx.todayTasks
        .map((t) => `  - ${safeCtx(t, 70)}`)
        .join('\n')}`,
    );
  }
  if (ctx.recentCorrections && ctx.recentCorrections.length > 0) {
    parts.push(
      `Recent corrections (this user's actual preferences — MIRROR these patterns when they apply):\n${ctx.recentCorrections
        .map((c) => `  - ${safeCtx(c, 160)}`)
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
// Dedupe cache (goal §2.3) — a double-tap of Send, or a voice retry
// of the same sentence, must not bill twice. Same raw text within
// the window → last result, zero tokens. One entry is enough (the
// pattern is always immediate re-submission, not history replay).
let understandCache: {
  raw: string;
  result: UnderstoodResponse;
  at: number;
} | null = null;
const UNDERSTAND_CACHE_MS = 5 * 60_000;

export const llmUnderstand = async (
  raw: string,
  ctx: UnderstandContext,
): Promise<UnderstoodResponse | null> => {
  if (!isAnthropicConfigured) return null;
  if (
    understandCache &&
    understandCache.raw === raw.trim() &&
    Date.now() - understandCache.at < UNDERSTAND_CACHE_MS
  ) {
    return understandCache.result;
  }
  try {
    const ctxBlock = buildContextBlock(ctx);
    const content = `${ctxBlock}\n\nUser wrote: ${raw}`;
    // B9 — a hung upstream must not pin the "Lumi is sorting…" card
    // forever; 15s is far beyond p99 (~2s measured) so this only
    // fires on genuine hangs, and callers fall back deterministic.
    const callOnce = (suffix = ''): Promise<string> =>
      Promise.race([
        callMessages({
          kind: 'title_clean',
          maxTokens: 3000,
          messages: [{ role: 'user', content: content + suffix }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('understand timeout')), 15000),
        ),
      ]);
    let text = await callOnce();
    let parsed: UnderstoodResponse;
    try {
      parsed = extractJson<UnderstoodResponse>(text);
    } catch {
      // B3 — the captures that most need the LLM (long dumps) are the
      // likeliest to come back malformed. One strict retry, paid only
      // on the failure path, recovers them before the deterministic
      // fallback.
      text = await callOnce(
        '\n\nIMPORTANT: Return ONLY the valid minified JSON object {"tasks":[...]} — no prose, no markdown fences.',
      );
      parsed = extractJson<UnderstoodResponse>(text);
    }
    if (!parsed || !Array.isArray(parsed.tasks)) return null;
    // Sanitize each task — coerce shape so a misbehaving model
    // doesn't blow up the caller. Drop tasks without a title.
    // NOTE — an empty tasks array is a LEGITIMATE success (the LLM
    // correctly extracted "nothing to do" from a question like
    // "when do I have time tomorrow?" or a pure emoji "😩😩").
    // We return `{ tasks: [] }` in that case, NOT null. Callers who
    // want "empty means do nothing" can check `.tasks.length === 0`.
    // Returning null here would conflate real errors (JSON parse
    // failure, network) with valid empty extraction — the benchmark
    // fails on both, and Home's upgrade path wipes the deterministic
    // preview unnecessarily.
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
          if (typeof t.when.time === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(t.when.time)) {
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
    understandCache = { raw: raw.trim(), result: { tasks }, at: Date.now() };
    return { tasks };
  } catch (e) {
    // DEV-visible failure reason — a silent null here cost a full
    // debugging session (truncated JSON from the proxy's token cap
    // looked identical to "LLM not configured"). Never logs user
    // content.
    if (__DEV__) {
      console.warn(
        '[llm] understand failed:',
        e instanceof Error ? e.message : String(e),
      );
    }
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
    { "taskId": "<id>",               "action": "surface",     "window": "morning"|"midday"|"afternoon"|"evening", "why": "<short reason>" },
    { "taskId": "<id>",               "action": "complete",    "why": "<short celebration>" },
    { "taskId": "",                   "action": "create",      "title": "<imperative title>", "at": "HH:MM"|null, "date": "YYYY-MM-DD"|null, "importance": "high"|"medium"|"low", "energyDemand": "high"|"medium"|"low", "durationMin": <number>|null, "why": "<short reason>" }
  ],
  "proactive": "<one short gentle note, or omit>"
}

Action rules:
- "schedule":   set a part-of-day window for a task that's already on the selected day.
- "reschedule": move a task to a specific date (and optional clock time at "HH:MM" 24-hour).
- "defer":      park to "later". Use sparingly.
- "surface":    pull a task onto the selected day at a given window.
- "create":     ADD a new task the user just mentioned ("I forgot I had a client meeting at 8am",
                "wait I also need to call David", "oh, dentist Thursday at 2"). Use when the user
                surfaces something that ISN'T in the pile and needs to land on a real day.
                Required: title (imperative, no "I/me/my"), importance, energyDemand.
                Optional: date (defaults to selected day), at (clock time if user named one),
                durationMin (only if they implied one — "30-min meeting" → 30).
                NEVER use 'create' to invent tasks the user didn't actually mention.
- "complete":   the user says a pile task is already DONE ("already called mom",
                "did the dishes this morning", "finished the report"). Emit ONE
                complete per finished task so a single tap checks it off — the
                app pays the XP/streak celebration. Only for tasks IN the pile;
                if what they finished isn't in the pile, celebrate in "say" with
                an empty proposal (never create-then-complete).
- Energy: high energyDemand → user's PEAK; low → SLUMP/evening; medium → neutral.
- NEVER stack on top of an anchor (meal/sleep). NEVER duplicate the same task in proposal.
- Use ONLY taskIds from the pile context for non-create actions. Do not invent ids. If unsure, leave proposal empty.
- For 'create', taskId is "" (empty) — the client mints the id when it adds the task.
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
- "I forgot I had X at Y" / "wait I also have…" / "oh, I have a meeting at 8"
  (something NEW the user just surfaced — NOT in the pile):
    → emit a 'create' proposal with the new task. Pull the title (imperative
    form — "Client meeting", "Call David", "Dentist"), the time if they named
    one ("8am" → at: "08:00"), the date if they implied one (today by default).
    Importance is usually HIGH (forgotten things they're now stressing about
    are real commitments). EnergyDemand reads from the kind of task (meetings
    & calls = medium, deep work = high, errands = low).
    Reply acknowledges WITHOUT amplifying the stress: "Got it — adding
    [thing] for [time]. Let me see what conflicts."
    THEN: if any existing pile item is scheduled near that time, ALSO emit a
    second proposal item that moves the conflict (reschedule or defer) so the
    user's day actually fits. ALWAYS pair the create with a calm "tap to add"
    framing — the user is stressed; one clear action chip helps.
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
    → if X matches a pile task, emit a 'complete' proposal for it (the tap IS
    the celebration — never make them hunt for the checkbox). Acknowledge the
    win warmly in "say" either way. Don't pivot to "great, what's next?".

Edge cases:
- If the pile is empty, the proposal MUST be empty. Reply gently.
- If the user names a task that isn't in the pile, don't invent it — say so plainly ("Don't see that one on your plate — want me to add it?").
- If "today" / "tonight" is already past (per "Now" in context), shift to tomorrow.
- If their message is all-caps or has !!!, that's emphasis, not anger. Don't
  escalate your tone. Stay calm.
- If they thank you / "you're the best", reply briefly without proposing
  anything ("anytime — I'm here when you need me."). Don't grovel.

Return ONLY the JSON object — MINIFIED on one line, no markdown fences,
no spaces after ":" or ",". Every stripped space is tokens the user
doesn't pay for.`;

export type UntangleAction =
  | 'schedule'
  | 'reschedule'
  | 'defer'
  | 'surface'
  | 'create'
  | 'complete';

export interface UntangleProposalItem {
  /** Pile task id — required for every action EXCEPT 'create'. For
   *  create the LLM doesn't know an id yet (the task doesn't exist).
   *  We accept an empty string and the apply layer mints the id. */
  taskId: string;
  action: UntangleAction;
  window?: 'morning' | 'midday' | 'afternoon' | 'evening' | 'someday';
  date?: string;
  at?: string;
  why?: string;
  // ── 'create' only — let the LLM mint a new task in-thread when
  // the user surfaces something they forgot ("oh I had a 8am
  // meeting"). The apply path turns these into addQuest() calls.
  /** Required for 'create'. Imperative title ("Call David"). */
  title?: string;
  importance?: 'high' | 'medium' | 'low';
  energyDemand?: 'high' | 'medium' | 'low';
  durationMin?: number;
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
  /** Parked tasks beyond the pile cap — lets Lumi say "and 22 more
   *  parked" instead of pretending they don't exist. */
  parkedOverflow?: number;
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
    // Cache split: the pile + profile head is byte-identical between
    // turns (until an Approve mutates the pile) and gets cached
    // server-side — but ONLY if the volatile "Now: …" clock line
    // stays out of it. Turns 2+ then read the head at 10% input
    // price instead of re-paying full freight every message.
    const volatile: string[] = [];
    const stable: string[] = [];
    for (const line of ctxBlock.split('\n')) {
      (line.startsWith('Now:') || line.startsWith('Today') ? volatile : stable).push(line);
    }
    const head: AnthropicMessage = {
      role: 'user',
      content: `${stable.join('\n')}\nSelected day: ${ctx.selectedDayISO}\n\nThe user's pile right now:\n${pileLines || '(empty pile)'}${
        ctx.parkedOverflow && ctx.parkedOverflow > 0
          ? `\n(…and ${ctx.parkedOverflow} more parked in Later, oldest not shown)`
          : ''
      }`,
    };
    const clock: AnthropicMessage = {
      role: 'user',
      content: volatile.join('\n') || `Now: ${ctx.nowLabel}`,
    };
    // Bound history to last 8 turns to keep tokens reasonable.
    const tail = thread.slice(-8);
    const text = await callMessages({
      kind: 'untangle',
      maxTokens: 700,
      messages: [head, clock, ...tail],
    });
    const parsed = extractJson<UntangleTurnResponse>(text);
    if (!parsed || typeof parsed.say !== 'string' || parsed.say.trim().length === 0) {
      return null;
    }
    const proposal = Array.isArray(parsed.proposal)
      ? parsed.proposal
          .map((p): UntangleProposalItem | null => {
            if (!p || typeof p.taskId !== 'string') return null;
            const isCreate = p.action === 'create';
            // 'create' is the only action allowed to have an empty
            // taskId (the task doesn't exist yet). For everything
            // else, an empty/missing taskId is a hard reject.
            if (!isCreate && p.taskId.length === 0) return null;
            if (
              p.action !== 'schedule' &&
              p.action !== 'reschedule' &&
              p.action !== 'defer' &&
              p.action !== 'surface' &&
              p.action !== 'create' &&
              p.action !== 'complete'
            ) {
              return null;
            }
            // Create requires a non-empty title — without it the task
            // would commit as untitled. Skip silently rather than crash.
            if (
              isCreate &&
              (typeof p.title !== 'string' || p.title.trim().length === 0)
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
            if (typeof p.at === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(p.at)) {
              item.at = p.at;
            }
            if (typeof p.why === 'string' && p.why.length > 0) {
              item.why = String(p.why).slice(0, 120);
            }
            // Create-only fields. We clamp and validate so a hostile
            // LLM response can't smuggle in a 9-digit duration or a
            // 400-char title that crashes the UI.
            if (isCreate && typeof p.title === 'string') {
              item.title = p.title.trim().slice(0, 140);
            }
            if (
              p.importance === 'high' ||
              p.importance === 'medium' ||
              p.importance === 'low'
            ) {
              item.importance = p.importance;
            }
            if (
              p.energyDemand === 'high' ||
              p.energyDemand === 'medium' ||
              p.energyDemand === 'low'
            ) {
              item.energyDemand = p.energyDemand;
            }
            if (
              typeof p.durationMin === 'number' &&
              Number.isFinite(p.durationMin) &&
              p.durationMin > 0 &&
              p.durationMin <= 600
            ) {
              item.durationMin = Math.round(p.durationMin);
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


