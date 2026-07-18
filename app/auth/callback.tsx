// Auth deep-link landing — the URL the confirmation / recovery
// emails redirect to (lumi://auth/callback#access_token=…).
//
// This screen existed only as a PATH until now: lib/auth.ts sends
// emailRedirectTo auth/callback and app/_layout.tsx's Linking
// listener consumes the tokens — but with no route file, Expo
// Router rendered "Unmatched Route" over the top of a successful
// sign-in. This file gives the deep link a real (quiet) place to
// land while the listener does its work; the root gate then routes
// to onboarding/tabs the moment the session appears.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

import { fonts } from '../../constants/fonts';
import { timeColors as C } from '../../constants/colors';
import { useSession, consumePendingPasswordRecovery } from '../../lib/auth';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { session, loading } = useSession();

  // The root layout's gate normally handles routing on session
  // change, but it only bounces users out of /auth when they're
  // fully onboarded — nudge explicitly once the session lands so
  // nobody can get parked here.
  useEffect(() => {
    if (loading) return;
    if (session) {
      // A recovery link's session exists ONLY so the user can set a
      // new password — sending them to the tabs left the forgotten
      // password unchanged (dead-end). The deep-link handler flags
      // recovery before setSession; consume it here.
      //
      // Small delay: on a COLD start with a persisted session, this
      // effect fires with the OLD session immediately, racing
      // Linking.getInitialURL → handleAuthDeepLink (which sets the
      // recovery flag). Waiting a beat lets the flag land so a valid
      // recovery isn't silently dropped into the tabs.
      const t = setTimeout(() => {
        router.replace(
          consumePendingPasswordRecovery()
            ? ('/auth/reset-password' as never)
            : '/',
        );
      }, 400);
      return () => clearTimeout(t);
    }
  }, [session, loading, router]);

  // Still no session after the listener has had ample time to parse
  // the URL → the link was expired or already used. Send them to
  // sign-in instead of an eternal spinner. (Effect re-arms whenever
  // session/loading settle; a session arriving cancels it via the
  // effect above unmounting this screen.)
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (loading || session) return;
    // Tell them WHY before moving them — a silent redirect reads as a
    // glitch on a slow connection. Generous timers: setSession on a
    // bad network can legitimately take several seconds, and bouncing
    // to sign-in mid-exchange silently killed valid recovery links.
    const warn = setTimeout(() => setStale(true), 6000);
    const t = setTimeout(() => router.replace('/auth/sign-in'), 15000);
    return () => {
      clearTimeout(warn);
      clearTimeout(t);
    };
  }, [session, loading, router]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={C.ember} />
      <Text style={styles.line}>
        {stale
          ? 'That link looks expired or already used — taking you to sign in…'
          : 'Setting up your space…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: C.void,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  line: {
    fontFamily: fonts.frauncesMed,
    fontSize: 16,
    color: C.boneDim,
  },
});
