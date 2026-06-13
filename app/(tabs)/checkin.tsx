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
import {
  checkinResponse,
  checkinFollowUp,
  CheckinResponse,
} from '../../lib/anthropic';
import { TextInput, ActivityIndicator } from 'react-native';

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
  | 'good'
  | 'other';

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

// "Other" lives separately — it's the escape hatch for "none of these
// fit," and it triggers the freeform AI path instead of a preset response.
const OTHER_MOOD: MoodData = {
  id: 'other',
  word: 'other',
  sub: 'describe it in your own words',
  color: colors.terra,
  glyph: '✎',
};

interface ResponseData {
  state: string;
  body: string;
  action: string;
  color: string;
}

// Standard mood responses — "other" is handled by the AI path,
// so we exclude it from this preset map.
const RESPONSES: Record<Exclude<MoodId, 'other'>, ResponseData> = {
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
// "Other" gets stored as Foggy as a fallback (closest neutral option)
// since the Mood store union doesn't include it.
const moodIdToStoreMood: Record<MoodId, Mood> = {
  foggy: 'Foggy',
  stuck: 'Stuck',
  low: 'Low',
  wired: 'Wired',
  anxious: 'Anxious',
  focused: 'Focused',
  drained: 'Drained',
  good: 'Good',
  other: 'Foggy',
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

  // "Other" path
  const [otherText, setOtherText] = useState('');

  // The actual response shown to the user. For standard moods it's a
  // RESPONSES lookup; for "other" it's the AI's structured answer.
  const [aiResponse, setAiResponse] = useState<{
    state: string;
    body: string;
    action: string;
    color: string;
  } | null>(null);

  // Follow-up "talk to lumi" thread
  const [followUp, setFollowUp] = useState('');
  const [followingUp, setFollowingUp] = useState(false);
  const [followUpTip, setFollowUpTip] = useState<string | null>(null);

  const streak = useUserStore((s) => s.streak);
  const petName = useUserStore((s) => s.petName);
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

  // For the "other" path we need the user to type something before they
  // can submit. The CTA disables until they do.
  const canSubmit = selected && (selected !== 'other' || otherText.trim().length > 2);

  const submit = async () => {
    if (!selected || !canSubmit) return;
    Haptics.selectionAsync();
    setAnalyzing(true);
    try {
      let r: { state: string; body: string; action: string; color: string };
      if (selected === 'other') {
        const ai = await checkinResponse({
          mood: 'Other',
          text: otherText,
          petName,
        });
        r = {
          state: ai.state,
          body: ai.explanation,
          action: ai.action,
          color: colors.terra,
        };
      } else {
        // small artificial delay so it doesn't feel instant on standard moods
        await new Promise((res) => setTimeout(res, 700));
        r = RESPONSES[selected as Exclude<MoodId, 'other'>];
      }
      setAiResponse(r);
      add({
        mood: moodIdToStoreMood[selected],
        text: selected === 'other' ? otherText : '',
        state: r.state,
        explanation: r.body,
        action: r.action,
      });
      addXp(XP.checkin);
      registerActivity();
      care('checkin');
      setSubmitted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setShowXp(true), 300);
    } catch (err) {
      // Fall back to a generic "other" response if AI fails
      setAiResponse({
        state: 'Something in between',
        body: "I couldn't reach the model just now, but whatever you're feeling is real. Naming it is already the first move.",
        action: 'Pick the smallest possible next thing.',
        color: colors.terra,
      });
      setSubmitted(true);
      setTimeout(() => setShowXp(true), 300);
    } finally {
      setAnalyzing(false);
    }
  };

  const askFollowUp = async () => {
    if (!followUp.trim() || !aiResponse || !selected) return;
    Haptics.selectionAsync();
    setFollowingUp(true);
    try {
      const res = await checkinFollowUp({
        mood:
          selected === 'other'
            ? otherText
            : MOODS.find((m) => m.id === selected)?.word ?? selected,
        initialState: aiResponse.state,
        initialAction: aiResponse.action,
        followUp,
      });
      setFollowUpTip(res.tip);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setFollowUpTip(
        "Couldn't reach Lumi just now. Whatever's coming up is still worth writing down.",
      );
    } finally {
      setFollowingUp(false);
    }
  };

  const reset = () => {
    Haptics.selectionAsync();
    setSelected(null);
    setSubmitted(false);
    setAnalyzing(false);
    setShowXp(false);
    setOtherText('');
    setAiResponse(null);
    setFollowUp('');
    setFollowingUp(false);
    setFollowUpTip(null);
  };

  const moodObj = selected
    ? selected === 'other'
      ? OTHER_MOOD
      : MOODS.find((m) => m.id === selected) ?? null
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

            {/* "Other" escape hatch — full-width pill */}
            <Pressable
              onPress={() => {
                if (analyzing) return;
                Haptics.selectionAsync();
                setSelected('other');
              }}
              style={[
                styles.otherPill,
                selected === 'other' && {
                  borderColor: OTHER_MOOD.color,
                  backgroundColor: hexAlpha(OTHER_MOOD.color, 0.08),
                },
              ]}
            >
              <Text
                style={[
                  styles.otherGlyph,
                  selected === 'other' && { color: OTHER_MOOD.color },
                ]}
              >
                ✎
              </Text>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.otherWord,
                    selected === 'other' && { color: colors.cream },
                  ]}
                >
                  other
                </Text>
                <Text style={styles.otherSub}>
                  describe in your own words
                </Text>
              </View>
            </Pressable>

            {/* Text input appears when "other" is the active mood */}
            {selected === 'other' && (
              <View style={styles.otherInputCard}>
                <Text style={styles.otherInputLabel}>tell lumi what's up</Text>
                <TextInput
                  placeholder="i feel something but i don't know what to call it…"
                  placeholderTextColor={colors.text3}
                  value={otherText}
                  onChangeText={setOtherText}
                  multiline
                  numberOfLines={3}
                  style={styles.otherInput}
                  editable={!analyzing}
                />
              </View>
            )}

            <Pressable
              onPress={submit}
              disabled={!canSubmit || analyzing}
              style={[
                styles.cta,
                canSubmit && !analyzing ? styles.ctaActive : styles.ctaIdle,
              ]}
            >
              {analyzing ? (
                <View style={styles.ctaRow}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={[styles.ctaText, { color: '#fff' }]}>
                    reading you…
                  </Text>
                </View>
              ) : (
                <Text
                  style={[
                    styles.ctaText,
                    canSubmit && { color: '#fff' },
                  ]}
                >
                  {selected === 'other'
                    ? otherText.trim()
                      ? 'ask lumi →'
                      : 'write a few words first'
                    : selected
                      ? 'tell me more →'
                      : 'pick something first'}
                </Text>
              )}
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
            {aiResponse && (
              <SlideUp delay={100}>
                <LinearGradient
                  colors={[colors.cardHi, colors.surface]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.responseCard}
                >
                  <LinearGradient
                    colors={[
                      'transparent',
                      hexAlpha(aiResponse.color, 0.5),
                      'transparent',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.responseShimmer}
                  />
                  <Text style={[styles.aNote, { color: aiResponse.color }]}>
                    ✦ a note
                  </Text>
                  <Text style={styles.whatThis}>what this is —</Text>
                  <Text
                    style={[styles.responseState, { color: aiResponse.color }]}
                  >
                    {aiResponse.state}.
                  </Text>
                  <Text style={styles.responseBody}>{aiResponse.body}</Text>

                  <View style={styles.tryThisRow}>
                    <View
                      style={[
                        styles.tryThisLine,
                        { backgroundColor: hexAlpha(aiResponse.color, 0.2) },
                      ]}
                    />
                    <Text
                      style={[
                        styles.tryThisLabel,
                        { color: aiResponse.color },
                      ]}
                    >
                      TRY THIS
                    </Text>
                    <View
                      style={[
                        styles.tryThisLine,
                        { backgroundColor: hexAlpha(aiResponse.color, 0.2) },
                      ]}
                    />
                  </View>

                  <Text style={styles.actionQuote}>
                    "{aiResponse.action}"
                  </Text>
                </LinearGradient>
              </SlideUp>
            )}

            {/* AI follow-up section */}
            {aiResponse && (
              <SlideUp delay={150}>
                <View style={styles.followCard}>
                  <Text style={styles.followLabel}>
                    talk to lumi about it
                  </Text>
                  <Text style={styles.followPrompt}>
                    say more or ask a different angle. lumi will respond
                    with one focused tip.
                  </Text>
                  <TextInput
                    placeholder="what else is going on? ask anything…"
                    placeholderTextColor={colors.text3}
                    value={followUp}
                    onChangeText={setFollowUp}
                    multiline
                    style={styles.followInput}
                    editable={!followingUp}
                  />
                  <Pressable
                    onPress={askFollowUp}
                    disabled={!followUp.trim() || followingUp}
                    style={[
                      styles.followBtn,
                      followUp.trim() && !followingUp
                        ? styles.followBtnActive
                        : styles.followBtnIdle,
                    ]}
                  >
                    {followingUp ? (
                      <View style={styles.ctaRow}>
                        <ActivityIndicator
                          size="small"
                          color={colors.terra}
                        />
                        <Text
                          style={[
                            styles.followBtnText,
                            { color: colors.terra },
                          ]}
                        >
                          listening…
                        </Text>
                      </View>
                    ) : (
                      <Text
                        style={[
                          styles.followBtnText,
                          followUp.trim() && {
                            color: colors.terra,
                          },
                        ]}
                      >
                        ask lumi ✦
                      </Text>
                    )}
                  </Pressable>

                  {followUpTip && (
                    <SlideUp>
                      <View style={styles.tipCard}>
                        <Text style={styles.tipEyebrow}>lumi says —</Text>
                        <Text style={styles.tipText}>{followUpTip}</Text>
                      </View>
                    </SlideUp>
                  )}
                </View>
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

  // "Other" pill
  otherPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  otherGlyph: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.text3,
  },
  otherWord: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    color: colors.text2,
    marginBottom: 2,
  },
  otherSub: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
  },
  // "Other" text input
  otherInputCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderHi,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  otherInputLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  otherInput: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.text,
    minHeight: 64,
    textAlignVertical: 'top',
    lineHeight: 22,
  },

  cta: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 28,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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

  // Follow-up "talk to lumi" section
  followCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  followLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.terra,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  followPrompt: {
    fontFamily: fonts.sansItalic,
    fontSize: 12,
    color: colors.text3,
    lineHeight: 17,
    marginBottom: 12,
  },
  followInput: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text,
    minHeight: 58,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    textAlignVertical: 'top',
    marginBottom: 10,
    lineHeight: 19,
  },
  followBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
  },
  followBtnActive: {
    backgroundColor: colors.terraBg,
    borderColor: 'rgba(216,152,120,0.5)',
  },
  followBtnIdle: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    opacity: 0.6,
  },
  followBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.text3,
    letterSpacing: 0.4,
  },
  // Tip card (Lumi's response to the follow-up)
  tipCard: {
    backgroundColor: colors.terraBg,
    borderLeftWidth: 2,
    borderLeftColor: colors.terra,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  tipEyebrow: {
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.terra,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  tipText: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    color: colors.cream,
    lineHeight: 22,
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
