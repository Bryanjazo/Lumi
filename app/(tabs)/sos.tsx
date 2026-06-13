import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { SOSTimer } from '../../components/SOSTimer';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';
import { usePetStore } from '../../store/petStore';
import { XP } from '../../lib/gamification';

type Mode = 'rsd' | 'depersonalization';

const RSD_STEPS = [
  'Notice five physical things you can feel.',
  'Slow your exhale. Out longer than in.',
  'Name what someone said — not what your brain heard.',
  'It will fade. The chemistry is real, the verdict is not.',
];

const DP_STEPS = [
  '5 things you can see',
  '4 things you can touch',
  '3 things you can hear',
  '2 things you can smell',
  '1 thing you can taste',
];

export default function SosTab() {
  const [mode, setMode] = useState<Mode>('rsd');
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const addXp = useUserStore((s) => s.addXp);
  const logSos = usePetStore((s) => s.logSos);

  const total = mode === 'rsd' ? 20 * 60 : 5 * 60;
  const steps = mode === 'rsd' ? RSD_STEPS : DP_STEPS;

  const start = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setStartedAt(Date.now());
    setRunning(true);
  };

  const finish = (succeeded: boolean) => {
    setRunning(false);
    const dur = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    logSos({ type: mode, durationSeconds: dur });
    if (succeeded) addXp(XP.sos);
    setStartedAt(null);
  };

  return (
    <Screen>
      <Text style={styles.h1}>You're safe here.</Text>
      <Text style={styles.sub}>
        Pick what's loudest. Lumi will hold the timer.
      </Text>

      <View style={styles.toggle}>
        <Pressable
          onPress={() => !running && setMode('rsd')}
          style={[styles.tBtn, mode === 'rsd' && styles.tBtnSelRose]}
        >
          <Text style={[styles.tText, mode === 'rsd' && { color: colors.rose }]}>
            Emotional spiral
          </Text>
          <Text style={styles.tSub}>RSD</Text>
        </Pressable>
        <Pressable
          onPress={() => !running && setMode('depersonalization')}
          style={[
            styles.tBtn,
            mode === 'depersonalization' && styles.tBtnSelFog,
          ]}
        >
          <Text
            style={[
              styles.tText,
              mode === 'depersonalization' && { color: colors.fog },
            ]}
          >
            Disconnected
          </Text>
          <Text style={styles.tSub}>Depersonalization</Text>
        </Pressable>
      </View>

      {!running ? (
        <Pressable
          onPress={start}
          style={[
            styles.bigBtn,
            mode === 'rsd' ? styles.bigRose : styles.bigFog,
          ]}
        >
          <Text style={styles.bigText}>
            {mode === 'rsd' ? 'Start holding' : 'Ground me'}
          </Text>
          <Text style={styles.bigSub}>
            {mode === 'rsd' ? '20 minutes' : '5 minutes'}
          </Text>
        </Pressable>
      ) : (
        <SOSTimer
          totalSeconds={total}
          running={running}
          tone={mode === 'rsd' ? 'rose' : 'fog'}
          onComplete={() => finish(true)}
          onCancel={() => finish(true)}
        />
      )}

      <View style={styles.expl}>
        <Text style={styles.explTag}>WHAT'S HAPPENING</Text>
        <Text style={styles.explText}>
          {mode === 'rsd'
            ? "RSD makes a small social signal feel like rejection. The brain treats it like physical danger. It fades — usually within 20 minutes — when you slow input."
            : "Depersonalization is the brain dimming sensory bandwidth to protect you. You're still here. It passes within minutes when you re-anchor to the senses."}
        </Text>
      </View>

      <Text style={styles.stepsLabel}>Try this, in order</Text>
      <View style={{ gap: 9 }}>
        {steps.map((s, i) => (
          <View key={i} style={styles.step}>
            <Text style={styles.stepNum}>{i + 1}</Text>
            <Text style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 28,
    marginBottom: 6,
  },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    marginBottom: 18,
  },
  toggle: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: 13,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  tBtnSelRose: {
    borderColor: colors.roseBorder,
    backgroundColor: colors.roseBg,
  },
  tBtnSelFog: { borderColor: colors.fogBorder, backgroundColor: colors.fogBg },
  tText: { fontFamily: fonts.sansSemi, color: colors.text, fontSize: 13 },
  tSub: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    marginTop: 2,
  },
  bigBtn: {
    borderRadius: 18,
    paddingVertical: 36,
    alignItems: 'center',
    marginVertical: 14,
    borderWidth: 1.5,
  },
  bigRose: {
    backgroundColor: colors.roseBg,
    borderColor: colors.roseBorder,
  },
  bigFog: { backgroundColor: colors.fogBg, borderColor: colors.fogBorder },
  bigText: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 26,
  },
  bigSub: {
    fontFamily: fonts.sansItalic,
    color: colors.text2,
    fontSize: 12,
    marginTop: 4,
  },
  expl: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    marginTop: 18,
    marginBottom: 22,
  },
  explTag: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  explText: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
  },
  stepsLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 13,
  },
  stepNum: {
    fontFamily: fonts.serif,
    color: colors.plum,
    fontSize: 17,
    width: 22,
  },
  stepText: {
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 13,
    flex: 1,
    lineHeight: 19,
  },
});
