import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  Mood,
  useCheckinStore,
  selectWeekMoods,
} from '../../store/checkinStore';
import { useUserStore } from '../../store/userStore';
import { usePetStore } from '../../store/petStore';
import { XP } from '../../lib/gamification';

// ── Mood / Response data ─────────────────────────────────────────────
// Ported verbatim from lumi-checkin.jsx — hardcoded responses keep the
// language exactly as designed. AI hookup can layer in later as an
// enhancement; the mock is the source of truth for tone.

type MoodId =
  | 'foggy'
  | 'stuck'
  | 'low'
  | 'wired'
  | 'anxious'
  | 'focused'
  | 'drained'
  | 'good';

interface MoodData {
  id: MoodId;
  word: string;
  sub: string;
  color: string;
  glyph: string;
}

const MOODS: MoodData[] = [
  { id: 'foggy', word: 'foggy', sub: "can't think straight", color: '#9AB4C4', glyph: '◌' },
  { id: 'stuck', word: 'stuck', sub: "can't get started", color: '#A89880', glyph: '▢' },
  { id: 'low', word: 'low', sub: 'everything feels heavy', color: '#A88B95', glyph: '◡' },
  { id: 'wired', word: 'wired', sub: 'buzzing too loud', color: '#C9A06A', glyph: '≋' },
  { id: 'anxious', word: 'anxious', sub: 'tight in the chest', color: '#D88878', glyph: '◈' },
  { id: 'focused', word: 'focused', sub: 'rare and good', color: '#D89878', glyph: '✦' },
  { id: 'drained', word: 'drained', sub: 'running on empty', color: '#7A8A95', glyph: '◐' },
  { id: 'good', word: 'good', sub: 'steady ground', color: '#8FA378', glyph: '○' },
];

interface ResponseData {
  state: string;
  body: string;
  action: string;
  color: string;
}

const RESPONSES: Record<MoodId, ResponseData> = {
  foggy: {
    state: 'Fog',
    body: "Your brain is asking for something — water, food, light, sleep, you name it. ADHD brains run on cleaner fuel than most. The fog isn't you. It's chemistry.",
    action: 'Stand up. Water. Look out a window for 60 seconds.',
    color: '#9AB4C4',
  },
  stuck: {
    state: 'The freeze',
    body: "You see the task. You can't start it. This isn't laziness — it's executive function stalling between intent and action. Naming it helps loosen it.",
    action: 'Pick the smallest task. Five-minute timer. Start is everything.',
    color: '#A89880',
  },
  low: {
    state: 'Dopamine dip',
    body: "Your reward system is running below baseline today. ADHD brains feel this dip harder. It's a chemistry thing, not a character thing.",
    action: 'Step outside. Two minutes. Sunlight is the fastest free dopamine.',
    color: '#A88B95',
  },
  wired: {
    state: 'Too much input',
    body: 'Your nervous system is in overdrive. Could be caffeine, dopamine spikes, or anxiety wearing energy as a mask. Wired without focus is exhausting.',
    action: 'Slow exhale, twice as long as inhale. Three rounds. Try it now.',
    color: '#C9A06A',
  },
  anxious: {
    state: 'Threat mode',
    body: 'Your amygdala fired. Your brain registered something as danger — real or not — and is flooding you with cortisol. RSD often shows up like this.',
    action: 'Name one thing you see, hear, and touch. Pulls you back to your body.',
    color: '#D88878',
  },
  focused: {
    state: 'Flow',
    body: "You found the groove. This is rare for ADHD brains — protect it. Don't switch tasks. Don't check your phone. Just stay.",
    action: 'Ride it. Check back in when it fades.',
    color: '#D89878',
  },
  drained: {
    state: 'Empty tank',
    body: "Your executive function is running on fumes. Pushing through now costs you tomorrow. ADHD brains need recovery in ways people don't talk about enough.",
    action: 'Stop. One easy task or rest entirely. Both are valid.',
    color: '#7A8A95',
  },
  good: {
    state: 'Steady ground',
    body: "Notice this. Your systems are working — sleep, food, regulation. This is your brain handing you a baseline, which means it's possible.",
    action: 'One thing future-you will thank you for. Just one.',
    color: '#8FA378',
  },
};

