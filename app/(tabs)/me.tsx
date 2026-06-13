import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaSection } from '../../components/me/LunaSection';
import { SkinsSection } from '../../components/me/SkinsSection';
import { ItemsSection } from '../../components/me/ItemsSection';
import { GoalsSection } from '../../components/me/GoalsSection';
import { ReportSection } from '../../components/me/ReportSection';

type Sub = 'luna' | 'skins' | 'items' | 'goals' | 'report';

const TABS: { key: Sub; label: string }[] = [
  { key: 'luna', label: 'Luna' },
  { key: 'skins', label: 'Skins' },
  { key: 'items', label: 'Items' },
  { key: 'goals', label: 'Goals' },
  { key: 'report', label: 'Report' },
];

export default function MeTab() {
  const [sub, setSub] = useState<Sub>('luna');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.subtabs}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subRow}
        >
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setSub(t.key)}
              style={[styles.tab, sub === t.key && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  sub === t.key && styles.tabTextActive,
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {sub === 'luna' && <LunaSection />}
        {sub === 'skins' && <SkinsSection />}
        {sub === 'items' && <ItemsSection />}
        {sub === 'goals' && <GoalsSection />}
        {sub === 'report' && <ReportSection />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  subtabs: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  subRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
  },
  tabText: {
    fontFamily: fonts.sansMedium,
    color: colors.text2,
    fontSize: 12,
  },
  tabTextActive: { color: colors.plum, fontFamily: fonts.sansSemi },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 120,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
});
