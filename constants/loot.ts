export interface LootItem {
  name: string;
  glyph: string;
  color: string;
  chance: number;
}

export const LOOT: LootItem[] = [
  { name: 'Ember shard', glyph: '✦', color: '#E07A4F', chance: 0.3 },
  { name: 'Calm shard', glyph: '❉', color: '#869072', chance: 0.3 },
  { name: 'Focus shard', glyph: '✧', color: '#C9A06A', chance: 0.25 },
  { name: 'Rare crystal', glyph: '◈', color: '#9A85A8', chance: 0.1 },
  { name: 'Star fragment', glyph: '★', color: '#F4C98A', chance: 0.05 },
];

export const rollLoot = (): LootItem => {
  const r = Math.random();
  let a = 0;
  for (const item of LOOT) {
    a += item.chance;
    if (r <= a) return item;
  }
  return LOOT[0];
};
