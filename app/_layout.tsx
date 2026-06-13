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
import { View, ActivityIndicator } from 'react-native';
import { colors } from '../constants/colors';
import { useUserStore } from '../store/userStore';
import {
  useSession,
  handleAuthDeepLink,
  hasVerifiedPhone,
} from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { useCloudSync } from '../lib/sync';
import { useAccessStatus } from '../lib/subscription';

export default function RootLayout() {
  const [fontsReady] = useFonts({
    DMSans_400Regular,
    DMSans_400Regular_Italic,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSerifDisplay_400Regular,
    DMSerifDisplay_400Regular_Italic,
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
  const phoneVerified = useUserStore((s) => s.phoneVerified);
  const setPhoneVerified = useUserStore((s) => s.setPhoneVerified);
  const { session, loading: sessionLoading } = useSession();
  useCloudSync(session);
  const access = useAccessStatus(session);

  // Whenever the session changes, refresh the phoneVerified flag against
  // Supabase. Authoritative source-of-truth is mfa.listFactors; the
  // local flag is just for snappier routing.
  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setPhoneVerified(false);
      return;
    }
    void hasVerifiedPhone().then((v) => {
      if (!cancelled) setPhoneVerified(v);
    });
    return () => {
      cancelled = true;
    };
  }, [session, setPhoneVerified]);

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

  useEffect(() => {
    if (!hydrated || !fontsReady) return;
    if (isSupabaseConfigured && sessionLoading) return;

    const segs = segments as string[];
    const top = segs[0];
    const second = segs[1];
    const inOnboarding = top === 'onboarding';
    const inAuth = top === 'auth';
    const onPhoneStep = inAuth && second === 'verify-phone';
    const inPaywall = top === 'paywall';

    if (!onboarded) {
      if (!inOnboarding) router.replace('/onboarding/welcome');
      return;
    }

    // Sign-in is required once Supabase is configured.
    if (!session && !allowOfflineDev) {
      if (!inAuth || onPhoneStep) router.replace('/auth/sign-in');
      return;
    }

    // Signed in but phone isn't verified yet → second auth step.
    if (session && !phoneVerified && !allowOfflineDev) {
      if (!onPhoneStep) router.replace('/auth/verify-phone');
      return;
    }

    // Signed in but trial expired / not subscribed → paywall.
    if (session && !access.hasAccess) {
      if (!inPaywall) router.replace('/paywall');
      return;
    }

    if (inOnboarding || inAuth || inPaywall) {
      router.replace('/(tabs)');
    }
  }, [
    hydrated,
    fontsReady,
    onboarded,
    allowOfflineDev,
    session,
    sessionLoading,
    phoneVerified,
    access.hasAccess,
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
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
