import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  Alert,
  LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Circle,
  Text as SvgText,
} from 'react-native-svg';
import { fonts } from '../constants/fonts';
import { useUserStore } from '../store/userStore';
import { useLearningDigest, formatStaleDays } from '../lib/learning';
import { useCompanionMode, phrasingFor } from '../lib/companion-mode';
import { useAccent, accentFor, type Accent } from '../lib/theme';
import { WINDOWS } from '../constants/windows';
import { SoftGlow } from '../components/SoftGlow';

// ═════════════════════════════════════════════════════════════════════
// Palette — taken from lumi-recap.jsx
// ═════════════════════════════════════════════════════════════════════
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  glow: '#F4C98A',
  lichen: '#869072',
  honey: '#C9A06A',
  dusk: '#8EA0B4',
  amethyst: '#9A85A8',
  ash: '#5A5650',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// ═════════════════════════════════════════════════════════════════════
// CountUp — eased number tween
// ═════════════════════════════════════════════════════════════════════
const CountUp = ({
  to,
  duration = 1100,
  style,
}: {
  to: number;
  duration?: number;
  style?: any;
}) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf: number;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start == null) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * e));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <Text style={style}>{n}</Text>;
};

// ═════════════════════════════════════════════════════════════════════
// Section — fade+rise on mount, optional staggered delay
// ═════════════════════════════════════════════════════════════════════
const Section = ({
  delay = 0,
  style,
  children,
}: {
  delay?: number;
  style?: any;
  children: React.ReactNode;
}) => {
  const op = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, {
        toValue: 1,
        duration: 600,
        delay: delay * 1000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(ty, {
        toValue: 0,
        duration: 600,
        delay: delay * 1000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, op, ty]);
  return (
    <Animated.View style={[{ opacity: op, transform: [{ translateY: ty }] }, style]}>
      {children}
    </Animated.View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// WeekCurve — smooth ember line + filled area
// ═════════════════════════════════════════════════════════════════════
const WeekCurve = ({
  data,
}: {
  data: { day: string; v: number }[];
}) => {
  const accent = useAccent();
  const [w, setW] = useState(0);
  const H = 120;
  const PAD = 14;
  const onLayout = (e: LayoutChangeEvent) =>
    setW(e.nativeEvent.layout.width);

  const { line, fill, points } = useMemo(() => {
    if (!w || data.length < 2) return { line: '', fill: '', points: [] };
    const gw = w - PAD * 2;
    const gh = H - PAD * 2;
    const pts = data.map((d, i) => ({
      x: PAD + (i / (data.length - 1)) * gw,
      y: PAD + (1 - Math.max(0, Math.min(100, d.v)) / 100) * gh,
      day: d.day,
    }));
    let line = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const pp = pts[i - 1];
      const p = pts[i];
      const cx = (pp.x + p.x) / 2;
      line += ` C ${cx} ${pp.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
    }
    const fill = line + ` L ${pts[pts.length - 1].x} ${H - PAD} L ${pts[0].x} ${H - PAD} Z`;
    return { line, fill, points: pts };
  }, [data, w]);

  return (
    <View onLayout={onLayout} style={{ width: '100%' }}>
      {w > 0 && (
        <Svg width={w} height={H}>
          <Defs>
            <LinearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent.fg} stopOpacity={0.28} />
              <Stop offset="1" stopColor={accent.fg} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={fill} fill="url(#curveFill)" />
          <Path
            d={line}
            stroke={accent.fg}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={C.void} />
          ))}
          {points.map((p, i) => (
            <Circle key={'i' + i} cx={p.x} cy={p.y} r={2} fill={accent.fg} />
          ))}
          {points.map((p, i) => (
            <SvgText
              key={'d' + i}
              x={p.x}
              y={H - 3}
              fill={hexA(C.bone, 0.5)}
              fontSize={9}
              fontFamily={fonts.inter}
              textAnchor="middle"
            >
              {p.day}
            </SvgText>
          ))}
        </Svg>
      )}
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════
const DAY_NAME: Record<string, string> = {
  M: 'Monday',
  T: 'Tuesday',
  W: 'Wednesday',
  R: 'Thursday',
  F: 'Friday',
  S: 'Saturday',
  U: 'Sunday',
};

const monthDay = (d: Date): string =>
  d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// LOCAL YYYY-MM-DD — match the rest of the app's date bucketing so
// today's check-ins show up on today's bar, not on tomorrow's UTC.
const ymdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const isoOffsetDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
};

// Build last 7 days ending today, with LOCAL date keys.
const last7Days = (
  energyByDate: Map<string, number>,
): { day: string; v: number }[] => {
  const out: { day: string; v: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = ymdLocal(d);
    const idx = d.getDay();
    const letter = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][idx];
    out.push({ day: letter, v: energyByDate.get(key) ?? 0 });
  }
  return out;
};

// ═════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════
export default function RecapScreen() {
  const router = useRouter();
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  const streak = useUserStore((s) => s.streak);
  // Companion-mode phrasing — in Focused mode "quest" reads as
  // "task" so the recap matches the calm-organizer framing. Per
  // companion-mode-spec §3.
  const companion = useCompanionMode();
  const phrase = phrasingFor(companion.mode);

  // Single hook runs every detector over the user's own data.
  const digest = useLearningDigest();
  const { followThrough, energyTrend, pattern, avoidance, win } = digest;

  const done = followThrough.thisWeek.done;
  const set = followThrough.thisWeek.set;
  const lastWeekDone = followThrough.lastWeek.done;
  const doneByDay = followThrough.doneByDay;
  const dayLetters = followThrough.doneByDayLetters;
  const trend = done - lastWeekDone;
  // Only crow "best yet" when there's a REAL trend to crow about —
  // a first-week user has lastWeekDone = 0 and trend = done, which
  // isn't an improvement, it's just the starting line.
  const showTrendBest = trend > 0 && lastWeekDone > 0;

  const energyData = useMemo(
    () => energyTrend.map((d) => ({ day: d.day, v: d.v })),
    [energyTrend],
  );
  const fallback = { day: 'M', v: 0 };
  const peak = energyData.reduce(
    (a, b) => (b.v > a.v ? b : a),
    energyData[0] ?? fallback,
  );
  const low = energyData.reduce(
    (a, b) => (b.v < a.v ? b : a),
    energyData[0] ?? fallback,
  );

  // ── Week label ─────────────────────────────────────────────────────
  const weekLabel = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return `${monthDay(start)} – ${monthDay(end)}`;
  }, []);

  // ── Headline read of the week shape ──────────────────────────────
  const headline = useMemo(() => {
    if (set === 0) return 'A quiet week.';
    const rate = done / set;
    if (rate >= 0.8) return 'A strong week,\nquietly built.';
    if (rate >= 0.5) return 'A steady week —\nyou showed up.';
    if (done === 0) return 'A heavier week.\nNo penalty here.';
    return 'A mixed week.\nLumi sees the shape.';
  }, [done, set]);
  const headlineSub = useMemo(() => {
    if (set === 0)
      return "Not much on the docket — and that's fine. Rest is data too.";
    const rate = done / set;
    if (rate >= 0.5)
      return "You showed up more than you didn't. Here's what that looked like.";
    return 'Capacity has limits. The list waits — it doesn’t judge.';
  }, [done, set]);

  // Strong-window CTA copy uses real windows when we have a pattern.
  const next = useMemo(() => {
    if (pattern) {
      const winLabel = WINDOWS[pattern.strong].label.toLowerCase();
      return (
        <Text style={styles.nextBody}>
          Move your hardest {phrase.tasks} to{' '}
          <Text style={styles.nextBodyAccent}>{winLabel}s</Text> — your proven
          strong window. Lumi will set it up.
        </Text>
      );
    }
    if (avoidance) {
      return (
        <Text style={styles.nextBody}>
          A few{' '}
          <Text style={styles.nextBodyAccent}>{avoidance.label}</Text> have
          been waiting. Batch them into one 15-minute block — easier than
          one-offs.
        </Text>
      );
    }
    return (
      <Text style={styles.nextBody}>
        Keep checking in. After a couple weeks Lumi can name your strong
        windows and quiet hours.
      </Text>
    );
  }, [pattern, avoidance]);

  const close = () => {
    Haptics.selectionAsync();
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Pressable onPress={close} style={styles.closeBtn} hitSlop={10}>
        <Text style={styles.closeBtnGlyph}>×</Text>
      </Pressable>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1 · COVER ── */}
        <Section style={{ paddingHorizontal: 28, paddingTop: 60 }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.coverEyebrow}>Your Week</Text>
            <Text style={styles.coverWeek}>{weekLabel}</Text>
            <Text style={styles.coverH1}>{headline}</Text>
            <Text style={styles.coverSub}>{headlineSub}</Text>
            <Text style={styles.coverArrow}>↓</Text>
          </View>
        </Section>

        {/* ── 2 · FOLLOW-THROUGH ── */}
        <Section delay={0.1} style={{ paddingHorizontal: 28, paddingTop: 56 }}>
          <Text style={styles.sectionLabel}>Follow-through</Text>
          <View style={styles.bigCountRow}>
            <CountUp to={done} style={styles.bigCount} />
            <Text style={styles.bigCountDiv}>/ {set}</Text>
          </View>
          <Text style={styles.bigCountSub}>{phrase.tasks} cleared</Text>
          {showTrendBest && (
            <View style={styles.trendPill}>
              <Text style={styles.trendUp}>▲</Text>
              <Text style={styles.trendText}>
                {trend} more than last week — your best yet
              </Text>
            </View>
          )}
          {/* Mini week bars — letters align to actual days ending TODAY,
              not the old "MTWTFSS" hardcode that was only right on
              Sundays. */}
          <View style={styles.barsRow}>
            {doneByDay.map((q, i) => {
              const h = Math.max(5, q * 8);
              return (
                <View key={i} style={{ flex: 1, alignItems: 'center', gap: 5 }}>
                  <View
                    style={{
                      width: '70%',
                      maxWidth: 22,
                      height: h,
                      borderRadius: 5,
                      backgroundColor: accent.fg,
                    }}
                  />
                  <Text style={styles.barLabel}>{dayLetters[i] ?? ''}</Text>
                </View>
              );
            })}
          </View>
        </Section>

        {/* ── 3 · ENERGY STORY ── */}
        <Section delay={0.15} style={{ paddingHorizontal: 28, paddingTop: 56 }}>
          <Text style={styles.sectionLabel}>Your energy</Text>
          {/* Only narrate peak/dip when the math has at least two
              distinct points to compare. A new account with one
              check-in produced "Peaked Wednesday, dipped Wednesday."
              — same day, no story. */}
          {peak.day !== low.day && peak.v > 0 ? (
            <>
              <Text style={styles.energyH1}>
                Peaked{' '}
                <Text style={{ color: accent.fg }}>
                  {DAY_NAME[peak.day] ?? peak.day}
                </Text>
                , dipped{' '}
                <Text style={{ color: C.dusk }}>
                  {DAY_NAME[low.day] ?? low.day}
                </Text>
                .
              </Text>
              <View style={styles.curveCard}>
                <WeekCurve data={energyData} />
              </View>
              <Text style={styles.energyBody}>
                Your strongest day held{' '}
                <Text style={{ color: C.bone }}>{peak.v}</Text> — and Lumi
                quietly lightened your weakest day for you.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.energyH1}>
                Still finding your rhythm.
              </Text>
              <View style={styles.curveCard}>
                <WeekCurve data={energyData} />
              </View>
              <Text style={styles.energyBody}>
                A week or two of activity and Lumi will start sketching
                your real energy shape — peaks, dips, and where the slump
                lives.
              </Text>
            </>
          )}
        </Section>

        {/* ── 4 · PATTERN — only when the math finds a real signal ── */}
        {pattern && (
          <Section delay={0.2} style={{ paddingHorizontal: 20, paddingTop: 56 }}>
            <View style={styles.patternCard}>
              <View style={styles.patternTopGlow} />
              <View style={styles.patternHead}>
                <Text style={styles.patternSpark}>✦</Text>
                <Text style={styles.patternEyebrow}>{pattern.eyebrow}</Text>
              </View>
              <Text style={styles.patternHeadline}>{pattern.headline}</Text>
              <Text style={styles.patternBody}>{pattern.body}</Text>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Scheduled',
                    'Will move Trials to your strong window.',
                  )
                }
                style={styles.patternBtn}
              >
                <Text style={styles.patternBtnText}>{pattern.cta}</Text>
              </Pressable>
            </View>
          </Section>
        )}

        {/* ── 5 · AVOIDANCE — only when ≥3 stale items cluster ── */}
        {avoidance && (
          <Section
            delay={0.25}
            style={{ paddingHorizontal: 28, paddingTop: 56 }}
          >
            <Text style={styles.sectionLabel}>Still waiting</Text>
            <Text style={styles.avoidH1}>
              {avoidance.items.length} things have been waiting 5+ days.
              They&apos;re all {avoidance.label}.
            </Text>
            <View style={{ gap: 8, marginBottom: 18 }}>
              {avoidance.items.map((a) => (
                <View key={a.quest.id} style={styles.avoidRow}>
                  <Text style={styles.avoidTitle} numberOfLines={1}>
                    {a.quest.title}
                  </Text>
                  <Text style={styles.avoidDays}>
                    {formatStaleDays(a.days)}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.avoidNote}>
              That&apos;s a pattern, not a failure. Want to batch them into one
              15-minute block?
            </Text>
          </Section>
        )}

        {/* ── 6 · YOUR WIN ── */}
        {win && (
          <Section delay={0.3} style={{ paddingHorizontal: 28, paddingTop: 56 }}>
            <View style={styles.winCard}>
              <Text style={styles.winStar}>★</Text>
              <Text style={styles.winEyebrow}>Your win this week</Text>
              <Text style={styles.winHeadline}>{win.headline}</Text>
              <Text style={styles.winBody}>{win.body}</Text>
            </View>
          </Section>
        )}

        {/* ── 7 · NEXT WEEK ── */}
        <Section delay={0.35} style={{ paddingHorizontal: 28, paddingTop: 56 }}>
          <Text style={styles.sectionLabel}>Into next week</Text>
          <Text style={styles.nextH1}>
            One small shift could make next week lighter.
          </Text>
          <View style={styles.nextCard}>{next}</View>
        </Section>

        {/* ── 8 · SHARE / CLOSE ── */}
        <Section delay={0.4} style={{ paddingHorizontal: 28, paddingTop: 56 }}>
          <View style={styles.shareCard}>
            <SoftGlow
              color={accent.fg}
              opacity={0.2}
              fade={0.7}
              cx={0.92}
              cy={0.08}
              style={styles.shareGlow}
            />
            <Text style={styles.shareEyebrow}>Lumi · Your Week</Text>
            <View style={styles.shareStatsRow}>
              <View>
                <Text style={styles.shareStatNum}>{done}</Text>
                <Text style={styles.shareStatLabel}>{phrase.tasks} done</Text>
              </View>
              {companion.showStreak && (
                <View>
                  <Text style={[styles.shareStatNum, { color: C.honey }]}>
                    {streak}
                  </Text>
                  <Text style={styles.shareStatLabel}>day streak</Text>
                </View>
              )}
              <View>
                <Text style={[styles.shareStatNum, { color: C.dusk }]}>
                  {peak.v}
                </Text>
                <Text style={styles.shareStatLabel}>peak energy</Text>
              </View>
            </View>
            <Text style={styles.shareQuote}>
              &ldquo;Mornings are my strong window.&rdquo; — what Lumi taught me
              this week
            </Text>
          </View>
          <Pressable
            onPress={() =>
              Alert.alert('Share', 'Share sheet coming in a future build.')
            }
            style={styles.sharePrimary}
          >
            <Text style={styles.sharePrimaryText}>Share my week</Text>
          </Pressable>
          <Pressable onPress={close} style={styles.shareSecondary}>
            <Text style={styles.shareSecondaryText}>Done</Text>
          </Pressable>
          <Text style={styles.shareFoot}>
            Every week, Lumi understands you a little better.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const makeStyles = (accent: Accent) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },

  closeBtn: {
    position: 'absolute',
    top: 54,
    right: 20,
    zIndex: 40,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnGlyph: { color: C.boneDim, fontSize: 18, lineHeight: 18 },

  // Cover
  coverEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    letterSpacing: 3,
    color: accent.fg,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  coverWeek: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: C.mute,
    marginBottom: 6,
  },
  coverH1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 38,
    color: C.bone,
    letterSpacing: -1,
    lineHeight: 42,
    textAlign: 'center',
  },
  coverSub: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.boneDim,
    marginTop: 16,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  coverArrow: {
    marginTop: 24,
    fontSize: 20,
    color: C.mute,
  },

  // Section label
  sectionLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: C.mute,
    textTransform: 'uppercase',
    marginBottom: 14,
  },

  // Follow-through
  bigCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 4,
  },
  bigCount: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 76,
    color: accent.fg,
    letterSpacing: -2,
    lineHeight: 80,
    paddingRight: 10,
    includeFontPadding: false,
  },
  bigCountDiv: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 30,
    color: C.mute,
    paddingRight: 6,
    includeFontPadding: false,
  },
  bigCountSub: {
    fontFamily: fonts.inter,
    fontSize: 15,
    color: C.bone,
    letterSpacing: -0.2,
    marginBottom: 18,
  },
  trendPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: hexA('#869072', 0.08),
    borderWidth: 1,
    borderColor: hexA('#869072', 0.27),
    borderRadius: 100,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  trendUp: { color: C.lichen, fontSize: 13 },
  trendText: {
    fontFamily: fonts.interMed,
    fontSize: 13.5,
    color: C.bone,
  },
  barsRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-end',
    height: 60,
    marginTop: 24,
  },
  barLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9,
    color: C.mute,
  },

  // Energy
  energyH1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 24,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 32,
    marginBottom: 16,
  },
  curveCard: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 8,
  },
  energyBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 22,
    marginTop: 16,
  },

  // Pattern
  patternCard: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.27),
    borderRadius: 22,
    padding: 22,
    paddingTop: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  patternTopGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: hexA(C.dusk, 0.7),
  },
  patternHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  patternSpark: { fontSize: 13, color: C.dusk },
  patternEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: C.dusk,
    textTransform: 'uppercase',
  },
  patternHeadline: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 23,
    color: C.bone,
    letterSpacing: -0.4,
    lineHeight: 30,
    marginBottom: 14,
  },
  patternBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 22,
    marginBottom: 18,
  },
  patternBtn: {
    backgroundColor: hexA(C.dusk, 0.12),
    borderWidth: 1,
    borderColor: C.dusk,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  patternBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.dusk,
  },

  // Avoidance
  avoidH1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.4,
    lineHeight: 30,
    marginBottom: 18,
  },
  avoidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  avoidTitle: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.bone,
    letterSpacing: -0.1,
    flex: 1,
  },
  avoidDays: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11.5,
    color: C.honey,
  },
  avoidNote: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: C.boneDim,
    lineHeight: 22,
  },

  // Win
  winCard: {
    backgroundColor: hexA(C.glow, 0.08),
    borderWidth: 1,
    borderColor: hexA(C.glow, 0.27),
    borderRadius: 22,
    padding: 26,
    paddingTop: 22,
    alignItems: 'center',
  },
  winStar: { fontSize: 30, marginBottom: 12 },
  winEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: C.glow,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  winHeadline: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 25,
    color: C.bone,
    letterSpacing: -0.4,
    lineHeight: 34,
    marginBottom: 12,
    textAlign: 'center',
  },
  winBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 22,
    textAlign: 'center',
  },

  // Next week
  nextH1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 24,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 32,
    marginBottom: 16,
  },
  nextCard: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: hexA(accent.fg, 0.27),
    borderRadius: 16,
    padding: 18,
  },
  nextBody: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.bone,
    lineHeight: 23,
    letterSpacing: -0.1,
  },
  nextBodyAccent: { color: accent.fg, fontFamily: fonts.interSemi },

  // Share
  shareCard: {
    backgroundColor: '#221813',
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 22,
    padding: 22,
    paddingTop: 26,
    overflow: 'hidden',
    position: 'relative',
  },
  // SoftGlow paints inside this box — no borderRadius / backgroundColor
  // needed. Sized generously so the bloom can feather past the card
  // corner instead of reading as a hard moon.
  shareGlow: {
    position: 'absolute',
    top: -70,
    right: -70,
    width: 240,
    height: 240,
  },
  shareEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: accent.fg,
    textTransform: 'uppercase',
    marginBottom: 18,
  },
  shareStatsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  shareStatNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 34,
    color: C.bone,
    lineHeight: 38,
    paddingRight: 6,
    includeFontPadding: false,
  },
  shareStatLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    color: C.mute,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  shareQuote: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 16,
    color: C.boneDim,
    lineHeight: 22,
    borderTopWidth: 1,
    borderTopColor: C.hair,
    paddingTop: 16,
  },
  sharePrimary: {
    backgroundColor: accent.fg,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  sharePrimaryText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.void,
    letterSpacing: 0.2,
  },
  shareSecondary: {
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  shareSecondaryText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.mute,
  },
  shareFoot: {
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12,
    color: C.mute,
    marginTop: 20,
    lineHeight: 18,
  },
});

// Default ember-themed styles for module-level sub-components.
const styles = makeStyles(accentFor('ember'));
