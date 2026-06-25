// Paywall — the App Store subscription screen.
//
// Visual spec lives at lumi-paywall.jsx (the user's mock). The screen
// is a navigable surface (not a gate) — users push to it from the
// Profile → Subscription row, from upgrade prompts, and from any
// in-app CTA that wants to convert.
//
// Two purchase paths:
//   • Soft trial (no card needed) — for first-time eligible users.
//     Calls userStore.startTrial() → flips status to 'trial' for 7d.
//   • Real IAP purchase — for users who've already trialed OR want
//     to commit straight away. Calls purchaseTier() → StoreKit sheet
//     → on success the RC listener updates store optimistically.
//
// Restore + Terms + Privacy footer is App-Store-required. Without
// them, App Review rejects the build.

import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Image,
  ScrollView,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { fonts } from '../constants/fonts';
import { timeColors as C } from '../constants/colors';
import { lunaSource } from '../lib/luna-source';
import { useAmbientLunaMood } from '../lib/luna-mood';
import { useSession } from '../lib/auth';
import { useAccessStatus, PRICING } from '../lib/subscription';
import { useUserStore } from '../store/userStore';
import { purchaseTier, restorePurchases } from '../lib/revenuecat';

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

// Reusable check icon (matches the mock's stroke-only style).
const CheckIcon = ({ color, size = 13 }: { color: string; size?: number }) => (
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

export default function Paywall() {
  const router = useRouter();
  const { session } = useSession();
  const access = useAccessStatus(session);
  const petName = useUserStore((s) => s.petName);
  // Read the real safe-area top inset so the close button sits below
  // the Dynamic Island / notch on every device, not at the literal
  // top edge of the screen (where iOS clips it). The SafeAreaView
  // edges only inset its CHILD container; the absolutely-positioned
  // close button needs the value applied directly.
  const insets = useSafeAreaInsets();
  // Honest mood — even on a sales surface. If the user is tired or
  // overwhelmed when they hit the paywall, showing a beaming cat
  // would feel performative. Let Luna reflect their actual state.
  const lunaMood = useAmbientLunaMood();

  const [selected, setSelected] = useState<'annual' | 'monthly'>('annual');
  const [purchasing, setPurchasing] = useState(false);

  // Savings % on the annual first-year vs paying monthly × 12.
  // Used in the "Save N%" pill on the year card.
  const annualSavePct = useMemo(() => {
    const monthlyYearly = PRICING.monthly.amountUSD * 12;
    return Math.round(
      ((monthlyYearly - PRICING.annual.firstYearAmountUSD) / monthlyYearly) *
        100,
    );
  }, []);

  const features = useMemo(
    () => [
      {
        glyph: '✦',
        color: C.ember,
        title: 'Unlimited brain-dumps',
        sub: 'Untangle as much as you need — no daily cap.',
      },
      {
        glyph: '◔',
        color: C.honey,
        title: 'Smart re-planning',
        sub: 'Lumi reshapes your day around your energy.',
      },
      {
        glyph: '❉',
        color: C.lichen,
        title: `${petName}'s full world`,
        sub: 'Every room, companion & skin to unlock.',
      },
      {
        glyph: '◷',
        color: C.dusk,
        title: 'Weekly reflections',
        sub: 'Your patterns, gently surfaced each Sunday.',
      },
      {
        glyph: '☾',
        color: C.amethyst,
        title: 'Custom rhythms & themes',
        sub: 'Anchors, accents and reminders, your way.',
      },
    ],
    [petName],
  );

  const handleClose = () => {
    Haptics.selectionAsync();
    // `router.canGoBack()` can lie when the paywall was opened as a
    // stack root (e.g. deep-link, programmatic replace). Always
    // fall through to `/(tabs)` if back doesn't actually navigate
    // so the user can never get stranded here.
    try {
      if (router.canGoBack()) {
        router.back();
        return;
      }
    } catch {
      // ignore — fall through to the safe replace
    }
    router.replace('/(tabs)');
  };

  // PRIMARY CTA — always triggers the real Apple StoreKit purchase.
  //
  //  Previously this branched on `canStartTrial` and gave free-tier
  //  users a "soft trial" (a 7-day local flag with no Apple receipt)
  //  instead of opening StoreKit. That was the source of the
  //  "subscribe button just sends me to home" bug: users tapped the
  //  primary CTA expecting to pay, but it skipped the Apple sheet
  //  entirely and just bounced them into the app on a fake trial.
  //
  //  The "trial" mechanism for paid plans now lives where it should:
  //  Apple's Introductory Offer on the Annual product ($59.99 for
  //  the first year, then $89.99/yr). StoreKit shows this clearly in
  //  the sheet so the user sees what they're committing to.
  //
  //  The card-less soft trial is still available — but as an
  //  explicit secondary action below, only when the user is eligible.
  const handlePurchase = async () => {
    Haptics.selectionAsync();
    setPurchasing(true);
    const outcome = await purchaseTier(selected);
    setPurchasing(false);
    if (outcome.kind === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Confirm visibly before navigating — otherwise a successful
      // purchase looks identical to a cancelled one (both just close
      // the StoreKit sheet and return to Lumi). The Alert gives the
      // user proof and a clear "continue" gesture.
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
    if (outcome.kind === 'cancelled') return; // silent — they backed out
    if (outcome.kind === 'unavailable') {
      // Map each diagnostic reason to user-facing copy. Helps both
      // the user understand what's wrong AND lets me triage support
      // tickets without guessing.
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
    const outcome = await restorePurchases();
    if (outcome.kind === 'restored') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Welcome back',
        'Your subscription has been restored on this device.',
      );
      router.replace('/(tabs)');
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

  const openLink = (url: string) => () => {
    Haptics.selectionAsync();
    Linking.openURL(url).catch(() => {});
  };

  const selPrice =
    selected === 'annual'
      ? PRICING.annual.firstYearLabel
      : PRICING.monthly.label;
  const selPer = selected === 'annual' ? '/ year' : '/ month';

  // CTA always commits to a real purchase via StoreKit. The label
  // reflects the introductory offer Apple will show in the sheet so
  // the user sees the actual headline before tapping:
  //   • Annual: "$59.99 first year" (Pay-As-You-Go intro), then
  //     renews $89.99/yr
  //   • Monthly: "Start 7 days free" (Free Trial intro), then
  //     $14.99/mo
  // Apple's sheet handles the truth — if the user already used the
  // intro on this Apple ID, the headline shows the base price
  // instead. We just give them the best-case headline up front.
  const ctaLabel =
    selected === 'annual'
      ? `Subscribe — ${PRICING.annual.firstYearLabel} first year`
      : 'Start 7 days free';

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      {/* Top ember-glow gradient (radial-feel via a downward fade). */}
      <LinearGradient
        colors={[hexA(C.ember, 0.18), hexA(C.ember, 0.06), 'rgba(0,0,0,0)']}
        locations={[0, 0.25, 0.55]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero ── */}
          <View style={styles.hero}>
            <View style={styles.lunaWrap}>
              <View style={styles.lunaGlow} />
              <Image
                source={lunaSource(lunaMood)}
                style={styles.luna}
              />
            </View>
            <View style={styles.eyebrow}>
              <Text style={[styles.eyebrowGlyph, { color: C.glow }]}>✦</Text>
              <Text style={[styles.eyebrowText, { color: C.glow }]}>
                LUMI PREMIUM
              </Text>
            </View>
            <Text style={styles.h1}>
              Give your brain{'\n'}all the room it needs.
            </Text>
            <Text style={styles.heroSub}>
              {petName === 'Lumi'
                ? 'Unlock everything Lumi can do — and keep your whole world growing.'
                : `Unlock everything Lumi & ${petName} can do — and keep your whole world growing.`}
            </Text>
          </View>

          {/* ── Features ── */}
          <View style={styles.features}>
            {features.map((f, i) => (
              <View
                key={i}
                style={[
                  styles.feature,
                  i < features.length - 1 && styles.featureBorder,
                ]}
              >
                <View
                  style={[
                    styles.featureIcon,
                    {
                      backgroundColor: hexA(f.color, 0.12),
                      borderColor: hexA(f.color, 0.32),
                    },
                  ]}
                >
                  <Text style={{ color: f.color, fontSize: 16 }}>
                    {f.glyph}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureSub}>{f.sub}</Text>
                </View>
                <CheckIcon color={f.color} />
              </View>
            ))}
          </View>

          {/* ── Plan picker ── */}
          <View style={styles.plans}>
            {(['annual', 'monthly'] as const).map((k) => {
              const on = selected === k;
              const label = k === 'annual' ? 'Yearly' : 'Monthly';
              const price =
                k === 'annual'
                  ? PRICING.annual.firstYearLabel
                  : PRICING.monthly.label;
              const per = k === 'annual' ? '/ year' : '/ month';
              const note =
                k === 'annual'
                  ? `then ${PRICING.annual.renewalLabel}/yr · billed annually`
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
                    styles.plan,
                    on
                      ? { borderColor: C.ember, backgroundColor: C.void2 }
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
                      {label.toUpperCase()}
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

          {/* ── Apple intro-offer hint — varies per plan to mirror
              the actual StoreKit sheet copy. Annual = "$59.99 first
              year, renews $89.99". Monthly = "7 days free, then
              $14.99/mo". ── */}
          <View style={styles.trialLine}>
            <Text style={{ color: C.dusk, fontSize: 12 }}>✦</Text>
            <Text style={styles.trialText}>
              {selected === 'annual' ? (
                <>
                  <Text style={{ color: C.bone, fontWeight: '600' }}>
                    First year ${PRICING.annual.firstYearAmountUSD}
                  </Text>
                  , renews at ${PRICING.annual.renewalAmountUSD}/yr.
                  Cancel anytime in Settings.
                </>
              ) : (
                <>
                  <Text style={{ color: C.bone, fontWeight: '600' }}>
                    7 days free
                  </Text>
                  , then ${PRICING.monthly.amountUSD}/month. Cancel
                  anytime in Settings.
                </>
              )}
            </Text>
          </View>

          {/* ── PRIMARY CTA — always opens StoreKit ── */}
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
              <Text style={styles.ctaText}>{ctaLabel}</Text>
            )}
          </Pressable>
          <Text style={styles.ctaSub}>
            Cancel anytime · Manage in App Store Settings
          </Text>

          {/* ── Apple-required legal footer ── */}
          <View style={styles.legalRow}>
            <Pressable onPress={handleRestore} hitSlop={8}>
              <Text style={styles.legalLink}>Restore</Text>
            </Pressable>
            <View style={styles.legalDot} />
            <Pressable
              onPress={openLink('https://lumi.app/terms')}
              hitSlop={8}
            >
              <Text style={styles.legalLink}>Terms</Text>
            </Pressable>
            <View style={styles.legalDot} />
            <Pressable
              onPress={openLink('https://lumi.app/privacy')}
              hitSlop={8}
            >
              <Text style={styles.legalLink}>Privacy</Text>
            </Pressable>
          </View>
          <Text style={styles.boilerplate}>
            Payment is charged to your Apple ID. Subscription renews
            automatically unless cancelled at least 24 hours before
            the period ends. Manage or cancel in App Store settings.
          </Text>

          {/* Belt-and-suspenders escape — the × at the top can be
              missed on first scroll. A clear "Maybe later" at the
              bottom guarantees the user always has a way back. */}
          <Pressable onPress={handleClose} style={styles.maybeLaterBtn}>
            <Text style={styles.maybeLaterText}>Maybe later</Text>
          </Pressable>
        </ScrollView>

        {/* Close (×) — rendered AFTER the ScrollView so iOS reliably
            routes taps to it instead of swallowing them into the
            scrollable area. zIndex alone isn't enough on iOS. */}
        <Pressable
          onPress={handleClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          // top is the device's safe area top + 6pt cushion so the
          // button always sits just below the Dynamic Island / notch
          // on every iPhone (was a flat top: 10 which clipped under
          // the island on 14 Pro+).
          style={[styles.close, { top: insets.top + 6 }]}
        >
          <Text style={styles.closeGlyph}>×</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  close: {
    position: 'absolute',
    // `top` is applied inline from useSafeAreaInsets so the button
    // dodges the Dynamic Island on every device.
    right: 14,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: hexA(C.bone, 0.18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    color: C.bone,
    fontSize: 24,
    lineHeight: 26,
    marginTop: -2,
    fontWeight: '300',
  },
  maybeLaterBtn: {
    alignSelf: 'center',
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  maybeLaterText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.boneDim,
    textDecorationLine: 'underline',
    textDecorationColor: C.boneDim,
  },
  scroll: {
    paddingHorizontal: 26,
    paddingTop: 6,
    paddingBottom: 32,
  },

  // ── Hero ──
  hero: {
    alignItems: 'center',
    marginTop: 8,
  },
  lunaWrap: {
    position: 'relative',
    width: 92,
    height: 92,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lunaGlow: {
    position: 'absolute',
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: hexA(C.glow, 0.16),
    top: -22,
    left: -22,
  },
  luna: {
    width: 92,
    height: 92,
  },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: hexA(C.glow, 0.12),
    borderWidth: 1,
    borderColor: hexA(C.glow, 0.4),
    marginBottom: 14,
  },
  eyebrowGlyph: { fontSize: 11 },
  eyebrowText: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 2,
    fontWeight: '700',
  },
  h1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 32,
    color: C.bone,
    letterSpacing: -0.8,
    lineHeight: 38,
    textAlign: 'center',
    paddingTop: 6,
  },
  heroSub: {
    fontFamily: fonts.inter,
    color: C.boneDim,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 13,
    textAlign: 'center',
    maxWidth: 300,
  },

  // ── Features ──
  features: {
    marginTop: 26,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  featureBorder: {
    borderBottomWidth: 1,
    borderBottomColor: hexA(C.hair, 0.6),
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontFamily: fonts.interSemi,
    color: C.bone,
    fontSize: 15,
    letterSpacing: -0.2,
  },
  featureSub: {
    fontFamily: fonts.inter,
    color: C.mute,
    fontSize: 12.5,
    marginTop: 2,
    lineHeight: 17,
  },

  // ── Plans ──
  plans: {
    flexDirection: 'row',
    gap: 11,
    marginTop: 28,
  },
  plan: {
    flex: 1,
    position: 'relative',
    borderRadius: 17,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 15,
  },
  savePill: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    backgroundColor: C.glow,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  savePillText: {
    fontFamily: fonts.interSemi,
    color: C.void,
    fontSize: 9.5,
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  planTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  planLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    letterSpacing: 0.4,
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
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
  },

  // ── Trial line ──
  trialLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
  },
  trialText: {
    fontFamily: fonts.inter,
    color: C.boneDim,
    fontSize: 12.5,
  },

  // ── CTA ──
  cta: {
    marginTop: 14,
    width: '100%',
    backgroundColor: C.ember,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: C.ember,
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  ctaText: {
    fontFamily: fonts.interSemi,
    color: C.void,
    fontSize: 16,
    letterSpacing: 0.2,
    fontWeight: '700',
  },
  ctaSub: {
    fontFamily: fonts.inter,
    color: C.mute,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 11,
  },
  // ── Legal ──
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: hexA(C.hair, 0.6),
  },
  legalLink: {
    fontFamily: fonts.interSemi,
    color: C.boneDim,
    fontSize: 12,
  },
  legalDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.hair,
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
});
