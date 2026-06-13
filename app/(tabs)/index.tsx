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
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { XPBar } from '../../components/XPBar';
import { ProfileCard } from '../../components/ProfileCard';
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
  const day = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  if (h < 5) return `${day} late night 🌙`;
  if (h < 12) return `${day} morning ☁️`;
  if (h < 17) return `${day} afternoon ☀️`;
  if (h < 21) return `${day} evening 🌅`;
  return `${day} night 🌙`;
};

export default function Home() {
  const router = useRouter();
  const name = useUserStore((s) => s.name);
  const shieldAvailable = useUserStore((s) => s.shieldAvailable);
  const streak = useUserStore((s) => s.streak);
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
      Alert.alert("Couldn't parse that", 'Try a shorter line and resend.');
    } finally {
      setParsing(false);
    }
  };

  return (
    <Screen>
      <View style={styles.greetingRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.time}>{greeting()}</Text>
          <Text style={styles.h1}>
            Hey {name || 'friend'}, <Text style={styles.italics}>ready?</Text>
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push('/profile');
          }}
          hitSlop={10}
          style={styles.gear}
        >
          <Text style={styles.gearIcon}>⚙️</Text>
        </Pressable>
      </View>

      <XPBar />
      <ProfileCard />

      <Label style={{ marginTop: 8 }}>Today's quests</Label>
      <View style={styles.questList}>
        {todayQuests.length === 0 ? (
          <Text style={styles.empty}>
            No quests yet. Dump some thoughts below and Lumi will turn them
            into small ones.
          </Text>
        ) : (
          todayQuests.map((q) => (
            <QuestCard
              key={q.id}
              quest={q}
              onToggle={() => handleToggle(q.id)}
            />
          ))
        )}
      </View>

      {shieldAvailable && streak > 0 && (
        <View style={styles.shield}>
          <Text style={styles.shieldIcon}>🛡️</Text>
          <Text style={styles.shieldText}>
            <Text style={styles.shieldStrong}>Streak shield active.</Text>{' '}
            Miss a day and your {streak}-day streak stays safe.
          </Text>
        </View>
      )}

      <Label style={{ marginTop: 20 }}>Brain dump</Label>
      <View style={styles.dump}>
        <TextInput
          value={dump}
          onChangeText={setDump}
          placeholder="I need to remember…"
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
            <Text style={styles.micText}>🎙️</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { marginBottom: 20 },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    gap: 12,
  },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 100,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearIcon: { fontSize: 18, lineHeight: 20 },
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
    marginTop: 12,
  },
  shieldIcon: { fontSize: 16 },
  shieldText: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
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
    fontSize: 14,
  },
});
