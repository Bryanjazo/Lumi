import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';

type Trait = 'I' | 'H';

const QUESTIONS: { q: string; a: { label: string; trait: Trait }[] }[] = [
  {
    q: 'What does a stuck moment usually feel like?',
    a: [
      { label: 'I drift away from the thing', trait: 'I' },
      { label: 'I bounce between tabs', trait: 'H' },
    ],
  },
  {
    q: 'When you finally start a task,',
    a: [
      { label: 'it took 4 hours to begin', trait: 'I' },
      { label: 'I started 12 of them at once', trait: 'H' },
    ],
  },
  {
    q: 'In a long meeting,',
    a: [
      { label: 'I go quiet and lose the thread', trait: 'I' },
      { label: 'I interrupt or fidget hard', trait: 'H' },
    ],
  },
  {
    q: 'When something is boring,',
    a: [
      { label: 'I forget I was doing it', trait: 'I' },
      { label: 'My body needs to move now', trait: 'H' },
    ],
  },
  {
    q: 'Late at night your brain is',
    a: [
      { label: 'foggy, slow, half-here', trait: 'I' },
      { label: 'spinning, ideas everywhere', trait: 'H' },
    ],
  },
];

export default function Quiz() {
  const router = useRouter();
  const setType = useUserStore((s) => s.setAdhdType);
  const [i, setI] = useState(0);
  const [tally, setTally] = useState<{ I: number; H: number }>({ I: 0, H: 0 });

  const answer = (t: Trait) => {
    Haptics.selectionAsync();
    const next = { ...tally, [t]: tally[t] + 1 };
    setTally(next);
    if (i + 1 < QUESTIONS.length) {
      setI(i + 1);
      return;
    }
    const diff = Math.abs(next.I - next.H);
    if (diff <= 1) setType('combined');
    else if (next.I > next.H) setType('inattentive');
    else setType('hyperactive');
    router.push('/onboarding/pet-name');
  };

  const cur = QUESTIONS[i];

  return (
    <Screen scroll={false}>
      <Text style={styles.tag}>
        Question {i + 1} of {QUESTIONS.length}
      </Text>
      <Text style={styles.q}>{cur.q}</Text>
      <View style={{ gap: 10, marginTop: 18 }}>
        {cur.a.map((opt) => (
          <Pressable
            key={opt.label}
            onPress={() => answer(opt.trait)}
            style={styles.opt}
          >
            <Text style={styles.optText}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.foot}>
        No wrong answer. We're just tuning Lumi to you.
      </Text>
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
    marginTop: 30,
    marginBottom: 12,
  },
  q: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
  },
  opt: {
    backgroundColor: colors.surface,
    borderColor: colors.border2,
    borderWidth: 1.5,
    borderRadius: 13,
    padding: 18,
  },
  optText: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  foot: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 28,
  },
});
