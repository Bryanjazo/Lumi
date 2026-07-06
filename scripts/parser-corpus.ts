// Lumi · parser test corpus (lumi-GOAL-smartest-task-manager §1.8)
//
// The scoreboard for the deterministic engine. Every case is a real-
// world-shaped input → the structured output we EXPECT. Cases marked
// with `target: true` encode grammar we're building toward — they're
// allowed to fail while the feature lands, but they still print, so
// the gap is always visible. Everything else is a regression guard.
//
// Run: npm run test:parser
//
// Fixed clock: Friday 2026-07-03 10:00 local (see runner). Every
// dateOffset is DAYS FROM THAT FRIDAY.

import type { Importance } from '../constants/importance';
import type { WindowKey } from '../constants/windows';

export interface ExpectTask {
  /** Case-insensitive exact title match (string) or pattern. */
  title?: string | RegExp;
  importance?: Importance;
  window?: WindowKey;
  /** Days from the fixed "today". null = expressly NO date. */
  dateOffset?: number | null;
  /** Minutes since midnight. null = expressly NO anchored time. */
  at?: number | null;
  recur?: {
    every: string;
    day?: string;
    part?: string;
    interval?: number;
  } | null;
  needsFollowup?: boolean;
  durationMinutes?: number;
  /** Deadline-vs-start: "by thursday" true · "on thursday" false. */
  deadline?: boolean;
}

export interface CorpusCase {
  name: string;
  input: string;
  expect: ExpectTask[];
  /** Encodes grammar still being built — allowed to fail, printed. */
  target?: boolean;
}

