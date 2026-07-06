// Lumi · zero-token personalization (goal §1.5)
//
// The corrections store already remembers every Tweak the user makes
// to a parsed task. Until now those memories only fed the LLM prompt —
// which means FREE users (and outages, and the routing gate's local
// path) never benefited from them. This module is the deterministic
// twin: a pure lookup that applies the user's own past corrections to
// a fresh parse. "They always move 'gym' to morning" → gym lands in
// morning. Zero tokens, works offline, IS the personal lexicon
// ("deck" carrying high importance is learned the same way).
//
// Safety rails:
//   - Window is only overridden when the parser GUESSED (confidence
//     .time < 0.6) — an explicit "gym at 6pm" or "gym tonight" always
//     wins over memory.
//   - Most recent matching correction wins per field (people change
//     their minds; the newest signal is the truest).
//   - Matching is token-overlap on significant words, so "go to the
//     gym" matches a correction recorded for "gym after work".

import type { Correction } from '../store/correctionsStore';
import type { SmartTask } from './capture';

const STOP = new Set([
  'the', 'a', 'an', 'my', 'our', 'to', 'for', 'of', 'and', 'on', 'in',
  'at', 'with', 'up', 'out', 'it', 'that', 'this', 'her', 'his',
  'their', 'some', 'get', 'go', 'do', 'about', 'from', 'more',
]);

/** Significant lowercase tokens of a phrase (stopwords dropped). */
const sigTokens = (s: string): Set<string> => {
  const out = new Set<string>();
  for (const w of s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)) {
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
};

/** Overlap ratio against the smaller set — 1.0 means one phrase's
 * significant words are fully contained in the other's. */
const overlap = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / Math.min(a.size, b.size);
};

const MATCH_THRESHOLD = 0.5;

/**
 * Apply the user's correction memory to one freshly parsed task.
 * Pure — takes the corrections list explicitly so it's trivially
 * testable and never imports a store.
 */
export const personalizeTask = (
  task: SmartTask,
  corrections: Correction[],
): SmartTask => {
  if (corrections.length === 0) return task;
  const taskTokens = sigTokens(task.title);
  if (taskTokens.size === 0) return task;

  let out = task;
  const applied: NonNullable<SmartTask['personalized']> = [];
  let windowDone = false;
  let importanceDone = false;
  let durationDone = false;

  // Corrections are stored newest-first — first match per field wins.
  for (const c of corrections) {
    if (windowDone && importanceDone && durationDone) break;
    const ref = c.delta.title?.to ?? c.raw;
    if (overlap(taskTokens, sigTokens(ref)) < MATCH_THRESHOLD) continue;

    if (
      !windowDone &&
      c.delta.window &&
      out.timeMode === 'windowed' &&
      out.at == null &&
      !out.recur &&
      (out.confidence?.time ?? 0.35) < 0.6 &&
      out.window !== c.delta.window.to
    ) {
      out = { ...out, window: c.delta.window.to };
      applied.push('window');
      windowDone = true;
    }
    if (
      !importanceDone &&
      c.delta.importance &&
      (out.confidence?.importance ?? 0.4) < 0.9 &&
      out.importance !== c.delta.importance.to
    ) {
      out = {
        ...out,
        importance: c.delta.importance.to,
        energyDemand: c.delta.importance.to,
      };
      applied.push('importance');
      importanceDone = true;
    }
    if (
      !durationDone &&
      c.delta.durationMinutes &&
      out.durationMinutes !== c.delta.durationMinutes.to
    ) {
      out = { ...out, durationMinutes: c.delta.durationMinutes.to };
      applied.push('duration');
      durationDone = true;
    }
  }

  return applied.length > 0 ? { ...out, personalized: applied } : task;
};

/** Batch form — the deterministic capture path runs every parsed task
 * through memory before preview. */
/**
 * A10 — learning warm-start. The follow-through engine already knows
 * the user's STRONG window (where things actually get finished); it
 * powered recap copy but never touched parsing. Now: a high-
 * importance task whose window was GUESSED (low time confidence, no
 * explicit time/recur) starts in the strong window. Corrections
 * still run after and win — explicit memory beats inferred pattern.
 * Zero tokens; the data was already computed.
 */
const warmStart = (
  t: SmartTask,
  strongWindow: SmartTask['window'] | null | undefined,
): SmartTask => {
  if (
    !strongWindow ||
    strongWindow === 'someday' ||
    t.timeMode !== 'windowed' ||
    t.at != null ||
    t.recur != null ||
    t.importance !== 'high' ||
    t.window === strongWindow ||
    (t.confidence?.time ?? 0) >= 0.6
  ) {
    return t;
  }
  return { ...t, window: strongWindow };
};

export const personalizeTasks = (
  tasks: SmartTask[],
  corrections: Correction[],
  opts?: { strongWindow?: SmartTask['window'] | null },
): SmartTask[] =>
  tasks.map((t) =>
    personalizeTask(warmStart(t, opts?.strongWindow), corrections),
  );
