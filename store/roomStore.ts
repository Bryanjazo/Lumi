// Lumi · the living room — progressive care state for the Me-tab room.
//
// The room grows as the user shows up and tends it: watering the plant
// advances it through three growth stages; feeding fills Lumi's bowls;
// curtains and the lamp are cozy toggles. Everything persists.
//
// SOUL RULE — the plant NEVER wilts and nothing ever dies from
// neglect. Gaps are rest, not failure (no guilt). The visible plant
// stage is LATCHED (peakStage): attention only ever moves it forward,
// and a later dip in momentum can never shrink it back. Bowls fill on
// feeding and fade toward empty as a gentle refill affordance — but a
// brand-new / just-reset room reads full and cozy, never needy.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HOUR_MS = 3_600_000;

// A filled bowl empties gently over real time — a calm cadence, not a
// Tamagotchi treadmill.
export const FOOD_EMPTY_HOURS = 36;

// Growth: one water can only ADVANCE growth once per this window, so
// the plant grows with genuine day-over-day attention, not spam taps.
const GROWTH_COOLDOWN_HOURS = 18;
// growthPoints thresholds → plant stage (1 small · 2 fuller · 3 lush).
const STAGE2_AT = 3;
const STAGE3_AT = 6;

export interface CareMeter {
  /** 0–100 at the moment it was last set. */
  value: number;
  /** Epoch ms it was last set. 0 = never consumed (treated as full). */
  at: number;
}

/** Current 0–100 level of a meter, decayed for elapsed real time. A
 *  meter that has never been "spent" (at === 0) reads at its full
 *  value — so a fresh install / reset never shows an empty bowl. */
export const meterLevel = (
  m: CareMeter,
  emptyHours: number,
  now: number,
): number => {
  const clamped = Math.max(0, Math.min(100, m.value));
  if (!m.at || emptyHours <= 0) return clamped;
  const elapsedH = Math.max(0, (now - m.at) / HOUR_MS);
  const drop = (100 / emptyHours) * elapsedH;
  return Math.max(0, Math.min(100, m.value - drop));
};

/** Growth points → plant stage (1–3) earned by tending. Monotonic. */
export const stageForGrowth = (growthPoints: number): number =>
  growthPoints >= STAGE3_AT ? 3 : growthPoints >= STAGE2_AT ? 2 : 1;

interface RoomState {
  /** Times the plant was watered on a fresh day (growth-eligible). */
  growthPoints: number;
  /** Epoch ms growth last advanced (enforces the cooldown). */
  lastGrowthAt: number;
  /** Highest plant stage ever SEEN — the display never drops below it,
   *  so a momentum dip can't wilt the plant. Raised by notePeakStage. */
  peakStage: number;
  /** Lumi's food bowl. */
  food: CareMeter;
  /** Lumi's water bowl. */
  bowlWater: CareMeter;
  curtainsOpen: boolean;
  lampOn: boolean;
  /** Local Y-M-D of the last room visit — powers the welcome-back
   *  re-bloom moment (retention §5): returning after days away gets a
   *  warm greeting + the cat's happy beat, never a dead plant. */
  lastRoomVisitDate: string | null;
  /** Stamp today's visit; returns days since the previous one
   *  (0 on same-day or first-ever visit). */
  noteRoomVisit: () => number;

  /** Water the plant — at most once per cooldown window, advances
   *  growth toward the next stage. Returns true when this water
   *  actually grew the plant a stage. */
  waterPlant: () => boolean;
  /** Feed Lumi — fills both the food and water bowls. */
  feed: () => void;
  toggleCurtains: () => void;
  toggleLamp: () => void;
  /** Raise the latched peak stage (never lowers). Called from render
   *  when momentum/tending would show a higher stage. */
  notePeakStage: (stage: number) => void;
  /** Full reset — called by the account-wipe registry. */
  resetRoom: () => void;
}

// at:0 sentinel → meterLevel reads it as full, so day-one bowls are
// cozy, not needy.
const fullMeter = (): CareMeter => ({ value: 100, at: 0 });

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const useRoomStore = create<RoomState>()(
  persist(
    (set, get) => ({
      growthPoints: 0,
      lastGrowthAt: 0,
      peakStage: 1,
      food: fullMeter(),
      bowlWater: fullMeter(),
      curtainsOpen: true,
      lampOn: false,
      lastRoomVisitDate: null,

      noteRoomVisit: () => {
        const prev = get().lastRoomVisitDate;
        const now = todayIso();
        if (prev === now) return 0;
        set({ lastRoomVisitDate: now });
        if (!prev) return 0;
        const days = Math.round(
          (new Date(now + 'T12:00').getTime() -
            new Date(prev + 'T12:00').getTime()) /
            86_400_000,
        );
        return Math.max(0, days);
      },

      waterPlant: () => {
        const now = Date.now();
        const s = get();
        let grew = false;
        let { growthPoints, lastGrowthAt } = s;
        const prevStage = stageForGrowth(growthPoints);
        if (now - lastGrowthAt >= GROWTH_COOLDOWN_HOURS * HOUR_MS) {
          growthPoints += 1;
          lastGrowthAt = now;
          const nextStage = stageForGrowth(growthPoints);
          grew = nextStage > prevStage;
          set({
            growthPoints,
            lastGrowthAt,
            peakStage: Math.max(s.peakStage, nextStage),
          });
        }
        return grew;
      },

      feed: () => {
        const now = Date.now();
        set({
          food: { value: 100, at: now },
          bowlWater: { value: 100, at: now },
        });
      },

      toggleCurtains: () => set((s) => ({ curtainsOpen: !s.curtainsOpen })),
      toggleLamp: () => set((s) => ({ lampOn: !s.lampOn })),

      notePeakStage: (stage) =>
        set((s) => (stage > s.peakStage ? { peakStage: stage } : s)),

      resetRoom: () =>
        set({
          growthPoints: 0,
          lastGrowthAt: 0,
          peakStage: 1,
          food: fullMeter(),
          bowlWater: fullMeter(),
          curtainsOpen: true,
          lampOn: false,
          lastRoomVisitDate: null,
        }),
    }),
    {
      name: 'lumi-room',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