// Map our store's uppercase Mood union ↔ lowercase ids used here.
const moodIdToStoreMood: Record<MoodId, Mood> = {
  foggy: 'Foggy',
  stuck: 'Stuck',
  low: 'Low',
  wired: 'Wired',
  anxious: 'Anxious',
  focused: 'Focused',
  drained: 'Drained',
  good: 'Good',
};

const timeWordFor = (hr: number) => {
  if (hr >= 21 || hr < 5) return 'night';
  if (hr >= 17) return 'evening';
  if (hr >= 12) return 'afternoon';
  return 'morning';
};

// ── Ornament ─────────────────────────────────────────────────────────
const Ornament = ({ color = colors.terra }: { color?: string }) => (
  <View style={ornStyles.wrap}>
    <View
      style={[
        ornStyles.line,
        { backgroundColor: hexAlpha(color, 0.2) },
      ]}
    />
    <View style={ornStyles.center}>
      <View style={[ornStyles.dot, { backgroundColor: hexAlpha(color, 0.4) }]} />
      <Text style={[ornStyles.spark, { color: hexAlpha(color, 0.55) }]}>
        ✦
      </Text>
      <View style={[ornStyles.dot, { backgroundColor: hexAlpha(color, 0.4) }]} />
    </View>
    <View
      style={[
        ornStyles.line,
        { backgroundColor: hexAlpha(color, 0.2) },
      ]}
    />
  </View>
);

