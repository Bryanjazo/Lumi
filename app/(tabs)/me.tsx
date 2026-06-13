import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaPanel } from '../../components/me/LunaPanel';
import { ReportPanel } from '../../components/me/ReportPanel';

type Sub = 'luna' | 'report';

const SUB_TABS: { key: Sub; label: string; emoji: string }[] = [
  { key: 'luna', label: 'Luna', emoji: '🐾' },
  { key: 'report', label: 'Report', emoji: '📊' },
];

export default function MeTab() {
  const [sub, setSub] = useState<Sub>('luna');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.toggle}>
        {SUB_TABS.map((t) => {
          const active = sub === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => {
                if (sub !== t.key) {
                  Haptics.selectionAsync();
                  setSub(t.key);
                }
              }}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={styles.emoji}>{t.emoji}</Text>
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {sub === 'luna' ? <LunaPanel /> : <ReportPanel />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 100,
    padding: 4,
    marginHorizontal: 18,
    marginTop: 8,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 100,
  },
  tabActive: {
    backgroundColor: colors.terraBg,
  },
  emoji: { fontSize: 14 },
  tabLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.text2,
  },
  tabLabelActive: {
    color: colors.terra,
    fontFamily: fonts.sansSemi,
  },
});
