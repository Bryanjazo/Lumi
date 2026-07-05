// Lumi · "Hey Lumi" wake-phrase guard tests
//
// Run: npx tsx scripts/test-heylumi-wake.ts
// Same contract as the parser corpus: every case here MUST pass —
// these encode the owner's spec (trigger on "hey lumi" / "lumi",
// never on bare "luna", command = everything after the LAST wake).

import { matchWake } from '../lib/heyLumiWake';

interface Case {
  name: string;
  text: string;
  /** null = must NOT wake; string = expected command tail. */
  tail: string | null;
  /** 'last' (wake mode, default) or 'first' (command mode). */
  which?: 'first' | 'last';
}

const CASES: Case[] = [
  // ── must wake ────────────────────────────────────────────────────
  { name: 'canonical', text: 'hey lumi remind me to call mom', tail: 'remind me to call mom' },
  { name: 'recognizer punctuation', text: 'Hey, Lumi! Remind me to call mom', tail: 'Remind me to call mom' },
  { name: 'bare name', text: 'lumi add buy milk tomorrow', tail: 'add buy milk tomorrow' },
  { name: 'okay variant', text: 'okay lumi what do I need today', tail: 'what do I need today' },
  { name: 'wake only, no command yet', text: 'hey lumi', tail: '' },
  { name: 'mishear loomy', text: 'hey loomy remind me to stretch', tail: 'remind me to stretch' },
  { name: 'mishear luna WITH hey', text: 'hey luna pick up the dry cleaning', tail: 'pick up the dry cleaning' },
  { name: 'chatter before wake', text: "so anyway I told him no hey lumi remind me to email sarah", tail: 'remind me to email sarah' },
  { name: 'LAST wake wins', text: 'hey lumi uh no hey lumi buy stamps', tail: 'buy stamps' },
  { name: 'comma after name', text: 'hey lumi, groceries after work', tail: 'groceries after work' },
  { name: 'capitalized mid-sentence', text: 'HEY LUMI water the plants', tail: 'water the plants' },

  // ── must NOT wake ────────────────────────────────────────────────
  { name: 'bare luna is the cat', text: 'feed luna tonight', tail: null },
  { name: 'bare loona excluded', text: 'loona needs new litter', tail: null },
  { name: 'inside a word', text: 'the alumina order shipped', tail: null },
  { name: 'illuminate', text: 'illuminate the porch', tail: null },
  { name: 'no wake word at all', text: 'remind me to call mom', tail: null },
  { name: 'name embedded with suffix', text: 'the luminous lamp broke', tail: null },
  { name: 'bare lume needs hey (ambient guard)', text: 'the lume on this watch is bright', tail: null },
  { name: 'bare luma needs hey', text: 'luma is a nice name', tail: null },
  { name: 'bare lumia needs hey', text: 'my old lumia phone', tail: null },

  // ── command mode (which='first') ─────────────────────────────────
  {
    name: 'mid-command name must not wipe command',
    text: 'hey lumi remind me to ask lumi about the invoice',
    tail: 'remind me to ask lumi about the invoice',
    which: 'first',
  },
  {
    name: 'first-mode canonical',
    text: 'hey lumi buy stamps',
    tail: 'buy stamps',
    which: 'first',
  },
];

let pass = 0;
const fails: string[] = [];
for (const c of CASES) {
  const m = matchWake(c.text, c.which ?? 'last');
  const got = m ? m.tail : null;
  if (got === c.tail) pass++;
  else fails.push(`✗ ${c.name}: got ${JSON.stringify(got)}, want ${JSON.stringify(c.tail)}`);
}

console.log('─'.repeat(40));
console.log(`WAKE GUARDS  ${pass}/${CASES.length}  (must be 100%)`);
for (const f of fails) console.log(f);
if (fails.length > 0) process.exit(1);
