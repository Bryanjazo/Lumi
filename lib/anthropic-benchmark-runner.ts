// Lumi · LLM benchmark runner
//
// Executes every case from `anthropic-benchmark.ts` against the real
// LLM (through the Supabase Edge Function), aggregates pass/fail
// results, and prints a markdown-friendly report.
//
// USAGE — pick one:
//   1. As a one-off script:
//        npx ts-node lib/anthropic-benchmark-runner.ts
//   2. Imported and called from a dev screen:
//        import { runFullBenchmark } from './lib/anthropic-benchmark-runner';
//        const report = await runFullBenchmark();
//
// REQUIREMENTS:
//   - Supabase configured (EXPO_PUBLIC_SUPABASE_URL + anon key)
//   - User signed in (the proxy needs a JWT)
//   - anthropic-proxy Edge Function deployed
//   - ANTHROPIC_API_KEY secret set on the project
//
// COST: each understand case ~600 tokens out, each untangle case
// ~700 tokens out. The current set is ~28 understand + ~10 untangle =
// ~28*0.01 + 10*0.02 ≈ $0.48 per full run. Don't run it in a tight
// loop.

import {
  UNDERSTAND_CASES,
  UNTANGLE_CASES,
  assertUnderstand,
  assertUntangle,
  type UnderstandRunResult,
  type UntangleRunResult,
} from './anthropic-benchmark';
import {
  llmUnderstand,
  llmUntangle,
  type UnderstandContext,
  type UntangleContext,
  type UntanglePileItem,
  type UntangleThreadMsg,
} from './anthropic';

// ─────────────────────────────────────────────────────────────────────
// Shared test context (matches the shape Home/Untangle build)
// ─────────────────────────────────────────────────────────────────────

const makeUnderstandCtx = (): UnderstandContext => {
  const now = new Date();
  const dow = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][now.getDay()];
  const todayISO = now.toISOString().slice(0, 10);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    nowLabel: `${dow}, ${todayISO} ${hh}:${mm}`,
    todayISO,
    sharpWindow: 'morning',
    foggyWindow: 'afternoon',
    peakRange: '09:30–11:30',
    slumpRange: '14:00–15:30',
    curveTrusted: true,
    anchors: {
      wake: '07:00',
      breakfast: '08:00',
      lunch: '12:30',
      dinner: '18:30',
      sleep: '22:30',
    },
    struggles: ['paralysis', 'overwhelm'],
    userName: 'Bryan',
    recentCorrections: [],
  };
};

const makeUntangleCtx = (
  pile: UntanglePileItem[],
  todayISO: string,
): UntangleContext => ({
  ...makeUnderstandCtx(),
  pile,
  selectedDayISO: todayISO,
});

// ─────────────────────────────────────────────────────────────────────
// Runners
// ─────────────────────────────────────────────────────────────────────

export const runUnderstandBenchmark = async (): Promise<
  UnderstandRunResult[]
> => {
  const ctx = makeUnderstandCtx();
  const results: UnderstandRunResult[] = [];
  for (const c of UNDERSTAND_CASES) {
    process.stdout?.write?.(`  · ${c.name} `);
    const r = await llmUnderstand(c.raw, ctx);
    const tasks = r?.tasks ?? null;
    const errors = tasks
      ? assertUnderstand(tasks, c.expect)
      : ['llmUnderstand returned null'];
    results.push({ case: c, output: tasks, errors });
    process.stdout?.write?.(errors.length === 0 ? 'PASS\n' : 'FAIL\n');
  }
  return results;
};

export const runUntangleBenchmark = async (): Promise<
  UntangleRunResult[]
> => {
  const todayISO = new Date().toISOString().slice(0, 10);
  const results: UntangleRunResult[] = [];
  for (const c of UNTANGLE_CASES) {
    process.stdout?.write?.(`  · ${c.name} `);
    const pile: UntanglePileItem[] = c.pile.map((p) => ({
      id: p.id,
      title: p.title,
      importance: p.importance,
      window: p.window,
      date: p.date ?? todayISO,
      ...(p.at ? { at: p.at } : {}),
      status: p.status ?? 'today',
      ...(p.overdue ? { overdue: true } : {}),
    }));
    const ctx = makeUntangleCtx(pile, todayISO);
    const thread: UntangleThreadMsg[] = [
      { role: 'user', content: c.message },
    ];
    const r = await llmUntangle(thread, ctx);
    const errors = r ? assertUntangle(r, c.expect) : ['llmUntangle returned null'];
    results.push({ case: c, output: r, errors });
    process.stdout?.write?.(errors.length === 0 ? 'PASS\n' : 'FAIL\n');
  }
  return results;
};

