// Manage subscription — the "Subscription" page reached from Profile.
//
// Visual ported from lumi-subscription.jsx (the design composer
// mockup). For free / trial users this IS the upgrade flow:
// status card → Free-vs-Pro comparison table → plan toggle →
// Upgrade CTA (opens StoreKit directly via purchaseTier). Active
// subscribers see a "Manage in App Store Settings" link in place
// of the plan picker — per Apple + Google policy, cancellation
// has to happen in the platform's own UI, not ours.
//
// All RC plumbing (purchaseTier, restorePurchases, openManage-
// Subscription, outcome dispatch + error UX) is preserved from
// the prior implementation.

import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { fonts } from '../constants/fonts';
import { useUserStore } from '../store/userStore';
import { useSession } from '../lib/auth';
import { useAccessStatus, PRICING } from '../lib/subscription';
import { lunaSource } from '../lib/luna-source';
import {
  purchaseTier,
  restorePurchases,
  openManageSubscription,
} from '../lib/revenuecat';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  hair: '#2A2420',
  lichen: '#869072',
  honey: '#C9A06A',
  ember: '#E07A4F',
  emberLt: '#E0A488',
  glow: '#F4C98A',
  dusk: '#8EA0B4',
  ash: '#5A5650',
} as const;

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const CheckIcon = ({ color, size = 11 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M5 12.5l4.5 4.5L19 6.5"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);

const COMPARE_ROWS = [
  { label: 'Daily brain-dumps', free: '3 / day', pro: 'Unlimited' },
  { label: 'AI sorting & re-plan', free: 'Basic', pro: 'Smart' },
  { label: 'Weekly reflection', free: 'Snippet', pro: 'Full story' },
  { label: 'Calendar sync', free: '1 calendar', pro: 'Multi-cal' },
  { label: "Luna's worlds & skins", free: 'Starter', pro: 'All' },
];

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { session } = useSession();
  const access = useAccessStatus(session);
  const tier = useUserStore((s) => s.subscriptionTier);
  const periodEnd = useUserStore((s) => s.subscriptionCurrentPeriodEnd);

  const [selected, setSelected] = useState<'annual' | 'monthly'>('annual');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const annualSavePct = useMemo(() => {
    const monthlyYearly = PRICING.monthly.amountUSD * 12;
    return Math.round(
      ((monthlyYearly - PRICING.annual.firstYearAmountUSD) / monthlyYearly) *
        100,
    );
  }, []);

  const handleBack = () => {
    Haptics.selectionAsync();
    try {
      if (router.canGoBack()) {
        router.back();
        return;
      }
    } catch {
      // fall through
    }
    router.replace('/(tabs)');
  };

  const handlePurchase = async () => {
    Haptics.selectionAsync();
    setPurchasing(true);
    const outcome = await purchaseTier(selected);
    setPurchasing(false);
    if (outcome.kind === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'You’re on Pro 💛',
        outcome.tier === 'annual'
          ? `Welcome to Lumi Annual — your first year is $${PRICING.annual.firstYearAmountUSD}. Cancel anytime in Settings.`
          : `Welcome to Lumi Monthly — $${PRICING.monthly.amountUSD}/month. Cancel anytime in Settings.`,
        [{ text: 'Open Lumi', onPress: () => router.replace('/(tabs)') }],
        { cancelable: false },
      );
      return;
    }
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'unavailable') {
      const msg =
        outcome.reason === 'no-sdk'
          ? 'In-app purchases need the App Store build. If you’re testing in Expo Go or a dev preview, install via TestFlight instead.'
          : outcome.reason === 'no-config'
            ? 'The store isn’t set up in this build. Please update Lumi to the latest TestFlight version, then try again.'
            : outcome.reason === 'no-offering'
              ? 'Pro isn’t available right now — the store is still propagating. Wait a few minutes and try again, or restore a purchase you already made.'
              : 'The selected plan isn’t available right now. Try the other plan, or restore a purchase you already made.';
      Alert.alert('Purchases unavailable', msg);
      return;
    }
    Alert.alert('Purchase failed', outcome.message);
  };

  const handleRestore = async () => {
    Haptics.selectionAsync();
    setRestoring(true);
    const outcome = await restorePurchases();
    setRestoring(false);
    if (outcome.kind === 'restored') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Welcome back',
        'Your subscription has been restored on this device.',
      );
      return;
    }
    if (outcome.kind === 'nothing') {
      Alert.alert(
        'Nothing to restore',
        "We didn't find an active subscription tied to this device.",
      );
      return;
    }
    if (outcome.kind === 'unavailable') {
      Alert.alert(
        'Purchases unavailable',
        outcome.reason === 'no-sdk'
          ? 'In-app purchases need the App Store build. Try the TestFlight version.'
          : 'The store isn’t set up in this build. Please update to the latest version, then try again.',
      );
      return;
    }
    Alert.alert('Restore failed', outcome.message);
  };

  const handleManage = async () => {
    Haptics.selectionAsync();
    try {
      await openManageSubscription();
    } catch {
      Alert.alert(
        "Couldn't open settings",
        'You can manage your subscription from the App Store or Play Store settings.',
      );
    }
  };

  const openLink = (url: string) => () => {
    Haptics.selectionAsync();
    Linking.openURL(url).catch(() => {});
  };

  const ctaLabel =
    selected === 'annual'
      ? `Upgrade to Pro · ${PRICING.annual.firstYearLabel} / year`
      : `Upgrade to Pro · ${PRICING.monthly.label} / month`;

  const statusContent = (() => {
    if (access.hasActiveSubscription) {
      return {
        pill: 'PRO',
        pillColor: C.ember,
        headline: 'You’re on Pro.',
        body: `${tier === 'annual' ? 'Annual' : 'Monthly'} plan · renews ${fmtDate(periodEnd)}.`,
      };
    }
    if (access.inTrial) {
      return {
        pill: `TRIAL · ${access.trialDaysLeft}D LEFT`,
        pillColor: C.glow,
        headline: 'Enjoy your taste of Pro.',
        body: 'Pick a plan below to keep everything when the trial ends.',
      };
    }
    return {
      pill: 'FREE PLAN',
      pillColor: C.boneDim,
      headline: 'Free Lumi, always.',
      body: 'The baseline is yours forever — capture, plan, and Luna’s company. No pressure to ever pay.',
    };
  })();

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={[hexA(C.ember, 0.12), 'rgba(0,0,0,0)']}
        locations={[0, 0.42]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={styles.headerBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.headerBackGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Subscription</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statusCard}>
            <Image source={lunaSource('idle')} style={styles.statusLuna} />
            <View
              style={[
                styles.statusPill,
                { borderColor: hexA(statusContent.pillColor, 0.4) },
              ]}
            >
              <View
                style={[
                  styles.statusPillDot,
                  { backgroundColor: statusContent.pillColor },
                ]}
              />
              <Text
                style={[
                  styles.statusPillText,
                  { color: statusContent.pillColor },
                ]}
              >
                {statusContent.pill}
              </Text>
            </View>
            <Text style={styles.statusHeadline}>{statusContent.headline}</Text>
            <Text style={styles.statusBody}>{statusContent.body}</Text>
          </View>

          {!access.hasActiveSubscription && (
            <>
              <View style={styles.eyebrowRow}>
                <Text style={[styles.eyebrowGlyph, { color: C.ember }]}>✦</Text>
                <Text style={styles.eyebrowText}>What Pro adds</Text>
              </View>

              <View style={styles.table}>
                <View style={styles.tableHead}>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.tableHeadFreeCell}>Free</Text>
                  <Text style={styles.tableHeadProCell}>Pro</Text>
                </View>
                {COMPARE_ROWS.map((r, i) => (
                  <View
                    key={r.label}
                    style={[
                      styles.tableRow,
                      i < COMPARE_ROWS.length - 1 && styles.tableRowBorder,
                    ]}
                  >
                    <Text style={styles.tableRowLabel}>{r.label}</Text>
                    <Text style={styles.tableFreeCell}>{r.free}</Text>
                    <Text style={styles.tableProCell}>{r.pro}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.plansRow}>
                {(['annual', 'monthly'] as const).map((k) => {
                  const on = selected === k;
                  const label = k === 'annual' ? 'Yearly' : 'Monthly';
                  const price =
                    k === 'annual'
                      ? PRICING.annual.firstYearLabel
                      : PRICING.monthly.label;
                  const per = k === 'annual' ? '/yr' : '/mo';
                  const note =
                    k === 'annual'
                      ? `then ${PRICING.annual.renewalLabel}/yr · billed yearly`
                      : 'billed monthly';
                  const save =
                    k === 'annual' && annualSavePct > 0
                      ? `Save ${annualSavePct}%`
                      : null;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelected(k);
                      }}
                      style={[
                        styles.planCard,
                        on
                          ? {
                              borderColor: C.ember,
                              backgroundColor: hexA(C.ember, 0.1),
                            }
                          : { borderColor: C.hair, backgroundColor: C.void2 },
                      ]}
                    >
                      {save && (
                        <View style={styles.savePill}>
                          <Text style={styles.savePillText}>{save}</Text>
                        </View>
                      )}
                      <View style={styles.planTop}>
                        <Text
                          style={[
                            styles.planLabel,
                            { color: on ? C.bone : C.boneDim },
                          ]}
                        >
                          {label}
                        </Text>
                        <View
                          style={[
                            styles.planRadio,
                            on
                              ? { borderColor: C.ember, backgroundColor: C.ember }
                              : { borderColor: C.ash },
                          ]}
                        >
                          {on && <CheckIcon color={C.void} size={11} />}
                        </View>
                      </View>
                      <View style={styles.planPriceRow}>
                        <Text
                          style={[
                            styles.planPrice,
                            { color: on ? C.bone : C.boneDim },
                          ]}
                        >
                          {price}
                        </Text>
                        <Text style={styles.planPer}>{per}</Text>
                      </View>
                      <Text style={styles.planNote}>{note}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={handlePurchase}
                disabled={purchasing}
                style={[styles.cta, purchasing && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={ctaLabel}
              >
                {purchasing ? (
                  <ActivityIndicator color={C.void} />
                ) : (
                  <>
                    <Text style={styles.ctaGlyph}>✦</Text>
                    <Text style={styles.ctaText}>{ctaLabel}</Text>
                  </>
                )}
              </Pressable>
              <Text style={styles.ctaDisclaimer}>
                {selected === 'annual'
                  ? `${PRICING.annual.firstYearLabel} first year, renews at ${PRICING.annual.renewalLabel}/yr. Cancel anytime — your free plan never expires.`
                  : `7-day free trial, then ${PRICING.monthly.label}/mo. Cancel anytime — your free plan never expires.`}
              </Text>
            </>
          )}

          {access.hasActiveSubscription && (
            <Pressable onPress={handleManage} style={styles.manageBtn}>
              <Text style={styles.manageBtnText}>Manage or cancel →</Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleRestore}
            disabled={restoring}
            style={[styles.restoreRow, restoring && { opacity: 0.5 }]}
            hitSlop={8}
          >
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Path
                d="M3.5 9a9 9 0 1 1-1 5"
                stroke={C.mute}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <Path
                d="M3 4v5h5"
                stroke={C.mute}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
            {restoring ? (
              <ActivityIndicator size="small" color={C.boneDim} />
            ) : (
              <Text style={styles.restoreText}>Restore purchase</Text>
            )}
          </Pressable>

          <View style={styles.legalRow}>
            <Pressable onPress={openLink('https://lumi.app/terms')} hitSlop={8}>
              <Text style={styles.legalLink}>Terms</Text>
            </Pressable>
            <Pressable
              onPress={openLink('https://lumi.app/privacy')}
              hitSlop={8}
            >
              <Text style={styles.legalLink}>Privacy</Text>
            </Pressable>
          </View>

          {!access.hasActiveSubscription && (
            <Text style={styles.boilerplate}>
              Payment is charged to your Apple ID. Subscription renews
              automatically unless cancelled at least 24 hours before
              the period ends. Manage or cancel in App Store settings.
            </Text>
          )}

          {access.hasActiveSubscription && (
            <Text style={styles.reassure}>
              Cancel anytime — you keep Pro until {fmtDate(periodEnd)}.
              Lumi never disappears mid-cycle.
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 10,
    height: 48,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackGlyph: {
    fontSize: 26,
    color: C.boneDim,
    lineHeight: 28,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.interSemi,
    fontSize: 16,
    color: C.bone,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  headerSpacer: { width: 32 },

  scroll: {
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 60,
  },

  statusCard: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    marginBottom: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  statusLuna: {
    position: 'absolute',
    bottom: -8,
    right: 6,
    width: 88,
    height: 88,
    opacity: 0.95,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 11,
    borderRadius: 100,
    backgroundColor: hexA(C.bone, 0.08),
    borderWidth: 1,
    marginBottom: 14,
  },
  statusPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  statusHeadline: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 26,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 30,
    marginBottom: 8,
    maxWidth: 240,
  },
  statusBody: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    lineHeight: 19,
    maxWidth: 230,
  },

  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  eyebrowGlyph: { fontSize: 13 },
  eyebrowText: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    letterSpacing: 2,
    color: C.ember,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  table: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: C.void2,
    overflow: 'hidden',
    marginBottom: 24,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.hair,
    backgroundColor: hexA(C.surface, 0.5),
  },
  tableHeadFreeCell: {
    width: 74,
    textAlign: 'center',
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1,
    color: C.mute,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tableHeadProCell: {
    width: 84,
    textAlign: 'center',
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1,
    color: C.ember,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: hexA(C.hair, 0.6),
  },
  tableRowLabel: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.bone,
    letterSpacing: -0.1,
  },
  tableFreeCell: {
    width: 74,
    textAlign: 'center',
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
  },
  tableProCell: {
    width: 84,
    textAlign: 'center',
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    color: C.emberLt,
    fontWeight: '600',
  },

  plansRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    marginTop: 4,
  },
  planCard: {
    flex: 1,
    position: 'relative',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 15,
  },
  savePill: {
    position: 'absolute',
    top: -9,
    right: 12,
    backgroundColor: C.glow,
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  savePillText: {
    fontFamily: fonts.interSemi,
    color: C.void,
    fontSize: 9.5,
    letterSpacing: 0.5,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  planTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  planLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    fontWeight: '600',
  },
  planRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  planPrice: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 26,
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  planPer: {
    fontFamily: fonts.inter,
    color: C.mute,
    fontSize: 12,
  },
  planNote: {
    fontFamily: fonts.inter,
    color: C.mute,
    fontSize: 10.5,
    marginTop: 3,
    lineHeight: 14,
  },

  cta: {
    width: '100%',
    backgroundColor: C.ember,
    borderRadius: 15,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: C.ember,
    shadowOpacity: 0.3,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  ctaGlyph: {
    color: C.void,
    fontSize: 14,
    fontWeight: '700',
  },
  ctaText: {
    fontFamily: fonts.interSemi,
    color: C.void,
    fontSize: 15,
    letterSpacing: 0.1,
    fontWeight: '600',
  },
  ctaDisclaimer: {
    textAlign: 'center',
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    marginTop: 12,
    marginBottom: 22,
    lineHeight: 17,
    paddingHorizontal: 4,
  },

  manageBtn: {
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.4),
    backgroundColor: hexA(C.ember, 0.08),
    marginBottom: 18,
  },
  manageBtnText: {
    fontFamily: fonts.interSemi,
    color: C.ember,
    fontSize: 13,
  },

  restoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  restoreText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.boneDim,
    fontWeight: '500',
  },

  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    marginTop: 6,
  },
  legalLink: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  boilerplate: {
    fontFamily: fonts.inter,
    color: C.ash,
    fontSize: 10.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 6,
  },
  reassure: {
    fontFamily: fonts.inter,
    color: C.mute,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
  },
});
