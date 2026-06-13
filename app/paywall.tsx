import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../components/Screen';
import { Pill } from '../components/Pill';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { useSession, signOut } from '../lib/auth';
import { useAccessStatus } from '../lib/subscription';
import { useUserStore } from '../store/userStore';

type Tier = 'monthly' | 'annual';

const TIERS: { id: Tier; label: string; price: string; sub: string; save?: string }[] = [
  {
    id: 'annual',
    label: 'Annual',
    price: '$49',
    sub: 'per year · $4.08/mo',
    save: 'Save 41%',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    price: '$6.99',
    sub: 'per month',
  },
];

const BENEFITS = [
  { icon: '◐', text: 'Daily quests + XP, all unlocked' },
  { icon: '♡', text: 'Unlimited AI check-ins' },
  { icon: '◷', text: 'Time visualization + transition warnings' },
  { icon: '✦', text: 'SOS modes for RSD + dissociation' },
  { icon: '◉', text: 'Luna grows with you — across devices' },
];

export default function Paywall() {
  const router = useRouter();
  const { session } = useSession();
  const access = useAccessStatus(session);
  const petName = useUserStore((s) => s.petName);

  const [selected, setSelected] = useState<Tier>('annual');
  const [purchasing, setPurchasing] = useState(false);

  const headerLine = access.inTrial
    ? `${access.trialDaysLeft} days left in your trial`
    : 'Your trial ended';

  const handlePurchase = async () => {
    Haptics.selectionAsync();
    setPurchasing(true);
    // Real IAP lands in Lumi-1005 (RevenueCat). For now we just stub.
    setTimeout(() => {
      setPurchasing(false);
      Alert.alert(
        'Coming soon',
        'In-app purchases land in the next update. For now you can keep using your trial.',
      );
    }, 600);
  };

  const handleRestore = () => {
    Haptics.selectionAsync();
    Alert.alert(
      'Nothing to restore',
      'Real purchases will be restorable once IAP is live.',
    );
  };

  const handleSignOut = async () => {
    Haptics.selectionAsync();
    await signOut();
    router.replace('/auth/sign-in');
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pill tone={access.inTrial ? 'caramel' : 'rose'}>{headerLine}</Pill>
        <Text style={styles.h1}>
          Keep <Text style={styles.italic}>{petName}</Text> with you.
        </Text>
        <Text style={styles.sub}>
          {access.inTrial
            ? 'Lock in your access before the trial ends. Cancel anytime.'
            : "It's been good having you. Pick a plan to keep going."}
        </Text>
      </View>

      <View style={styles.benefits}>
        {BENEFITS.map((b) => (
          <View key={b.text} style={styles.benefitRow}>
            <Text style={styles.benefitIcon}>{b.icon}</Text>
            <Text style={styles.benefitText}>{b.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.tiers}>
        {TIERS.map((t) => {
          const sel = selected === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => {
                Haptics.selectionAsync();
                setSelected(t.id);
              }}
              style={[styles.tier, sel && styles.tierSel]}
            >
              <View style={styles.tierTop}>
                <Text style={[styles.tierLabel, sel && { color: colors.plum }]}>
                  {t.label}
                </Text>
                {t.save && (
                  <View style={styles.savePill}>
                    <Text style={styles.savePillText}>{t.save}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.tierPrice}>{t.price}</Text>
              <Text style={styles.tierSub}>{t.sub}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={handlePurchase}
        disabled={purchasing}
        style={[styles.cta, purchasing && { opacity: 0.5 }]}
      >
        <Text style={styles.ctaText}>
          {access.inTrial
            ? `Continue with ${selected === 'annual' ? 'Annual' : 'Monthly'}`
            : `Subscribe — ${selected === 'annual' ? '$49 / year' : '$6.99 / month'}`}
        </Text>
      </Pressable>

      <View style={styles.footerLinks}>
        <Pressable onPress={handleRestore}>
          <Text style={styles.linkText}>Restore purchase</Text>
        </Pressable>
        <Text style={styles.linkDot}>·</Text>
        <Pressable onPress={handleSignOut}>
          <Text style={styles.linkText}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.fine}>
        Cancel anytime. No charge until your trial ends.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: 12, marginBottom: 18, gap: 10, alignItems: 'flex-start' },
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    marginTop: 2,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.cream },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
  },
  benefits: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 16,
    gap: 11,
    marginBottom: 18,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: {
    color: colors.plum,
    fontSize: 16,
    width: 18,
    textAlign: 'center',
  },
  benefitText: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  tiers: { gap: 10, marginBottom: 18 },
  tier: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: 15,
    padding: 16,
  },
  tierSel: {
    borderColor: colors.plum,
    backgroundColor: colors.plumBg,
  },
  tierTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  tierLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text,
    fontSize: 14,
  },
  savePill: {
    backgroundColor: colors.mossBg,
    borderColor: colors.mossBorder,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
  },
  savePillText: {
    fontFamily: fonts.sansSemi,
    color: colors.moss,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  tierPrice: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 28,
    lineHeight: 32,
  },
  tierSub: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 12,
    marginTop: 2,
  },
  cta: {
    backgroundColor: colors.plumDark,
    paddingVertical: 16,
    borderRadius: 100,
    alignItems: 'center',
  },
  ctaText: { fontFamily: fonts.sansSemi, color: '#fff', fontSize: 14 },
  footerLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  linkText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 12,
  },
  linkDot: { color: colors.text3, fontSize: 12 },
  fine: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 14,
  },
});
