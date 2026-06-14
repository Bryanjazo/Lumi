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
import { useUserStore } from '../store/userStore';
import { useSession, handleAuthDeepLink } from '../lib/auth';
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
  const { session, loading: sessionLoading } = useSession();
  useCloudSync(session);
  const access = useAccessStatus(session);

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

    const top = (segments as string[])[0];
    const inOnboarding = top === 'onboarding';
    const inAuth = top === 'auth';
    const inPaywall = top === 'paywall';

    if (!onboarded) {
      if (!inOnboarding) router.replace('/onboarding/welcome');
      return;
    }

    // Sign-up is the default landing once Supabase is configured.
    if (!session && !allowOfflineDev) {
      if (!inAuth) router.replace('/auth/sign-up');
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
          <Stack.Screen name="profile" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
