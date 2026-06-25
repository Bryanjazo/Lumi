// Lumi · LLM benchmark CLI entry point
//
// Run: `npx ts-node scripts/anthropic-benchmark.ts`
//
// Writes `anthropic-benchmark-report.md` in the project root with
// full pass/fail details for every case in `lib/anthropic-benchmark.ts`.
//
// REQUIRES: Supabase configured, anthropic-proxy deployed, a valid
// user session with ANTHROPIC_API_KEY secret set on the project.
//
// This file lives outside `lib/` so node-specific imports (`fs`,
// `process`) don't pollute the Expo bundle's type-check.

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs');
import {
  runFullBenchmark,
  formatReport,
} from '../lib/anthropic-benchmark-runner';

runFullBenchmark()
  .then((report) => {
    const out = formatReport(report);
    fs.writeFileSync('anthropic-benchmark-report.md', out, 'utf-8');
    console.log('\n📄 Wrote anthropic-benchmark-report.md');
    const failed =
      report.summary.understandTotal -
      report.summary.understandPass +
      report.summary.untangleTotal -
      report.summary.untanglePass;
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
