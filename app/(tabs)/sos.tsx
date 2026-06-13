import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';
import { usePetStore } from '../../store/petStore';
import { XP } from '../../lib/gamification';

type Mode = 'rsd' | 'fog';

const RSD_DUR = 20 * 60;
const FOG_DUR = 5 * 60;

const RSD_STEPS = [
  {
    title: 'Name it out loud.',
    body: 'Say "this is RSD, not reality." Your brain calms faster when it has a label.',
  },
  {
    title: 'Breathe 4–7–8.',
    body: 'Inhale 4 counts, hold 7, exhale 8. Repeat twice. It physically slows your nervous system.',
  },
  {
    title: 'Find one true thing.',
    body: 'Name something factual that is okay right now — not great, just okay. The floor. A cup of water.',
  },
  {
    title: 'Wait 20 minutes',
    body: 'before responding to whatever triggered this. Any message, any decision — it can wait.',
  },
];

const FOG_STEPS = [
  {
    title: 'Name 5 things you can see.',
    body: 'Say them out loud. A wall, your hands, a light — anything visible.',
  },
  {
    title: 'Touch 4 things.',
    body: 'Feel their texture. Rough, smooth, warm, cold. Stay with each one for a second.',
  },
  {
    title: "Listen for 3 sounds.",
    body: "Don't judge them — traffic, your breath, a hum. Just notice.",
  },
  {
    title: 'Find 2 smells.',
    body: 'Your skin, the air, something nearby. This is one of the fastest ways back to your body.',
  },
  {
    title: 'Taste 1 thing.',
    body: 'Water, gum, anything. The taste sensation is a strong anchor to the present moment.',
  },
];

