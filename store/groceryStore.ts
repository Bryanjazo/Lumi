import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Same encrypted-at-rest storage the quest store uses (security audit
// §6): AES via lib/secureStorage — key in Keychain/Keystore, ciphertext
// in AsyncStorage. A grocery list is low-stakes, but there's no reason
// to hold it in weaker storage than everything else.
import { secureStorage } from '../lib/secureStorage';

/**
 * One line on the grocery checklist.
 *
 * Groceries are DELIBERATELY not Quests. They never earn XP, never
 * touch a window / date / anchor / recur, never mirror to a calendar,
 * never enter the Time radar, and never round-trip through lib/sync.
 * That isolation is exactly what keeps "don't break quests/sync" true:
 * a scratchpad list can't corrupt the task economy if it never enters
 * it. (See the feature spec — groceries route to this store instead of
 * addQuest.)
 */
export interface GroceryItem {
  id: string;
  /** The literal item text — "milk", "oat milk", "2% milk". Kept as
   *  the user (or the split) produced it; NOT title-cased, so the list
   *  stays lowercase-calm like its Home neighbors. */
  text: string;
  checked: boolean;
  /** When it was grabbed (checked). Null while unchecked. Powers the
   *  "clear grabbed" affordance; no reorder happens on check. */
  checkedAt: number | null;
  createdAt: number;
}

interface GroceryState {
  items: GroceryItem[];
  /** Persisted expand/collapse flag for the Home pill — the card born
   *  from a capture opens so the user sees items land, and the choice
   *  survives a restart like the quest piles' local UI state. */
  open: boolean;
  /**
   * Append several item texts at once (the capture → confirm-card
   * route). Trims each, drops empties, and drops case-insensitive
   * duplicates of an EXISTING UNCHECKED item (re-buying something
   * you already grabbed is legitimate, so checked items don't block a
   * re-add). Order preserved.
   */
  addItems: (texts: string[]) => void;
  /** Append a single literal item (the inline add row). Same trim +
   *  unchecked-dupe guard as addItems. */
  addItem: (text: string) => void;
  toggle: (id: string) => void;
  /** Rename an item in place (inline edit). Blank/whitespace is a
   *  NO-OP — the item keeps its old text. Clearing the field then
   *  tapping away (blur) used to silently DELETE the line with no undo;
   *  deletion is now an explicit act via remove() (the × affordance),
   *  which carries an undo. */
  editItem: (id: string, text: string) => void;
  remove: (id: string) => void;
  /** Put a removed item back exactly as it was — same id, checked
   *  state, and timestamps. Powers the remove → undo affordance, which
   *  a plain re-add (unchecked) would have quietly reset. No-op if an
   *  item with that id is somehow already present. */
  restoreItem: (item: GroceryItem) => void;
  /** Drop every checked (grabbed) item — the "clear grabbed" link. */
  clearChecked: () => void;
  reset: () => void;
  setOpen: (open: boolean) => void;
  /** True once async storage rehydration finished — Home gates the
   *  pill on this so it never flashes empty before the list loads
   *  (same precedent as questStore.hasHydrated). */
  hasHydrated: boolean;
}

// RFC 4122 v4 — matches questStore's generator. These ids never leave
// the device (no cloud grocery table), so a non-crypto Math.random
// source is fine; collision risk for one user's short list is nil.
const newId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

/** Append texts to a list, trimming + dropping empties and
 *  case-insensitive duplicates of existing UNCHECKED items. Shared by
 *  addItems / addItem so both honor the same guard. */
const appendItems = (existing: GroceryItem[], texts: string[]): GroceryItem[] => {
  const uncheckedKeys = new Set(
    existing.filter((i) => !i.checked).map((i) => i.text.trim().toLowerCase()),
  );
  const next = [...existing];
  const now = Date.now();
  for (const raw of texts) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (uncheckedKeys.has(key)) continue;
    uncheckedKeys.add(key);
    next.push({ id: newId(), text, checked: false, checkedAt: null, createdAt: now });
  }
  return next;
};

export const useGroceryStore = create<GroceryState>()(
  persist(
    (set) => ({
      items: [],
      // Born open — the first capture routes items here, and an
      // already-expanded pill shows them landing instead of hiding
      // the payoff behind a collapsed header.
      open: true,
      addItems: (texts) =>
        set((s) => ({ items: appendItems(s.items, texts) })),
      addItem: (text) =>
        set((s) => ({ items: appendItems(s.items, [text]) })),
      toggle: (id) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id
              ? {
                  ...i,
                  checked: !i.checked,
                  checkedAt: !i.checked ? Date.now() : null,
                }
              : i,
          ),
        })),
      editItem: (id, text) => {
        const trimmed = text.trim();
        // Blank = keep the original (see the interface note): an emptied
        // edit field must never silently delete a line. Removal is the
        // explicit × (remove), which has undo.
        if (!trimmed) return;
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, text: trimmed } : i)),
        }));
      },
      remove: (id) =>
        set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      restoreItem: (item) =>
        set((s) =>
          s.items.some((i) => i.id === item.id)
            ? s
            : { items: [...s.items, item] },
        ),
      clearChecked: () =>
        set((s) => ({ items: s.items.filter((i) => !i.checked) })),
      reset: () => set({ items: [] }),
      setOpen: (open) => set({ open }),
      hasHydrated: false,
    }),
    {
      name: 'lumi.groceries',
      storage: createJSONStorage(() => secureStorage),
      version: 1,
      // Consumers gate the Home pill on this so it never renders against
      // the empty pre-hydration list (same reason questStore waits).
      onRehydrateStorage: () => () => {
        useGroceryStore.setState({ hasHydrated: true });
      },
    },
  ),
);
