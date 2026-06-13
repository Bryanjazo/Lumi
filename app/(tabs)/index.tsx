import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { XPBar } from '../../components/XPBar';
import { QuestCard } from '../../components/QuestCard';
import { Label } from '../../components/Label';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';
import { useQuestStore, selectTodayQuests } from '../../store/questStore';
import { parseBrainDump } from '../../lib/anthropic';
import { XP } from '../../lib/gamification';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
};

export default function Home() {
  const name = useUserStore((s) => s.name);
  const shieldAvailable = useUserStore((s) => s.shieldAvailable);
  const addXp = useUserStore((s) => s.addXp);
  const registerActivity = useUserStore((s) => s.registerActivity);

  const quests = useQuestStore((s) => s.quests);
  const toggle = useQuestStore((s) => s.toggle);
  const addMany = useQuestStore((s) => s.addMany);
  const todayQuests = useMemo(() => selectTodayQuests(quests), [quests]);

  const [dump, setDump] = useState('');
  const [parsing, setParsing] = useState(false);

  const handleToggle = (id: string) => {
    const q = toggle(id);
    if (!q) return;
    if (q.completed) {
      addXp(q.xpReward);
      registerActivity();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleDump = async () => {
    if (!dump.trim()) return;
    setParsing(true);
    try {
      const res = await parseBrainDump(dump);
      addMany(res.tasks);
      addXp(XP.brainDump);
      setDump('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Couldn't parse that", "Try a shorter line and resend.");
    } finally {
      setParsing(false);
    }
  };

  return (
    <Screen>
      <View style={styles.greeting}>
        <Text style={styles.time}>{greeting()}</Text>
        <Text style={styles.h1}>
          Hey <Text style={styles.italics}>{name || 'friend'}</Text>, ready?
        </Text>
      </View>

      <XPBar />

      {shieldAvailable && (
        <View style={styles.shield}>
          <Text style={styles.shieldIcon}>◈</Text>
          <Text style={styles.shieldText}>
            <Text style={styles.shieldStrong}>Streak shield active.</Text>{' '}
            One free miss this week.
          </Text>
        </View>
      )}

      <Label style={{ marginTop: 8 }}>Today's quests</Label>
      <View style={styles.questList}>
        {todayQuests.length === 0 ? (
          <Text style={styles.empty}>
            No quests yet. Dump some thoughts below and Lumi will turn them into
            small ones.
          </Text>
        ) : (
          todayQuests.map((q) => (
            <QuestCard key={q.id} quest={q} onToggle={() => handleToggle(q.id)} />
          ))
        )}
      </View>

      <Label style={{ marginTop: 20 }}>Brain dump</Label>
      <View style={styles.dump}>
        <TextInput
          value={dump}
          onChangeText={setDump}
          placeholder="anything in your head…"
          placeholderTextColor={colors.text3}
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={handleDump}
          style={styles.mic}
          disabled={parsing || !dump.trim()}
        >
          {parsing ? (
            <ActivityIndicator size="small" color={colors.plum} />
          ) : (
            <Text style={styles.micText}>↑</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { marginBottom: 20 },
  time: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 12,
    marginBottom: 4,
  },
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
  },
  italics: {
    fontFamily: fonts.serifItalic,
    color: colors.cream,
  },
  shield: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.caramelBg,
    borderColor: colors.caramelBorder,
    borderWidth: 1,
    borderRadius: 11,
    padding: 11,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  shieldIcon: { color: colors.caramel, fontSize: 14 },
  shieldText: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    flex: 1,
  },
  shieldStrong: {
    fontFamily: fonts.sansSemi,
    color: colors.cream,
  },
  questList: { gap: 7 },
  empty: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    fontSize: 13,
    paddingVertical: 18,
    textAlign: 'center',
  },
  dump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 44,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text,
    paddingVertical: 8,
    minHeight: 36,
  },
  mic: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micText: {
    color: colors.plum,
    fontFamily: fonts.sansSemi,
    fontSize: 16,
  },
});
