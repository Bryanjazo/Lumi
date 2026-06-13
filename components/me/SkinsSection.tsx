import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { skins } from '../../constants/skins';
import { usePetStore } from '../../store/petStore';
import { useUserStore } from '../../store/userStore';

export const SkinsSection = () => {
  const skinId = usePetStore((s) => s.skinId);
  const ownedSkins = usePetStore((s) => s.ownedSkins);
  const equipSkin = usePetStore((s) => s.equipSkin);
  const unlockSkin = usePetStore((s) => s.unlockSkin);
  const xp = useUserStore((s) => s.xp);

  return (
    <View>
      <Text style={styles.head}>Choose Luna's color</Text>
      <Text style={styles.sub}>Unlocks roll in as your XP grows.</Text>
      <View style={styles.grid}>
        {skins.map((s) => {
          const owned = ownedSkins.includes(s.id);
          const eligible = xp >= s.xpToUnlock;
          const equipped = skinId === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => {
                Haptics.selectionAsync();
                if (owned) equipSkin(s.id);
                else if (eligible) {
                  unlockSkin(s.id);
                  equipSkin(s.id);
                }
              }}
              style={[
                styles.card,
                equipped && {
                  borderColor: colors.plum,
                  backgroundColor: colors.plumBg,
                },
              ]}
            >
              <View style={styles.swatch}>
                <View
                  style={[styles.dot, { backgroundColor: s.primary }]}
                />
                <View
                  style={[styles.dot, { backgroundColor: s.secondary }]}
                />
              </View>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.meta}>
                {equipped
                  ? 'Equipped'
                  : owned
                    ? 'Owned · tap to equip'
                    : eligible
                      ? 'Tap to unlock'
                      : `${s.xpToUnlock} XP`}
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
  sub: { fontFamily: fonts.sans, color: colors.text2, fontSize: 13, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: 15,
    padding: 14,
    alignItems: 'center',
  },
  swatch: { flexDirection: 'row', gap: 4, marginBottom: 10 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  name: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 2,
  },
  meta: { fontFamily: fonts.sans, color: colors.text3, fontSize: 11 },
});
