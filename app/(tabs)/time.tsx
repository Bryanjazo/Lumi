import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen } from '../../components/Screen';
import { Label } from '../../components/Label';
import { TimeBar } from '../../components/TimeBar';
import { Pill } from '../../components/Pill';
import { colors, accent } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useQuestStore, selectTodayQuests } from '../../store/questStore';

const PEAK_START = 10;
const PEAK_END = 13;

export default function TimeTab() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  const quests = useQuestStore((s) => s.quests);
  const todayQuests = useMemo(() => selectTodayQuests(quests), [quests]);

  const scheduled = todayQuests
    .filter((q) => q.scheduledHour !== undefined)
    .sort((a, b) => {
      const ah = a.scheduledHour ?? 0;
      const bh = b.scheduledHour ?? 0;
      return ah * 60 + (a.scheduledMinute ?? 0) - (bh * 60 + (b.scheduledMinute ?? 0));
    });

  const blocks =
    scheduled.length > 0
      ? scheduled
      : todayQuests.slice(0, 6).map((q, i) => ({
          ...q,
          scheduledHour: 9 + i * 2,
          scheduledMinute: 0,
          durationMinutes: 60,
        }));

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentBlock = blocks.find((b) => {
    const start = (b.scheduledHour ?? 0) * 60 + (b.scheduledMinute ?? 0);
    const end = start + (b.durationMinutes ?? 60);
    return currentMinutes >= start && currentMinutes < end;
  });
  const minutesLeft = currentBlock
    ? (currentBlock.scheduledHour ?? 0) * 60 +
      (currentBlock.scheduledMinute ?? 0) +
      (currentBlock.durationMinutes ?? 60) -
      currentMinutes
    : null;

  const timeStr = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.label}>Right now</Text>
        <Text style={styles.timeBig}>{timeStr}</Text>
      </View>

      <View style={styles.card}>
        <TimeBar peakStartHour={PEAK_START} peakEndHour={PEAK_END} />
        <View style={styles.legendRow}>
          <Pill tone="moss">Peak focus 10a–1p</Pill>
        </View>
      </View>

      {currentBlock && minutesLeft !== null && minutesLeft <= 12 && (
        <View style={styles.warn}>
          <Text style={styles.warnTag}>TRANSITION IN {minutesLeft}m</Text>
          <Text style={styles.warnText}>
            <Text style={styles.warnStrong}>{currentBlock.title}</Text> ends soon.
            Let your brain prep for the switch.
          </Text>
        </View>
      )}

      <Label style={{ marginTop: 22 }}>Today</Label>
      <View style={{ gap: 9 }}>
        {blocks.length === 0 ? (
          <Text style={styles.empty}>Nothing scheduled. Today is open.</Text>
        ) : (
          blocks.map((q) => {
            const start = (q.scheduledHour ?? 0) * 60 + (q.scheduledMinute ?? 0);
            const end = start + (q.durationMinutes ?? 60);
            const isCurrent = currentMinutes >= start && currentMinutes < end;
            const isDone = q.completed || currentMinutes >= end;
            const tone = accent(q.accent ?? 'plum');
            return (
              <View
                key={q.id}
                style={[
                  styles.block,
                  isCurrent && { borderColor: tone.fg },
                  isDone && styles.blockDone,
                ]}
              >
                <View style={[styles.dot, { backgroundColor: tone.fg }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.blockTitle, isDone && styles.strike]}>
                    {q.title}
                  </Text>
                  <Text style={styles.blockTime}>
                    {formatHm(q.scheduledHour ?? 0, q.scheduledMinute ?? 0)} ·{' '}
                    {q.durationMinutes ?? 60}m
                  </Text>
                </View>
                {isCurrent && <Pill tone="plum">NOW</Pill>}
              </View>
            );
          })
        )}
      </View>
    </Screen>
  );
}

const formatHm = (h: number, m: number) => {
  const ampm = h >= 12 ? 'p' : 'a';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, '0')}${ampm}`;
};

const styles = StyleSheet.create({
  head: { marginBottom: 18 },
  label: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  timeBig: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 52,
    lineHeight: 58,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 16,
    marginBottom: 16,
  },
  legendRow: { marginTop: 12, flexDirection: 'row', gap: 6 },
  warn: {
    backgroundColor: colors.terraBg,
    borderColor: colors.terraBorder,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    marginBottom: 8,
  },
  warnTag: {
    fontFamily: fonts.sansSemi,
    color: colors.terra,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  warnText: { fontFamily: fonts.sans, color: colors.text2, fontSize: 13 },
  warnStrong: { fontFamily: fonts.sansSemi, color: colors.text },
  block: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 13,
  },
  blockDone: { opacity: 0.45 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  blockTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
  },
  strike: { textDecorationLine: 'line-through' },
  blockTime: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    marginTop: 2,
  },
  empty: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    textAlign: 'center',
    fontSize: 13,
    paddingVertical: 18,
  },
});
