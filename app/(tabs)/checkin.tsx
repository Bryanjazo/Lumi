import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { Label } from '../../components/Label';
import { MoodGrid } from '../../components/MoodGrid';
import { AICheckin } from '../../components/AICheckin';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  Mood,
  useCheckinStore,
  moodEmoji,
  selectWeekMoods,
} from '../../store/checkinStore';
import { useUserStore } from '../../store/userStore';
import { usePetStore } from '../../store/petStore';
import { checkinResponse, CheckinResponse } from '../../lib/anthropic';
import { XP } from '../../lib/gamification';

export default function CheckinTab() {
  const [mood, setMood] = useState<Mood | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CheckinResponse | null>(null);

  const add = useCheckinStore((s) => s.add);
  const checkins = useCheckinStore((s) => s.checkins);
  const weekMoods = useMemo(() => selectWeekMoods(checkins), [checkins]);
  const addXp = useUserStore((s) => s.addXp);
  const registerActivity = useUserStore((s) => s.registerActivity);
  const petName = useUserStore((s) => s.petName);
  const care = usePetStore((s) => s.care);

  const send = async () => {
    if (!mood) {
      Alert.alert('Pick a mood first', 'Even a rough guess helps.');
      return;
    }
    setLoading(true);
    try {
      const res = await checkinResponse({ mood, text, petName });
      setResponse(res);
      add({
        mood,
        text,
        state: res.state,
        explanation: res.explanation,
        action: res.action,
      });
      addXp(XP.checkin);
      registerActivity();
      care('checkin');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Try again', "Couldn't reach Lumi just now.");
    } finally {
      setLoading(false);
    }
  };

  const pattern = derivePattern(weekMoods);

  return (
    <Screen>
      <View style={styles.top}>
        <Text style={styles.h2}>
          How's it <Text style={styles.italics}>actually</Text> going?
        </Text>
        <Text style={styles.sub}>Pick what's loudest. Words can come after.</Text>
      </View>

      <Label>Mood</Label>
      <MoodGrid selected={mood} onSelect={setMood} />

      <View style={{ height: 16 }} />
      <Label>Words, if you have them</Label>
      <View style={styles.inputCard}>
        <Text style={styles.prompt}>
          <Text style={styles.promptStrong}>Tell us what's going on.</Text>{' '}
          Messy is fine.
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="anything…"
          placeholderTextColor={colors.text3}
          style={styles.input}
          multiline
        />
        <View style={styles.row}>
          <Text style={styles.mic}>◉ voice input</Text>
          <Pressable
            onPress={send}
            disabled={loading || !mood}
            style={[styles.send, (!mood || loading) && { opacity: 0.5 }]}
          >
            <Text style={styles.sendText}>{loading ? 'Reading…' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>

      <AICheckin loading={loading} response={response} />

      <View style={{ height: 28 }} />
      <Label>Last 7 days</Label>
      <View style={styles.chart}>
        {weekMoods.map((d) => {
          const h = d.score === 0 ? 8 : 16 + d.score * 14;
          return (
            <View key={d.date} style={styles.chartCol}>
              <View
                style={[
                  styles.bar,
                  {
                    height: h,
                    backgroundColor:
                      d.score >= 4
                        ? colors.moss
                        : d.score >= 3
                          ? colors.caramel
                          : d.score >= 2
                            ? colors.terra
                            : d.score >= 1
                              ? colors.rose
                              : colors.border2,
                  },
                ]}
              />
              <Text style={styles.day}>
                {new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, {
                  weekday: 'narrow',
                })}
              </Text>
              {d.mood && <Text style={styles.emoji}>{moodEmoji[d.mood]}</Text>}
            </View>
          );
        })}
      </View>
      {pattern && (
        <View style={styles.insight}>
          <Text style={styles.insightTag}>PATTERN</Text>
          <Text style={styles.insightText}>{pattern}</Text>
        </View>
      )}
    </Screen>
  );
}

const derivePattern = (
  week: { date: string; score: number; mood: Mood | null }[],
): string | null => {
  const scored = week.filter((d) => d.score > 0);
  if (scored.length < 3) return null;
  const days = scored.map((d) => ({
    day: new Date(d.date + 'T00:00:00').getDay(),
    s: d.score,
  }));
  const mid = days.filter((d) => d.day >= 2 && d.day <= 4);
  const ends = days.filter((d) => d.day <= 1 || d.day >= 5);
  const midAvg = mid.length ? mid.reduce((a, b) => a + b.s, 0) / mid.length : 0;
  const endAvg = ends.length
    ? ends.reduce((a, b) => a + b.s, 0) / ends.length
    : 0;
  if (midAvg > endAvg + 0.5) return 'You feel better mid-week.';
  if (endAvg > midAvg + 0.5) return 'Weekends sit lighter for you.';
  return null;
};

const styles = StyleSheet.create({
  top: { marginBottom: 22 },
  h2: {
    fontFamily: fonts.serif,
    fontSize: 25,
    color: colors.text,
    lineHeight: 32,
  },
  italics: { fontFamily: fonts.serifItalic, color: colors.cream },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    marginTop: 4,
  },
  inputCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 16,
  },
  prompt: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
  promptStrong: { fontFamily: fonts.sansSemi, color: colors.text },
  input: {
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 9,
    padding: 12,
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 13,
    minHeight: 70,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mic: { fontFamily: fonts.sans, color: colors.text3, fontSize: 12 },
  send: {
    backgroundColor: colors.plumDark,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  sendText: { fontFamily: fonts.sansSemi, color: '#fff', fontSize: 13 },
  chart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 10,
    minHeight: 110,
  },
  chartCol: { alignItems: 'center', flex: 1 },
  bar: { width: 14, borderRadius: 4, marginBottom: 6 },
  day: { fontFamily: fonts.sans, color: colors.text3, fontSize: 11 },
  emoji: { fontSize: 12, marginTop: 2 },
  insight: {
    marginTop: 14,
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1,
    borderRadius: 11,
    padding: 12,
  },
  insightTag: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 4,
  },
  insightText: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
  },
});
