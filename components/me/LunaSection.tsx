import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LunaCanvas } from '../LunaCanvas';
import { TraitBar } from '../TraitBar';
import { Pill } from '../Pill';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { usePetStore } from '../../store/petStore';
import { useUserStore } from '../../store/userStore';
import { useSession, signOut } from '../../lib/auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  useQuestStore,
  selectCompletedToday,
} from '../../store/questStore';
import {
  useCheckinStore,
  selectTodayMood,
} from '../../store/checkinStore';
import { lunaState } from '../../lib/gamification';
import { items as ALL_ITEMS } from '../../constants/items';

export const LunaSection = () => {
  const router = useRouter();
  const petName = useUserStore((s) => s.petName);
  const streak = useUserStore((s) => s.streak);
  const lastActiveDate = useUserStore((s) => s.lastActiveDate);
  const offlineMode = useUserStore((s) => s.offlineMode);
  const setOfflineMode = useUserStore((s) => s.setOfflineMode);
  const { session } = useSession();
  const quests = useQuestStore((s) => s.quests);
  const checkins = useCheckinStore((s) => s.checkins);
  const completedToday = useMemo(
    () => selectCompletedToday(quests),
    [quests],
  );
  const todayMood = useMemo(() => selectTodayMood(checkins), [checkins]);

  const traits = usePetStore((s) => s.traits);
  const adventure = usePetStore((s) => s.adventure);
  const startAdventure = usePetStore((s) => s.startAdventure);
  const collectAdventure = usePetStore((s) => s.collectAdventure);
  const care = usePetStore((s) => s.care);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000 * 15);
    return () => clearInterval(id);
  }, []);

  const daysSince = lastActiveDate
    ? Math.floor(
        (Date.now() - new Date(lastActiveDate + 'T00:00:00').getTime()) /
          86400000,
      )
    : 99;

  const state = lunaState({
    questsCompletedToday: completedToday,
    dailyQuestTarget: 3,
    streak,
    checkedInToday: !!todayMood,
    lastActiveDaysAgo: daysSince,
  });

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

  const handleSignIn = () => {
    Haptics.selectionAsync();
    setOfflineMode(false);
    router.push('/auth/sign-in');
  };

  const handleSignOut = async () => {
    Haptics.selectionAsync();
    await signOut();
    Alert.alert('Signed out', 'Your local data stays on this device.');
  };

  const adventureReady =
    adventure && new Date(adventure.endsAt).getTime() <= now;

  return (
    <View>
      <View style={styles.stateRow}>
        <Pill
          tone={
            state === 'thriving' ? 'moss' : state === 'struggling' ? 'caramel' : 'fog'
          }
        >
          {state === 'thriving'
            ? `${petName} is thriving`
            : state === 'struggling'
              ? `${petName} is holding on`
              : `${petName} is resting`}
        </Pill>
      </View>

      <LunaCanvas state={state} size={340} />

      <View style={{ height: 18 }} />
      <Text style={styles.label}>Care actions</Text>
      <View style={styles.careRow}>
        {[
          { k: 'checkin', label: 'Check-in', tone: colors.plum },
          { k: 'meds', label: 'Meds', tone: colors.moss },
          { k: 'move', label: 'Move', tone: colors.terra },
          { k: 'windDown', label: 'Wind-down', tone: colors.mist },
        ].map((b) => (
          <Pressable
            key={b.k}
            onPress={() => handleCare(b.k as 'checkin')}
            style={[styles.careBtn, { borderColor: b.tone }]}
          >
            <Text style={[styles.careText, { color: b.tone }]}>{b.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ height: 22 }} />
      <Text style={styles.label}>Traits</Text>
      <TraitBar
        label="Presence"
        value={traits.presence}
        tone="plum"
        note="Grows with check-ins"
      />
      <TraitBar
        label="Groundedness"
        value={traits.groundedness}
        tone="moss"
        note="Grows when meds and food align"
      />
      <TraitBar
        label="Momentum"
        value={traits.momentum}
        tone="terra"
        note="Grows with completed quests"
      />
      <TraitBar
        label="Curiosity"
        value={traits.curiosity}
        tone="caramel"
        note="Grows when you wind down well"
      />

      <View style={{ height: 16 }} />
      <Text style={styles.label}>Adventure</Text>
      <Pressable onPress={handleAdventure} style={styles.adv}>
        <Text style={styles.advTitle}>
          {!adventure
            ? `Send ${petName} out`
            : adventureReady
              ? `${petName} is back`
              : `${petName} is exploring…`}
        </Text>
        <Text style={styles.advSub}>
          {!adventure
            ? 'She comes back with a found object'
            : adventureReady
              ? 'Tap to collect'
              : `Back at ${new Date(adventure.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
        </Text>
      </Pressable>

      {isSupabaseConfigured && (
        <>
          <View style={{ height: 22 }} />
          <Text style={styles.label}>Account</Text>
          {session ? (
            <View style={styles.account}>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {session.user.email ?? 'signed in'}
              </Text>
              <Pressable onPress={handleSignOut} style={styles.signOut}>
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={handleSignIn} style={styles.signIn}>
              <Text style={styles.signInText}>
                {offlineMode ? 'Sign in to sync across devices' : 'Sign in'}
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  stateRow: { marginBottom: 12, alignItems: 'center' },
  label: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  careRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  careBtn: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
  },
  careText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  adv: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 16,
  },
  advTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
    marginBottom: 4,
  },
  advSub: { fontFamily: fonts.sans, color: colors.text3, fontSize: 12 },
  account: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  accountEmail: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  signOut: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  signOutText: {
    fontFamily: fonts.sansMedium,
    color: colors.text2,
    fontSize: 12,
  },
  signIn: {
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    alignItems: 'center',
  },
  signInText: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 13,
  },
});
