// Lumi · parser corpus runner (lumi-GOAL-smartest-task-manager §1.8)
//
// npm run test:parser
//
// Fixed clock (Friday 2026-07-03 10:00) + fixed anchors so every
// expectation is deterministic. Prints per-case failures and the two
// scoreboards: GUARD pass-rate (must stay 100%) and TARGET pass-rate
// (the growth curve for grammar still being built).

import {
  parseSmartCapture,
  routeCapture,
  tidyTranscript,
  type CaptureContext,
} from '../lib/capture';
import { personalizeTask } from '../lib/personalize';
import type { Correction } from '../store/correctionsStore';
import { CORPUS, type ExpectTask } from './parser-corpus';

const NOW = new Date(2026, 6, 3, 10, 0, 0); // Friday
const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

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
  // Anchor-relative grammar resolves against these:
  //   breakfast 8:00 · lunch 12:30 · dinner 18:30
  anchors: {
    wake: 7 * 60,
    breakfast: 8 * 60,
    lunch: 12 * 60 + 30,
    dinner: 18 * 60 + 30,
    sleep: 23 * 60,
  },
} as CaptureContext;

const offsetOf = (dateISO: string | null): number | null => {
  if (!dateISO) return null;
  const [y, m, d] = dateISO.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const base = new Date(NOW);
  base.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
};

const checkTask = (
  exp: ExpectTask,
  got: ReturnType<typeof parseSmartCapture>[number],
): string[] => {
  const errs: string[] = [];
  if (exp.title !== undefined) {
    if (typeof exp.title === 'string') {
      if (got.title.toLowerCase() !== exp.title.toLowerCase()) {
        errs.push(`title "${got.title}" ≠ "${exp.title}"`);
      }
    } else if (!exp.title.test(got.title)) {
      errs.push(`title "${got.title}" !~ ${exp.title}`);
    }
  }
  if (exp.importance !== undefined && got.importance !== exp.importance) {
    errs.push(`importance ${got.importance} ≠ ${exp.importance}`);
  }
  if (exp.window !== undefined && got.window !== exp.window) {
    errs.push(`window ${got.window} ≠ ${exp.window}`);
  }
  if (exp.dateOffset !== undefined) {
    const off = offsetOf(got.date);
    if (off !== exp.dateOffset) {
      errs.push(`dateOffset ${off} ≠ ${exp.dateOffset}`);
    }
  }
  if (exp.at !== undefined && got.at !== exp.at) {
    errs.push(`at ${got.at} ≠ ${exp.at}`);
  }
  if (exp.recur !== undefined) {
    if (exp.recur === null) {
      if (got.recur) errs.push(`recur present, expected none`);
    } else if (!got.recur) {
      errs.push(`recur missing (${JSON.stringify(exp.recur)})`);
    } else {
      if (got.recur.every !== exp.recur.every) {
        errs.push(`recur.every ${got.recur.every} ≠ ${exp.recur.every}`);
      }
      if (exp.recur.day !== undefined && got.recur.day !== exp.recur.day) {
        errs.push(`recur.day ${got.recur.day} ≠ ${exp.recur.day}`);
      }
      if (exp.recur.part !== undefined && got.recur.part !== exp.recur.part) {
        errs.push(`recur.part ${got.recur.part} ≠ ${exp.recur.part}`);
      }
      if (
        exp.recur.interval !== undefined &&
        got.recur.interval !== exp.recur.interval
      ) {
        errs.push(
          `recur.interval ${got.recur.interval} ≠ ${exp.recur.interval}`,
        );
      }
    }
  }
  if (
    exp.needsFollowup !== undefined &&
    got.needsFollowup !== exp.needsFollowup
  ) {
    errs.push(`needsFollowup ${got.needsFollowup} ≠ ${exp.needsFollowup}`);
  }
  if (
    exp.durationMinutes !== undefined &&
    got.durationMinutes !== exp.durationMinutes
  ) {
    errs.push(
      `durationMinutes ${got.durationMinutes} ≠ ${exp.durationMinutes}`,
    );
  }
  if (exp.deadline !== undefined) {
    const gotDeadline = (got as { deadline?: boolean }).deadline ?? false;
    if (gotDeadline !== exp.deadline) {
      errs.push(`deadline ${gotDeadline} ≠ ${exp.deadline}`);
    }
  }
  return errs;
};

