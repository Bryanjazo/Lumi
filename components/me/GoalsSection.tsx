import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { milestones } from '../../constants/milestones';
import { items } from '../../constants/items';
import { skins } from '../../constants/skins';
import { useLevel, useUserStore } from '../../store/userStore';
import { useQuestStore } from '../../store/questStore';
import { useCheckinStore } from '../../store/checkinStore';
import { usePetStore } from '../../store/petStore';

export const GoalsSection = () => {
  const { level } = useLevel();
  const streak = useUserStore((s) => s.streak);
  const questsDone = useQuestStore(
    (s) => s.quests.filter((q) => q.completed).length,
  );
  const checkins = useCheckinStore((s) => s.checkins.length);
  const sosCount = usePetStore((s) => s.sosEvents.length);

  const metricValue = (m: string) => {
    switch (m) {
      case 'quests':
        return questsDone;
      case 'streak':
        return streak;
      case 'level':
        return level;
      case 'checkins':
        return checkins;
      case 'sos':
        return sosCount;
      default:
        return 0;
    }
  };

  return (
    <View>
      <Text style={styles.head}>Milestones</Text>
      <Text style={styles.sub}>Each one unlocks something for Luna.</Text>
      <View style={{ gap: 10 }}>
        {milestones.map((m) => {
          const cur = metricValue(m.metric);
          const pct = Math.max(0, Math.min(1, cur / m.target));
          const done = cur >= m.target;
          const unlockMeta = m.unlocks
            ? m.unlocks.type === 'item'
              ? items.find((i) => i.id === m.unlocks!.id)?.name
              : skins.find((s) => s.id === m.unlocks!.id)?.name + ' skin'
            : null;
          return (
            <View
              key={m.id}
              style={[styles.card, done && { borderColor: colors.moss }]}
            >
              <View style={styles.row}>
                <Text style={styles.title}>{m.title}</Text>
                <Text style={[styles.xp, done && { color: colors.moss }]}>
                  +{m.xpReward} XP
                </Text>
              </View>
              <Text style={styles.desc}>{m.description}</Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${pct * 100}%`,
                      backgroundColor: done ? colors.moss : colors.plum,
                    },
                  ]}
                />
              </View>
              <Text style={styles.meta}>
                {Math.min(cur, m.target)} / {m.target}
                {unlockMeta && ` · unlocks ${unlockMeta}`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  head: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 22,
    marginBottom: 4,
  },
  sub: { fontFamily: fonts.sans, color: colors.text2, fontSize: 13, marginBottom: 16 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: { fontFamily: fonts.sansSemi, color: colors.text, fontSize: 14 },
  xp: { fontFamily: fonts.sansSemi, color: colors.plum, fontSize: 12 },
  desc: { fontFamily: fonts.sans, color: colors.text2, fontSize: 12, marginBottom: 9 },
  track: {
    height: 5,
    backgroundColor: colors.bg2,
    borderRadius: 100,
    overflow: 'hidden',
    marginBottom: 6,
  },
  fill: { height: '100%', borderRadius: 100 },
  meta: { fontFamily: fonts.sans, color: colors.text3, fontSize: 11 },
});
