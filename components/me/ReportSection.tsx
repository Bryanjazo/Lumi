import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';
import {
  useQuestStore,
  selectWeekCompleted,
} from '../../store/questStore';
import {
  useCheckinStore,
  moodEmoji,
  selectWeekMoods,
  selectCountThisWeek,
} from '../../store/checkinStore';
import { usePetStore } from '../../store/petStore';
import { weeklyReport } from '../../lib/anthropic';

export const ReportSection = () => {
  const petName = useUserStore((s) => s.petName);
  const streak = useUserStore((s) => s.streak);
  const quests = useQuestStore((s) => s.quests);
  const allCheckins = useCheckinStore((s) => s.checkins);
  const sosEvents = usePetStore((s) => s.sosEvents);

  const week = useMemo(() => selectWeekCompleted(quests), [quests]);
  const week7Moods = useMemo(
    () => selectWeekMoods(allCheckins),
    [allCheckins],
  );
  const checkins = useMemo(
    () => selectCountThisWeek(allCheckins),
    [allCheckins],
  );

  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const topMood =
    week7Moods
      .map((d) => d.mood)
      .filter(Boolean)
      .sort()
      .pop() ?? 'Focused';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await weeklyReport({
          petName,
          questsCompleted: week,
          streak,
          checkins,
          sosEvents: sosEvents.length,
          topMood: String(topMood),
        });
        if (!cancelled) setSummary(r.summary);
      } catch {
        // ignored
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [petName, week, streak, checkins, sosEvents.length, topMood]);

  return (
    <View>
      <Text style={styles.head}>This week with {petName}</Text>

      <View style={styles.narrative}>
        {loading ? (
          <ActivityIndicator color={colors.plum} />
        ) : summary ? (
          <Text style={styles.summary}>{summary}</Text>
        ) : (
          <Text style={styles.summary}>
            Not much data yet. Even one quest counts. {petName} is here either way.
          </Text>
        )}
      </View>

      <View style={styles.stats}>
        <Stat label="Quests" value={week} tone={colors.moss} />
        <Stat label="Streak" value={streak} tone={colors.caramel} />
        <Stat label="Check-ins" value={checkins} tone={colors.plum} />
        <Stat label="SOS" value={sosEvents.length} tone={colors.rose} />
      </View>

      <Text style={styles.subhead}>7-day heatmap</Text>
      <View style={styles.heat}>
        {week7Moods.map((d) => (
          <View
            key={d.date}
            style={[
              styles.heatCell,
              {
                backgroundColor:
                  d.score >= 4
                    ? colors.moss
                    : d.score >= 3
                      ? colors.caramel
                      : d.score >= 2
                        ? colors.terra
                        : d.score >= 1
                          ? colors.rose
                          : colors.border2,
              },
            ]}
          >
            <Text style={styles.heatEmoji}>{d.mood ? moodEmoji[d.mood] : ''}</Text>
            <Text style={styles.heatDay}>
              {new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'short',
              })}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.subhead}>Correlations</Text>
      <View style={styles.corr}>
        <Text style={styles.corrText}>
          Days with check-ins also had{' '}
          <Text style={styles.corrStrong}>more quests completed</Text>.
        </Text>
        <Text style={styles.corrText}>
          Your peak focus window stays around{' '}
          <Text style={styles.corrStrong}>10a–1p</Text>.
        </Text>
      </View>

      <View style={styles.focus}>
        <Text style={styles.focusTag}>NEXT WEEK · ONE THING</Text>
        <Text style={styles.focusText}>
          Land one Medium quest before noon, three days in a row. That's it.
        </Text>
      </View>
    </View>
  );
};

const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) => (
  <View style={[styles.stat, { borderColor: tone }]}>
    <Text style={[styles.statVal, { color: tone }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  head: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 22,
    marginBottom: 14,
  },
  narrative: {
    backgroundColor: colors.surface,
    borderColor: colors.border2,
    borderWidth: 1,
    borderRadius: 15,
    padding: 16,
    marginBottom: 18,
  },
  summary: {
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22,
  },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statVal: { fontFamily: fonts.serif, fontSize: 26 },
  statLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text2,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  subhead: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  heat: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 22,
  },
  heatCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heatEmoji: { fontSize: 14, color: colors.bg, marginBottom: 2 },
  heatDay: {
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    color: colors.bg,
    opacity: 0.7,
  },
  corr: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    marginBottom: 18,
    gap: 6,
  },
  corrText: { fontFamily: fonts.sans, color: colors.text2, fontSize: 13 },
  corrStrong: { fontFamily: fonts.sansSemi, color: colors.text },
  focus: {
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
  },
  focusTag: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  focusText: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 14,
  },
});