const hexAlpha = (hex: string, a: number): string => {
  if (hex.startsWith('rgba')) return hex;
  const m = hex.match(/^#?([a-fA-F0-9]{6})$/);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// ── Mood Stamp ───────────────────────────────────────────────────────
const MoodStamp = ({
  mood,
  selected,
  onPress,
}: {
  mood: MoodData;
  selected: boolean;
  onPress: () => void;
}) => {
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(translateY, {
      toValue: selected ? -2 : 0,
      duration: 220,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [selected, translateY]);

  return (
    <Pressable onPress={onPress} style={{ width: '48%' }}>
      <Animated.View
        style={[
          stampStyles.card,
          {
            backgroundColor: selected ? hexAlpha(mood.color, 0.11) : colors.card,
            borderColor: selected ? mood.color : colors.border,
            transform: [{ translateY }],
            shadowColor: selected ? mood.color : 'transparent',
            shadowOpacity: selected ? 0.2 : 0,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 8 },
            elevation: selected ? 6 : 0,
          },
        ]}
      >
        <Text
          style={[
            stampStyles.glyph,
            { color: selected ? mood.color : colors.text3 },
          ]}
        >
          {mood.glyph}
        </Text>
        <Text
          style={[
            stampStyles.word,
            { color: selected ? colors.cream : colors.text2 },
          ]}
        >
          {mood.word}
        </Text>
        <Text
          style={[
            stampStyles.sub,
            { color: selected ? colors.text2 : colors.text3 },
          ]}
        >
          {mood.sub}
        </Text>
      </Animated.View>
    </Pressable>
  );
};

// ── Slide-up animated wrapper ───────────────────────────────────────
const SlideUp = ({
  delay = 0,
  children,
  style,
}: {
  delay?: number;
  children: React.ReactNode;
  style?: object;
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [delay, opacity, translateY]);
  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
};

// ── Main ────────────────────────────────────────────────────────────
export default function CheckinTab() {
  const router = useRouter();
  const [selected, setSelected] = useState<MoodId | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showXp, setShowXp] = useState(false);

  const streak = useUserStore((s) => s.streak);
  const addXp = useUserStore((s) => s.addXp);
  const registerActivity = useUserStore((s) => s.registerActivity);
  const add = useCheckinStore((s) => s.add);
  const allCheckins = useCheckinStore((s) => s.checkins);
  const weekMoods = useMemo(() => selectWeekMoods(allCheckins), [allCheckins]);
  const care = usePetStore((s) => s.care);

  const hr = new Date().getHours();
  const dayName = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
  });

  const submit = () => {
    if (!selected) return;
    Haptics.selectionAsync();
    setAnalyzing(true);
    setTimeout(() => {
      const r = RESPONSES[selected];
      add({
        mood: moodIdToStoreMood[selected],
        text: '',
        state: r.state,
        explanation: r.body,
        action: r.action,
      });
      addXp(XP.checkin);
      registerActivity();
      care('checkin');
      setAnalyzing(false);
      setSubmitted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setShowXp(true), 300);
    }, 900);
  };

  const reset = () => {
    Haptics.selectionAsync();
    setSelected(null);
    setSubmitted(false);
    setAnalyzing(false);
    setShowXp(false);
  };

  const response = selected ? RESPONSES[selected] : null;
  const moodObj = selected
    ? MOODS.find((m) => m.id === selected) ?? null
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Eyebrow */}
        <Text selectable={false} style={styles.eyebrow}>
          ✦  {dayName.toLowerCase()} {timeWordFor(hr)}  ✦
        </Text>

        {/* Headline */}
        <Text selectable={false} style={styles.h1}>
          how's the{'\n'}
          <Text style={{ color: colors.terra }}>weather</Text> in there?
        </Text>

        <Ornament />

        {!submitted ? (
          <>
            <Text style={styles.subprompt}>
              pick whatever feels closest.{'\n'}
              <Text style={{ color: colors.text4 }}>no right answer here.</Text>
            </Text>

            <View style={styles.grid}>
              {MOODS.map((m) => (
                <MoodStamp
                  key={m.id}
                  mood={m}
                  selected={selected === m.id}
                  onPress={() => {
                    if (analyzing) return;
                    Haptics.selectionAsync();
                    setSelected(m.id);
                  }}
                />
              ))}
            </View>

            <Pressable
              onPress={submit}
              disabled={!selected || analyzing}
              style={[
                styles.cta,
                selected && !analyzing
                  ? styles.ctaActive
                  : styles.ctaIdle,
              ]}
            >
              <Text
                style={[
                  styles.ctaText,
                  selected && !analyzing && { color: '#fff' },
                ]}
              >
                {analyzing
                  ? 'reading you…'
                  : selected
                    ? 'tell me more →'
                    : 'pick something first'}
              </Text>
            </Pressable>

            <Ornament color={colors.honey} />

            {/* This week */}
            <View style={{ marginBottom: 18 }}>
              <Text style={styles.sectionLabel}>— this week —</Text>
              <View style={styles.chart}>
                {weekMoods.map((d, i) => {
                  const tone = barTone(d.score);
                  const h = barHeight(d.score);
                  const day = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][
                    new Date(d.date + 'T00:00:00').getDay()
                  ];
                  return (
                    <View key={d.date + i} style={styles.chartCol}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: h,
                            backgroundColor: hexAlpha(tone, 0.16),
                            borderColor: hexAlpha(tone, 0.33),
                          },
                        ]}
                      />
                      <Text style={styles.chartDay}>{day}</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.weekInsight}>
                middle of the week, you find your ground.{'\n'}
                <Text style={{ color: colors.text3, fontSize: 11 }}>
                  weekends tend to drift
                </Text>
              </Text>
            </View>

            {/* Streak */}
            <View style={styles.streakCard}>
              <Text style={styles.streakNum}>{streak || 0}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.streakTitle}>days in a row</Text>
                <Text style={styles.streakSub}>
                  showing up is the whole thing
                </Text>
              </View>
              <Text style={styles.streakXp}>+30 ✦</Text>
            </View>
          </>
        ) : (
          <>
            {/* Mood echo */}
            <SlideUp>
              {moodObj && (
                <View
                  style={[
                    styles.echoCard,
                    {
                      backgroundColor: hexAlpha(moodObj.color, 0.06),
                      borderColor: hexAlpha(moodObj.color, 0.2),
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.echoToday,
                      { color: moodObj.color },
                    ]}
                  >
                    today
                  </Text>
                  <Text
                    style={[styles.echoGlyph, { color: moodObj.color }]}
                  >
                    {moodObj.glyph}
                  </Text>
                  <Text style={styles.echoWord}>{moodObj.word}</Text>
                  <Text style={styles.echoSub}>{moodObj.sub}</Text>
                  <Pressable onPress={reset} style={styles.echoChange}>
                    <Text style={styles.echoChangeText}>change →</Text>
                  </Pressable>
                </View>
              )}
            </SlideUp>

            {/* Response card */}
            {response && (
              <SlideUp delay={100}>
                <LinearGradient
                  colors={[colors.cardHi, colors.surface]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.responseCard}
                >
                  {/* shimmer */}
                  <LinearGradient
                    colors={[
                      'transparent',
                      hexAlpha(response.color, 0.5),
                      'transparent',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.responseShimmer}
                  />
                  <Text
                    style={[styles.aNote, { color: response.color }]}
                  >
                    ✦ a note
                  </Text>
                  <Text style={styles.whatThis}>what this is —</Text>
                  <Text
                    style={[
                      styles.responseState,
                      { color: response.color },
                    ]}
                  >
                    {response.state}.
                  </Text>
                  <Text style={styles.responseBody}>{response.body}</Text>

                  <View style={styles.tryThisRow}>
                    <View
                      style={[
                        styles.tryThisLine,
                        { backgroundColor: hexAlpha(response.color, 0.2) },
                      ]}
                    />
                    <Text
                      style={[
                        styles.tryThisLabel,
                        { color: response.color },
                      ]}
                    >
                      TRY THIS
                    </Text>
                    <View
                      style={[
                        styles.tryThisLine,
                        { backgroundColor: hexAlpha(response.color, 0.2) },
                      ]}
                    />
                  </View>

                  <Text style={styles.actionQuote}>"{response.action}"</Text>
                </LinearGradient>
              </SlideUp>
            )}

            {/* XP card */}
            {showXp && (
              <SlideUp>
                <View style={styles.xpCard}>
                  <Text style={styles.xpAmount}>+30</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.xpDay}>day {(streak || 0) + 1}</Text>
                    <Text style={styles.xpSub}>
                      you showed up. that's the whole thing.
                    </Text>
                  </View>
                </View>
              </SlideUp>
            )}

            {/* Where next */}
            <Text style={styles.sectionLabel}>— where next —</Text>
            <View style={styles.pillRow}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push('/(tabs)');
                }}
                style={styles.pill}
              >
                <Text style={styles.pillText}>back to home</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push('/(tabs)/time');
                }}
                style={styles.pill}
              >
                <Text style={styles.pillText}>plan my day</Text>
              </Pressable>
              {(selected === 'anxious' ||
                selected === 'stuck' ||
                selected === 'low') && (
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    router.push('/(tabs)/sos');
                  }}
                  style={[styles.pill, styles.pillSupport]}
                >
                  <Text style={[styles.pillText, { color: colors.rose }]}>
                    need support →
                  </Text>
                </Pressable>
              )}
            </View>

            <Pressable onPress={reset} style={styles.doneBtn}>
              <Text style={styles.doneText}>done — save this</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
