// Lumi · task kinds — the semantic "what sort of thing is this?"
// layer (REACH OUT / ERRAND / WORK / HOME / SOMEDAY), promoted into
// the app from the waitlist demo everyone loved.
//
// Distinct from importance (Trial/Task/Whim = how much it matters)
// and window (when) — kind is WHAT it is, and it carries two gifts:
// a warm color and a typical duration, so a bare "call the dentist"
// arrives pre-sized at ~10 min without the user touching a chip.
//
// COLOR LAW fit: these are Lumi's READ of the task (not a user
// action), so they lean on the ambient palette — dusk for reaching
// out, honey for errands, ember for work, lichen for home, amethyst
// for someday. Deterministic, zero tokens, same regexes as the
// landing-page demo so the taste and the product agree.

export type TaskKindKey =
  | 'reach_out'
  | 'errand'
  | 'work'
  | 'home'
  | 'someday'
  | 'task';

export interface TaskKind {
  key: TaskKindKey;
  /** Short tag label, uppercase-styled by the UI. */
  label: string;
  /** Tag/dot color (timeColors palette). */
  color: string;
  /** Typical duration in minutes — seeds durationMinutes when the
   *  user didn't say. null = no estimate ("no rush"). */
  defaultMinutes: number | null;
  /** Human phrase for pattern copy ("mostly phone calls"). */
  plural: string;
}

const KINDS: Record<TaskKindKey, TaskKind> = {
  reach_out: {
    key: 'reach_out',
    label: 'reach out',
    color: '#8EA0B4', // dusk
    defaultMinutes: 10,
    plural: 'calls and messages',
  },
  errand: {
    key: 'errand',
    label: 'errand',
    color: '#C9A06A', // honey
    defaultMinutes: 15,
    plural: 'errands',
  },
  work: {
    key: 'work',
    label: 'work',
    color: '#E07A4F', // ember
    defaultMinutes: 45,
    plural: 'work things',
  },
  home: {
    key: 'home',
    label: 'home',
    color: '#869072', // lichen
    defaultMinutes: 20,
    plural: 'house stuff',
  },
  someday: {
    key: 'someday',
    label: 'someday',
    color: '#9A85A8', // amethyst
    defaultMinutes: null,
    plural: 'someday things',
  },
  task: {
    key: 'task',
    label: 'task',
    color: '#F4C98A', // glow
    defaultMinutes: null,
    plural: 'things',
  },
};

// First match wins — same ordering as the landing demo, with a few
// app-grade extensions (pay/bills → errand money-run, appointments →
// reach out, chores list widened).
const RULES: Array<{ re: RegExp; kind: TaskKindKey }> = [
  {
    re: /\b(call|text|email|reply|respond|message|reach out|follow up|rsvp|mom|dad|grandma|dr\b|doctor|dentist|therapist)\b/i,
    kind: 'reach_out',
  },
  {
    re: /\b(buy|get|pick up|order|grocer|groceries|store|return|renew|pay|bill|deposit|mail|ship|drop off|pharmacy|errand)\b/i,
    kind: 'errand',
  },
  {
    re: /\b(work|deck|report|meeting|boss|deadline|client|invoice|send|finish|write|draft|review|submit|presentation|project|standup|email sarah)\b/i,
    kind: 'work',
  },
  {
    re: /\b(clean|tidy|laundry|dishes|vacuum|mop|dust|fix|repair|plant|water|garage|closet|yard|declutter|organize)\b/i,
    kind: 'home',
  },
  {
    re: /\b(someday|maybe|eventually|learn|trip|dream|bucket|idea|research trip|explore)\b/i,
    kind: 'someday',
  },
];

/** Classify a title/raw text into a kind. Pure + cheap — safe to
 *  call at render time, so kind never needs storing or syncing. */
export const classifyKind = (text: string): TaskKind => {
  for (const r of RULES) {
    if (r.re.test(text)) return KINDS[r.kind];
  }
  return KINDS.task;
};

export const taskKind = (key: TaskKindKey): TaskKind => KINDS[key];
