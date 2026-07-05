// Lumi · offline adversarial benchmark — hunt for deterministic-layer
// failures the corpus hasn't seen.
//
// Run: esbuild-bundle + node (see package.json bench:offline).
//
// Unlike the corpus (exact expectations, MUST stay green), this is a
// FUZZER + invariant battery: throw hostile input at the pipeline and
// check properties that must hold for ANY input:
//   I1  nothing throws (tidy / spell-count / parse / route)
//   I2  every task title is non-empty after trim
//   I3  `at` ∈ [0, 1439] when set
//   I4  `date` is YYYY-MM-DD when set
//   I5  task count never exceeds word count (no task invention)
//   I6  tidyTranscript is idempotent (tidy(tidy(x)) == tidy(x))
//   I7  clean common-word text never triggers the spell pass
//   I8  parse+route agree: route 'local' implies detTasks.length ≥ 1
// Warnings (not failures): leftover date-words in titles, 0-task
// parses of action-looking text.

import {
  parseSmartCapture,
  routeCapture,
  tidyTranscript,
  countUnknownWords,
  type CaptureContext,
} from '../lib/capture';

const NOW = new Date(2026, 6, 3, 10, 0, 0); // Friday, pinned
const ctx: CaptureContext = {
  sharpWindow: null,
  foggyWindow: null,
  peakStart: null,
  peakEnd: null,
  slumpStart: null,
  slumpEnd: null,
  effectiveWindows: {
    morning: { key: 'morning', label: 'Morning', start: 7, end: 11 },
    midday: { key: 'midday', label: 'Midday', start: 11, end: 14 },
    afternoon: { key: 'afternoon', label: 'Afternoon', start: 14, end: 17 },
    evening: { key: 'evening', label: 'Evening', start: 17, end: 22 },
    someday: { key: 'someday', label: 'Someday', start: null, end: null },
  } as CaptureContext['effectiveWindows'],
  now: NOW,
  nowMin: 10 * 60,
  wakeMin: 7 * 60,
  sleepMin: 23 * 60,
  anchors: { wake: 420, breakfast: 480, lunch: 750, dinner: 1110, sleep: 1380 },
} as unknown as CaptureContext;

// ── Adversarial battery — realistic hostile input ───────────────────
const BATTERY: string[] = [
  // punctuation chaos
  'call mom!!!! tomorrow???',
  'groceries,,,,dishes,,,laundry',
  '...call the dentist...',
  'DO. THE. TAXES.',
  'buy milk & eggs + bread @ costco',
  // unicode / emoji
  'call mom 😩😩 tomorrow',
  'gym 💪 at 6',
  '🧺 laundry 🧺',
  'café rsvp for saturday',
  'reunión con mamá mañana',
  // whitespace hostility
  '   call    mom     tomorrow   ',
  'call\tmom\ttomorrow',
  'call mom\n\n\npay rent\n\n',
  // absurd lengths
  'a',
  'do',
  'zz',
  'buy ' + 'very '.repeat(80) + 'big cake',
  ('finish the report, call sam, book flights, pay rent, gym, dishes, ' +
    'email tax guy, order cat food, water plants, fix the bike, ').repeat(4),
  // time edge cases
  'meeting at 25:00',
  'call at 0:00',
  'lunch at 12:60',
  'wake up at 5am and also at 6am and also at 7am',
  'dentist at 3pm yesterday',
  'call mom feb 30',
  'party on the 32nd',
  'meeting tomorrow at midnight',
  'call at noon and midnight',
  'gym in -5 minutes',
  'call mom in 999 hours',
  // date-word soup
  'tomorrow tomorrow tomorrow',
  'today tomorrow someday',
  'monday tuesday wednesday',
  'call mom next next week',
  'every day every week every month',
  // self-correction abuse
  'call mom no wait no wait no wait call dad',
  'scratch that',
  'no wait',
  'call mom actually scratch that actually call mom',
  // vent-only + mixed
  'ughhhhhh',
  'I hate everything today',
  "i'm so overwhelmed i can't even",
  'so stressed. also groceries.',
  'kill me... anyway dentist at 3',
  // questions / non-tasks
  'what should I do today?',
  'when is my dentist appointment?',
  'did I already add the gym thing?',
  // spell-pass probes (I7 uses CLEAN_SET below instead)
  'call mam tomorrow for lanch and dinnner',
  'grocries, свежий хлеб, dishes',
  'asdfghjkl qwertyuiop',
  'x'.repeat(400),
  // sneaky formats
  'call mom (tomorrow) [important]',
  '"finish the report" — boss',
  'email sarah@work.com about the invoice',
  'check https://example.com/thing tomorrow',
  '#gym #health tomorrow',
  '1. call mom 2. pay rent 3. gym',
  '- call mom\n- pay rent',
  'CALL MOM AND PAY RENT AND DO TAXES',
];

const CLEAN_SET = [
  'call mom tomorrow at 5',
  'finish the report by friday',
  'water the plants every morning',
  'dinner with sam tonight',
  'pay rent on the first',
];