export default function SosTab() {
  const [mode, setMode] = useState<Mode>('rsd');
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(RSD_DUR);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const addXp = useUserStore((s) => s.addXp);
  const logSos = usePetStore((s) => s.logSos);

  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Pulse the ring forever.
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 1250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulse]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          finish(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const start = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setStartedAt(Date.now());
    setRemaining(mode === 'rsd' ? RSD_DUR : FOG_DUR);
    setRunning(true);
  };

  const finish = (success: boolean) => {
    if (!running && !startedAt) return;
    setRunning(false);
    const dur = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    logSos({
      type: mode === 'rsd' ? 'rsd' : 'depersonalization',
      durationSeconds: dur,
    });
    if (success) addXp(XP.sos);
    setStartedAt(null);
  };

  const stopEarly = () => {
    Haptics.selectionAsync();
    finish(true);
  };

  const switchMode = (m: Mode) => {
    if (running) return;
    Haptics.selectionAsync();
    setMode(m);
    setRemaining(m === 'rsd' ? RSD_DUR : FOG_DUR);
  };

  const isRSD = mode === 'rsd';
  const accentColor = isRSD ? colors.rose : colors.fog;
  const accentBg = isRSD ? colors.roseBg : colors.fogBg;
  const accentBorder = isRSD ? colors.roseBorder : colors.fogBorder;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  const steps = isRSD ? RSD_STEPS : FOG_STEPS;
  const stepsTitle = isRSD ? '60-second reset' : '5-4-3-2-1 grounding';

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.heroNote}>
          Something just hit you hard.{'\n'}
          You're not overreacting. This is real.
        </Text>
        <Text style={styles.heroH2}>
          What are you{'\n'}
          <Text style={[styles.italic, { color: accentColor }]}>
            feeling right now?
          </Text>
        </Text>
      </View>

      <View style={styles.modeRow}>
        <Pressable
          onPress={() => switchMode('rsd')}
          style={[
            styles.modeBtn,
            isRSD && {
              borderColor: 'rgba(224,122,138,0.4)',
              backgroundColor: colors.roseBg,
            },
          ]}
        >
          <Text style={styles.modeEmoji}>🌊</Text>
          <Text style={[styles.modeLabel, isRSD && { color: colors.rose }]}>
            Emotional spiral
          </Text>
        </Pressable>
        <Pressable
          onPress={() => switchMode('fog')}
          style={[
            styles.modeBtn,
            !isRSD && {
              borderColor: 'rgba(155,170,184,0.4)',
              backgroundColor: colors.fogBg,
            },
          ]}
        >
          <Text style={styles.modeEmoji}>🌫️</Text>
          <Text style={[styles.modeLabel, !isRSD && { color: colors.fog }]}>
            Disconnected / foggy
          </Text>
        </Pressable>
      </View>

      <View style={styles.btnWrap}>
        <Animated.View
          style={[
            styles.btnRing,
            {
              borderColor: isRSD
                ? 'rgba(224,122,138,0.1)'
                : 'rgba(155,170,184,0.08)',
              transform: [{ scale: pulse }],
            },
          ]}
        />
        <Pressable
          onPress={running ? stopEarly : start}
          style={[
            styles.bigBtn,
            { borderColor: isRSD ? 'rgba(224,122,138,0.3)' : 'rgba(155,170,184,0.25)' },
          ]}
        >
          <LinearGradient
            colors={
              isRSD ? ['#3A1A20', '#1E0D12'] : ['#141820', '#0D1018']
            }
            start={{ x: 0.35, y: 0.35 }}
            end={{ x: 1, y: 1 }}
            style={styles.bigBtnGradient}
          >
            <Text style={styles.bigEmoji}>{isRSD ? '🫁' : '🌫️'}</Text>
            <Text style={[styles.bigLabel, { color: accentColor }]}>
              {running ? "I'M FEELING STEADIER" : isRSD ? 'I NEED HELP' : 'I FEEL UNREAL'}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>

      {running && (
        <LinearGradient
          colors={isRSD ? ['#1E1018', colors.surface] : ['#141820', colors.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.timerCard, { borderColor: accentBorder }]}
        >
          <Text style={[styles.timerLabel, { color: accentColor }]}>
            {isRSD ? 'This feeling peaks and passes' : 'You are here. You are real.'}
          </Text>
          <Text style={styles.timerNum}>
            {mins}:{secs.toString().padStart(2, '0')}
          </Text>
          <Text style={styles.timerSub}>
            {isRSD
              ? 'RSD episodes typically peak within 20 minutes.\nYou don’t have to do anything. Just breathe.'
              : 'A grounding exercise is running.\nStay with the steps below until the timer ends.'}
          </Text>
          <Pressable
            onPress={stopEarly}
            style={[styles.timerBtn, { backgroundColor: accentColor }]}
          >
            <Text style={styles.timerBtnText}>
              {isRSD ? "I'm feeling steadier" : 'I feel more present'}
            </Text>
          </Pressable>
        </LinearGradient>
      )}

      <View style={styles.explainerCard}>
        <Text style={styles.explainerTitle}>
          {isRSD
            ? "What's happening right now"
            : 'What depersonalization feels like'}
        </Text>
        <Text style={styles.explainerBody}>
          {isRSD ? (
            <>
              <Text style={styles.bold}>
                Rejection Sensitive Dysphoria (RSD)
              </Text>{' '}
              is an intense emotional response triggered by real or perceived
              rejection, criticism, or failure. It's not weakness — it's a
              neurological feature of ADHD.
              {'\n\n'}The pain feels permanent. It isn't. Your brain's threat
              detection fired at full intensity for something that doesn't match
              the actual danger level. That mismatch is the disorder talking,
              not reality.
            </>
          ) : (
            <>
              <Text style={styles.bold}>Depersonalization</Text> is a
              dissociative experience where you feel detached from your own
              thoughts, body, or surroundings — like you're watching yourself
              from outside, or the world looks flat and unreal.
              {'\n\n'}It's more common with ADHD than most people know,
              especially when stress, sleep deprivation, or emotional overload
              is high. It is <Text style={styles.bold}>not dangerous</Text>, and
              it will pass. You're still here.
            </>
          )}
        </Text>
      </View>

      <View style={styles.groundCard}>
        <Text style={styles.groundTitle}>{stepsTitle}</Text>
        <View style={{ gap: 9 }}>
          {steps.map((s, i) => {
            const active = i === 0;
            return (
              <View
                key={s.title}
                style={[
                  styles.step,
                  active && {
                    backgroundColor: accentBg,
                    borderColor: accentBorder,
                  },
                ]}
              >
                <View
                  style={[
                    styles.stepNum,
                    active && { backgroundColor: accentColor },
                  ]}
                >
                  <Text
                    style={[
                      styles.stepNumText,
                      active && { color: colors.bg },
                    ]}
                  >
                    {isRSD ? i + 1 : 5 - i}
                  </Text>
                </View>
                <Text style={styles.stepText}>
                  <Text style={styles.stepStrong}>{s.title}</Text> {s.body}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: 4, marginBottom: 22 },
  heroNote: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 9,
  },
  heroH2: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 26,
    lineHeight: 34,
    textAlign: 'center',
  },
  italic: { fontFamily: fonts.serifItalic },

  modeRow: { flexDirection: 'row', gap: 7, marginBottom: 20 },
  modeBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  modeEmoji: { fontSize: 22, marginBottom: 4 },
  modeLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 11,
  },

  btnWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    position: 'relative',
  },
  btnRing: {
    position: 'absolute',
    width: 136,
    height: 136,
    borderRadius: 68,
    borderWidth: 1,
  },
  bigBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    overflow: 'hidden',
  },
  bigBtnGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigEmoji: { fontSize: 30, marginBottom: 3 },
  bigLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
    paddingHorizontal: 6,
  },

  timerCard: {
    borderRadius: 15,
    borderWidth: 1,
    padding: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  timerLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  timerNum: {
    fontFamily: fonts.serif,
    color: colors.cream,
    fontSize: 48,
    lineHeight: 52,
    marginBottom: 4,
  },
  timerSub: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  timerBtn: {
    borderRadius: 9,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  timerBtnText: {
    fontFamily: fonts.sansSemi,
    color: colors.bg,
    fontSize: 13,
  },

  explainerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 17,
    paddingHorizontal: 19,
    marginBottom: 12,
  },
  explainerTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 8,
  },
  explainerBody: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 22,
  },
  bold: { fontFamily: fonts.sansSemi, color: colors.text },

  groundCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 17,
    paddingHorizontal: 19,
  },
  groundTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 13,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    paddingHorizontal: 13,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 11,
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 19,
  },
  stepStrong: { fontFamily: fonts.sansSemi, color: colors.text },
});
