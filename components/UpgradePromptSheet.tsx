// UpgradePromptSheet — the cap-hit upgrade conversation
//
// Listens to quotaPromptStore (fired when the proxy returns 429).
// Surfaces a calm, feature-specific bottom sheet:
//   "You've used your 5 Untangle chats this week.
//    Try 7 days of Pro free — and pick up where you left off."
//
// Never blocks the user. The LLM call already fell back to the
// deterministic path; this is purely the upgrade conversation
// surface at the moment of peak intent. Either button dismisses.
//
// For premium users who hit the soft daily ceiling (rare — heavy
// power-use), we show a quieter "let's keep it quick for now" line
// with no CTA, per lumi-ai-cost-economics-v2.md §5.

import { useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import { timeColors as TC } from '../constants/colors';
import { useQuotaPromptStore, type QuotaKind } from '../store/quotaPromptStore';
import { useUserStore } from '../store/userStore';
import { PRICING } from '../lib/subscription';

const labelForKind = (kind: QuotaKind | null): string => {
  switch (kind) {
    case 'untangle':
      return 'Untangle chats';
    case 'brain_dump':
      return 'brain dumps';
    case 'title_clean':
      return 'smart captures';
    case 'followup':
      return 'follow-ups';
    case 'weekly_report':
      return 'recap narratives';
    default:
      return 'AI helpers';
  }
};

export const UpgradePromptSheet = () => {
  const router = useRouter();
  const open = useQuotaPromptStore((s) => s.open);
  const kind = useQuotaPromptStore((s) => s.kind);
  const premiumDailyHit = useQuotaPromptStore((s) => s.premiumDailyHit);
  const close = useQuotaPromptStore((s) => s.close);

  const startTrial = useUserStore((s) => s.startTrial);
  const trialStartedAt = useUserStore((s) => s.trialStartedAt);
  const subscriptionStatus = useUserStore((s) => s.subscriptionStatus);

  // Pop-in animation on open.
  const translateY = new Animated.Value(40);
  const opacity = new Animated.Value(0);
  useEffect(() => {
    if (!open) return;
    translateY.setValue(40);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
    // run once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const feature = labelForKind(kind);
  const trialAlreadyUsed = trialStartedAt != null;
  const onTrial = subscriptionStatus === 'trial';

  // ── Premium soft-ceiling: warm note, no CTA. They're already paid;
  //    the proxy is bounding worst-case cost (whale). ──
  if (premiumDailyHit) {
    const onClose = () => {
      Haptics.selectionAsync();
      close();
    };
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.scrim}>
          <SafeAreaView style={styles.sheetWrap} edges={['bottom']}>
            <Animated.View
              style={[
                styles.sheet,
                { transform: [{ translateY }], opacity },
              ]}
            >
              <Text style={styles.eyebrow}>JUST A BREATHER</Text>
              <Text style={styles.title}>
                Let&apos;s keep it quick for now.
              </Text>
              <Text style={styles.body}>
                You&apos;ve been making the most of Lumi today —
                {' '}I&apos;ll catch up with you again in a bit. The
                quick sorts and the deterministic path still work
                while we wait.
              </Text>
              <Pressable
                onPress={onClose}
                style={[styles.primaryBtn, { backgroundColor: TC.ember }]}
              >
                <Text style={styles.primaryBtnText}>Got it</Text>
              </Pressable>
            </Animated.View>
          </SafeAreaView>
        </View>
      </Modal>
    );
  }

  // ── Free user hit the weekly cap → upgrade conversation. ──
  const headlineTitle = onTrial
    ? `You've used your ${feature} for this week.`
    : trialAlreadyUsed
      ? `You've used your free ${feature} for the week.`
      : `You've used your 5 free ${feature} this week.`;

  const headlineBody = onTrial
    ? "Even Pro has a fair-use ceiling, but it resets soon. The quick sorts below still work in the meantime."
    : trialAlreadyUsed
      ? `Subscribe to keep things unlimited — ${PRICING.annual.firstYearLabel}/yr first year, or ${PRICING.monthly.label}/mo.`
      : "Want unlimited? Try 7 days of Pro free — no card, no charge, slide back to free if it's not for you.";

  const primaryCta = onTrial
    ? 'Got it'
    : trialAlreadyUsed
      ? 'See plans'
      : 'Try 7 days free';

  const onPrimary = () => {
    Haptics.selectionAsync();
    if (onTrial) {
      close();
      return;
    }
    if (trialAlreadyUsed) {
      close();
      router.push('/paywall');
      return;
    }
    // Free user, never trialed → start the 7-day taste right here.
    startTrial();
    close();
  };

  const onDismiss = () => {
    Haptics.selectionAsync();
    close();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <SafeAreaView style={styles.sheetWrap} edges={['bottom']}>
          <Animated.View
            style={[
              styles.sheet,
              { transform: [{ translateY }], opacity },
            ]}
          >
            <Text style={styles.eyebrow}>A GENTLE NUDGE</Text>
            <Text style={styles.title}>{headlineTitle}</Text>
            <Text style={styles.body}>{headlineBody}</Text>

            <Pressable
              onPress={onPrimary}
              style={[styles.primaryBtn, { backgroundColor: TC.ember }]}
            >
              <Text style={styles.primaryBtnText}>{primaryCta} →</Text>
            </Pressable>

            {!onTrial && (
              <Pressable onPress={onDismiss} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>
                  Stay on free — the basics still work
                </Text>
              </Pressable>
            )}
          </Animated.View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    backgroundColor: TC.void2,
    borderTopWidth: 1,
    borderColor: TC.hair,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 10,
  },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 3,
    color: TC.dusk,
    marginBottom: 11,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: TC.bone,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  body: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.boneDim,
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 18,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
    color: TC.void,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: TC.boneDim,
  },
});
