// Lumi · AI metrics (goal §2.5) — make tuning real, not vibes.
//
// One compact row per Home capture: which route the gate picked
// (local = 0 tokens), why, how long the LLM took, and whether the
// user EDITED the result afterward (edit-rate = the quality signal
// for both paths — if local edit-rate creeps above LLM edit-rate,
// the gate is keeping too much local).
//
// Server-side token/cost accounting already lives in the `ai_usage`
// table (the proxy logs tokens_in/out per user per kind on every
// call). This store is the CLIENT half: the routing decisions the
// server never sees, because a skipped call never reaches it — which
// is exactly the number that matters ("% of captures skipping the
// LLM" = cost saved).
//
// Rolling window of 300 rows (~30KB). Local-only, wiped with the
// rest of user data on sign-out via lib/localData.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CaptureMetric {
  id: string;
  /** Local Y-M-D. */
  date: string;
  /** 'local' = gate kept it deterministic (0 tokens). 'llm' = model
   * answered. 'llm_fallback' = tried the model, shipped deterministic
   * (timeout / error / breaker). */
  route: 'local' | 'llm' | 'llm_fallback' | 'dym';
  /** Gate reason ('clean-single', 'multi', 'emotional', …). */
  reason: string;
  /** Model latency in ms — 0 for local. */
  latencyMs: number;
  /** Did the user tweak the preview afterward? */
  edited: boolean;
  /** Uploaded to parse_metrics (telemetry tier 1). Re-synced when
   *  `edited` flips after the first upload (upsert on the server). */
  synced?: boolean;
}

interface AiMetricsState {
  metrics: CaptureMetric[];
  /** Log a capture; returns its id so the edit flag can attach later. */
  record: (m: Omit<CaptureMetric, 'id' | 'date'>) => string;
  /** Patch a metric after the fact (LLM resolved / user edited). */
  update: (id: string, patch: Partial<CaptureMetric>) => void;
  reset: () => void;
}

const MAX = 300;

export const useAiMetricsStore = create<AiMetricsState>()(
  persist(
    (set) => ({
      metrics: [],
      record: (m) => {
        const id = `m-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        set((s) => ({ metrics: [{ ...m, id, date }, ...s.metrics].slice(0, MAX) }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          metrics: s.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
      reset: () => set({ metrics: [] }),
    }),
    {
      name: 'lumi.aiMetrics',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);

export interface AiMetricsSummary {
  captures: number;
  /** % of captures that never touched the LLM — the cost-saved dial. */
  llmSkipRate: number;
  /** Edit-rate per route — the quality dial. */
  editRateLocal: number;
  editRateLlm: number;
  /** How often an attempted LLM call ended in deterministic fallback. */
  fallbackRate: number;
  avgLlmLatencyMs: number;
}

export const summarizeAiMetrics = (
  raw: CaptureMetric[],
): AiMetricsSummary => {
  // dym rows are card-interaction events, not captures — they'd
  // pollute the skip/edit rates.
  const metrics = raw.filter((m) => m.route !== 'dym');
  const total = metrics.length;
  const local = metrics.filter((m) => m.route === 'local');
  const llm = metrics.filter((m) => m.route === 'llm');
  const fallback = metrics.filter((m) => m.route === 'llm_fallback');
  const rate = (part: number, whole: number) =>
    whole === 0 ? 0 : part / whole;
  const attempted = llm.length + fallback.length;
  return {
    captures: total,
    llmSkipRate: rate(local.length, total),
    editRateLocal: rate(local.filter((m) => m.edited).length, local.length),
    editRateLlm: rate(llm.filter((m) => m.edited).length, llm.length),
    fallbackRate: rate(fallback.length, attempted),
    avgLlmLatencyMs:
      llm.length === 0
        ? 0
        : Math.round(llm.reduce((a, m) => a + m.latencyMs, 0) / llm.length),
  };
};
