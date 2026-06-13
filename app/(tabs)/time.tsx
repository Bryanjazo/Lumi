import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { Label } from '../../components/Label';
import { colors, accent } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useQuestStore, selectTodayQuests } from '../../store/questStore';

// Day window — what we show as the user's "day."
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const PEAK_START_HOUR = 11;
const PEAK_END_HOUR = 14;

const HOUR_LABELS = [
  { h: 7, label: '7 AM' },
  { h: 12, label: '12 PM' },
  { h: 17, label: '5 PM' },
  { h: 22, label: '10 PM' },
];

const formatHm = (h: number, m: number) => {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const formatHmShort = (h: number) => {
  const ampm = h >= 12 ? 'p' : 'a';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${ampm.toUpperCase()}M`;
};

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
      return (
        ah * 60 + (a.scheduledMinute ?? 0) - (bh * 60 + (b.scheduledMinute ?? 0))
      );
    });

  // Auto-schedule unscheduled quests across the day if none have times.
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
  const dayStartMin = DAY_START_HOUR * 60;
  const dayEndMin = DAY_END_HOUR * 60;
  const dayTotalMin = dayEndMin - dayStartMin;

  const dayElapsed = Math.max(0, Math.min(dayTotalMin, currentMinutes - dayStartMin));
  const goneFrac = dayElapsed / dayTotalMin;
  const peakStartFrac = (PEAK_START_HOUR * 60 - dayStartMin) / dayTotalMin;
  const peakEndFrac = (PEAK_END_HOUR * 60 - dayStartMin) / dayTotalMin;

  const minutesGone = dayElapsed;
  const minutesLeft = Math.max(0, dayTotalMin - dayElapsed);
  const hLeft = Math.floor(minutesLeft / 60);
  const mLeft = minutesLeft % 60;

  const inPeak =
    currentMinutes >= PEAK_START_HOUR * 60 &&
    currentMinutes < PEAK_END_HOUR * 60;

  // Detect current quest + transition warning
  const currentBlock = blocks.find((b) => {
    const start = (b.scheduledHour ?? 0) * 60 + (b.scheduledMinute ?? 0);
    const end = start + (b.durationMinutes ?? 60);
    return currentMinutes >= start && currentMinutes < end;
  });
  const minutesToEnd = currentBlock
    ? (currentBlock.scheduledHour ?? 0) * 60 +
      (currentBlock.scheduledMinute ?? 0) +
      (currentBlock.durationMinutes ?? 60) -
      currentMinutes
    : null;
  const showTransition =
    minutesToEnd !== null && minutesToEnd > 0 && minutesToEnd <= 12;

  const todayName = now.toLocaleDateString(undefined, { weekday: 'long' });
  const nowTimeStr = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.heroSub}>{todayName} · your day at a glance</Text>
        <Text style={styles.heroH1}>
          Time is <Text style={styles.italic}>visible</Text> here.
        </Text>
      </View>

      <LinearGradient
        colors={[colors.surface, '#1E1A10']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.dayStrip}
      >
        <View style={styles.dayStripHeader}>
          <View>
            <Text style={styles.dayTitle}>Today's time</Text>
            <Text style={styles.daySub}>
              {DAY_START_HOUR}am → {DAY_END_HOUR - 12}pm ·{' '}
              {DAY_END_HOUR - DAY_START_HOUR}hr day
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.dayTime}>{nowTimeStr}</Text>
            <Text style={[styles.daySub, { textAlign: 'right' }]}>
              right now
            </Text>
          </View>
        </View>

        <View style={styles.barLabels}>
          {HOUR_LABELS.map((l) => (
            <Text key={l.h} style={styles.barLabel}>
              {l.label}
            </Text>
          ))}
        </View>
        <View style={styles.barTrack}>
          {/* peak focus window */}
          <View
            style={[
              styles.barWindow,
              {
                left: `${peakStartFrac * 100}%`,
                width: `${(peakEndFrac - peakStartFrac) * 100}%`,
              },
            ]}
          />
          {/* time gone */}
          <LinearGradient
            colors={['#3A2E20', '#4A3A28']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.barGone, { width: `${goneFrac * 100}%` }]}
          />
          {/* now indicator */}
          <View style={[styles.barNow, { left: `${goneFrac * 100}%` }]} />
        </View>

        <View style={styles.barFooter}>
          <Text style={styles.gone}>
            {Math.round(goneFrac * 100)}% of your day gone
          </Text>
          <Text style={styles.left}>
            {hLeft}h {mLeft}m remaining
          </Text>
        </View>

        <View style={styles.peakKey}>
          <View style={styles.peakDot} />
          <Text style={styles.peakText}>
            Your <Text style={styles.peakStrong}>peak focus window</Text> is{' '}
            {PEAK_START_HOUR}am–{PEAK_END_HOUR - 12}pm
            {inPeak ? " · you're in it now" : ''}
          </Text>
        </View>
      </LinearGradient>

      {showTransition && currentBlock && (
        <Pressable
          style={styles.transitionCard}
          onPress={() => Haptics.selectionAsync()}
        >
          <Text style={styles.transitionEmoji}>⏰</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.transitionTitle}>
              Quest ending in {minutesToEnd}m
            </Text>
            <Text style={styles.transitionSub}>
              "{currentBlock.title}" · start wrapping up
            </Text>
          </View>
          <View style={styles.transitionBtn}>
            <Text style={styles.transitionBtnText}>Got it</Text>
          </View>
        </Pressable>
      )}

      <Label style={{ marginTop: 18 }}>Your schedule</Label>
      <View style={{ gap: 7 }}>
        {blocks.length === 0 ? (
          <Text style={styles.empty}>Nothing scheduled. Today is open.</Text>
        ) : (
          blocks.map((q) => {
            const start =
              (q.scheduledHour ?? 0) * 60 + (q.scheduledMinute ?? 0);
            const end = start + (q.durationMinutes ?? 60);
            const isCurrent =
              currentMinutes >= start && currentMinutes < end;
            const isDone = q.completed || currentMinutes >= end;
            const dotColor = accent(q.accent ?? 'plum').fg;
            return (
              <View
                key={q.id}
                style={[
                  styles.block,
                  isCurrent && styles.blockNow,
                  isDone && styles.blockDone,
                ]}
              >
                <Text
                  style={[
                    styles.blockTime,
                    isCurrent && { color: colors.caramel },
                  ]}
                >
                  {formatHmShort(q.scheduledHour ?? 0)}
                </Text>
                <View style={[styles.blockDot, { backgroundColor: dotColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.blockTitle, isDone && styles.strike]}>
                    {q.title}
                  </Text>
                  <Text style={styles.blockSub}>
                    {isDone
                      ? `Completed · +${q.xpReward} XP`
                      : isCurrent
                        ? 'Peak window · best time for this'
                        : `${q.durationMinutes ?? 60}m`}
                  </Text>
                </View>
                {isCurrent && (
                  <View style={styles.nowBadge}>
                    <Text style={styles.nowBadgeText}>NOW</Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: 18 },
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
  italic: { fontFamily: fonts.serifItalic, color: colors.caramel },

  dayStrip: {
    borderRadius: 17,
    padding: 18,
    paddingHorizontal: 19,
    borderWidth: 1,
    borderColor: colors.border2,
    marginBottom: 12,
  },
  dayStripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  dayTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 13,
    marginBottom: 2,
  },
  daySub: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
  },
  dayTime: {
    fontFamily: fonts.serif,
    color: colors.cream,
    fontSize: 22,
    lineHeight: 24,
    marginBottom: 2,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  barLabel: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 10,
  },
  barTrack: {
    height: 11,
    backgroundColor: colors.bg2,
    borderRadius: 100,
    overflow: 'hidden',
    position: 'relative',
  },
  barWindow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(139,191,150,0.12)',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(139,191,150,0.25)',
  },
  barGone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 100,
  },
  barNow: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 3,
    backgroundColor: colors.caramel,
    shadowColor: colors.caramel,
    shadowOpacity: 0.6,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  barFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  gone: { fontFamily: fonts.sans, color: colors.text3, fontSize: 12 },
  left: { fontFamily: fonts.sansSemi, color: colors.caramel, fontSize: 12 },
  peakKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  peakDot: {
    width: 7,
    height: 7,
    borderRadius: 2,
    backgroundColor: 'rgba(139,191,150,0.4)',
  },
  peakText: {
    flex: 1,
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 12,
  },
  peakStrong: { fontFamily: fonts.sansSemi, color: colors.moss },

  transitionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.caramelBg,
    borderColor: colors.caramelBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 13,
    paddingHorizontal: 15,
    marginBottom: 8,
  },
  transitionEmoji: { fontSize: 20 },
  transitionTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.caramel,
    fontSize: 13,
    marginBottom: 2,
  },
  transitionSub: { fontFamily: fonts.sans, color: colors.text2, fontSize: 12 },
  transitionBtn: {
    backgroundColor: colors.caramel,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  transitionBtnText: {
    fontFamily: fonts.sansSemi,
    color: colors.bg,
    fontSize: 12,
  },

  block: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  blockNow: {
    borderColor: 'rgba(212,170,106,0.3)',
    backgroundColor: '#221D10',
  },
  blockDone: { opacity: 0.32 },
  blockTime: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    width: 44,
    textAlign: 'right',
  },
  blockDot: { width: 7, height: 7, borderRadius: 100 },
  blockTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
  },
  blockSub: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    marginTop: 2,
  },
  strike: { textDecorationLine: 'line-through' },
  nowBadge: {
    backgroundColor: colors.caramelBg,
    borderColor: colors.caramelBorder,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  nowBadgeText: {
    fontFamily: fonts.sansSemi,
    color: colors.caramel,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  empty: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    textAlign: 'center',
    fontSize: 13,
    paddingVertical: 18,
  },
});
