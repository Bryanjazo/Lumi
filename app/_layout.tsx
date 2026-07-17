import { syncParseMetrics } from '../lib/telemetry';
import { installErrorReporting } from '../lib/errorReport';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import {
  useNotifIntentStore,
  type NotifIntent,
} from '../store/notifIntentStore';
import { AppState } from 'react-native';
import { useEffect, useRef, useState } from 'react';
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
import { useUserStore } from '../store/userStore';
import { resetLocalUserData } from '../lib/localData';
import { useQuestStore } from '../store/questStore';
import { useSession, handleAuthDeepLink } from '../lib/auth';
import { syncNotifications } from '../lib/notifications';
import { isSupabaseConfigured } from '../lib/supabase';
import { useCloudSync, useSyncStatus } from '../lib/sync';
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
  // ── Notification taps DO the thing they promised ────────────────
  // The scheduled content carries {action, questId?}; route to the
  // right screen and park the intent for it to consume on focus.
  // getLastNotificationResponseAsync covers the cold-start tap (the
  // listener only exists once JS is alive).
  const router2 = useRouter();
  const handledNotifRef = useRef<string | null>(null);
  useEffect(() => {
    // Dedupe key for a delivered tap. Repeating notifications reuse a
    // CONSTANT identifier ('lumi-meds' etc.) every day — if the OS
    // ever omits notification.date, the old identifier-only key
    // collapsed to the same string forever and day-2+ cold-start taps
    // were silently dropped. Fall back to the local day so a constant
    // id is at worst deduped within one day.
    const keyFor = (resp: Notifications.NotificationResponse): string => {
      const d = new Date();
      const dayStamp = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      return (
        resp.notification.request.identifier +
        '|' +
        String(resp.notification.date ?? dayStamp)
      );
    };
    const persistSeen = (key: string) => {
      void import('@react-native-async-storage/async-storage')
        .then(({ default: AsyncStorage }) =>
          AsyncStorage.setItem('lumi.lastNotifResponse', key),
        )
        .catch(() => {});
    };
    const act = (resp: Notifications.NotificationResponse | null) => {
      if (!resp) return;
      const key = keyFor(resp);
      if (handledNotifRef.current === key) return;
      handledNotifRef.current = key;
      // The LIVE listener persists the key too — it used to be
      // cold-start-only, so a tap handled live could be replayed by
      // the next launch's getLastNotificationResponseAsync.
      persistSeen(key);
      const data = (resp.notification.request.content.data ?? {}) as {
        action?: NotifIntent['action'];
        questId?: string;
        questTitle?: string;
      };
      if (!data.action) return;
      if (data.action === 'recap') {
        router2.push('/recap');
        return;
      }
      useNotifIntentStore.getState().setIntent({
        action: data.action,
        questId: data.questId,
        questTitle: data.questTitle,
        // Carry the notification's own words so Home can show which
        // notification this action came from.
        bodySnippet: resp.notification.request.content.body ?? undefined,
      });
      // Home consumes every non-recap intent.
      router2.navigate('/(tabs)');
    };
    const sub = Notifications.addNotificationResponseReceivedListener(act);
    // Cold-start tap: getLastNotificationResponse returns the LAST
    // response EVER — without a persisted dedupe key, yesterday's
    // tapped notification replayed its intent on every cold start.
    void (async () => {
      try {
        const AsyncStorage = (
          await import('@react-native-async-storage/async-storage')
        ).default;
        const resp = await Notifications.getLastNotificationResponseAsync();
        if (!resp) return;
        const key = keyFor(resp);
        const seen = await AsyncStorage.getItem('lumi.lastNotifResponse');
        if (seen === key) return;
        await AsyncStorage.setItem('lumi.lastNotifResponse', key);
        act(resp);
      } catch {
        // storage unavailable — skip the cold-start replay entirely
        // rather than risk acting on a stale tap
      }
    })();
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parse-quality telemetry (tier 1, zero text): push pending
  // aiMetrics rows shortly after launch and on each return to
  // foreground. Silent, batched, offline-mode aware.
  useEffect(() => {
    installErrorReporting();
    // Orphan Live Activities from a crash/force-quit would count on
    // the lock screen for hours — sweep any stragglers not owned by
    // a live session (the store is in-memory, so on cold start ANY
    // existing activity is an orphan).
    void import('../lib/focusSession').then(({ clearOrphanFocusActivities, useFocusSession }) => {
      if (!useFocusSession.getState().current) {
        void clearOrphanFocusActivities();
      }
    });
    const t = setTimeout(() => void syncParseMetrics(), 6000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncParseMetrics();
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, []);

  // ── OTA updates without the two-launch dance ─────────────────────
  // expo-updates default: launch N downloads the new bundle, launch
  // N+1 runs it. We close the gap invisibly: every FOREGROUND checks
  // + fetches; a downloaded bundle is applied the moment the app goes
  // to BACKGROUND — no live session is ever interrupted, and the next
  // open is already the new version.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let fetching = false;
    let pendingReload = false;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !fetching && !pendingReload) {
        fetching = true;
        void (async () => {
          try {
            const res = await Updates.checkForUpdateAsync();
            if (res.isAvailable) {
              await Updates.fetchUpdateAsync();
              pendingReload = true;
            }
          } catch {
            // offline / server hiccup — the on-launch check covers it
          } finally {
            fetching = false;
          }
        })();
      } else if (s === 'background' && pendingReload) {
        pendingReload = false;
        void Updates.reloadAsync().catch(() => {
          // reload refused (e.g. iOS suspending) — the normal
          // next-launch swap still applies it
        });
      }
    });
    return () => sub.remove();
  }, []);

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
  // First-pull-per-user flags — the cross-account wipe waits on these.
  const pulledFor = useSyncStatus((s) => s.pulledFor);
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

  // One-shot heal: the store migration renamed persisted 'Luna' →
  // 'Lumi', but a cloud pull could re-adopt the legacy value AFTER
  // the version-gated migration already ran, so a returning user was
  // stuck seeing "Luna" across every surface. This normalizes the
  // live value on each launch (cheap no-op once healed); the sync
  // pull now maps it too, and the next push writes 'Lumi' to cloud.
  useEffect(() => {
    if (useUserStore.getState().petName === 'Luna') {
      useUserStore.setState({ petName: 'Lumi' });
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
    // WAIT for the first cloud pull before wiping. The pull mints the
    // onboarding receipt from the server (users.onboarded / existing
    // quests) — wiping before it spoke is how returning Google/Apple
    // sign-ins kept losing their check-ins (rhythm reset to zero).
    // A genuinely NEW account still gets wiped right after its pull
    // completes (no receipt gets minted for it). A failed pull never
    // sets the flag → no wipe on flaky networks (fail-safe; re-arms
    // next launch).
    if (!pulledFor[uid]) return;
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
      // Wipe UNCONDITIONALLY for a genuinely-new account on this device
      // (all the guards above already established that). The old
      // hasData proxy only checked quests/checkins/suggestions, so a
      // previous account whose ONLY residue was pet SOS mental-health
      // events, an active subscription/trial, or room/pet progression
      // slipped through and leaked into the new account. resetLocalUser
      // Data is idempotent, so wiping a truly-empty device is harmless.
      resetLocalUserData();
    } catch (e) {
      console.warn('[lumi] cross-account wipe failed', e);
    }
  }, [session, onboardedUserIds, onboarded, onboardedAt, pulledFor]);

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

  // ── Notification sync (passive) ────────────────────────────────
  // Re-align the scheduled set whenever the inputs move: app start,
  // anchor edits (times shift), pref changes made elsewhere, or the
  // recurring-quest roster changing. Passive mode NEVER prompts for
  // permission — only the profile toggles do that.
  const notifPrefs = useUserStore((s) => s.notifPrefs);
  const notifAnchors = useUserStore((s) => s.anchors);
  const recurSignature = useQuestStore((s) =>
    s.quests
      .filter((q) => q.recur && !q.completed)
      .map((q) => q.id)
      .join(','),
  );
  useEffect(() => {
    const t = setTimeout(() => {
      void syncNotifications().catch(() => {});
    }, 1500); // debounce bursts (onboarding writes several anchors)
    return () => clearTimeout(t);
  }, [notifPrefs, notifAnchors, recurSignature]);

  const trialChoiceSeen = useUserStore((s) => s.trialChoiceSeen);

  // Timeout fallback for the check-first onboarding gate below: if the
  // first pull hasn't spoken for this uid within 12s (hard network
  // failure), release the hold so a genuinely-new user can onboard.
  // Resets whenever the uid changes.
  const [pullWaitTimedOut, setPullWaitTimedOut] = useState(false);
  useEffect(() => {
    const uid = session?.user.id;
    setPullWaitTimedOut(false);
    if (!uid || !isSupabaseConfigured) return;
    if (onboardedUserIds[uid] || pulledFor[uid]) return;
    const t = setTimeout(() => setPullWaitTimedOut(true), 12_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, onboardedUserIds, pulledFor]);

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
      // CHECK FIRST, PROMPT SECOND: a returning user (Google/Apple
      // sign-in, reinstall) has no local receipt until the first cloud
      // pull mints it — routing to onboarding immediately flashed the
      // "about to onboard" screen for a beat before the pull yanked it
      // away. Hold here (the auth screen simply stays put) until the
      // pull has spoken for this uid; the timeout fallback keeps a
      // genuinely-new user on a flaky network from waiting forever.
      const uid = session?.user.id;
      if (
        !allowOfflineDev &&
        isSupabaseConfigured &&
        uid &&
        !pulledFor[uid] &&
        !pullWaitTimedOut
      ) {
        return;
      }
      if (!inOnboarding || inTrialChoice) router.replace('/onboarding/welcome');
      return;
    }

    // 3. Optional one-time trial-choice screen — offered once right
    //    after onboarding. Both options proceed into the app; this
    //    is NOT a gate, just the moment to surface the upfront
    //    "7 days of Pro, on us" offer.
    // Only offered on the way OUT of onboarding/auth — this used to
    // yank the user to the trial screen from ANYWHERE the moment
    // trialChoiceSeen flipped false (e.g. the cross-account wipe on
    // a shared device resetting it mid-session), landing the "7 days
    // of Pro" on top of the Home tour spotlight.
    if (!trialChoiceSeen && (inOnboarding || inAuth || inTrialChoice)) {
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
    pulledFor,
    pullWaitTimedOut,
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