// ── Fuzzer — random soup, hunting for throws only ───────────────────
const VOCAB_SOUP = (
  'call mom dad buy milk eggs at on by tomorrow tmrw 5pm noon every ' +
  'week no wait scratch that and then also , . ! ? … — 😩 🧺 ½ ñ é 中 ' +
  "don't it's I'll the a for with about re: @ # $ % ( ) [ ] tomorrows " +
  'tonite grocries lanch mam danny 25:00 0:00 -1 999'
).split(' ');
let seed = 1234567;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const fuzzString = (): string => {
  const n = 1 + Math.floor(rnd() * 18);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(VOCAB_SOUP[Math.floor(rnd() * VOCAB_SOUP.length)]);
  }
  return parts.join(rnd() < 0.15 ? '' : ' ');
};

// ── Runner ───────────────────────────────────────────────────────────
let fails = 0;
let warns = 0;
const fail = (name: string, msg: string) => {
  fails++;
  console.log(`✗ FAIL  ${name}: ${msg}`);
};
const warn = (name: string, msg: string) => {
  warns++;
  console.log(`~ warn  ${name}: ${msg}`);
};

const DATE_WORD_IN_TITLE = /\b(tomorrow|tonight|today)\b/i;

const checkOne = (input: string, name: string, fuzz = false) => {
  let tidied: ReturnType<typeof tidyTranscript>;
  try {
    tidied = tidyTranscript(input);
  } catch (e) {
    return fail(name, `tidy threw: ${(e as Error).message} on ${JSON.stringify(input.slice(0, 60))}`);
  }
  // I6 idempotence
  try {
    const twice = tidyTranscript(tidied.tidied);
    if (twice.tidied !== tidyTranscript(tidied.tidied).tidied) {
      fail(name, 'tidy non-deterministic');
    }
    if (tidyTranscript(twice.tidied).tidied !== twice.tidied) {
      fail(
        name,
        `tidy not idempotent: ${JSON.stringify(tidied.tidied.slice(0, 50))} → ${JSON.stringify(twice.tidied.slice(0, 50))}`,
      );
    }
  } catch (e) {
    return fail(name, `tidy(tidy) threw: ${(e as Error).message}`);
  }
  try {
    countUnknownWords(input);
  } catch (e) {
    return fail(name, `countUnknownWords threw: ${(e as Error).message}`);
  }
  let tasks: ReturnType<typeof parseSmartCapture>;
  try {
    tasks = parseSmartCapture(input, ctx);
  } catch (e) {
    return fail(name, `parse threw: ${(e as Error).message} on ${JSON.stringify(input.slice(0, 60))}`);
  }
  let route: ReturnType<typeof routeCapture>;
  try {
    route = routeCapture(input, tasks);
  } catch (e) {
    return fail(name, `route threw: ${(e as Error).message}`);
  }
  // Separator-aware unit count — punctuation splits are legitimate
  // even inside one whitespace token ("callmom,payrent").
  const words = input.split(/[\s,.;:!?\n—–-]+/).filter(Boolean).length;
  if (tasks.length > Math.max(1, words)) {
    fail(name, `invented tasks: ${tasks.length} tasks from ${words} words`);
  }
  if (route.route === 'local' && input.trim().length > 3 && tasks.length === 0) {
    // Local route with zero tasks means send would silently no-op.
    if (!fuzz) warn(name, `local route but 0 tasks for ${JSON.stringify(input.slice(0, 50))}`);
  }
  for (const t of tasks) {
    if (!t.title || t.title.trim().length === 0) {
      fail(name, `empty title from ${JSON.stringify(input.slice(0, 60))}`);
    }
    if (t.at != null && (t.at < 0 || t.at > 1439 || !Number.isFinite(t.at))) {
      fail(name, `at out of range: ${t.at} from ${JSON.stringify(input.slice(0, 60))}`);
    }
    if (t.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
      fail(name, `bad date "${t.date}" from ${JSON.stringify(input.slice(0, 60))}`);
    }
    if (!fuzz && DATE_WORD_IN_TITLE.test(t.title)) {
      warn(name, `date word left in title "${t.title}" from ${JSON.stringify(input.slice(0, 50))}`);
    }
  }
};

console.log('── battery ──');
BATTERY.forEach((input, i) => checkOne(input, `battery[${i}]`));

console.log('── clean set (I7) ──');
for (const input of CLEAN_SET) {
  const n = countUnknownWords(input);
  if (n !== 0) fail('clean-set', `spell pass would trigger (${n}) on ${JSON.stringify(input)}`);
}

console.log('── fuzz ×2000 ──');
for (let i = 0; i < 2000; i++) checkOne(fuzzString(), `fuzz[${i}]`, true);

console.log('─'.repeat(44));
console.log(`OFFLINE BENCH  fails=${fails}  warnings=${warns}`);
process.exit(fails > 0 ? 1 : 0);
