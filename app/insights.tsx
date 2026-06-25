// "What Lumi knows about you" — the self-knowledge surface called for
// in lumi-profile-functional-spec §1 and lumi-retention-strategy §3.2.
//
// Pure read-side: reads the math-layer digest (cheap aggregates over
// quests + checkins, no LLM calls) and renders it as discrete cards.
// The whole point of this screen is to make the moat *visible* —
// users feel the accumulation that keeps them from leaving. Empty-
// state copy explicitly tells fresh accounts the picture will fill
// in, so day-1 doesn't feel hollow.

import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { fonts } from '../constants/fonts';
import { useUserStore } from '../store/userStore';
import { useCheckinStore } from '../store/checkinStore';
import { useQuestStore } from '../store/questStore';
import { useLearningDigest, formatStaleDays } from '../lib/learning';
import { useAccent, LUMI_INTELLIGENCE } from '../lib/theme';

// Palette mirrors profile.tsx
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
} as const;

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function InsightsScreen() {
  const router = useRouter();
  const accent = useAccent();

  const checkinCount = useCheckinStore((s) => s.checkins.length);
  const questCount = useQuestStore((s) => s.quests.length);
  const onboardedAt = useUserStore((s) => s.onboardedAt);

  const daysSinceJoin = useMemo(() => {
    if (!onboardedAt) return 0;
    const ms = Date.now() - new Date(onboardedAt).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  }, [onboardedAt]);

  // Fresh-account threshold. Below this, math hasn't learned anything
  // meaningful — show the "filling in" empty state instead of fake
  // certainty (the moat works by being *real*, not by faking it).
  const hasEnoughSignal = checkinCount + questCount >= 6;

  const digest = useLearningDigest();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>What Lumi knows</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 18, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Your picture, so far</Text>
          <Text style={styles.introBody}>
            {hasEnoughSignal
              ? `Built from ${checkinCount} check-in${checkinCount === 1 ? '' : 's'} and ${questCount} quest${questCount === 1 ? '' : 's'} over the last ${Math.max(daysSinceJoin, 1)} day${daysSinceJoin === 1 ? '' : 's'}. This page gets richer every week you keep using Lumi.`
              : `You just got here. The longer you use Lumi, the sharper this picture gets — your energy patterns, what you avoid, the rhythms only your weeks have. Come back in a week.`}
          </Text>
        </View>

        {/* Strong window */}
        {hasEnoughSignal && digest.pattern && (
          <Card
            kind="lumi"
            title={digest.pattern.headline}
            body={digest.pattern.body}
            footer={digest.pattern.eyebrow}
            accentColor={LUMI_INTELLIGENCE}
          />
        )}

        {/* Energy peaks */}
        {hasEnoughSignal && digest.peakDow != null && (
          <Card
            kind="lumi"
            title="Energy rhythm"
            body={`You peak on ${DOW_LABELS[digest.peakDow]}${
              digest.lowDow != null
                ? `, dip on ${DOW_LABELS[digest.lowDow]}`
                : ''
            }. Avg energy this week is ${Math.round(digest.avgEnergy7)}/100.`}
            accentColor={LUMI_INTELLIGENCE}
          />
        )}

        {/* Recurrence — Lumi-noticed */}
        {digest.recurrence.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Lumi noticed</Text>
            {digest.recurrence.slice(0, 4).map((r) => (
              <View key={r.id} style={styles.bullet}>
                <View
                  style={[
                    styles.bulletDot,
                    { backgroundColor: LUMI_INTELLIGENCE },
                  ]}
                />
                <Text style={styles.bulletText}>
                  {r.title} · {r.span}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Avoidance — named gently */}
        {digest.avoidance && (
          <Card
            kind="lumi"
            title="What's been waiting"
            body={`${digest.avoidance.items.length} task${
              digest.avoidance.items.length === 1 ? '' : 's'
            } have been open ${formatStaleDays(
              digest.avoidance.items[0]?.days ?? 0,
            )}${
              digest.avoidance.tag
                ? `. They're mostly ${digest.avoidance.tag} — that's a pattern, not a failure.`
                : '.'
            }`}
            accentColor={LUMI_INTELLIGENCE}
          />
        )}

        {/* Win of week */}
        {digest.win && (
          <Card
            kind="warm"
            title="Your win"
            body={`You finished "${digest.win.quest.title}" after ${digest.win.delayDays} day${
              digest.win.delayDays === 1 ? '' : 's'
            }. The kind of thing that's easy to forget you did.`}
            accentColor={C.honey}
          />
        )}

        {/* Footer link to recap */}
        <Pressable
          onPress={() => router.push('/recap')}
          style={[styles.footerLink, { borderColor: accent.fg }]}
        >
          <Text style={[styles.footerLinkText, { color: accent.fg }]}>
            See this week's recap →
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

interface CardProps {
  kind: 'lumi' | 'warm';
  title: string;
  body: string;
  footer?: string;
  accentColor: string;
}

const Card = ({ title, body, footer, accentColor }: CardProps) => (
  <View style={styles.card}>
    <View style={[styles.cardStripe, { backgroundColor: accentColor }]} />
    <View style={{ flex: 1 }}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
      {footer && <Text style={styles.cardFooter}>{footer}</Text>}
    </View>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },

  topBar: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.hair,
  },
  backGlyph: { fontSize: 22, color: C.boneDim },
  topTitle: {
    flex: 1,
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 20,
    color: C.bone,
  },

  intro: { paddingHorizontal: 24, paddingBottom: 22 },
  introTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    marginBottom: 8,
  },
  introBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 21,
  },

  section: { paddingHorizontal: 24, marginBottom: 22 },
  sectionLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: C.mute,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  bullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.bone,
    lineHeight: 20,
  },

  card: {
    marginHorizontal: 24,
    marginBottom: 14,
    flexDirection: 'row',
    backgroundColor: C.void2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.hair,
    overflow: 'hidden',
  },
  cardStripe: { width: 3 },
  cardTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 15.5,
    color: C.bone,
    paddingHorizontal: 16,
    paddingTop: 14,
    marginBottom: 4,
  },
  cardBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    paddingHorizontal: 16,
    paddingBottom: 14,
    lineHeight: 20,
  },
  cardFooter: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    color: C.mute,
    paddingHorizontal: 16,
    paddingBottom: 14,
    marginTop: -8,
    letterSpacing: 0.5,
  },

  footerLink: {
    marginHorizontal: 24,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  footerLinkText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
