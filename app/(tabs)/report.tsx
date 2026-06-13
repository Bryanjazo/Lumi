import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../../components/Screen';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';
import {
  useQuestStore,
  selectWeekCompleted,
} from '../../store/questStore';
import {
  useCheckinStore,
  selectWeekMoods,
  selectCountThisWeek,
} from '../../store/checkinStore';
import { usePetStore } from '../../store/petStore';
import { weeklyReport } from '../../lib/anthropic';

const weekRangeLabel = (now: Date) => {
  const monday = new Date(now);
  const day = monday.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  monday.setDate(monday.getDate() + diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Week of ${fmt(monday)} – ${fmt(sunday)}`;
};

export default function ReportTab() {
  const petName = useUserStore((s) => s.petName);
  const streak = useUserStore((s) => s.streak);
  const quests = useQuestStore((s) => s.quests);
  const allCheckins = useCheckinStore((s) => s.checkins);
  const sosEvents = usePetStore((s) => s.sosEvents);

  const week = useMemo(() => selectWeekCompleted(quests), [quests]);
  const week7Moods = useMemo(() => selectWeekMoods(allCheckins), [allCheckins]);
  const checkins = useMemo(
    () => selectCountThisWeek(allCheckins),
    [allCheckins],
  );

  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const topMood =
    week7Moods.find((d) => d.score >= 4)?.mood ??
    week7Moods.find((d) => d.mood)?.mood ??
    'Focused';

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
        // ignored — summary stays null
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [petName, week, streak, checkins, sosEvents.length, topMood]);

  const weekRange = weekRangeLabel(new Date());

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.heroSub}>{weekRange}</Text>
        <Text style={styles.heroH1}>
          Your <Text style={styles.italic}>brain report.</Text>
        </Text>
      </View>

      <LinearGradient
        colors={[colors.surface, '#1A1525']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.narrativeCard}
      >
        <View style={styles.narrativeEyebrow}>
          <View style={styles.narrativeDot} />
          <Text style={styles.narrativeEyebrowText}>Weekly narrative</Text>
          <Text style={styles.narrativeWeek}>{weekRange}</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.plum} />
        ) : (
          <Text style={styles.narrativeBody}>
            {summary ??
              `Not much data yet. Even one quest counts. ${petName} is here either way.`}
          </Text>
        )}
      </LinearGradient>

      <View style={styles.statRow}>
        <Stat label="Quests completed" value={week} tone={colors.cream} />
        <Stat label="Day streak" value={streak} tone={colors.cream} />
        <Stat
          label="Crisis moments"
          value={sosEvents.length}
          tone={colors.cream}
        />
      </View>

      <View style={styles.heatmapCard}>
        <Text style={styles.heatmapTitle}>Day-by-day</Text>
        <View style={styles.heatmapRow}>
          {week7Moods.map((d, i) => {
            const h = d.score === 0 ? 8 : 10 + d.score * 11;
            const good = d.score >= 3;
            const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
              new Date(d.date + 'T00:00:00').getDay()
            ];
            return (
              <View key={d.date + i} style={styles.heatCol}>
                <View style={styles.heatBarWrap}>
                  <View
                    style={[
                      styles.heatBar,
                      {
                        height: h,
                        backgroundColor: good
                          ? 'rgba(139,191,150,0.3)'
                          : 'rgba(212,144,106,0.22)',
                        borderColor: good
                          ? 'rgba(139,191,150,0.4)'
                          : 'rgba(212,144,106,0.3)',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.heatDay}>{day}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.bestMoment}>
          <Text style={styles.bmLabel}>Best moment</Text>
          <Text style={styles.bmText}>
            <Text style={styles.bmStrong}>
              {bestDayLabel(week7Moods) ?? 'Wednesday 11am–2pm'}
            </Text>{' '}
            — your peak focus window. This combination works for you.
          </Text>
        </View>
      </View>

      <View style={styles.corrCard}>
        <Text style={styles.corrTitle}>What your data is telling you</Text>
        <View style={{ gap: 9 }}>
          <CorrItem
            icon="😴"
            text={
              <>
                On days with <Text style={styles.corrStrong}>under 6hrs sleep</Text>,
                quests stall. Sleep is your biggest lever.
              </>
            }
          />
          <CorrItem
            icon="🚶"
            text={
              <>
                Days you logged a walk, your afternoon mood was higher.{' '}
                <Text style={styles.corrStrong}>
                  Movement is not optional for your brain.
                </Text>
              </>
            }
          />
          <CorrItem
            icon="🌫️"
            text={
              <>
                Disconnected feelings cluster on{' '}
                <Text style={styles.corrStrong}>low-sleep days.</Text> Rest is
                directly connected to how real the world feels.
              </>
            }
          />
        </View>
      </View>

      <View style={styles.nextCard}>
        <Text style={styles.nextTitle}>One focus for next week</Text>
        <View style={{ gap: 9 }}>
          <View style={styles.nextRow}>
            <View style={styles.nextDot} />
            <Text style={styles.nextItem}>
              Try to be in bed by 11pm, 4 out of 7 nights. That's it. Nothing
              else changes.
            </Text>
          </View>
          <View style={[styles.nextRow, styles.nextSecondary]}>
            <View style={[styles.nextDot, { backgroundColor: colors.text3 }]} />
            <Text style={[styles.nextItem, { color: colors.text3 }]}>
              Your quests and reminders stay the same. Just the one thing.
            </Text>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) => (
  <View style={statStyles.card}>
    <Text style={[statStyles.num, { color: tone }]}>{value}</Text>
    <Text style={statStyles.label}>{label}</Text>
  </View>
);

const CorrItem = ({
  icon,
  text,
}: {
  icon: string;
  text: React.ReactNode;
}) => (
  <View style={corrStyles.item}>
    <Text style={corrStyles.icon}>{icon}</Text>
    <Text style={corrStyles.text}>{text}</Text>
  </View>
);

const bestDayLabel = (
  week: { date: string; score: number }[],
): string | null => {
  const best = [...week].sort((a, b) => b.score - a.score)[0];
  if (!best || best.score === 0) return null;
  return new Date(best.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
  });
};

const styles = StyleSheet.create({
  hero: { marginBottom: 20 },
  heroSub: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 12,
    marginBottom: 4,
  },
  heroH1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 27,
    lineHeight: 32,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.plum },

  narrativeCard: {
    borderRadius: 17,
    padding: 20,
    paddingHorizontal: 21,
    borderWidth: 1,
    borderColor: colors.border2,
    marginBottom: 12,
  },
  narrativeEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  narrativeDot: {
    width: 6,
    height: 6,
    backgroundColor: colors.plum,
    borderRadius: 100,
  },
  narrativeEyebrowText: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 11,
  },
  narrativeWeek: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    marginLeft: 'auto',
  },
  narrativeBody: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 14,
    lineHeight: 26,
  },

  statRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 12,
  },

  heatmapCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 17,
    paddingHorizontal: 19,
    marginBottom: 12,
  },
  heatmapTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 13,
  },
  heatmapRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 4,
  },
  heatCol: { flex: 1 },
  heatBarWrap: {
    height: 60,
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  heatBar: {
    width: '100%',
    borderRadius: 4,
    borderWidth: 1,
  },
  heatDay: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 10,
    textAlign: 'center',
  },

  bestMoment: {
    backgroundColor: colors.mossBg,
    borderColor: 'rgba(139,191,150,0.18)',
    borderWidth: 1,
    borderRadius: 9,
    padding: 11,
    paddingHorizontal: 13,
    marginTop: 11,
  },
  bmLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.moss,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  bmText: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 19,
  },
  bmStrong: { fontFamily: fonts.sansSemi, color: colors.text },

  corrCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 17,
    paddingHorizontal: 19,
    marginBottom: 12,
  },
  corrTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 13,
  },
  corrStrong: { fontFamily: fonts.sansSemi, color: colors.text },

  nextCard: {
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1,
    borderRadius: 15,
    padding: 17,
    paddingHorizontal: 19,
  },
  nextTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 14,
    marginBottom: 11,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  nextSecondary: {
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  nextDot: {
    width: 5,
    height: 5,
    borderRadius: 100,
    backgroundColor: colors.plum,
    marginTop: 7,
  },
  nextItem: {
    flex: 1,
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 19,
  },
});

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  num: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 28,
    marginBottom: 3,
  },
  label: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 13,
  },
});

const corrStyles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: colors.bg2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    paddingHorizontal: 13,
  },
  icon: { fontSize: 18, marginTop: 1 },
  text: {
    flex: 1,
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 19,
  },
});
