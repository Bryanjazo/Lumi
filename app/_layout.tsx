import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import { useFonts } from 'expo-font';
import {
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import {
  DMSerifDisplay_400Regular,
  DMSerifDisplay_400Regular_Italic,
} from '@expo-google-fonts/dm-serif-display';
import {
  Fraunces_400Regular_Italic,
  Fraunces_500Medium_Italic,
} from '@expo-google-fonts/fraunces';
import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
} from '@expo-google-fonts/inter-tight';
import { View, ActivityIndicator } from 'react-native';
import { colors } from '../constants/colors';
import { useUserStore, DEFAULT_ANCHORS } from '../store/userStore';
import { useQuestStore } from '../store/questStore';
import { useCheckinStore } from '../store/checkinStore';
import { useSuggestionsStore } from '../store/suggestionsStore';
import { useSession, handleAuthDeepLink } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { useCloudSync } from '../lib/sync';
import { useWidgetSync } from '../lib/widget';
import {
  configureRevenueCat,
  identifyUser as identifyRC,
  logOutUser as logOutRC,
  onCustomerInfoUpdate,
} from '../lib/revenuecat';
import { TourProvider } from '../components/SpotlightTour';
import { DeleteConfirmProvider } from '../components/TaskDeleteWrap';
import { UpgradePromptSheet } from '../components/UpgradePromptSheet';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function RootLayout() {
  const [fontsReady] = useFonts({
    DMSans_400Regular,
    DMSans_400Regular_Italic,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSerifDisplay_400Regular,
    DMSerifDisplay_400Regular_Italic,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium_Italic,
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
  });

  const [hydrated, setHydrated] = useState(() =>
    useUserStore.persist.hasHydrated(),
  );
  useEffect(() => {
    const unsub = useUserStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    if (useUserStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  const onboarded = useUserStore((s) => s.onboarded);
  const onboardedAt = useUserStore((s) => s.onboardedAt);
  const onboardedUserIds = useUserStore((s) => s.onboardedUserIds);
  const markOnboardedForUser = useUserStore((s) => s.markOnboardedForUser);
  const { session, loading: sessionLoading } = useSession();
  useCloudSync(session);
  // Push the cat's mood + completion count to the iOS home-screen
  // widget whenever they change. No-op on Android / Expo Go / web.
  useWidgetSync();

  // ── RevenueCat ──
  //
  //  configure() runs once at boot; identifyUser() links the device
  //  receipt to the Supabase user id so cross-device purchases work.
  //  The customer-info listener keeps `subscriptionStatus` honest in
  //  real time (renewals, cancellations, lapses). In Expo Go the RC
  //  module isn't bundled — every call is a no-op, so dev still works.
  useEffect(() => {
    // Defensive: a failure inside the RC native module CAN crash
    // the app tree (Expo runtime turns uncaught JS errors during
    // a useEffect into a fatal). Catch + log so RC misconfig
    // (missing key, mismatched bundle) never takes down auth.
    try {
      configureRevenueCat();
      const unsub = onCustomerInfoUpdate();
      return unsub;
    } catch (e) {
      console.warn('[lumi] RC bootstrap failed', e);
      return undefined;
    }
  }, []);

  useEffect(() => {
    const uid = session?.user.id;
    // identifyRC / logOutRC are async and may reject if the native
    // SDK is in a weird state. The .catch keeps the rejection from
    // becoming an UnhandledPromiseRejection that crashes RN.
    if (uid) {
      identifyRC(uid).catch((e) =>
        console.warn('[lumi] identifyRC failed', e),
      );
    } else {
      logOutRC().catch((e) => console.warn('[lumi] logOutRC failed', e));
    }
  }, [session]);

  // ── Cross-account data wipe:
  //
  //  Zustand stores (quests, check-ins, suggestions) plus the per-user
  //  onboarding seeds (struggles, sharp/foggy windows, anchors) all
  //  persist to AsyncStorage, which is bound to the DEVICE — not to a
  //  Supabase user. Without this wipe, signing out and signing up with
  //  a new email would let the new account inherit the previous user's
  //  quests and anchors. That's a privacy + correctness problem.
  //
  //  We wipe when the current session.user.id is NOT in
  //  `onboardedUserIds`, except for the legacy-bridge case (existing
  //  tester whose data we want to keep on the first adoption). The
  //  bridge's empty-map guard handles that path; our wipe handles
  //  every other path.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    // Already known on this device — keep their data.
    if (onboardedUserIds[uid]) return;
    // First-launch legacy adoption (only fires when the map is fully
    // empty AND local `onboarded` is still true from before v7). Don't
    // wipe — the bridge above adopts the existing data.
    const legacyAdoption =
      onboarded &&
      onboardedAt &&
      Object.keys(onboardedUserIds).length === 0;
    if (legacyAdoption) return;

    // Otherwise this is a genuinely new account on the device. Wipe
    // anything left behind by a previous account so onboarding gets a
    // clean slate. Wrapped in try/catch so a single store failing to
    // reset doesn't bubble out and crash the auth-state-change tree.
    try {
      const hasData =
        useQuestStore.getState().quests.length > 0 ||
        useCheckinStore.getState().checkins.length > 0 ||
        useSuggestionsStore.getState().suggestions.length > 0;
      if (!hasData) return;

      useQuestStore.getState().reset();
      useCheckinStore.getState().reset();
      useSuggestionsStore.getState().reset();
      // Wipe learned LLM corrections too — they're per-user
      // preferences, not device defaults.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../store/correctionsStore').useCorrectionsStore.getState().reset();
      useUserStore.setState({
        // identity
        name: '',
        // Default pet name matches the app brand — both are "Lumi".
        petName: 'Lumi',
        adhdType: null,
        avatar: 'default',
        // progression
        xp: 0,
        streak: 0,
        lastActiveDate: null,
        shieldAvailable: true,
        shieldUsedThisWeek: false,
        shards: 0,
        // onboarding seeds
        struggles: [],
        sharpWindow: null,
        foggyWindow: null,
        wakeHour: 7,
        anchors: DEFAULT_ANCHORS,
        windowOverrides: { midday: 11, afternoon: 14, evening: 17 },
        // legacy onboarding flag (per-user gate is onboardedUserIds)
        onboarded: false,
        onboardedAt: null,
      });
    } catch (e) {
      console.warn('[lumi] cross-account wipe failed', e);
    }
  }, [session, onboardedUserIds, onboarded, onboardedAt]);

  // ── Legacy adoption (one-shot, single user):
  //
  //  A tester who finished onboarding before per-user receipts shipped
  //  has `onboarded=true` + `onboardedAt` set locally but no entries in
  //  `onboardedUserIds`. The first time they sign in after the update,
  //  we copy that single timestamp into the map for their user.id so
  //  they don't get bounced through onboarding again.
  //
  //  CRITICAL: this MUST only fire when the map is genuinely empty.
  //  An earlier version of this bridge fired for every fresh sign-up
  //  while the local `onboarded` flag was true — which meant
  //  signing up with a NEW account inherited the existing user's
  //  "already onboarded" state and skipped the interview. The
  //  empty-map guard ensures we adopt exactly one user (the first to
  //  sign in after upgrade) and every subsequent account gets its
  //  own clean per-user gate.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    if (!onboarded || !onboardedAt) return;
    if (onboardedUserIds[uid]) return;
    if (Object.keys(onboardedUserIds).length > 0) return;
    markOnboardedForUser(uid);
  }, [
    session,
    onboarded,
    onboardedAt,
    onboardedUserIds,
    markOnboardedForUser,
  ]);

  // When Supabase isn't configured (dev / no env vars), we let the user
  // through without auth so the app still runs. Once configured, sign-in
  // is required — no offline escape.
  const allowOfflineDev = !isSupabaseConfigured;

  const segments = useSegments();
  const router = useRouter();

  // Deep-link handler: when the magic-link email opens the app, parse the
  // tokens out of the URL and set the Supabase session.
  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      void handleAuthDeepLink(url);
    };
    const sub = Linking.addEventListener('url', onUrl);
    Linking.getInitialURL().then((url) => {
      if (url) void handleAuthDeepLink(url);
    });
    return () => sub.remove();
  }, []);

  const trialChoiceSeen = useUserStore((s) => s.trialChoiceSeen);

  useEffect(() => {
    if (!hydrated || !fontsReady) return;
    if (isSupabaseConfigured && sessionLoading) return;

    const top = (segments as string[])[0];
    const inOnboarding = top === 'onboarding';
    const inAuth = top === 'auth';
    const inTrialChoice =
      inOnboarding &&
      (segments as string[])[1] === 'trial-choice';

    // ── Routing order ──
    // auth → onboarding (per user.id) → optional trial-choice → tabs.
    //
    // The old order force-redirected to /paywall on !hasAccess,
    // which trapped lapsed-trial users on the wall. The new model
    // (lumi-monetization-model-spec-2.md) is **free is the floor** —
    // the app never locks. The paywall is now a screen you NAVIGATE
    // to from upgrade prompts, not a gate you're trapped behind.
    const isOnboardedForCurrentUser = allowOfflineDev
      ? onboarded
      : !!(session?.user.id && onboardedUserIds[session.user.id]);

    // 1. Need a session first (prod only).
    if (!session && !allowOfflineDev) {
      if (!inAuth) router.replace('/auth/sign-up');
      return;
    }

    // 2. Then the per-user onboarding gate.
    if (!isOnboardedForCurrentUser) {
      if (!inOnboarding || inTrialChoice) router.replace('/onboarding/welcome');
      return;
    }

    // 3. Optional one-time trial-choice screen — offered once right
    //    after onboarding. Both options proceed into the app; this
    //    is NOT a gate, just the moment to surface the upfront
    //    "7 days of Pro, on us" offer.
    if (!trialChoiceSeen) {
      if (!inTrialChoice)
        router.replace('/onboarding/trial-choice' as never);
      return;
    }

    // 4. Otherwise land in the tabs.
    //
    //  We only bounce out of /onboarding and /auth — NOT /paywall.
    //  The paywall is a navigable surface (push from upgrade prompts,
    //  the Subscription row in Profile, etc.), not a gate the user
    //  is trapped behind. Bouncing them off would make "Upgrade"
    //  buttons fail silently from the user's perspective.
    if (inOnboarding || inAuth) {
      router.replace('/(tabs)');
    }
  }, [
    hydrated,
    fontsReady,
    onboarded,
    onboardedUserIds,
    allowOfflineDev,
    session,
    sessionLoading,
    trialChoiceSeen,
    segments,
    router,
  ]);

  if (!fontsReady || !hydrated) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={colors.plum} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* Top-level error boundary — one screen's render crash
            here shows a calm reload card instead of a hard white
            screen. Wraps every route + provider beneath. */}
        <ErrorBoundary>
        <TourProvider>
          <DeleteConfirmProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'fade',
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="auth" />
              <Stack.Screen name="paywall" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="profile" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="recap" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen
                name="dev-benchmark"
                options={{ animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="manage-subscription"
                options={{ animation: 'slide_from_bottom' }}
              />
            </Stack>
            <UpgradePromptSheet />
          </DeleteConfirmProvider>
        </TourProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
