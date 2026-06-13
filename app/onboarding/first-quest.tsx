import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { Pill } from '../../components/Pill';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';
import { useQuestStore } from '../../store/questStore';
import { xpForQuest } from '../../lib/gamification';
import {
  requestNotificationPermissions,
  scheduleDailyReminders,
} from '../../lib/notifications';

const QUEST_TITLE = 'Drink one full glass of water';

export default function FirstQuest() {
  const router = useRouter();
  const addQuest = useQuestStore((s) => s.addQuest);
  const toggle = useQuestStore((s) => s.toggle);
  const addXp = useUserStore((s) => s.addXp);
  const registerActivity = useUserStore((s) => s.registerActivity);
  const completeOnboarding = useUserStore((s) => s.completeOnboarding);
  const setNotificationsEnabled = useUserStore(
    (s) => s.setNotificationsEnabled,
  );
  const petName = useUserStore((s) => s.petName);

  const [questId, setQuestId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const q = addQuest({ title: QUEST_TITLE, difficulty: 'easy' });
    setQuestId(q.id);
  }, [addQuest]);

  const complete = async () => {
    if (!questId || done) return;
    const q = toggle(questId);
    if (!q) return;
    addXp(xpForQuest('easy'));
    registerActivity();
    setDone(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const finish = async () => {
    Haptics.selectionAsync();
    const ok = await requestNotificationPermissions();
    setNotificationsEnabled(ok);
    if (ok) await scheduleDailyReminders();
    completeOnboarding();
    router.replace('/(tabs)');
  };

  return (
    <Screen>
      <Text style={styles.tag}>YOUR FIRST QUEST</Text>
      <Text style={styles.h2}>
        Start with the <Text style={styles.italic}>smallest</Text> possible win.
      </Text>
      <Text style={styles.sub}>
        {petName} is watching. She gets a little brighter when this clicks.
      </Text>

      <Pressable
        onPress={complete}
        style={[styles.card, done && styles.cardDone]}
      >
        <View
          style={[
            styles.accent,
            { backgroundColor: done ? colors.moss : colors.plum },
          ]}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, done && styles.strike]}>
            {QUEST_TITLE}
          </Text>
          <View style={styles.row}>
            <Pill tone="moss">Easy</Pill>
            <Text style={styles.xp}>+{xpForQuest('easy')} XP</Text>
          </View>
        </View>
        <View
          style={[
            styles.check,
            done && {
              backgroundColor: colors.moss,
              borderColor: colors.moss,
            },
          ]}
        >
          {done && <Text style={styles.checkText}>✓</Text>}
        </View>
      </Pressable>

      {done && (
        <View style={styles.feedback}>
          <Text style={styles.feedbackText}>
            That's the loop. Now do it again, tomorrow.
          </Text>
        </View>
      )}

      <Pressable
        onPress={finish}
        disabled={!done}
        style={[styles.btn, !done && { opacity: 0.45 }]}
      >
        <Text style={styles.btnText}>
          {done ? 'Open Lumi' : 'Tap the quest to start'}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tag: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 12,
  },
  h2: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.cream },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    marginTop: 6,
    marginBottom: 22,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border2,
    borderWidth: 1.5,
    borderRadius: 15,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  cardDone: { opacity: 0.7 },
  accent: { width: 4, height: 36, borderRadius: 100 },
  title: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 15,
    marginBottom: 6,
  },
  strike: { textDecorationLine: 'line-through' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  xp: { fontFamily: fonts.sans, color: colors.text3, fontSize: 12 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderColor: colors.border2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { color: colors.bg, fontFamily: fonts.sansSemi, fontSize: 14 },
  feedback: {
    backgroundColor: colors.mossBg,
    borderColor: colors.mossBorder,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    marginBottom: 22,
  },
  feedbackText: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 14,
    borderRadius: 100,
    alignItems: 'center',
  },
  btnText: { fontFamily: fonts.sansSemi, color: '#fff', fontSize: 14 },
});