let guardPass = 0;
let guardTotal = 0;
let targetPass = 0;
let targetTotal = 0;
const failures: string[] = [];

for (const c of CORPUS) {
  const tasks = parseSmartCapture(c.input, ctx);
  const errs: string[] = [];
  if (tasks.length !== c.expect.length) {
    errs.push(
      `task count ${tasks.length} ≠ ${c.expect.length} — got [${tasks
        .map((t) => `"${t.title}"`)
        .join(', ')}]`,
    );
  } else {
    c.expect.forEach((exp, i) => {
      for (const e of checkTask(exp, tasks[i])) errs.push(`task[${i}] ${e}`);
    });
  }
  const pass = errs.length === 0;
  if (c.target) {
    targetTotal++;
    if (pass) targetPass++;
  } else {
    guardTotal++;
    if (pass) guardPass++;
  }
  if (!pass) {
    failures.push(
      `${c.target ? '◇ target' : '✗ GUARD '} ${c.name}\n     in: ${
        c.input.length > 80 ? c.input.slice(0, 77) + '…' : c.input
      }\n     ${errs.join('\n     ')}`,
    );
  }
}

// ═══ §1.5 personalization + §1.6 confidence (guards) ═══════════════
// Pure-function checks on the zero-token layers that sit on top of
// the parse. All guards — regressions here break the free tier.
const check = (name: string, cond: boolean, detail: string) => {
  guardTotal++;
  if (cond) {
    guardPass++;
  } else {
    failures.push(`✗ GUARD  ${name}\n     ${detail}`);
  }
};

