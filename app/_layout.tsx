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
import { useSession, handleAuthDeepLink } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { useCloudSync } from '../lib/sync';

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
  const offlineMode = useUserStore((s) => s.offlineMode);
  const { session, loading: sessionLoading } = useSession();
  useCloudSync(session);

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

    const top = segments[0];
    const inOnboarding = top === 'onboarding';
    const inAuth = top === 'auth';

    if (!onboarded) {
      if (!inOnboarding) router.replace('/onboarding/welcome');
      return;
    }

    const needsAuthGate = isSupabaseConfigured && !session && !offlineMode;

    if (needsAuthGate) {
      if (!inAuth) router.replace('/auth/sign-in');
      return;
    }

    if (inOnboarding || inAuth) {
      router.replace('/(tabs)');
    }
  }, [
    hydrated,
    fontsReady,
    onboarded,
    offlineMode,
    session,
    sessionLoading,
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
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
