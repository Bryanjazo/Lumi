// Lumi · Dev — LLM benchmark runner (in-app)
//
// Hidden dev screen: tap "Run all" to execute every case in
// `lib/anthropic-benchmark.ts` against the real LLM through the
// existing Supabase Edge Function (so it uses the same auth /
// quota / network path as production). Results render below with
// per-case pass / fail + the raw LLM output.
//
// Why in-app instead of a Node CLI: the LLM client lives behind
// the Supabase client which relies on React Native AsyncStorage.
// Running from Node would require mocking RN, which is more setup
// than the benchmark is worth. From inside the app, everything
// just works.
//
// Access: navigate to `/dev-benchmark` from anywhere
// (`router.push('/dev-benchmark')`) — there's a button in Profile.

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import { timeColors as TC } from '../constants/colors';
import {
  runFullBenchmark,
  type BenchmarkReport,
} from '../lib/anthropic-benchmark-runner';

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

export default function DevBenchmarkScreen() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRunning(true);
    setReport(null);
    setError(null);
    setProgress('Starting…');
    try {
      // Patch progress reporting via a temporary console.log shim so
      // the runner's existing `process.stdout.write` lines land in
      // our progress state too. (Simple: just let it run and clear
      // progress when done.)
      const r = await runFullBenchmark();
      setReport(r);
      setProgress(
        `Done — understand ${r.summary.understandPass}/${r.summary.understandTotal}, untangle ${r.summary.untanglePass}/${r.summary.untangleTotal}`,
      );
      Haptics.notificationAsync(
        r.summary.understandTotal -
          r.summary.understandPass +
          (r.summary.untangleTotal - r.summary.untanglePass) ===
          0
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error,
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹  Back</Text>
        </Pressable>
        <Text style={styles.title}>LLM Benchmark</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.body}>
          Runs every case from{' '}
          <Text style={styles.mono}>lib/anthropic-benchmark.ts</Text>{' '}
          against the real LLM through the Supabase Edge Function.
          Costs ~$0.50 per full run.
        </Text>

        <Pressable
          onPress={run}
          disabled={running}
          style={[
            styles.runBtn,
            { backgroundColor: TC.ember, opacity: running ? 0.5 : 1 },
          ]}
        >
          {running ? (
            <ActivityIndicator color={TC.void} />
          ) : (
            <Text style={styles.runBtnText}>Run all</Text>
          )}
        </Pressable>

        {progress ? (
          <Text style={styles.progress}>{progress}</Text>
        ) : null}

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Run failed</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        )}

        {report && (
          <View style={{ marginTop: 16 }}>
            {/* ── Summary ───────────────────────────────────────── */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Summary</Text>
              <Text style={styles.summaryLine}>
                llmUnderstand:{' '}
                <Text
                  style={{
                    color:
                      report.summary.understandPass ===
                      report.summary.understandTotal
                        ? TC.lichen
                        : TC.ember,
                  }}
                >
                  {report.summary.understandPass} /{' '}
                  {report.summary.understandTotal}
                </Text>
              </Text>
              <Text style={styles.summaryLine}>
                llmUntangle:{' '}
                <Text
                  style={{
                    color:
                      report.summary.untanglePass ===
                      report.summary.untangleTotal
                        ? TC.lichen
                        : TC.ember,
                  }}
                >
                  {report.summary.untanglePass} /{' '}
                  {report.summary.untangleTotal}
                </Text>
              </Text>
              <View style={{ height: 8 }} />
              <Text style={styles.summarySub}>By category</Text>
              {Object.entries(report.summary.byCategory).map(
                ([cat, { pass, total }]) => (
                  <Text key={cat} style={styles.summaryLine}>
                    {cat}:{' '}
                    <Text
                      style={{
                        color: pass === total ? TC.lichen : TC.ember,
                      }}
                    >
                      {pass}/{total}
                    </Text>
                  </Text>
                ),
              )}
            </View>

            {/* ── Understand details ────────────────────────────── */}
            <Text style={styles.sectionTitle}>llmUnderstand</Text>
            {report.understand.map((r, i) => (
              <View
                key={`u-${i}`}
                style={[
                  styles.caseCard,
                  {
                    borderColor:
                      r.errors.length === 0
                        ? hexA(TC.lichen, 0.4)
                        : hexA(TC.ember, 0.4),
                  },
                ]}
              >
                <View style={styles.caseHeader}>
                  <Text
                    style={[
                      styles.caseStatus,
                      {
                        color:
                          r.errors.length === 0 ? TC.lichen : TC.ember,
                      },
                    ]}
                  >
                    {r.errors.length === 0 ? '✓' : '✗'}
                  </Text>
                  <Text style={styles.caseName}>{r.case.name}</Text>
                  <Text style={styles.caseCategory}>
                    {r.case.category}
                  </Text>
                </View>
                <Text style={styles.caseRaw}>
                  &quot;{r.case.raw}&quot;
                </Text>
                {r.case.notes && (
                  <Text style={styles.caseNotes}>{r.case.notes}</Text>
                )}
                {r.output && (
                  <Text style={styles.caseJson}>
                    {JSON.stringify(r.output, null, 2)}
                  </Text>
                )}
                {r.errors.length > 0 && (
                  <View style={styles.errorsBlock}>
                    {r.errors.map((e, j) => (
                      <Text key={j} style={styles.errorLine}>
                        • {e}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))}

            {/* ── Untangle details ──────────────────────────────── */}
            <Text style={styles.sectionTitle}>llmUntangle</Text>
            {report.untangle.map((r, i) => (
              <View
                key={`t-${i}`}
                style={[
                  styles.caseCard,
                  {
                    borderColor:
                      r.errors.length === 0
                        ? hexA(TC.lichen, 0.4)
                        : hexA(TC.ember, 0.4),
                  },
                ]}
              >
                <View style={styles.caseHeader}>
                  <Text
                    style={[
                      styles.caseStatus,
                      {
                        color:
                          r.errors.length === 0 ? TC.lichen : TC.ember,
                      },
                    ]}
                  >
                    {r.errors.length === 0 ? '✓' : '✗'}
                  </Text>
                  <Text style={styles.caseName}>{r.case.name}</Text>
                  <Text style={styles.caseCategory}>
                    {r.case.category}
                  </Text>
                </View>
                <Text style={styles.caseRaw}>
                  &quot;{r.case.message}&quot;
                </Text>
                {r.case.notes && (
                  <Text style={styles.caseNotes}>{r.case.notes}</Text>
                )}
                {r.output && (
                  <Text style={styles.caseJson}>
                    {JSON.stringify(r.output, null, 2)}
                  </Text>
                )}
                {r.errors.length > 0 && (
                  <View style={styles.errorsBlock}>
                    {r.errors.map((e, j) => (
                      <Text key={j} style={styles.errorLine}>
                        • {e}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: TC.void },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: TC.hair,
  },
  back: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: TC.boneDim,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 17,
    color: TC.bone,
  },
  body: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.boneDim,
    lineHeight: 20,
    marginBottom: 16,
  },
  mono: {
    fontFamily: 'Courier',
    fontSize: 12.5,
    color: TC.bone,
  },
  runBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  runBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 15,
    color: TC.void,
  },
  progress: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: TC.mute,
    textAlign: 'center',
    marginBottom: 12,
  },
  errorCard: {
    backgroundColor: hexA('#C97560', 0.08),
    borderColor: hexA('#C97560', 0.4),
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  errorTitle: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: '#C97560',
    marginBottom: 6,
  },
  errorBody: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: TC.boneDim,
    lineHeight: 18,
  },
  summaryCard: {
    backgroundColor: TC.void2,
    borderColor: TC.hair,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  summaryTitle: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: TC.dusk,
    marginBottom: 10,
  },
  summarySub: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: TC.mute,
    marginTop: 6,
    marginBottom: 4,
  },
  summaryLine: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: TC.bone,
    paddingVertical: 2,
  },
  sectionTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 18,
    color: TC.bone,
    marginTop: 18,
    marginBottom: 10,
  },
  caseCard: {
    backgroundColor: TC.void2,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  caseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  caseStatus: {
    fontFamily: fonts.interSemi,
    fontSize: 16,
    width: 18,
    textAlign: 'center',
  },
  caseName: {
    flex: 1,
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: TC.bone,
  },
  caseCategory: {
    fontFamily: fonts.inter,
    fontSize: 10,
    color: TC.mute,
    letterSpacing: 0.4,
  },
  caseRaw: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12.5,
    color: TC.boneDim,
    lineHeight: 18,
    marginBottom: 6,
  },
  caseNotes: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: TC.mute,
    lineHeight: 16,
    marginBottom: 6,
  },
  caseJson: {
    fontFamily: 'Courier',
    fontSize: 10.5,
    color: TC.dusk,
    lineHeight: 14,
    marginTop: 4,
  },
  errorsBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: hexA('#C97560', 0.2),
  },
  errorLine: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: '#C97560',
    lineHeight: 15,
    paddingVertical: 1,
  },
});
