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
          How are you feeling{'\n'}
          <Text style={styles.italics}>right now?</Text>
        </Text>
        <Text style={styles.sub}>No right answer. Just be honest.</Text>
      </View>

      <Label>Pick what fits</Label>
      <MoodGrid selected={mood} onSelect={setMood} />

      <View style={{ height: 20 }} />
      <Label>Tell us more</Label>
      <View style={styles.inputCard}>
        <Text style={styles.prompt}>
          <Text style={styles.promptStrong}>What's going on?</Text>{' '}
          Messy is fine — we'll make sense of it.
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="I woke up feeling off. I have 3 things to do and I can't start any of them…"
          placeholderTextColor={colors.text3}
          style={styles.input}
          multiline
        />
        <View style={styles.row}>
          <Text style={styles.mic}>🎙️ Speak instead</Text>
          <Pressable
            onPress={send}
            disabled={loading || !mood}
            style={[styles.send, (!mood || loading) && { opacity: 0.5 }]}
          >
            <Text style={styles.sendText}>
              {loading ? 'Reading…' : 'Make sense of this →'}
            </Text>
          </Pressable>
        </View>
      </View>

      {(loading || response) && (
        <>
          <View style={{ height: 20 }} />
          <Label>What's happening</Label>
          <AICheckin loading={loading} response={response} />
        </>
      )}

      <View style={{ height: 22 }} />
      <Label>Your pattern this week</Label>
      <View style={styles.patternCard}>
        <Text style={styles.patternTitle}>Mood · last 7 days</Text>
        <View style={styles.chart}>
          {weekMoods.map((d, i) => {
            const h = d.score === 0 ? 6 : 12 + d.score * 10;
            const good = d.score >= 3;
            const day = ['M', 'T', 'W', 'T', 'F', 'S', 'S'][
              new Date(d.date + 'T00:00:00').getDay() === 0
                ? 6
                : new Date(d.date + 'T00:00:00').getDay() - 1
            ];
            return (
              <View key={d.date + i} style={styles.chartCol}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: h,
                      backgroundColor: good
                        ? 'rgba(139,191,150,0.2)'
                        : 'rgba(212,144,106,0.2)',
                      borderColor: good
                        ? 'rgba(139,191,150,0.3)'
                        : 'rgba(212,144,106,0.3)',
                    },
                  ]}
                />
                <Text style={styles.day}>{day}</Text>
              </View>
            );
          })}
        </View>
        {pattern && (
          <View style={styles.insight}>
            <Text style={styles.insightIcon}>💡</Text>
            <Text style={styles.insightText}>
              <Text style={styles.insightStrong}>{pattern}</Text>
            </Text>
          </View>
        )}
      </View>
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
    fontSize: 26,
    color: colors.text,
    lineHeight: 34,
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
    paddingVertical: 15,
    paddingHorizontal: 17,
  },
  prompt: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 21,
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
    lineHeight: 21,
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
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  sendText: { fontFamily: fonts.sansSemi, color: '#fff', fontSize: 13 },
  patternCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 17,
    paddingHorizontal: 19,
  },
  patternTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 14,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 60,
    gap: 6,
    marginBottom: 12,
  },
  chartCol: { flex: 1, alignItems: 'center', gap: 4 },
  bar: {
    width: '100%',
    borderRadius: 4,
    borderWidth: 1,
  },
  day: { fontFamily: fonts.sans, color: colors.text3, fontSize: 10 },
  insight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: colors.caramelBg,
    borderColor: 'rgba(212,170,106,0.15)',
    borderWidth: 1,
    borderRadius: 9,
    padding: 11,
    paddingHorizontal: 13,
  },
  insightIcon: { fontSize: 13, lineHeight: 19 },
  insightText: {
    flex: 1,
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
  },
  insightStrong: { fontFamily: fonts.sansSemi, color: colors.cream },
});
