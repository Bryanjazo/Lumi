import { Pressable, Text, View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, accent } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { Quest } from '../store/questStore';
import { Pill } from './Pill';

interface Props {
  quest: Quest;
  onToggle: () => void;
}

const diffTone = (d: Quest['difficulty']) =>
  d === 'easy' ? 'moss' : d === 'medium' ? 'caramel' : 'mist';
const diffLabel = (d: Quest['difficulty']) =>
  d.charAt(0).toUpperCase() + d.slice(1);

export const QuestCard = ({ quest, onToggle }: Props) => {
  const stripeKey = quest.accent ?? 'plum';
  const stripe = accent(stripeKey).fg;
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onToggle();
      }}
      style={({ pressed }) => [
        styles.card,
        quest.completed && styles.done,
        pressed && { backgroundColor: colors.card },
      ]}
    >
      <View style={[styles.accentBar, { backgroundColor: stripe }]} />
      <View style={styles.info}>
        <Text style={[styles.title, quest.completed && styles.strike]}>
          {quest.title}
        </Text>
        <View style={styles.meta}>
          <Pill tone={diffTone(quest.difficulty)}>
            {diffLabel(quest.difficulty)}
          </Pill>
          <Text style={styles.xp}>+{quest.xpReward} XP</Text>
        </View>
      </View>
      <View
        style={[
          styles.check,
          quest.completed && {
            backgroundColor: colors.moss,
            borderColor: colors.moss,
          },
        ]}
      >
        {quest.completed && <Text style={styles.checkMark}>✓</Text>}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  done: { opacity: 0.35 },
  accentBar: { width: 3, height: 30, borderRadius: 100 },
  info: { flex: 1 },
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.text,
    marginBottom: 4,
  },
  strike: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  xp: { fontFamily: fonts.sans, color: colors.text3, fontSize: 11 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: colors.bg,
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    lineHeight: 14,
  },
});
