import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureStorage } from '../lib/secureStorage';
import { defaultEquipped, ItemCategory } from '../constants/items';

export interface Adventure {
  id: string;
  startedAt: string;
  endsAt: string;
  foundItemId?: string;
  collected: boolean;
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

  equipSkin: (id: string) => void;
  unlockSkin: (id: string) => void;
  equipItem: (cat: ItemCategory, id: string) => void;
  unlockItem: (id: string) => void;
  bumpTrait: (trait: keyof PetState['traits'], delta: number) => void;
  startAdventure: () => Adventure;
  collectAdventure: () => Adventure | null;
  care: (action: keyof PetState['lastCare']) => void;
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
        // Prefer finds the user does NOT own yet — 4 of the 6 pool
        // items ship default-owned, so a blind pick delivered nothing
        // ~two-thirds of the time while the UI celebrated a "find".
        // Once the pool is exhausted, any item is fine: the collect
        // moment is the payoff and re-finding a favorite is on-theme.
        const owned = get().ownedItems;
        const fresh = ADVENTURE_FINDS.filter((f) => !owned.includes(f));
        const pool = fresh.length > 0 ? fresh : ADVENTURE_FINDS;
        const found = pool[Math.floor(Math.random() * pool.length)];
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
        }),
    }),
    {
      name: 'lumi.pet',
      // Meds timestamps + care history are sensitive — AES at rest
      // like the user/checkin stores. secureStorage adopts a legacy
      // plaintext value in place, so existing installs migrate
      // losslessly. (A persisted sosEvents array from the retired SOS
      // prototype may linger in old blobs; zustand ignores unknown
      // keys on hydrate.)
      storage: createJSONStorage(() => secureStorage),
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