const barHeight = (score: number) => {
  if (score === 0) return 12;
  return 14 + score * 8;
};
const barTone = (score: number) => {
  if (score >= 4) return colors.sage;
  if (score >= 3) return colors.honey;
  return colors.terra;
};

// ── Styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 120,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },

  eyebrow: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 4,
    color: colors.terra,
    opacity: 0.55,
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  h1: {
    fontFamily: fonts.serifItalic,
    fontSize: 28,
    color: colors.cream,
    lineHeight: 36,
    textAlign: 'center',
  },

  subprompt: {
    fontFamily: fonts.sansItalic,
    fontSize: 12,
    color: colors.text3,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    rowGap: 10,
    marginBottom: 26,
  },

  cta: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 28,
  },
  ctaActive: {
    backgroundColor: '#B0664A',
  },
  ctaIdle: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    opacity: 0.7,
  },
  ctaText: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    color: colors.text3,
    letterSpacing: 0.3,
  },

  sectionLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.text3,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 14,
  },

  chart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 4,
    height: 50,
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  bar: {
    width: '100%',
    borderRadius: 4,
    borderWidth: 1,
  },
  chartDay: {
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    color: colors.text3,
    letterSpacing: 0.5,
  },
  weekInsight: {
    fontFamily: fonts.sansItalic,
    fontSize: 12,
    color: colors.text2,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 12,
  },

  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.honeyBg,
    borderWidth: 1,
    borderColor: 'rgba(201,160,106,0.18)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  streakNum: {
    fontFamily: fonts.serifItalic,
    fontSize: 26,
    color: colors.honey,
    lineHeight: 28,
  },
  streakTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.cream,
    marginBottom: 2,
  },
  streakSub: {
    fontFamily: fonts.sansItalic,
    fontSize: 11,
    color: colors.text3,
  },
  streakXp: {
    fontFamily: fonts.serifItalic,
    fontSize: 11,
    color: colors.honey,
    letterSpacing: 0.3,
  },

  // Post-submit
  echoCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    paddingTop: 18,
    paddingBottom: 18,
    marginBottom: 18,
    position: 'relative',
  },
  echoToday: {
    position: 'absolute',
    top: 12,
    right: 14,
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  echoGlyph: {
    fontFamily: fonts.serif,
    fontSize: 32,
    lineHeight: 34,
    marginBottom: 10,
  },
  echoWord: {
    fontFamily: fonts.serifItalic,
    fontSize: 24,
    color: colors.cream,
    marginBottom: 3,
    letterSpacing: 0.2,
  },
  echoSub: {
    fontFamily: fonts.sansItalic,
    fontSize: 12,
    color: colors.text2,
  },
  echoChange: {
    position: 'absolute',
    bottom: 12,
    right: 16,
  },
  echoChangeText: {
    fontFamily: fonts.serifItalic,
    fontSize: 11,
    color: colors.text3,
  },

  responseCard: {
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 22,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderHi,
    position: 'relative',
  },
  responseShimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  aNote: {
    position: 'absolute',
    top: 14,
    right: 18,
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  whatThis: {
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    color: colors.text3,
    marginTop: 18,
    marginBottom: 10,
  },
  responseState: {
    fontFamily: fonts.serifItalic,
    fontSize: 26,
    lineHeight: 28,
    marginBottom: 16,
  },
  responseBody: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.text2,
    lineHeight: 24,
    marginBottom: 20,
  },
  tryThisRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  tryThisLine: { flex: 1, height: 1 },
  tryThisLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    letterSpacing: 2.5,
    opacity: 0.75,
  },
  actionQuote: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    color: colors.cream,
    lineHeight: 26,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  xpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.terraBg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(216,152,120,0.4)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  xpAmount: {
    fontFamily: fonts.serifItalic,
    fontSize: 28,
    color: colors.terra,
    lineHeight: 30,
  },
  xpDay: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.cream,
    marginBottom: 2,
  },
  xpSub: {
    fontFamily: fonts.sansItalic,
    fontSize: 11,
    color: colors.text3,
    lineHeight: 16,
  },

  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  pillSupport: {
    backgroundColor: colors.roseBg,
    borderColor: 'rgba(216,136,120,0.35)',
  },
  pillText: {
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    color: colors.text2,
  },
  doneBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  doneText: {
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    color: colors.text3,
    letterSpacing: 0.3,
  },
});

const ornStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 20,
  },
  line: { flex: 1, height: 1 },
  center: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: { width: 3, height: 3, borderRadius: 2 },
  spark: {
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    letterSpacing: 2,
  },
});

const stampStyles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingTop: 16,
    paddingHorizontal: 14,
    paddingBottom: 14,
    overflow: 'hidden',
  },
  glyph: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 28,
    marginBottom: 8,
  },
  word: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 18,
    marginBottom: 5,
    letterSpacing: 0.2,
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    lineHeight: 15,
    letterSpacing: 0.1,
  },
});
