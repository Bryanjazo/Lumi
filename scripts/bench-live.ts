// Lumi · LIVE LLM benchmark — every UNDERSTAND_CASE through the real
// deployed proxy (server-pinned prompt, current model), node-native.
//
// Run: npm run bench:live   (needs .env + BENCH_EMAIL/BENCH_PASSWORD
// or defaults to the review account). Each case ≈ 1 understand call;
// bench rows are printed so they can be cleaned from ai_usage after.
//
// Exists alongside lib/anthropic-benchmark-runner.ts (which needs the
// RN runtime); this runner talks to the proxy directly so it can run
// from CI/CLI. It ALSO validates the OUTPUT FORMAT contract added for
// token diet: raw minified single-line JSON, no markdown fences.

import {
  UNDERSTAND_CASES,
  assertUnderstand,
} from '../lib/anthropic-benchmark';
import type { UnderstoodTask } from '../lib/anthropic';

const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const EMAIL = process.env.BENCH_EMAIL ?? 'applereview@yourdomain';
const PASSWORD = process.env.BENCH_PASSWORD ?? 'AppleTesting123!';

const todayISO = new Date().toISOString().slice(0, 10);
const dow = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
][new Date().getDay()];
const hh = String(new Date().getHours()).padStart(2, '0');
const mm = String(new Date().getMinutes()).padStart(2, '0');

// Mirrors lib/anthropic.ts buildContextBlock for the benchmark ctx.
const CTX_BLOCK = [
  `Now: ${dow}, ${todayISO} ${hh}:${mm}`,
  `Today (use to resolve dates): ${todayISO}`,
  'User is sharpest in the morning',
  'User hits a wall in the afternoon',
  'Learned peak window: 09:30–11:30',
  'Learned slump window: 14:00–15:30',
  'Daily anchors — wake 07:00, breakfast 08:00, lunch 12:30, dinner 18:30, sleep 22:30.',
  'Struggles: paralysis, overwhelm',
  "User's name: Bryan",
].join('\n');

// Minimal mirror of llmUnderstand's sanitize — defaults for omitted
// fields (the client tolerates the token-diet omissions; so must we).
const sanitize = (raw: unknown): UnderstoodTask[] | null => {
  const parsed = raw as { tasks?: unknown[] };
  if (!parsed || !Array.isArray(parsed.tasks)) return null;
  return parsed.tasks
    .map((x) => {
      const t = x as Record<string, unknown>;
      if (!t || typeof t.title !== 'string' || !t.title.trim()) return null;
      return {
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
        ...(t.when && typeof t.when === 'object' ? { when: t.when } : {}),
      } as UnderstoodTask;
    })
    .filter((t): t is UnderstoodTask => t != null);
};

const main = async () => {
  const tokRes = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const tok = ((await tokRes.json()) as { access_token?: string })
    .access_token;
  if (!tok) throw new Error('bench sign-in failed');

  let pass = 0;
  let fenced = 0;
  let multiline = 0;
  const sizes: number[] = [];
  const latencies: number[] = [];
  const failures: string[] = [];

  for (const c of UNDERSTAND_CASES) {
    const started = Date.now();
    let text = '';
    try {
      const res = await fetch(`${URL_BASE}/functions/v1/anthropic-proxy`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'title_clean',
          max_tokens: 3000,
          messages: [
            { role: 'user', content: `${CTX_BLOCK}\n\nUser wrote: ${c.raw}` },
          ],
        }),
      });
      const body = (await res.json()) as {
        text?: string;
        error?: { code: string; message: string };
      };
      if (!res.ok || !body.text) {
        failures.push(`✗ ${c.name}: HTTP ${res.status} ${body.error?.message ?? ''}`);
        continue;
      }
      text = body.text;
    } catch (e) {
      failures.push(`✗ ${c.name}: fetch threw ${(e as Error).message}`);
      continue;
    }
    latencies.push(Date.now() - started);
    sizes.push(text.length);
    if (text.includes('```')) fenced++;
    if (text.trim().includes('\n')) multiline++;

    let tasks: UnderstoodTask[] | null = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      tasks = m ? sanitize(JSON.parse(m[0])) : null;
    } catch {
      tasks = null;
    }
    if (tasks == null) {
      failures.push(`✗ ${c.name}: unparseable JSON: ${text.slice(0, 120)}`);
      continue;
    }
    const errs = assertUnderstand(tasks, c.expect);
    if (errs.length === 0) {
      pass++;
    } else {
      failures.push(
        `✗ ${c.name} [${c.category}]: ${errs.join(' | ')}\n    in:  ${c.raw.slice(0, 90)}\n    out: ${JSON.stringify(tasks).slice(0, 220)}`,
      );
    }
  }

  const avg = (a: number[]) =>
    a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
  console.log('─'.repeat(52));
  for (const f of failures) console.log(f);
  console.log('─'.repeat(52));
  console.log(
    `LIVE UNDERSTAND  ${pass}/${UNDERSTAND_CASES.length} pass · ` +
      `avg ${avg(latencies)}ms · avg ${avg(sizes)} chars out · ` +
      `fenced ${fenced} · multiline ${multiline}`,
  );
  process.exit(pass === UNDERSTAND_CASES.length ? 0 : 1);
};

void main();
