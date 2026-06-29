import { Pressable, Text, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { useSession } from '../lib/auth';
import { useAccessStatus } from '../lib/subscription';

export const TrialBanner = () => {
  const router = useRouter();
  const { session } = useSession();
  const access = useAccessStatus(session);

  // Free-first model: the banner exists ONLY to surface the
  // remaining days of an active opt-in trial. Free users see
  // nothing here (no nagging); active subscribers see nothing
  // either. The upgrade-conversation surface is the cap-hit
  // sheet, not a persistent banner.
  if (!session) return null;
  if (!access.inTrial) return null;

  const onTap = () => {
    Haptics.selectionAsync();
    router.push('/paywall');
  };

  const days = access.trialDaysLeft;
  const accent = days <= 2 ? colors.terra : colors.caramel;
  const bg = days <= 2 ? colors.terraBg : colors.caramelBg;
  const border = days <= 2 ? colors.terraBorder : colors.caramelBorder;

  return (
    <Pressable
      onPress={onTap}
      style={[styles.bar, { backgroundColor: bg, borderColor: border }]}
    >
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <Text style={styles.text}>
        <Text style={[styles.strong, { color: accent }]}>
          {`${days} ${days === 1 ? 'day' : 'days'} left in trial`}
        </Text>
        <Text style={styles.dim}>{'  ·  See plans'}</Text>
      </Text>
      <Text style={[styles.arrow, { color: accent }]}>→</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  dot: { width: 6, height: 6, borderRadius: 100 },
  text: { flex: 1, fontFamily: fonts.sansMedium, fontSize: 13 },
  strong: { fontFamily: fonts.sansSemi, fontSize: 13 },
  dim: { color: colors.text3, fontFamily: fonts.sans, fontSize: 12 },
  arrow: { fontFamily: fonts.sansSemi, fontSize: 14 },
});
