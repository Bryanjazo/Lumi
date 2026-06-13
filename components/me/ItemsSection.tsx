import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, accent } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  categories,
  ItemCategory,
  itemsByCategory,
} from '../../constants/items';
import { usePetStore } from '../../store/petStore';
import { useUserStore } from '../../store/userStore';

export const ItemsSection = () => {
  const [cat, setCat] = useState<ItemCategory>('rug');
  const equipped = usePetStore((s) => s.equipped);
  const ownedItems = usePetStore((s) => s.ownedItems);
  const equipItem = usePetStore((s) => s.equipItem);
  const unlockItem = usePetStore((s) => s.unlockItem);
  const xp = useUserStore((s) => s.xp);

  return (
    <View>
      <Text style={styles.head}>Room items</Text>
      <Text style={styles.sub}>One per category — tap to swap.</Text>

      <View style={styles.catRow}>
        {categories.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => setCat(c.key)}
            style={[styles.catBtn, cat === c.key && styles.catBtnActive]}
          >
            <Text
              style={[styles.catText, cat === c.key && styles.catTextActive]}
            >
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ height: 12 }} />
      <View style={styles.grid}>
        {itemsByCategory(cat).map((item) => {
          const owned = ownedItems.includes(item.id);
          const eligible = xp >= item.xpToUnlock;
          const equippedNow = equipped[item.category] === item.id;
          const t = accent(item.accent);
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                Haptics.selectionAsync();
                if (owned) equipItem(item.category, item.id);
                else if (eligible) {
                  unlockItem(item.id);
                  equipItem(item.category, item.id);
                }
              }}
              style={[
                styles.card,
                equippedNow && {
                  borderColor: t.fg,
                  backgroundColor: t.bg,
                },
              ]}
            >
              <Text style={[styles.glyph, { color: t.fg }]}>{item.glyph}</Text>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {equippedNow
                  ? 'Equipped'
                  : owned
                    ? 'Tap to equip'
                    : eligible
                      ? 'Tap to unlock'
                      : `${item.xpToUnlock} XP`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  head: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 22,
    marginBottom: 4,
  },
  sub: { fontFamily: fonts.sans, color: colors.text2, fontSize: 13, marginBottom: 14 },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catBtnActive: {
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
  },
  catText: { fontFamily: fonts.sansMedium, color: colors.text2, fontSize: 11 },
  catTextActive: { color: colors.plum, fontFamily: fonts.sansSemi },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: 13,
    padding: 14,
    alignItems: 'center',
  },
  glyph: { fontSize: 28, marginBottom: 8 },
  name: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 13,
    marginBottom: 2,
  },
  meta: { fontFamily: fonts.sans, color: colors.text3, fontSize: 11 },
});
