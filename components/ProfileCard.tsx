import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { LunaPixel } from './auth/LunaPixel';
import { useUserStore } from '../store/userStore';
import { useSession } from '../lib/auth';
import { useAccessStatus } from '../lib/subscription';

/**
 * The big tappable Profile entry-point that lives on the Home tab.
 * Pairs with the gear icon — same destination, but visible enough that
 * the user can't miss it.
 */
export const ProfileCard = () => {
  const router = useRouter();
  const name = useUserStore((s) => s.name);
  const { session } = useSession();
  const access = useAccessStatus(session);

  const email = session?.user.email;

  const badge = access.hasActiveSubscription
    ? { label: 'Subscribed', tone: colors.moss, bg: colors.mossBg, border: colors.mossBorder }
    : access.inTrial
      ? {
          label: `${access.trialDaysLeft}d trial left`,
          tone: colors.caramel,
          bg: colors.caramelBg,
          border: colors.caramelBorder,
        }
      : { label: 'Trial ended', tone: colors.rose, bg: colors.roseBg, border: colors.roseBorder };

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        router.push('/profile');
      }}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.avatar}>
        <LunaPixel mood="happy" size={44} />
      </View>
      <View style={styles.meta}>
        <Text style={styles.name}>{name || 'Your profile'}</Text>
        <Text style={styles.email} numberOfLines={1}>
          {email ?? 'Sign in to sync across devices'}
        </Text>
        <View
          style={[
            styles.pill,
            { backgroundColor: badge.bg, borderColor: badge.border },
          ]}
        >
          <Text style={[styles.pillText, { color: badge.tone }]}>
            ✦ {badge.label}
          </Text>
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 13,
    marginBottom: 14,
  },
  cardPressed: { backgroundColor: colors.card },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  meta: { flex: 1, gap: 2 },
  name: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
  },
  email: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 12,
  },
  pill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 2,
    marginTop: 4,
  },
  pillText: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  chevron: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 26,
    lineHeight: 26,
    paddingHorizontal: 4,
  },
});
