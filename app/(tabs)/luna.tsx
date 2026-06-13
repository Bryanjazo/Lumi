import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { LunaHeader } from '../../components/LunaHeader';
import { Label } from '../../components/Label';
import { colors, accent, AccentKey } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { usePetStore } from '../../store/petStore';
import { useUserStore } from '../../store/userStore';
import {
  useQuestStore,
  selectCompletedToday,
} from '../../store/questStore';
import {
  useCheckinStore,
  selectTodayMood,
} from '../../store/checkinStore';
import { lunaState, LunaState } from '../../lib/gamification';
import { items as ALL_ITEMS } from '../../constants/items';

type ManualState = LunaState | 'auto';

const STATE_TABS: { key: LunaState; label: string; emoji: string }[] = [
  { key: 'thriving', label: 'Thriving', emoji: '🌸' },
  { key: 'struggling', label: 'Struggling', emoji: '🌧️' },
  { key: 'away', label: 'Away', emoji: '🌘' },
];

export default function LunaTab() {
  const petName = useUserStore((s) => s.petName);
  const streak = useUserStore((s) => s.streak);
  const lastActiveDate = useUserStore((s) => s.lastActiveDate);
  const quests = useQuestStore((s) => s.quests);
  const checkins = useCheckinStore((s) => s.checkins);

  const completedToday = useMemo(() => selectCompletedToday(quests), [quests]);
  const todayMood = useMemo(() => selectTodayMood(checkins), [checkins]);

  const traits = usePetStore((s) => s.traits);
  const adventure = usePetStore((s) => s.adventure);
  const startAdventure = usePetStore((s) => s.startAdventure);
  const collectAdventure = usePetStore((s) => s.collectAdventure);
  const care = usePetStore((s) => s.care);
  const lastCare = usePetStore((s) => s.lastCare);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000 * 15);
    return () => clearInterval(id);
  }, []);

  const daysSinceActive = lastActiveDate
    ? Math.floor(
        (Date.now() - new Date(lastActiveDate + 'T00:00:00').getTime()) /
          86400000,
      )
    : 99;

  const actualState = lunaState({
    questsCompletedToday: completedToday,
    dailyQuestTarget: 3,
    streak,
    checkedInToday: !!todayMood,
    lastActiveDaysAgo: daysSinceActive,
  });

  // The state tabs preview each mood; default tracks actual state.
  const [previewState, setPreviewState] = useState<ManualState>('auto');
  const displayed: LunaState =
    previewState === 'auto' ? actualState : previewState;

  // Energy = quests completed today scaled to /10.
  const energy = Math.min(10, Math.round((completedToday / 3) * 10));

  const handleAdventure = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!adventure) {
      startAdventure();
      Alert.alert(`${petName}'s heading out`, "She'll be back in 2 hours.");
    } else if (new Date(adventure.endsAt).getTime() > now) {
      const minsLeft = Math.ceil(
        (new Date(adventure.endsAt).getTime() - now) / 60000,
      );
      Alert.alert('Still out there', `Back in ${minsLeft}m.`);
    } else {
      const found = collectAdventure();
      if (found?.foundItemId) {
        const item = ALL_ITEMS.find((i) => i.id === found.foundItemId);
        Alert.alert(`${petName} found something`, `She brought back: ${item?.name}.`);
      }
    }
  };

  const handleCare = (which: 'checkin' | 'meds' | 'move' | 'windDown') => {
    Haptics.selectionAsync();
    care(which);
  };

  const adventureFraction =
    adventure
      ? Math.min(
          1,
          Math.max(
            0,
            (now - new Date(adventure.startedAt).getTime()) /
              (new Date(adventure.endsAt).getTime() -
                new Date(adventure.startedAt).getTime()),
          ),
        )
      : 0;
  const adventureReady =
    adventure && new Date(adventure.endsAt).getTime() <= now;

  const badge = badgeForState(displayed, streak);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View>
        <LunaHeader state={displayed} height={150} />
        <View style={[styles.petBadge, { borderColor: badge.border }]}>
          <Text style={[styles.petBadgeText, { color: badge.fg }]}>
            {badge.text}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stateTabs}>
          {STATE_TABS.map((t) => {
            const active = displayed === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setPreviewState(active ? 'auto' : t.key);
                }}
                style={[styles.stateTab, active && styles.stateTabActive]}
              >
                <Text style={styles.stateTabEmoji}>{t.emoji}</Text>
                <Text
                  style={[
                    styles.stateTabLabel,
                    active && styles.stateTabLabelActive,
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Label style={{ marginTop: 16 }}>{petName}'s energy</Label>
        <View style={styles.energyCard}>
          <Text style={styles.energyIcon}>
            {displayed === 'thriving'
              ? '✨'
              : displayed === 'struggling'
                ? '🌑'
                : '🌘'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.energyLabel}>
              {energyLabel(energy)} · {energy} / 10
            </Text>
            <View style={styles.energyTrack}>
              <LinearGradient
                colors={
                  energy >= 6
                    ? [colors.plumDark, colors.plum]
                    : ['#6B3A2A', colors.terra]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.energyFill, { width: `${energy * 10}%` }]}
              />
            </View>
            <Text style={styles.energySub}>Powered by your quests today</Text>
          </View>
        </View>

        <Label>Your care today</Label>
        <View style={styles.careGrid}>
          {[
            { k: 'checkin' as const, emoji: '🌅', label: 'Check-in' },
            { k: 'meds' as const, emoji: '💊', label: 'Meds' },
            { k: 'move' as const, emoji: '🚶', label: 'Move' },
            { k: 'windDown' as const, emoji: '🌙', label: 'Wind-down' },
          ].map((c) => {
            const done = !!lastCare[c.k] &&
              new Date(lastCare[c.k]!).toDateString() === new Date().toDateString();
            return (
              <Pressable
                key={c.k}
                onPress={() => handleCare(c.k)}
                style={[styles.careBtn, done && styles.careBtnDone]}
              >
                <Text style={styles.careEmoji}>{c.emoji}</Text>
                <Text style={[styles.careLabel, done && styles.careLabelDone]}>
                  {c.label}
                  {done ? ' ✓' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Label>How the room reflects you</Label>
        <View style={styles.traitCard}>
          <Text style={styles.traitTitle}>Traits growing through your work</Text>
          <Trait
            tone="plum"
            label="Presence"
            value={traits.presence}
            source="Windows open · room gets brighter"
          />
          <Trait
            tone="moss"
            label="Groundedness"
            value={traits.groundedness}
            source="Plant grows with SOS work"
          />
          <Trait
            tone="caramel"
            label="Momentum"
            value={traits.momentum}
            source="Lamp glows warmer · bookshelf fills"
          />
          <Trait
            tone="mist"
            label="Curiosity"
            value={traits.curiosity}
            source="Toy box fills · unlocks at 60%"
            last
          />
        </View>

        <Label>On adventure</Label>
        <Pressable onPress={handleAdventure} style={styles.advWrap}>
          <LinearGradient
            colors={['#1A1525', '#1A1A10']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.advCard}
          >
            <View style={styles.advHeader}>
              <Text style={{ fontSize: 20 }}>🗺️</Text>
              <View>
                <Text style={styles.advTitle}>
                  {!adventure
                    ? `Send ${petName} out`
                    : adventureReady
                      ? `${petName} is back`
                      : 'The quiet forest'}
                </Text>
                <Text style={styles.advSub}>
                  {!adventure
                    ? 'She comes back with a found object'
                    : adventureReady
                      ? 'Tap to collect'
                      : `Returns in ${formatReturn(adventure.endsAt, now)}`}
                </Text>
              </View>
            </View>
            <View style={styles.advTrack}>
              <LinearGradient
                colors={[colors.plumDark, colors.plum]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.advFill,
                  { width: `${Math.round(adventureFraction * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.advFooter}>
              <Text style={styles.advFooterText}>Sent on quests completed</Text>
              <Text style={styles.advFooterText}>
                {Math.round(adventureFraction * 100)}%
              </Text>
            </View>
          </LinearGradient>
        </Pressable>

        <Label>Last discovery</Label>
        <View style={styles.discCard}>
          <Text style={{ fontSize: 22 }}>🪨</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.discTitle}>A smooth stone</Text>
            <Text style={styles.discText}>
              From the day you completed 3 quests in a row. {petName} keeps it
              near the door.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const Trait = ({
  tone,
  label,
  value,
  source,
  last,
}: {
  tone: AccentKey;
  label: string;
  value: number;
  source: string;
  last?: boolean;
}) => {
  const t = accent(tone);
  return (
    <View style={[traitStyles.row, last && { marginBottom: 0 }]}>
      <View style={[traitStyles.dot, { backgroundColor: t.fg }]} />
      <View style={{ flex: 1 }}>
        <View style={traitStyles.headerRow}>
          <Text style={traitStyles.name}>{label}</Text>
          <Text style={traitStyles.pct}>{value}%</Text>
        </View>
        <View style={traitStyles.track}>
          <View
            style={[
              traitStyles.fill,
              { width: `${value}%`, backgroundColor: t.fg },
            ]}
          />
        </View>
        <Text style={traitStyles.source}>{source}</Text>
      </View>
    </View>
  );
};

const energyLabel = (e: number): string => {
  if (e >= 8) return 'Full energy';
  if (e >= 5) return 'Steady energy';
  if (e >= 3) return 'Some energy';
  return 'Low energy';
};

const formatReturn = (ends: string, now: number): string => {
  const ms = new Date(ends).getTime() - now;
  if (ms <= 0) return 'any moment';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const badgeForState = (
  s: LunaState,
  streak: number,
): { text: string; fg: string; border: string } => {
  if (s === 'thriving')
    return {
      text: `✦ Thriving · Week ${Math.max(1, Math.floor(streak / 7) + 1)}`,
      fg: colors.plum,
      border: 'rgba(196,160,224,0.25)',
    };
  if (s === 'struggling')
    return {
      text: '🌧️ Low energy · needs you',
      fg: colors.terra,
      border: 'rgba(212,144,106,0.2)',
    };
  return {
    text: '🌘 Resting · waiting',
    fg: colors.text3,
    border: 'rgba(100,90,80,0.15)',
  };
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  petBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(14,8,24,0.75)',
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  petBadgeText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 140,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  stateTabs: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
  },
  stateTab: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  stateTabActive: {
    borderColor: 'rgba(196,160,224,0.4)',
    backgroundColor: colors.plumBg,
  },
  stateTabEmoji: { fontSize: 14, marginBottom: 2 },
  stateTabLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 11,
  },
  stateTabLabelActive: { color: colors.plum },

  energyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  energyIcon: { fontSize: 22 },
  energyLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 13,
    marginBottom: 5,
  },
  energyTrack: {
    height: 7,
    backgroundColor: colors.bg2,
    borderRadius: 100,
    overflow: 'hidden',
  },
  energyFill: { height: '100%', borderRadius: 100 },
  energySub: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    marginTop: 4,
  },

  careGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  careBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: 13,
    paddingTop: 13,
    paddingBottom: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
  },
  careBtnDone: {
    borderColor: 'rgba(139,191,150,0.35)',
    backgroundColor: colors.mossBg,
  },
  careEmoji: { fontSize: 20, marginBottom: 4 },
  careLabel: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 10,
  },
  careLabelDone: { color: colors.moss },

  traitCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  traitTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 14,
  },

  advWrap: { marginBottom: 12 },
  advCard: {
    borderColor: colors.border2,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    paddingHorizontal: 18,
  },
  advHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  advTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
  },
  advSub: { fontFamily: fonts.sans, color: colors.text3, fontSize: 12 },
  advTrack: {
    height: 6,
    backgroundColor: colors.bg2,
    borderRadius: 100,
    overflow: 'hidden',
    marginBottom: 7,
  },
  advFill: { height: '100%', borderRadius: 100 },
  advFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  advFooterText: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
  },

  discCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.caramelBg,
    borderColor: colors.caramelBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    paddingHorizontal: 16,
  },
  discTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.caramel,
    fontSize: 13,
    marginBottom: 3,
  },
  discText: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
  },
});

const traitStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 2 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  name: { fontFamily: fonts.sansSemi, color: colors.text, fontSize: 12 },
  pct: { fontFamily: fonts.sans, color: colors.text3, fontSize: 11 },
  track: {
    height: 5,
    backgroundColor: colors.bg2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 2 },
  source: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    marginTop: 2,
  },
});