// ─────────────────────────────────────────────────────────────────────
// Report formatting
// ─────────────────────────────────────────────────────────────────────

export interface BenchmarkReport {
  understand: UnderstandRunResult[];
  untangle: UntangleRunResult[];
  summary: {
    understandPass: number;
    understandTotal: number;
    untanglePass: number;
    untangleTotal: number;
    byCategory: Record<string, { pass: number; total: number }>;
  };
}

export const formatReport = (report: BenchmarkReport): string => {
  const lines: string[] = [];
  lines.push('# Lumi LLM Benchmark Report');
  lines.push('');
  lines.push(
    `**llmUnderstand**: ${report.summary.understandPass} / ${report.summary.understandTotal} pass`,
  );
  lines.push(
    `**llmUntangle**: ${report.summary.untanglePass} / ${report.summary.untangleTotal} pass`,
  );
  lines.push('');
  lines.push('## By category');
  for (const [cat, { pass, total }] of Object.entries(
    report.summary.byCategory,
  )) {
    lines.push(`- **${cat}**: ${pass}/${total}`);
  }
  lines.push('');
  lines.push('## llmUnderstand details');
  for (const r of report.understand) {
    const status = r.errors.length === 0 ? '✅' : '❌';
    lines.push(`### ${status} ${r.case.name}  *(${r.case.category})*`);
    lines.push(`> ${r.case.raw}`);
    if (r.case.notes) lines.push(`*${r.case.notes}*`);
    if (r.output) {
      lines.push('```json');
      lines.push(JSON.stringify(r.output, null, 2));
      lines.push('```');
    } else {
      lines.push('*(no output)*');
    }
    if (r.errors.length > 0) {
      lines.push('**Failures:**');
      r.errors.forEach((e) => lines.push(`- ${e}`));
    }
    lines.push('');
  }
  lines.push('## llmUntangle details');
  for (const r of report.untangle) {
    const status = r.errors.length === 0 ? '✅' : '❌';
    lines.push(`### ${status} ${r.case.name}  *(${r.case.category})*`);
    lines.push(`> ${r.case.message}`);
    if (r.case.notes) lines.push(`*${r.case.notes}*`);
    if (r.output) {
      lines.push('```json');
      lines.push(JSON.stringify(r.output, null, 2));
      lines.push('```');
    } else {
      lines.push('*(no output)*');
    }
    if (r.errors.length > 0) {
      lines.push('**Failures:**');
      r.errors.forEach((e) => lines.push(`- ${e}`));
    }
    lines.push('');
  }
  return lines.join('\n');
};

export const runFullBenchmark = async (): Promise<BenchmarkReport> => {
  console.log('🧠 Running llmUnderstand benchmark…');
  const understand = await runUnderstandBenchmark();
  console.log('🧶 Running llmUntangle benchmark…');
  const untangle = await runUntangleBenchmark();
  const byCategory: Record<string, { pass: number; total: number }> = {};
  for (const r of understand) {
    const k = r.case.category;
    byCategory[k] = byCategory[k] ?? { pass: 0, total: 0 };
    byCategory[k].total += 1;
    if (r.errors.length === 0) byCategory[k].pass += 1;
  }
  for (const r of untangle) {
    const k = r.case.category;
    byCategory[k] = byCategory[k] ?? { pass: 0, total: 0 };
    byCategory[k].total += 1;
    if (r.errors.length === 0) byCategory[k].pass += 1;
  }
  const summary = {
    understandPass: understand.filter((r) => r.errors.length === 0).length,
    understandTotal: understand.length,
    untanglePass: untangle.filter((r) => r.errors.length === 0).length,
    untangleTotal: untangle.length,
    byCategory,
  };
  const report: BenchmarkReport = { understand, untangle, summary };
  console.log('\n' + '─'.repeat(60));
  console.log(
    `understand: ${summary.understandPass}/${summary.understandTotal}    ` +
      `untangle: ${summary.untanglePass}/${summary.untangleTotal}`,
  );
  console.log('─'.repeat(60));
  return report;
};

// The auto-run-on-require entry point lives in a separate file
// (`anthropic-benchmark-cli.ts`) so that this module stays
// type-safe under the Expo bundle's typescript config (which
// doesn't ship node types). See that file for `ts-node` usage.
