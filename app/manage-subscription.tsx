// Manage subscription — where users see their current plan state
// and (per Apple + Google policy) hand off to the platform's own
// subscription manager to cancel / change tier. Restore lives here
// too so a user who logs in on a new device can pull their entitlement
// back without going through the paywall.
//
// What we DO render: current state (Free / Trial / Pro), tier (annual
// or monthly), renewal date when paid, restore button, system manage
// link, plus a one-liner about how cancellation works ("you keep Pro
// until the period ends — Lumi never disappears mid-cycle").
//
// What we DO NOT render: an in-app cancel button. Apple + Google
// require cancellation go through their UI. Linking to it satisfies
// the requirement and keeps us out of dark-pattern territory.

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fonts } from '../constants/fonts';
import { useUserStore } from '../store/userStore';
import { useSession } from '../lib/auth';
import { useAccessStatus } from '../lib/subscription';
import {
  openManageSubscription,
  restorePurchases,
} from '../lib/revenuecat';

// Palette mirrors profile.tsx / insights.tsx
const C = {
  void: '#120E0C',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  hair: '#2A2420',
  lichen: '#869072',
  honey: '#C9A06A',
  ember: '#E07A4F',
} as const;

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

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { session } = useSession();
  const access = useAccessStatus(session);
  const tier = useUserStore((s) => s.subscriptionTier);
  const periodEnd = useUserStore((s) => s.subscriptionCurrentPeriodEnd);

  const [restoring, setRestoring] = useState(false);

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

  const stateLabel = access.inTrial
    ? 'Trial'
    : access.hasActiveSubscription
      ? 'Pro'
      : 'Free';

  const stateAccent = access.inTrial
    ? C.honey
    : access.hasActiveSubscription
      ? C.lichen
      : C.boneDim;

  const subtitle = access.inTrial
    ? `${access.trialDaysLeft} day${access.trialDaysLeft === 1 ? '' : 's'} left in your trial`
    : access.hasActiveSubscription
      ? `${tier === 'annual' ? 'Annual' : 'Monthly'} plan · renews ${fmtDate(periodEnd)}`
      : 'You’re on the always-free baseline. Try Pro any time.';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => {
            // Same canGoBack guard as the paywall — never strand the
            // user on this screen if the stack is empty.
            try {
              if (router.canGoBack()) {
                router.back();
                return;
              }
            } catch {
              // fall through
            }
            router.replace('/(tabs)');
          }}
          hitSlop={20}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>Subscription</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 18, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stateCard}>
          <View
            style={[
              styles.statePill,
              {
                backgroundColor: stateAccent + '22',
                borderColor: stateAccent + '55',
              },
            ]}
          >
            <Text style={[styles.statePillText, { color: stateAccent }]}>
              {stateLabel.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.stateTitle}>
            {access.hasActiveSubscription
              ? 'You’re on Pro.'
              : access.inTrial
                ? 'Pro is yours for a few more days.'
                : 'Free Lumi, always.'}
          </Text>
          <Text style={styles.stateSub}>{subtitle}</Text>
        </View>

        {/* Actions */}
        <View style={styles.group}>
          {!access.hasActiveSubscription && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.push('/paywall');
              }}
              style={[styles.row, styles.rowFirst]}
            >
              <Text style={styles.rowIcon}>✦</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>
                  {access.inTrial ? 'Lock in your plan' : 'Upgrade to Pro'}
                </Text>
                <Text style={styles.rowSub}>
                  {access.inTrial
                    ? 'Pick a plan before your trial ends.'
                    : 'Unlimited AI sorting + full weekly recap.'}
                </Text>
              </View>
              <Text style={styles.rowChevron}>›</Text>
            </Pressable>
          )}

          {access.hasActiveSubscription && (
            <Pressable
              onPress={handleManage}
              style={[styles.row, styles.rowFirst]}
            >
              <Text style={styles.rowIcon}>◐</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Manage or cancel</Text>
                <Text style={styles.rowSub}>
                  Opens your App Store / Play Store subscriptions.
                </Text>
              </View>
              <Text style={styles.rowChevron}>›</Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleRestore}
            disabled={restoring}
            style={[styles.row, restoring && { opacity: 0.5 }]}
          >
            <Text style={styles.rowIcon}>↺</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Restore purchase</Text>
              <Text style={styles.rowSub}>
                Pull a subscription you bought on another device.
              </Text>
            </View>
            {restoring ? (
              <ActivityIndicator size="small" color={C.boneDim} />
            ) : (
              <Text style={styles.rowChevron}>›</Text>
            )}
          </Pressable>
        </View>

        {access.hasActiveSubscription && (
          <Text style={styles.reassure}>
            Cancel anytime — you keep Pro until {fmtDate(periodEnd)}.
            Lumi never disappears mid-cycle.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void, paddingHorizontal: 22 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingBottom: 4,
  },
  backGlyph: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    color: C.boneDim,
    fontSize: 28,
    lineHeight: 28,
    width: 22,
  },
  topTitle: {
    fontFamily: fonts.inter,
    color: C.bone,
    fontSize: 14,
    letterSpacing: 0.3,
  },

  stateCard: {
    backgroundColor: C.surface,
    borderColor: C.hair,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    gap: 8,
    alignItems: 'flex-start',
  },
  statePill: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 100,
  },
  statePillText: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 1.2,
  },
  stateTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    color: C.bone,
    fontSize: 26,
    lineHeight: 34,
    marginTop: 4,
  },
  stateSub: {
    fontFamily: fonts.inter,
    color: C.boneDim,
    fontSize: 13.5,
    lineHeight: 19,
  },

  group: {
    backgroundColor: C.surface,
    borderColor: C.hair,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: C.hair,
  },
  rowFirst: { borderTopWidth: 0 },
  rowIcon: {
    fontFamily: fonts.inter,
    color: C.honey,
    fontSize: 16,
    width: 20,
    textAlign: 'center',
  },
  rowLabel: {
    fontFamily: fonts.interSemi,
    color: C.bone,
    fontSize: 14,
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: fonts.inter,
    color: C.mute,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  rowChevron: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    color: C.mute,
    fontSize: 22,
  },

  reassure: {
    fontFamily: fonts.sansItalic,
    color: C.mute,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 12,
  },
});