{
  const parse1 = (input: string) => parseSmartCapture(input, ctx)[0];

  // §1.6 confidence ordering: explicit clock > window word > guess.
  const cExplicit = parse1('gym at 6pm').confidence!;
  const cHint = parse1('gym tonight').confidence!;
  const cGuess = parse1('gym').confidence!;
  check(
    'confidence: explicit > hint > guess',
    cExplicit.time > cHint.time && cHint.time > cGuess.time,
    `time conf ${cExplicit.time} / ${cHint.time} / ${cGuess.time}`,
  );
  check(
    'confidence: default importance is low-confidence',
    parse1('organize the bookshelf').confidence!.importance <
      parse1('finish the tax report').confidence!.importance,
    'no-signal default should score below multi-signal',
  );
  check(
    'followup: high stakes + guessed time asks',
    parse1('do the taxes').needsFollowup === true,
    'high-importance task with no when should ask',
  );
  check(
    'followup: explicit when does not ask',
    parse1('do the taxes tomorrow').needsFollowup === false,
    'explicit date should not trigger the chip',
  );

  // §1.5 correction memory — the user always moves gym to morning.
  const corrections: Correction[] = [
    {
      date: '2026-06-20',
      raw: 'hit the gym after errands',
      // "evening" so it always DIFFERS from the parse's own guess
      // (at the fixed 10:00 clock the parser guesses morning).
      delta: { window: { from: 'afternoon', to: 'evening' } },
    },
    {
      date: '2026-06-18',
      raw: 'work on the deck',
      delta: { importance: { from: 'medium', to: 'high' } },
    },
  ];
  const gym = personalizeTask(parse1('go to the gym'), corrections);
  check(
    'personalize: guessed window follows memory',
    gym.window === 'evening' && gym.personalized?.includes('window') === true,
    `window ${gym.window}, personalized ${JSON.stringify(gym.personalized)}`,
  );
  const gymMorning = personalizeTask(
    parse1('gym in the morning'),
    corrections,
  );
  check(
    'personalize: explicit when beats memory',
    gymMorning.window === 'morning',
    `window ${gymMorning.window} — "in the morning" must win over memory`,
  );
  const deck = personalizeTask(parse1('deck edits'), corrections);
  check(
    'personalize: personal lexicon carries importance',
    deck.importance === 'high',
    `importance ${deck.importance} — "deck" should be remembered as high`,
  );
  const stranger = personalizeTask(parse1('water the plants'), corrections);
  check(
    'personalize: unrelated tasks untouched',
    stranger.personalized === undefined,
    `personalized ${JSON.stringify(stranger.personalized)}`,
  );

  // Task kinds (the waitlist-demo tags, in-engine) — kind + its
  // typical duration pre-sizing.
  const kindOf = (input: string) => {
    const t = parse1(input) as { kind?: string; durationMinutes?: number };
    return { kind: t.kind, dur: t.durationMinutes };
  };
  const kindCases: Array<[string, string, number | undefined]> = [
    ['call the dentist back', 'reach_out', 10],
    ['buy paper towels', 'errand', 15],
    ['finish the quarterly report', 'work', 45],
    ['do the laundry', 'home', 20],
    ['learn guitar someday', 'someday', undefined],
  ];
  for (const [input, expectKind, expectDur] of kindCases) {
    const got = kindOf(input);
    check(
      `kind: "${input}" → ${expectKind}`,
      got.kind === expectKind && got.dur === expectDur,
      `got kind=${got.kind} dur=${got.dur}, want ${expectKind}/${expectDur}`,
    );
  }

  // tidyTranscript — the "did you mean" pre-flight for voice.
  const tidyCases: Array<{
    name: string;
    input: string;
    tidied?: string;
    suspicious: boolean;
  }> = [
    {
      name: 'tidy: stutters dedupe',
      input: 'call call the the dentist',
      tidied: 'call the dentist',
      suspicious: false,
    },
    {
      name: 'tidy: edge fillers trimmed',
      input: 'um uh so call mom um',
      tidied: 'call mom',
      suspicious: false,
    },
    {
      name: 'tidy: cut-off transcript is suspicious',
      input: 'remind me to call the',
      suspicious: true,
    },
    {
      name: 'tidy: gibberish is suspicious',
      input: 'txhq brzk dentist',
      suspicious: true,
    },
    {
      name: 'tidy: clean input passes untouched',
      input: 'buy oat milk tomorrow',
      tidied: 'buy oat milk tomorrow',
      suspicious: false,
    },
  ];
  for (const c of tidyCases) {
    const r = tidyTranscript(c.input);
    const ok =
      r.suspicious === c.suspicious &&
      (c.tidied === undefined || r.tidied === c.tidied);
    check(
      c.name,
      ok,
      `got tidied="${r.tidied}" suspicious=${r.suspicious}`,
    );
  }

  // §2.1 routing gate — trivial captures MUST cost 0 tokens; true
  // multi-task MUST reach the LLM.
  const route = (input: string) =>
    routeCapture(input, parseSmartCapture(input, ctx));
  for (const simple of ['clean car', 'gym at 6pm', 'call mom tomorrow']) {
    const r = route(simple);
    check(
      `gate: "${simple}" stays local`,
      r.route === 'local',
      `routed ${r.route} (${r.reason}) — trivial captures are 0 tokens`,
    );
  }
  const dump = route(
    'call the plumber, book the hotel, buy eggs and also finish the deck',
  );
  check(
    'gate: multi-task goes to the LLM',
    dump.route === 'llm',
    `routed ${dump.route} (${dump.reason})`,
  );
  const emotional = route("i keep avoiding the tax thing and it's stressing me out");
  check(
    'gate: emotional language goes to the LLM',
    emotional.route === 'llm',
    `routed ${emotional.route} (${emotional.reason})`,
  );
}

console.log('── Lumi parser corpus ──');
for (const f of failures) console.log(f);
console.log('─'.repeat(40));
console.log(
  `GUARDS  ${guardPass}/${guardTotal}  (must be 100%)`,
);
console.log(
  `TARGETS ${targetPass}/${targetTotal}  (growth curve)`,
);
console.log(
  `TOTAL   ${guardPass + targetPass}/${guardTotal + targetTotal}`,
);
// Exit non-zero only when a GUARD fails — targets are allowed to lag.
process.exit(guardPass === guardTotal ? 0 : 1);
