import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultEquipped, ItemCategory } from '../constants/items';

export interface Adventure {
  id: string;
  startedAt: string;
  endsAt: string;
  foundItemId?: string;
  collected: boolean;
}

export interface SosEvent {
  id: string;
  type: 'rsd' | 'depersonalization';
  durationSeconds: number;
  createdAt: string;
}

interface PetState {
  skinId: string;
  ownedSkins: string[];
  equipped: Record<ItemCategory, string>;
  ownedItems: string[];
  traits: {
    presence: number;
    groundedness: number;
    momentum: number;
    curiosity: number;
  };
  adventure: Adventure | null;
  lastCare: {
    checkin: string | null;
    meds: string | null;
    move: string | null;
    windDown: string | null;
  };
  sosEvents: SosEvent[];

  equipSkin: (id: string) => void;
  unlockSkin: (id: string) => void;
  equipItem: (cat: ItemCategory, id: string) => void;
  unlockItem: (id: string) => void;
  bumpTrait: (trait: keyof PetState['traits'], delta: number) => void;
  startAdventure: () => Adventure;
  collectAdventure: () => Adventure | null;
  care: (action: keyof PetState['lastCare']) => void;
  logSos: (e: Omit<SosEvent, 'id' | 'createdAt'>) => SosEvent;
  reset: () => void;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const newId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const ADVENTURE_FINDS = [
  'plant-fern',
  'toy-yarn',
  'toy-mouse',
  'plant-cactus',
  'lamp-warm',
  'decor-window',
];

export const usePetStore = create<PetState>()(
  persist(
    (set, get) => ({
      skinId: 'cream',
      ownedSkins: ['cream'],
      equipped: { ...defaultEquipped },
      ownedItems: Object.values(defaultEquipped),
      traits: {
        presence: 40,
        groundedness: 40,
        momentum: 35,
        curiosity: 50,
      },
      adventure: null,
      lastCare: { checkin: null, meds: null, move: null, windDown: null },
      sosEvents: [],

      equipSkin: (id) => {
        if (!get().ownedSkins.includes(id)) return;
        set({ skinId: id });
      },
      unlockSkin: (id) =>
        set((s) =>
          s.ownedSkins.includes(id)
            ? s
            : { ownedSkins: [...s.ownedSkins, id] },
        ),
      equipItem: (cat, id) => {
        if (!get().ownedItems.includes(id)) return;
        set((s) => ({ equipped: { ...s.equipped, [cat]: id } }));
      },
      unlockItem: (id) =>
        set((s) =>
          s.ownedItems.includes(id) ? s : { ownedItems: [...s.ownedItems, id] },
        ),
      bumpTrait: (trait, delta) =>
        set((s) => ({
          traits: { ...s.traits, [trait]: clamp(s.traits[trait] + delta) },
        })),
      startAdventure: () => {
        const now = new Date();
        const ends = new Date(now.getTime() + 1000 * 60 * 60 * 2);
        const found =
          ADVENTURE_FINDS[Math.floor(Math.random() * ADVENTURE_FINDS.length)];
        const a: Adventure = {
          id: newId(),
          startedAt: now.toISOString(),
          endsAt: ends.toISOString(),
          foundItemId: found,
          collected: false,
        };
        set({ adventure: a });
        return a;
      },
      collectAdventure: () => {
        const a = get().adventure;
        if (!a) return null;
        if (new Date(a.endsAt).getTime() > Date.now()) return null;
        if (a.collected) return a;
        const done: Adventure = { ...a, collected: true };
        set((s) => ({
          adventure: null,
          ownedItems: a.foundItemId
            ? s.ownedItems.includes(a.foundItemId)
              ? s.ownedItems
              : [...s.ownedItems, a.foundItemId]
            : s.ownedItems,
        }));
        return done;
      },
      care: (action) =>
        set((s) => ({
          lastCare: { ...s.lastCare, [action]: new Date().toISOString() },
          traits: bumpForCare(s.traits, action),
        })),
      logSos: (e) => {
        const ev: SosEvent = {
          ...e,
          id: newId(),
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ sosEvents: [ev, ...s.sosEvents] }));
        return ev;
      },
      reset: () =>
        set({
          skinId: 'cream',
          ownedSkins: ['cream'],
          equipped: { ...defaultEquipped },
          ownedItems: Object.values(defaultEquipped),
          traits: {
            presence: 40,
            groundedness: 40,
            momentum: 35,
            curiosity: 50,
          },
          adventure: null,
          lastCare: { checkin: null, meds: null, move: null, windDown: null },
          sosEvents: [],
        }),
    }),
    {
      name: 'lumi.pet',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

function bumpForCare(
  traits: PetState['traits'],
  action: keyof PetState['lastCare'],
): PetState['traits'] {
  switch (action) {
    case 'checkin':
      return { ...traits, presence: clamp(traits.presence + 5) };
    case 'meds':
      return { ...traits, groundedness: clamp(traits.groundedness + 5) };
    case 'move':
      return { ...traits, momentum: clamp(traits.momentum + 5) };
    case 'windDown':
      return { ...traits, curiosity: clamp(traits.curiosity + 3) };
  }
}
