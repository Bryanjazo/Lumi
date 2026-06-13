import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Pressable,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { LunaPixel } from '../../components/auth/LunaPixel';
import { useUserStore } from '../../store/userStore';

const SIGNUP_XP_REWARD = 30;
const AUTO_ADVANCE_MS = 2400;

export default function DoneScreen() {
  const router = useRouter();
  const addXp = useUserStore((s) => s.addXp);
  const registerActivity = useUserStore((s) => s.registerActivity);

  const lunaFloat = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const pillScale = useRef(new Animated.Value(0.92)).current;

  const [xpAwarded, setXpAwarded] = useState(false);

  useEffect(() => {
    // Award XP once on mount.
    if (xpAwarded) return;
    addXp(SIGNUP_XP_REWARD);
    registerActivity();
    setXpAwarded(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [addXp, registerActivity, xpAwarded]);

  useEffect(() => {
    // Subtle floating Luna animation.
    Animated.loop(
      Animated.sequence([
        Animated.timing(lunaFloat, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(lunaFloat, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    // Fade in everything.
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Pill pop-in slightly delayed.
    Animated.sequence([
      Animated.delay(450),
      Animated.spring(pillScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-advance to the main app.
    const t = setTimeout(() => {
      router.replace('/(tabs)');
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [lunaFloat, fadeIn, pillScale, router]);

  const lunaTranslate = lunaFloat.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  const goNow = () => {
    Haptics.selectionAsync();
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />
      <Pressable style={styles.tapArea} onPress={goNow}>
        <Animated.View style={[styles.content, { opacity: fadeIn }]}>
          {/* small sparkles above Luna */}
          <View style={styles.sparkleRow}>
            <Text style={styles.sparkle}>✦</Text>
          </View>

          <Animated.View
            style={{
              transform: [{ translateY: lunaTranslate }],
              alignItems: 'center',
            }}
          >
            <LunaPixel mood="excited" size={130} />
          </Animated.View>

          <Text style={styles.h1}>
            You're <Text style={styles.italic}>in.</Text>
          </Text>
          <Text style={styles.line}>Luna is awake.</Text>
          <Text style={styles.line}>She's been waiting for this.</Text>

          <Animated.View
            style={[
              styles.xpPill,
              { transform: [{ scale: pillScale }] },
            ]}
          >
            <Text style={styles.xpText}>✦ +{SIGNUP_XP_REWARD} XP earned</Text>
          </Animated.View>

          <Text style={styles.tap}>tap anywhere to continue</Text>
        </Animated.View>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  tapArea: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 60,
  },
  sparkleRow: { marginBottom: 10 },
  sparkle: {
    fontFamily: fonts.sansSemi,
    color: colors.caramel,
    fontSize: 14,
    opacity: 0.7,
  },
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 40,
    marginTop: 28,
    marginBottom: 14,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.cream },
  line: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  xpPill: {
    marginTop: 28,
    backgroundColor: colors.terraBg,
    borderColor: colors.terraBorder,
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  xpText: {
    fontFamily: fonts.sansSemi,
    color: colors.terra,
    fontSize: 14,
    letterSpacing: 0.4,
  },
  tap: {
    marginTop: 28,
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
