import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { useUserStore, useLevel } from '../store/userStore';
import { Pill } from './Pill';

export const XPBar = () => {
  const { level, pct, next, title } = useLevel();
  const xp = useUserStore((s) => s.xp);
  const streak = useUserStore((s) => s.streak);
  const shield = useUserStore((s) => s.shieldAvailable);

  return (
    <LinearGradient
      colors={[colors.surface, '#2A2018']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.top}>
        <View style={styles.ring}>
          <Text style={styles.ringNum}>{level}</Text>
          <Text style={styles.ringWord}>LVL</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>
            {xp} / {next} XP
          </Text>
        </View>
      </View>
      <View style={styles.track}>
        <LinearGradient
          colors={[colors.plumDark, colors.plum]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]}
        />
      </View>
      <View style={styles.chips}>
        <Pill tone="caramel">{`${streak}d streak`}</Pill>
        {shield && <Pill tone="mist">Shield ready</Pill>}
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 17,
    paddingHorizontal: 19,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginBottom: 13,
  },
  ring: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.plumBg,
    borderWidth: 1.5,
    borderColor: 'rgba(196,160,224,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringNum: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 17,
    lineHeight: 18,
  },
  ringWord: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    opacity: 0.6,
    fontSize: 8,
    letterSpacing: 1,
  },
  meta: { flex: 1 },
  title: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 13,
    marginBottom: 1,
  },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 12,
  },
  track: {
    height: 6,
    backgroundColor: colors.bg2,
    borderRadius: 100,
    overflow: 'hidden',
    marginBottom: 9,
  },
  fill: { height: '100%', borderRadius: 100 },
  chips: { flexDirection: 'row', gap: 6 },
});
