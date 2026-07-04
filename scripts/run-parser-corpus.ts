// Lumi · parser corpus runner (lumi-GOAL-smartest-task-manager §1.8)
//
// npm run test:parser
//
// Fixed clock (Friday 2026-07-03 10:00) + fixed anchors so every
// expectation is deterministic. Prints per-case failures and the two
// scoreboards: GUARD pass-rate (must stay 100%) and TARGET pass-rate
// (the growth curve for grammar still being built).

import { parseSmartCapture, type CaptureContext } from '../lib/capture';
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
