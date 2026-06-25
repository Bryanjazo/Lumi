// Lumi · check-in mood map — pure logic.
//
// Lumi is an ORGANIZATION app. The check-in logs the user's ENERGY and
// uses it to RE-PLAN today's tasks. This module holds the pure logic:
// zones, derived energy, the assist questions, the planner. No JSX.
//
// Spec: lumi-checkin-architecture.md (energy → planning variant).

import type { Quest } from '../store/questStore';

export type ZoneName =
  | 'Firing'
  | 'Wired'
  | 'Revved'
  | 'Easy'
  | 'Drained'
  | 'Low'
  | 'Steady'
  | 'Strained'
  | 'Even';

export type EnergyBand = 'low' | 'mid' | 'high';

export const CHECKIN_COLORS = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE3D2',
  boneDim: '#A4978C',
  ember: '#E0764C',
  emberLt: '#E0A488',
  emberGlow: '#F0C2A0',
  honey: '#C9A06A',
  lichen: '#9AAE8E',
  line: '#2A2420',
  lineSoft: '#221C18',
  mute: '#7A6E5E',
  zWired: '#D9A86E',
  zLit: '#CDB57E',
  zLow: '#9A8FA0',
  zCalm: '#8FA890',
} as const;

export interface ZoneRead {
  name: ZoneName;
  sub: string;
  band: EnergyBand;
}

export const readState = (x: number, y: number): ZoneRead => {
  const hi = y > 0.62;
  const lo = y < 0.38;
  const pl = x > 0.62;
  const df = x < 0.38;
  const mid = !hi && !lo;
  const ctr = !pl && !df;

  if (hi && pl) return { name: 'Firing', sub: 'high capacity', band: 'high' };
  if (hi && df)
    return { name: 'Wired', sub: 'charged but scattered', band: 'high' };
  if (hi && ctr) return { name: 'Revved', sub: 'energy to spend', band: 'high' };
  if (lo && pl) return { name: 'Easy', sub: 'low but steady', band: 'low' };
  if (lo && df) return { name: 'Drained', sub: 'running on empty', band: 'low' };
  if (lo && ctr) return { name: 'Low', sub: 'not much in the tank', band: 'low' };
  if (mid && pl)
    return { name: 'Steady', sub: 'solid working capacity', band: 'mid' };
  if (mid && df)
    return { name: 'Strained', sub: 'pushing uphill', band: 'mid' };
  return { name: 'Even', sub: 'middle of the road', band: 'mid' };
};

/** Arousal-weighted energy with focus nudge — stored 0–100; feeds the curve. */
export const energyValue = (x: number, y: number): number =>
  Math.round((y * 0.7 + x * 0.3) * 100);

const ZONE_COLOR_MAP: Record<ZoneName, string> = {
  Wired: CHECKIN_COLORS.zWired,
  Strained: CHECKIN_COLORS.zWired,
  Firing: CHECKIN_COLORS.zLit,
  Revved: CHECKIN_COLORS.zLit,
  Steady: CHECKIN_COLORS.zLit,
  Low: CHECKIN_COLORS.zLow,
  Drained: CHECKIN_COLORS.zLow,
  Easy: CHECKIN_COLORS.zCalm,
  Even: CHECKIN_COLORS.zCalm,
};
export const zoneColorFor = (name: ZoneName): string => ZONE_COLOR_MAP[name];

// ── ASSIST · capacity-focused questions ────────────────────────────
// Body + focus. Not emotional — these are the two reads that answer
// "can you bear down right now?".
export interface AssistOption {
  label: string;
  dx: number;
  dy: number;
}
export interface AssistQuestion {
  q: string;
  hint: string;
  opts: AssistOption[];
}
export const ASSIST: AssistQuestion[] = [
  {
    q: 'Your body right now —',
    hint: 'the physical read',
    opts: [
      { label: "wired, can't settle", dx: -0.15, dy: 0.32 },
      { label: 'alert and good', dx: 0.1, dy: 0.28 },
      { label: 'neutral, fine', dx: 0, dy: 0 },
      { label: 'heavy, tired', dx: -0.05, dy: -0.3 },
    ],
  },
  {
    q: 'Focus right now —',
    hint: 'can you bear down?',
    opts: [
      { label: 'sharp, locked in', dx: 0.3, dy: 0.05 },
      { label: 'okay-ish', dx: 0.12, dy: 0 },
      { label: 'scattered', dx: -0.22, dy: -0.05 },
      { label: "foggy, can't think", dx: -0.28, dy: -0.08 },
    ],
  },
];

// ── PLANNER · the payoff ────────────────────────────────────────────
// Given an energy band + today's quests, return what changes:
//   moves  — quests we're relocating (with a `to` hint for the row UI)
//   kept   — what stays on today
//   trim?  — mid-only optional drop suggestion
//
// Pure: doesn't mutate the store. The screen applies the moves with
// questStore.setDate / questStore.anchor after rendering.
export type MoveDestination = 'tomorrow' | 'now';
export interface TaskMove {
  quest: Quest;
  to: MoveDestination;
}
export interface Replan {
  headline: string;
  note: string;
  moves: TaskMove[];
  kept: Quest[];
  keptLabel: string;
  trim?: Quest;
}

export const replan = (band: EnergyBand, tasks: Quest[]): Replan => {
  const openTasks = tasks.filter((t) => !t.completed);
  const trials = openTasks.filter((t) => t.importance === 'high');
  const rest = openTasks.filter((t) => t.importance !== 'high');

  if (band === 'low') {
    const moved = trials;
    const n = moved.length;
    const note = n
      ? `You're low, so I pulled ${n} heavy ${n === 1 ? 'quest' : 'quests'} off and moved ${n === 1 ? 'it' : 'them'} to tomorrow. What's left is doable.`
      : "You're low — nothing heavy on today anyway. Take it light.";
    return {
      headline: "Let's lighten today.",
      note,
      moves: moved.map((q) => ({ quest: q, to: 'tomorrow' as const })),
      kept: rest,
      keptLabel: 'still on for today',
    };
  }

  if (band === 'high') {
    const lead = trials[0];
    if (!lead) {
      return {
        headline: "Strike while it's hot.",
        note: "You've got capacity — good day to get ahead on something big.",
        moves: [],
        kept: openTasks,
        keptLabel: "today's plan",
      };
    }
    return {
      headline: "Strike while it's hot.",
      note: `You've got capacity — I moved "${lead.title}" to the front. Hit the hard thing now, before the energy dips.`,
      moves: [{ quest: lead, to: 'now' }],
      kept: openTasks.filter((q) => q.id !== lead.id),
      keptLabel: 'after that',
    };
  }

  // mid — keep plan, offer trim.
  const trim =
    openTasks.find((q) => q.importance === 'low') ??
    openTasks[openTasks.length - 1];
  return {
    headline: 'Plan holds.',
    note:
      "You're steady. Today's list is realistic as-is — but if you want, drop the lowest-priority one to make room.",
    moves: [],
    kept: openTasks,
    keptLabel: "today's plan",
    trim,
  };
};

// ── Removed in the re-pointing (kept as type-only shims for any
// stragglers that imported them; safe to delete once nothing
// references them):
//   parseTalk · contextualRead · DayContext · SAMPLE_DAY · whisper
//
// These belonged to the emotional-reflection version. The new screen
// has no Talk flow, no contextual cause read, and no week ribbon, so
// nothing in the app should still import them.
