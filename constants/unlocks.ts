// Lumi · unlocks catalog.
//
// XP is a permanent level gate, NEVER spent (a strategy guardrail —
// progress only ever moves forward). Reaching the threshold permanently
// unlocks the item. category: world | pet | skin | feature.

export type UnlockCategory = 'world' | 'pet' | 'skin' | 'feature';

export interface UnlockCategoryMeta {
  label: string;
  glyph: string;
  color: string;
}

export const UNLOCK_CATS: Record<UnlockCategory, UnlockCategoryMeta> = {
  world: { label: 'Worlds', glyph: '◉', color: '#7FA06A' },
  pet: { label: 'Companions', glyph: '❉', color: '#E0A0B4' },
  skin: { label: 'Luna skins', glyph: '✦', color: '#C9A06A' },
  feature: { label: 'Powers', glyph: '◆', color: '#8EA0B4' },
};

export interface Unlock {
  id: string;
  cat: UnlockCategory;
  name: string;
  sub: string;
  /** Lifetime XP threshold to permanently unlock. */
  xp: number;
  /**
   * Asset key for commissioned art swap-out — when real assets land,
   * map this to an Image source in UnlockThumb. Null = no thumbnail
   * (uses the category glyph fallback).
   */
  art: string | null;
}

export const UNLOCKS: Unlock[] = [
  // ── worlds ──
  // Cozy Room is the default world every account starts with (0 XP).
  // Other worlds are aspirational unlocks the player works toward.
  { id: 'room', cat: 'world', name: 'Cozy Room', sub: "Luna's home", xp: 0, art: 'room' },
  { id: 'isle', cat: 'world', name: 'Floating Isle', sub: 'a little world in the sky', xp: 1500, art: 'isle' },
  { id: 'meadow', cat: 'world', name: 'Sunlit Meadow', sub: 'open fields & long grass', xp: 3000, art: 'meadow' },
  { id: 'tide', cat: 'world', name: 'Tide Pools', sub: 'a quiet shore at dusk', xp: 5000, art: 'tide' },
  { id: 'peaks', cat: 'world', name: 'Snow Peaks', sub: 'still, cold, starlit', xp: 8000, art: 'peaks' },

  // ── pets ──
  { id: 'luna', cat: 'pet', name: 'Lumi', sub: 'your first companion', xp: 0, art: 'luna' },
  { id: 'moth', cat: 'pet', name: 'Embermoth', sub: 'drifts near the lamp', xp: 2000, art: 'moth' },
  { id: 'fox', cat: 'pet', name: 'Dusk Fox', sub: "visits when you're steady", xp: 4500, art: 'fox' },

  // ── skins ──
  { id: 'cream', cat: 'skin', name: 'Cream coat', sub: 'Lumi, classic', xp: 0, art: 'cream' },
  { id: 'shadow', cat: 'skin', name: 'Shadow coat', sub: 'deep charcoal', xp: 1200, art: 'shadow' },
  { id: 'calico', cat: 'skin', name: 'Ember calico', sub: 'warm patches', xp: 2800, art: 'calico' },

  // ── features ──
  { id: 'themes', cat: 'feature', name: 'Color themes', sub: 'recolor the whole app', xp: 1000, art: null },
  { id: 'focus', cat: 'feature', name: 'Focus timer', sub: 'body-double work timer', xp: 2500, art: null },
  { id: 'widgets', cat: 'feature', name: 'Home widgets', sub: 'quests on your home screen', xp: 5000, art: null },
];

export const UNLOCK_ORDER: UnlockCategory[] = [
  'world',
  'pet',
  'skin',
  'feature',
];

/** Count unlocks the user has earned given their lifetime XP. */
export const countEarned = (totalXp: number): number =>
  UNLOCKS.filter((u) => totalXp >= u.xp).length;
