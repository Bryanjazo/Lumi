import { AccentKey } from './colors';

export type ItemCategory = 'rug' | 'sofa' | 'plant' | 'lamp' | 'toy' | 'decor';

export interface RoomItem {
  id: string;
  name: string;
  category: ItemCategory;
  accent: AccentKey;
  xpToUnlock: number;
  glyph: string;
}

export const items: RoomItem[] = [
  // Rugs
  { id: 'rug-plum', name: 'Plum Rug', category: 'rug', accent: 'plum', xpToUnlock: 0, glyph: '▭' },
  { id: 'rug-moss', name: 'Moss Rug', category: 'rug', accent: 'moss', xpToUnlock: 300, glyph: '▭' },
  { id: 'rug-caramel', name: 'Caramel Rug', category: 'rug', accent: 'caramel', xpToUnlock: 800, glyph: '▭' },

  // Sofas
  { id: 'sofa-cream', name: 'Cream Sofa', category: 'sofa', accent: 'caramel', xpToUnlock: 0, glyph: '⌐' },
  { id: 'sofa-mist', name: 'Mist Sofa', category: 'sofa', accent: 'mist', xpToUnlock: 500, glyph: '⌐' },
  { id: 'sofa-plum', name: 'Plum Sofa', category: 'sofa', accent: 'plum', xpToUnlock: 1200, glyph: '⌐' },

  // Plants
  { id: 'plant-fern', name: 'Fern', category: 'plant', accent: 'moss', xpToUnlock: 0, glyph: '♣' },
  { id: 'plant-monstera', name: 'Monstera', category: 'plant', accent: 'moss', xpToUnlock: 400, glyph: '♣' },
  { id: 'plant-cactus', name: 'Cactus', category: 'plant', accent: 'moss', xpToUnlock: 900, glyph: '♣' },

  // Lamps
  { id: 'lamp-warm', name: 'Warm Lamp', category: 'lamp', accent: 'caramel', xpToUnlock: 0, glyph: '✦' },
  { id: 'lamp-plum', name: 'Plum Lamp', category: 'lamp', accent: 'plum', xpToUnlock: 600, glyph: '✦' },
  { id: 'lamp-moss', name: 'Moss Lamp', category: 'lamp', accent: 'moss', xpToUnlock: 1500, glyph: '✦' },

  // Toys
  { id: 'toy-yarn', name: 'Yarn Ball', category: 'toy', accent: 'rose', xpToUnlock: 0, glyph: '◉' },
  { id: 'toy-mouse', name: 'Felt Mouse', category: 'toy', accent: 'terra', xpToUnlock: 700, glyph: '◐' },
  { id: 'toy-feather', name: 'Feather Wand', category: 'toy', accent: 'plum', xpToUnlock: 1800, glyph: '⌇' },

  // Decor
  { id: 'decor-window', name: 'Window', category: 'decor', accent: 'mist', xpToUnlock: 0, glyph: '▢' },
  { id: 'decor-art', name: 'Wall Art', category: 'decor', accent: 'plum', xpToUnlock: 1000, glyph: '◇' },
  { id: 'decor-clock', name: 'Wall Clock', category: 'decor', accent: 'caramel', xpToUnlock: 2200, glyph: '◷' },
];

export const itemsByCategory = (cat: ItemCategory) =>
  items.filter((i) => i.category === cat);

export const categories: { key: ItemCategory; label: string }[] = [
  { key: 'rug', label: 'Rugs' },
  { key: 'sofa', label: 'Sofas' },
  { key: 'plant', label: 'Plants' },
  { key: 'lamp', label: 'Lamps' },
  { key: 'toy', label: 'Toys' },
  { key: 'decor', label: 'Decor' },
];

export const defaultEquipped: Record<ItemCategory, string> = {
  rug: 'rug-plum',
  sofa: 'sofa-cream',
  plant: 'plant-fern',
  lamp: 'lamp-warm',
  toy: 'toy-yarn',
  decor: 'decor-window',
};