export const CORPUS: CorpusCase[] = [
  // ═══ A · Singles + title cleaning (regression guards) ═══
  {
    name: 'plain call',
    input: 'call mom',
    expect: [{ title: 'Call mom', dateOffset: null }],
  },
  {
    name: 'intent prefix strips',
    input: 'i need to call the bank',
    expect: [{ title: 'Call the bank' }],
  },
  {
    name: 'stacked prefixes strip',
    input: "don't forget to water the plants",
    expect: [{ title: 'Water the plants' }],
  },
  {
    name: 'keep meaning to strips',
    input: 'i keep meaning to work on the side project',
    expect: [{ title: 'Work on the side project' }],
  },
  {
    name: 'filler words vanish',
    input: 'um basically just fix the sink',
    expect: [{ title: 'Fix the sink' }],
  },
  {
    name: 'trailing vent clause cut',
    input: "finish the quarterly report by thursday it's stressing me out",
    expect: [
      {
        title: 'Finish the quarterly report',
        importance: 'high',
        dateOffset: 6,
      },
    ],
  },
  {
    name: 'pure vent drops',
    input: 'ok my brain is all over the place today',
    expect: [],
  },
  {
    name: 'location hint strips',
    input: 'pick up dog food on the way home',
    expect: [{ title: 'Pick up dog food' }],
  },

  // ═══ B · Explicit times (regression guards) ═══
  {
    name: 'pm time',
    input: 'gym at 6pm',
    expect: [{ title: 'Gym', at: 18 * 60 }],
  },
  {
    name: 'colon time',
    input: 'standup at 9:30am',
    expect: [{ at: 9 * 60 + 30 }],
  },
  {
    name: '24h time',
    input: 'deploy at 17:00',
    expect: [{ at: 17 * 60 }],
  },
  {
    name: 'tomorrow + time',
    input: 'dentist tomorrow at 2:30pm',
    expect: [{ dateOffset: 1, at: 14 * 60 + 30 }],
  },
  {
    name: 'small bare hour defaults pm',
    input: 'call the landlord at 4',
    expect: [{ at: 16 * 60 }],
  },
  {
    name: 'in N minutes',
    input: 'take the bread out in 20 minutes',
    expect: [{ at: 10 * 60 + 20, dateOffset: 0 }],
  },
  {
    name: 'in an hour',
    input: 'leave in an hour',
    expect: [{ at: 11 * 60, dateOffset: 0 }],
  },
  {
    name: 'tonight window',
    input: 'water the plants tonight',
    expect: [{ window: 'evening', dateOffset: 0 }],
  },
  {
    name: 'before bed anchors near sleep',
    input: 'journal before bed',
    expect: [{ window: 'evening', at: 22 * 60 + 40 }],
  },

  // ═══ C · §1.1 date grammar (mostly target) ═══
  {
    name: 'weekday resolves forward',
    input: 'submit the form thursday',
    expect: [{ dateOffset: 6 }],
  },
  {
    name: 'in 3 days',
    input: 'follow up with alex in 3 days',
    expect: [{ dateOffset: 3 }],
    target: true,
  },
  {
    name: 'in 2 weeks',
    input: 'renew the parking permit in 2 weeks',
    expect: [{ dateOffset: 14 }],
    target: true,
  },
  {
    // Device-caught bug (Jul 4): stripTokens' recurrence cleanup ate
    // the bare word "weekend" before the token loop, leaving the
    // qualifier — hero card literally said "Groceries this".
    name: 'this weekend keeps title clean',
    input: 'groceries this weekend',
    expect: [{ title: 'Groceries', dateOffset: 1 }],
  },
  {
    name: 'window qualifier does not dangle',
    input: 'call mom this evening',
    expect: [{ title: 'Call mom', window: 'evening' }],
  },
  {
    name: 'next week',
    input: 'dentist next week',
    expect: [{ title: 'Dentist', dateOffset: 3 }],
  },
  {
    name: 'nxt week shorthand',
    input: 'dentist nxt week',
    expect: [{ title: 'Dentist', dateOffset: 3 }],
    guard: true,
  },
  {
    name: 'this week is a soft deadline',
    input: 'finish the report this week',
    expect: [{ title: 'Finish the report', dateOffset: 2, deadline: true }],
  },
  {
    name: 'this weekend',
    input: 'clean the garage this weekend',
    expect: [{ dateOffset: 1 }],
    target: true,
  },
  {
    name: 'next weekend',
    input: "order mom's gift next weekend",
    expect: [{ dateOffset: 8 }],
    target: true,
  },
  {
    name: 'next friday is not today',
    input: 'send the invoice next friday',
    expect: [{ dateOffset: 7 }],
    target: true,
  },
  {
    name: 'end of week',
    input: 'expense report by end of week',
    expect: [{ dateOffset: 2, deadline: true }],
    target: true,
  },
  {
    name: 'eod',
    input: 'reply to legal by eod',
    expect: [{ dateOffset: 0, deadline: true }],
    target: true,
  },
  {
    name: 'end of month',
    input: 'cancel the trial by end of the month',
    expect: [{ dateOffset: 28, deadline: true }],
    target: true,
  },
  {
    name: 'first of the month',
    input: 'pay rent on the first of the month',
    expect: [{ dateOffset: 29 }],
    target: true,
  },
  {
    name: 'tmrw synonym',
    input: 'tmrw call the vet',
    expect: [{ dateOffset: 1, title: 'Call the vet' }],
    target: true,
  },
  {
    name: 'tmmrw texting typo (double-m, no vowels)',
    input: 'call my mom tmmrw',
    expect: [{ dateOffset: 1, title: 'Call my mom' }],
    guard: true,
  },
  {
    name: 'tmw shorthand',
    input: 'tmw gym',
    expect: [{ dateOffset: 1 }],
    guard: true,
  },
  {
    name: '2moro texting',
    input: 'text sam 2moro',
    expect: [{ dateOffset: 1, title: 'Text sam' }],
    guard: true,
  },
  {
    name: 'tomrrw (dropped vowels)',
    input: 'call mom tomrrw',
    expect: [{ dateOffset: 1, title: 'Call mom' }],
    guard: true,
  },
  {
    name: 'toro is sushi, not tomorrow',
    input: 'order toro sushi',
    expect: [{ title: 'Order toro sushi' }],
    guard: true,
  },

  // ═══ Wave-1 grammar batch (improvement plan A1–A9) ═══
  {
    name: 'A2: biweekly',
    input: 'water the plants biweekly',
    expect: [{ recur: { every: '2week' }, title: 'Water the plants' }],
    guard: true,
  },
  {
    name: 'A2: twice a week lands weekly (model floor)',
    input: 'call dad twice a week',
    expect: [{ recur: { every: 'week' } }],
    guard: true,
  },
  {
    name: 'A3: no rush reads low',
    input: 'fix the website no rush',
    expect: [{ importance: 'low' }],
    guard: true,
  },
  {
    name: 'A3: whenever reads low',
    input: 'call grandma whenever',
    expect: [{ importance: 'low' }],
    guard: true,
  },
  {
    name: 'A4: numbered list splits clean',
    input: '1) email sarah 2) laundry 3) water plants',
    expect: [
      { title: 'Email sarah' },
      { title: 'Laundry' },
      { title: 'Water plants' },
    ],
    guard: true,
  },
  {
    name: 'A4: bullet symbols split clean',
    input: '• gym • dishes • call mom',
    expect: [{ title: 'Gym' }, { title: 'Dishes' }, { title: 'Call mom' }],
    guard: true,
  },
  {
    name: 'A5: in a couple hours',
    input: 'call the vet in a couple hours',
    expect: [{ at: 12 * 60, title: 'Call the vet' }],
    guard: true,
  },
  {
    name: 'A6: half past 2 is 14:30',
    input: 'meeting at half past 2',
    expect: [{ at: 14 * 60 + 30 }],
    guard: true,
  },
  {
    name: 'A6: quarter to 3 is 14:45',
    input: 'call at quarter to 3',
    expect: [{ at: 14 * 60 + 45 }],
    guard: true,
  },
  {
    name: 'A1: around 3 parses as a soft 15:00',
    input: 'gym around 3',
    expect: [{ at: 15 * 60, title: 'Gym' }],
    guard: true,
  },
  {
    name: 'A1: 4ish',
    input: 'coffee with sam 4ish',
    expect: [{ at: 16 * 60 }],
    guard: true,
  },
  {
    name: 'A7: for 30 minutes sets duration, cleans title',
    input: 'meeting for 30 minutes',
    expect: [{ title: 'Meeting', durationMinutes: 30 }],
    guard: true,
  },
  {
    name: 'A7: 1-hour call',
    input: '1-hour call with mom',
    expect: [{ durationMinutes: 60 }],
    guard: true,
  },
  {
    name: 'A7: in 15 minutes stays a START time, not duration',
    input: 'call mom in 15 minutes',
    expect: [{ at: 10 * 60 + 15 }],
    guard: true,
  },
  {
    name: 'A8: about splits into note',
    input: 'call mom about the doctor appointment',
    expect: [{ title: 'Call mom', note: 'About the doctor appointment' }],
    guard: true,
  },
  {
    name: 'A8: think about stays whole',
    input: 'think about the trip',
    expect: [{ title: 'Think about the trip' }],
    guard: true,
  },
  {
    name: 'A9: a week from friday',
    input: 'call the landlord a week from friday',
    expect: [{ dateOffset: 14, title: 'Call the landlord' }],
    guard: true,
  },
  {
    name: 'A9: this coming tuesday',
    input: 'dentist this coming tuesday',
    expect: [{ dateOffset: 4 }],
    guard: true,
  },
  {
    name: 'noon',
    input: 'lunch with sam at noon',
    expect: [{ at: 12 * 60 }],
    target: true,
  },
  {
    name: 'deadline flag: by thursday',
    input: 'pay the deposit by thursday',
    expect: [{ dateOffset: 6, deadline: true }],
    target: true,
  },
  {
    name: 'start flag: on thursday',
    input: 'start the mural on thursday',
    expect: [{ dateOffset: 6, deadline: false }],
    target: true,
  },

  // ═══ D · §1.1 anchor-relative times (target) ═══
  {
    name: 'after lunch',
    input: 'call the pharmacy after lunch',
    expect: [{ at: 12 * 60 + 45 }], // lunch anchor 12:30 + 15
    target: true,
  },
  {
    name: 'before dinner',
    input: 'tidy the living room before dinner',
    expect: [{ at: 18 * 60 }], // dinner anchor 18:30 − 30
    target: true,
  },
  {
    name: 'after breakfast',
    input: 'take meds after breakfast',
    expect: [{ at: 8 * 60 + 15 }], // breakfast anchor 8:00 + 15
    target: true,
  },
  {
    name: 'after work',
    input: 'swing by the post office after work',
    expect: [{ window: 'evening' }],
    target: true,
  },

  // ═══ E · Recurrence (some target) ═══
  {
    name: 'every weekday-name',
    input: 'take out the trash every monday',
    expect: [{ recur: { every: 'week', day: 'Mon' } }],
  },
  {
    name: 'every morning',
    input: 'every morning do a quick walk',
    expect: [
      { recur: { every: 'day', part: 'morning' }, title: 'Do a quick walk' },
    ],
  },
  {
    name: 'daily',
    input: 'meditate daily',
    expect: [{ recur: { every: 'day' } }],
  },
  {
    name: 'weekdays',
    input: 'pack lunch on weekdays',
    expect: [{ recur: { every: 'weekday' } }],
  },
  {
    name: 'every other tuesday',
    input: 'water the ferns every other tuesday',
    expect: [{ recur: { every: '2week', day: 'Tue' } }],
    target: true,
  },
  {
    name: 'every 2 weeks',
    input: 'clean the fish tank every 2 weeks',
    expect: [{ recur: { every: '2week' } }],
    target: true,
  },
  {
    name: 'every 3 days',
    input: 'water the monstera every 3 days',
    expect: [{ recur: { every: 'day', interval: 3 } }],
    target: true,
  },
  {
    name: 'every weekend',
    input: 'meal prep every weekend',
    expect: [{ recur: { every: 'week', day: 'Sat' } }],
    target: true,
  },

  // ═══ F · §1.4 status → task templates (target) ═══
  {
    name: 'piling up → Do',
    input: 'laundry is piling up',
    expect: [{ title: 'Do laundry' }],
    target: true,
  },
  {
    name: 'is a mess → Clean',
    input: 'the kitchen is a mess',
    expect: [{ title: 'Clean the kitchen' }],
    target: true,
  },
  {
    name: 'overdue bill → Pay + high',
    input: 'rent is overdue',
    expect: [{ title: 'Pay rent', importance: 'high' }],
    target: true,
  },
  {
    name: 'needs doing → Do',
    input: 'the dishes need doing',
    expect: [{ title: 'Do the dishes' }],
    target: true,
  },

  // ═══ G · §1.3 weighted importance (some target) ═══
  {
    name: 'stakes word: exam',
    input: 'study for the biology exam',
    expect: [{ importance: 'high' }],
  },
  {
    name: 'taxes are high',
    input: 'do the taxes',
    expect: [{ importance: 'high' }],
    target: true,
  },
  {
    name: 'quick errand is low',
    input: 'grab paper towels',
    expect: [{ importance: 'low' }],
    target: true,
  },
  {
    name: 'quick text is low',
    input: 'text jess back',
    expect: [{ importance: 'low' }],
    target: true,
  },
  {
    name: 'consumption is low',
    input: 'watch that documentary sometime',
    expect: [{ importance: 'low' }],
  },
  {
    name: 'default is medium',
    input: 'organize the bookshelf',
    expect: [{ importance: 'medium' }],
  },

  // ═══ H · §1.2 multi-task splitting + verb heuristic ═══
  {
    name: 'two verbs split',
    input: 'call the dentist and pay the bill',
    expect: [{ title: 'Call the dentist' }, { title: 'Pay the bill' }],
  },
  {
    name: 'shared verb stays ONE task',
    input: 'pick up coffee beans and dog food',
    expect: [{ title: 'Pick up coffee beans and dog food' }],
    target: true,
  },
  {
    name: 'noun list stays ONE task',
    input: 'buy eggs, milk, and bread',
    expect: [{ title: 'Buy eggs, milk, and bread' }],
    target: true,
  },
  {
    name: 'then splits',
    input: 'email sarah then book the flights',
    expect: [{ title: 'Email sarah' }, { title: 'Book the flights' }],
  },
  {
    name: 'comma verbs split',
    input: 'buy milk, call dad, clean the desk',
    expect: [
      { title: 'Buy milk' },
      { title: 'Call dad' },
      { title: 'Clean the desk' },
    ],
  },
  {
    name: 'newlines split',
    input: 'water plants\nfeed the cat\nvacuum',
    expect: [
      { title: 'Water plants' },
      { title: 'Feed the cat' },
      { title: 'Vacuum' },
    ],
  },
  {
    name: 'mid-string intent marker splits',
    input: "mom's birthday is next weekend don't let me forget to order her gift",
    expect: [{}, { title: 'Order her gift' }],
  },
  {
    name: 'vent between tasks drops',
    input: "call the plumber, i'm so stressed, book the hotel",
    expect: [{ title: 'Call the plumber' }, { title: 'Book the hotel' }],
  },

  // ═══ H2 · Self-corrections (Wispr-Flow behavior, zero tokens) ═══
  {
    name: 'correction: full restatement',
    input: 'call mom no wait call dad',
    expect: [{ title: 'Call dad' }],
  },
  {
    name: 'correction: object swap keeps verb',
    input: 'buy milk, no wait, oat milk',
    expect: [{ title: 'Buy oat milk' }],
  },
  {
    name: 'correction: scratch that + date survives',
    input: 'text jess scratch that text sam tomorrow',
    expect: [{ title: 'Text sam', dateOffset: 1 }],
  },
  {
    name: 'correction: verb particle kept',
    input: 'pick up coffee no wait tea',
    expect: [{ title: 'Pick up tea' }],
  },
  {
    name: 'correction: chained keeps final intent',
    input: 'call mom no wait dad i mean grandma',
    expect: [{ title: 'Call grandma' }],
  },
  {
    name: 'correction inside a multi-dump',
    input: 'finish the report, no wait, the slides, and call the bank',
    expect: [{ title: 'Finish the slides' }, { title: 'Call the bank' }],
  },

  // ═══ H3 · Unpunctuated run-ons (typed, no commas) ═══
  {
    name: 'run-on: three verbs three tasks',
    input: 'call mom buy milk finish the report',
    expect: [
      { title: 'Call mom' },
      { title: 'Buy milk' },
      { title: 'Finish the report' },
    ],
  },
  {
    name: 'run-on: two chores split',
    input: 'make dinner do laundry',
    expect: [{ title: 'Make dinner' }, { title: 'Do laundry' }],
  },
  {
    name: 'run-on guard: noun "call" stays one task',
    input: 'schedule a call with the bank',
    expect: [{ title: 'Schedule a call with the bank' }],
  },
  {
    name: 'run-on guard: "go get" is one clause',
    input: 'go get milk',
    expect: [{ title: 'Go get milk' }],
  },
  {
    name: 'typo date: tomorow',
    input: 'email sarah tomorow',
    expect: [{ title: 'Email sarah', dateOffset: 1 }],
  },

  // ═══ I · The full Bryan dump (end-to-end guard) ═══
  {
    name: 'the mega-dump',
    input:
      "ok my brain is all over the place today — i really need to finish the quarterly report by thursday it's stressing me out, also gotta call the dentist to reschedule my cleaning, pick up coffee beans and dog food on the way home, mom's birthday is next weekend don't let me forget to order her gift, i keep meaning to work on the side project but never do, need to reply to sarah's email about the trip, laundry is piling up, oh and i should go to the gym today, pay the electric bill before it's late, and every morning i want to start doing a quick walk.",
    expect: [
      { title: 'Finish the quarterly report', importance: 'high', dateOffset: 6 },
      { title: 'Call the dentist to reschedule my cleaning' },
      { title: /pick up coffee beans/i },
      {},
      { title: 'Order her gift' },
      { title: 'Work on the side project' },
      { title: "Reply to sarah's email" },
      { title: /laundry/i },
      { title: 'Go to the gym', dateOffset: 0 },
      { title: /pay the electric bill/i },
      { title: 'Start doing a quick walk', recur: { every: 'day', part: 'morning' } },
    ],
    target: true,
  },

  // ═══ J · Follow-up / ambiguity guards ═══
  {
    name: 'deadline-type with no when asks',
    input: 'do the homework',
    expect: [{ needsFollowup: true }],
  },
  {
    name: 'ambiguous bare hour offers options',
    input: 'call mom today at 9',
    expect: [{ dateOffset: 0 }],
  },
];
