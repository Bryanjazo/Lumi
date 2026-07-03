// Lumi · corrections store
//
// Per lumi-smarter-ai-spec.md §6: every Tweak the user makes to a
// previewed task is a learning signal. When the LLM says "morning"
// and the user changes it to "evening", that's a hint about how
// THIS user wants tasks like THIS one placed. We persist the most
// recent N corrections locally and surface them in UnderstandContext
// so the next LLM call sees "user moved 'gym' from morning to
// evening" and can mirror that pattern.
//
// Compact by design — we keep last 20 corrections (rolling window),
// each ~120 chars in the serialized form. Storage cost: ~3KB. Cost
// to the prompt: ~600 tokens max, only the last 6 sent so the
// prompt stays lean.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Encrypted at-rest (security audit §6): AES via lib/secureStorage —
// key in Keychain/Keystore, ciphertext in AsyncStorage. Legacy
// plaintext values migrate in place on first read.
import { secureStorage } from '../lib/secureStorage';

import type { Importance } from '../constants/importance';
import type { WindowKey } from '../constants/windows';

export interface Correction {
  /** Local Y-M-D when the correction happened. */
  date: string;
  /** Raw user input that produced the LLM's first guess. */
  raw: string;
  /** What changed — only the fields the user actually modified. */
  delta: {
    title?: { from: string; to: string };
    window?: { from: WindowKey; to: WindowKey };
    importance?: { from: Importance; to: Importance };
    durationMinutes?: { from: number | undefined; to: number };
    date?: { from: string; to: string };
  };
}

interface CorrectionsState {
  corrections: Correction[];
  /** Append a correction; drops the oldest if over the cap. */
  record: (c: Correction) => void;
  /** Most recent N (default 6) — what we send to the LLM. */
  recent: (n?: number) => Correction[];
  reset: () => void;
}

const MAX = 20;

export const useCorrectionsStore = create<CorrectionsState>()(
  persist(
    (set, get) => ({
      corrections: [],
      record: (c) =>
        set((s) => {
          // Skip empty-delta records — nothing to learn from "no change".
          if (Object.keys(c.delta).length === 0) return s;
          const next = [c, ...s.corrections].slice(0, MAX);
          return { corrections: next };
        }),
      recent: (n = 6) => get().corrections.slice(0, n),
      reset: () => set({ corrections: [] }),
    }),
    {
      name: 'lumi.corrections',
      storage: createJSONStorage(() => secureStorage),
      version: 1,
    },
  ),
);

/**
 * Compact human-readable summary for the LLM context block. One line
 * per correction, last N sent. Token budget ~50 per line.
 *
 *   "user moved 'gym' from morning to evening on 2026-06-15"
 *   "user changed importance of 'tax paperwork' from medium to high"
 */
export const summarizeCorrections = (corrections: Correction[]): string[] => {
  const lines: string[] = [];
  for (const c of corrections) {
    const refTitle = c.delta.title?.to ?? c.delta.title?.from ?? c.raw;
    const parts: string[] = [];
    if (c.delta.title) {
      parts.push(`renamed "${c.delta.title.from}" → "${c.delta.title.to}"`);
    }
    if (c.delta.window) {
      parts.push(`moved from ${c.delta.window.from} → ${c.delta.window.to}`);
    }
    if (c.delta.importance) {
      parts.push(
        `set importance ${c.delta.importance.from} → ${c.delta.importance.to}`,
      );
    }
    if (c.delta.durationMinutes) {
      const from = c.delta.durationMinutes.from ?? '?';
      parts.push(`set length ${from}m → ${c.delta.durationMinutes.to}m`);
    }
    if (c.delta.date) {
      parts.push(`re-dated ${c.delta.date.from} → ${c.delta.date.to}`);
    }
    if (parts.length === 0) continue;
    lines.push(`"${refTitle}" (${c.date}): ${parts.join(', ')}`);
  }
  return lines;
};
