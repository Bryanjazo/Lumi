// Lumi · Patterns — the shape of you.
//
// The retention moat, promoted to a first-class tab (replaces Focus,
// whose session now lives entirely on Home's hearth card). Everything
// here is computed on-device from the learning layer — zero tokens,
// zero network. The page's job: make the accumulation FEELABLE, so a
// day-30 user sees a picture of themselves no fresh app could draw.
//
// Sections: energy curve (48-slot area chart with peak/dip bands and
// a now-mark) · momentum stats with week trend · 4-week completion
// heat matrix · strong-vs-tender window bars · "Lumi noticed" cards
// (recurrence / avoidance named gently / win of the week) · best-day
// chip. Sparse-data guards throughout — day 1 shows warm promise, not
// empty charts.

import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

import { timeColors as C } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { WINDOWS } from '../../constants/windows';
import { useLearningDigest } from '../../lib/learning';
import { useQuestStore } from '../../store/questStore';
import { useUserStore } from '../../store/userStore';
import { useCompanionMode } from '../../lib/companion-mode';

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const localYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fmtClock = (min: number): string => {
  const h = Math.floor(min / 60) % 24;
  const hr = h % 12 || 12;
  return `${hr}${h < 12 ? 'a' : 'p'}`;
};

// ── Energy curve (Svg area chart) ────────────────────────────────────
const CurveChart = ({
  slots,
  peakStart,
  peakEnd,
  slumpStart,
  slumpEnd,
  learned,
}: {
  slots: { slot: number; energy: number }[];
  peakStart: number | null;
  peakEnd: number | null;
  slumpStart: number | null;
  slumpEnd: number | null;
  learned: boolean;
}) => {
  const W = 320;
  const H = 120;
  const PAD = 8;
  const x = (slot: number) => PAD + (slot / 47) * (W - PAD * 2);
  const y = (e: number) => H - 14 - (e / 100) * (H - 34);
  const minX = (min: number) => PAD + (min / 1440) * (W - PAD * 2);

  // Smooth path via midpoint quadratics.
  const pts = slots.map((s) => [x(s.slot), y(s.energy)] as const);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const mx = (px + cx) / 2;
    const my = (py + cy) / 2;
    d += ` Q ${px} ${py} ${mx} ${my}`;
  }
  const area = `${d} L ${pts[pts.length - 1][0]} ${H - 12} L ${pts[0][0]} ${H - 12} Z`;

  const now = new Date();
  const nowX = minX(now.getHours() * 60 + now.getMinutes());

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Defs>
        <LinearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.honey} stopOpacity={0.5} />
          <Stop offset="1" stopColor={C.honey} stopOpacity={0.03} />
        </LinearGradient>
      </Defs>
      {/* peak + dip bands */}
      {peakStart != null && peakEnd != null && (
        <Rect
          x={minX(peakStart)}
          y={8}
          width={Math.max(2, minX(peakEnd) - minX(peakStart))}
          height={H - 20}
          fill={hexA(C.ember, learned ? 0.1 : 0.05)}
          rx={6}
        />
      )}
      {slumpStart != null && slumpEnd != null && (
        <Rect
          x={minX(slumpStart)}
          y={8}
          width={Math.max(2, minX(slumpEnd) - minX(slumpStart))}
          height={H - 20}
          fill={hexA(C.dusk, learned ? 0.12 : 0.06)}
          rx={6}
        />
      )}
      <Path d={area} fill="url(#curveFill)" />
      <Path d={d} stroke={C.honey} strokeWidth={2} fill="none" />
      {/* now mark */}
      <Path
        d={`M ${nowX} 10 L ${nowX} ${H - 12}`}
        stroke={hexA(C.bone, 0.35)}
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <Circle
        cx={nowX}
        cy={y(slots[Math.min(47, Math.floor((now.getHours() * 60 + now.getMinutes()) / 30))]?.energy ?? 50)}
        r={3.5}
        fill={C.ember}
      />
      {/* baseline */}
      <Path
        d={`M ${PAD} ${H - 12} L ${W - PAD} ${H - 12}`}
        stroke={C.hair}
        strokeWidth={1}
      />
    </Svg>
  );
};

// ── 4-week completion heat matrix ────────────────────────────────────
const HeatMatrix = ({ counts }: { counts: number[] }) => {
  // counts: 28 values, oldest → newest. Render 4 rows × 7 cols.
  const max = Math.max(1, ...counts);
  return (
    <View style={{ gap: 5 }}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 5 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((col) => {
            const v = counts[row * 7 + col] ?? 0;
            const t = v / max;
            return (
              <View
                key={col}
                style={{
                  flex: 1,
                  aspectRatio: 1.6,
                  borderRadius: 5,
                  backgroundColor:
                    v === 0 ? hexA(C.bone, 0.05) : hexA(C.ember, 0.18 + t * 0.65),
                  borderWidth: 1,
                  borderColor:
                    v === 0 ? hexA(C.hair, 0.8) : hexA(C.ember, 0.25),
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
};

// ── Window bar (strong vs tender) ────────────────────────────────────
const WindowBar = ({
  label,
  done,
  set,
  color,
}: {
  label: string;
  done: number;
  set: number;
  color: string;
}) => {
  const rate = set > 0 ? done / set : 0;
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={styles.barLabel}>{label}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.barPct, { color }]}>
          {Math.round(rate * 100)}%
        </Text>
        <Text style={styles.barCount}>
          {' '}· {done} of {set}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.max(4, rate * 100)}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
};

export default function PatternsScreen() {
  const digest = useLearningDigest();
  const quests = useQuestStore((s) => s.quests);
  const tasksEver = useUserStore((s) => s.tasksEverCompleted);
  const focusMin = useUserStore((s) => s.focusMinutesLifetime);
  const companion = useCompanionMode();

  const curve = digest.curve;
  const learned = curve.source !== 'baseline';
  const ft = digest.followThrough;

  // 28-day completion heat (oldest → newest).
  const heat = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const q of quests) {
      if (!q.completed || !q.completedAt) continue;
      const k = localYmd(new Date(q.completedAt));
      byDay.set(k, (byDay.get(k) ?? 0) + 1);
    }
    const out: number[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(byDay.get(localYmd(d)) ?? 0);
    }
    return out;
  }, [quests]);
  const heatTotal = heat.reduce((a, b) => a + b, 0);
  const bestStreakRow = Math.max(...heat);

  const trendUp = ft.trend > 0;
  const hearthHours = Math.floor(focusMin / 60);
  const hearthRem = focusMin % 60;

  const strong = digest.followThrough.strongWindow;
  const weak = digest.followThrough.weakWindow;
  // Sparse-data guard: identical peak/low day says nothing.
  const dayChip =
    digest.peakDow != null &&
    digest.lowDow != null &&
    digest.peakDow !== digest.lowDow
      ? `${DOW[digest.peakDow]}s carry you · ${DOW[digest.lowDow]}s run quieter`
      : digest.peakDow != null
        ? `${DOW[digest.peakDow]}s tend to be your day`
        : null;

  const sparse = curve.sampleDays < 3 && heatTotal < 5;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>✦ PATTERNS</Text>
        <Text style={styles.h1}>The shape of you.</Text>
        <Text style={styles.sub}>
          {sparse
            ? 'A few days of showing up and this page starts drawing your picture — all of it lives on your phone.'
            : learned
              ? 'Drawn from what you actually do — not what a planner thinks you should.'
              : 'Still sketching — every check-in and finished task sharpens these lines.'}
        </Text>

        {/* ── 1 · ENERGY CURVE ── */}
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardEyebrow}>YOUR DAY, AS ENERGY</Text>
            {!learned && <Text style={styles.learningTag}>still learning</Text>}
          </View>
          <CurveChart
            slots={curve.slots}
            peakStart={curve.peakStart}
            peakEnd={curve.peakEnd}
            slumpStart={curve.slumpStart}
            slumpEnd={curve.slumpEnd}
            learned={learned}
          />
          <View style={styles.curveLegend}>
            {curve.peakStart != null && curve.peakEnd != null && (
              <Text style={styles.legendItem}>
                <Text style={{ color: C.ember }}>▮</Text> peak{' '}
                {fmtClock(curve.peakStart)}–{fmtClock(curve.peakEnd)}
              </Text>
            )}
            {curve.slumpStart != null && curve.slumpEnd != null && (
              <Text style={styles.legendItem}>
                <Text style={{ color: C.dusk }}>▮</Text> dip{' '}
                {fmtClock(curve.slumpStart)}–{fmtClock(curve.slumpEnd)}
              </Text>
            )}
          </View>
          {curve.peakStart != null && (
            <Text style={styles.cardWhisper}>
              the hard thing belongs in the ember band — that&apos;s when
              you&apos;re strongest
            </Text>
          )}
        </View>

        {/* ── 2 · MOMENTUM ── */}
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: C.ember }]}>
              {ft.thisWeek.done}
              {ft.lastWeek.set > 0 && (
                <Text style={styles.statTrend}>
                  {' '}
                  {trendUp ? '▲' : ft.trend < 0 ? '▽' : '—'}
                </Text>
              )}
            </Text>
            <Text style={styles.statLabel}>done this week</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: C.honey }]}>
              {tasksEver}
            </Text>
            <Text style={styles.statLabel}>finished, ever</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: C.dusk }]}>
              {focusMin === 0
                ? '—'
                : hearthHours > 0
                  ? `${hearthHours}h${hearthRem > 0 ? ` ${hearthRem}m` : ''}`
                  : `${hearthRem}m`}
            </Text>
            <Text style={styles.statLabel}>
              {companion.isFocused ? 'focused time' : 'by the hearth'}
            </Text>
          </View>
        </View>

        {/* ── 3 · FOUR WEEKS OF SHOWING UP ── */}
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardEyebrow}>FOUR WEEKS OF SHOWING UP</Text>
            {heatTotal > 0 && (
              <Text style={styles.learningTag}>
                {heatTotal} done · best day {bestStreakRow}
              </Text>
            )}
          </View>
          <HeatMatrix counts={heat} />
          <Text style={styles.cardWhisper}>
            {heatTotal === 0
              ? 'this grid warms up as you finish things — no rush'
              : 'warmth = things finished · gaps are rest, not failure'}
          </Text>
        </View>

        {/* ── 4 · WHERE THINGS ACTUALLY HAPPEN ── */}
        {(strong || weak) && (
          <View style={styles.card}>
            <Text style={styles.cardEyebrow}>WHERE THINGS ACTUALLY HAPPEN</Text>
            {strong && (
              <WindowBar
                label={`${WINDOWS[strong.window].label} — your strong window`}
                done={strong.done}
                set={strong.set}
                color={C.ember}
              />
            )}
            {weak && (
              <WindowBar
                label={`${WINDOWS[weak.window].label} — runs tender`}
                done={weak.done}
                set={weak.set}
                color={C.dusk}
              />
            )}
            {strong && (
              <Text style={styles.cardWhisper}>
                Lumi already leans on this — big things get offered to your{' '}
                {WINDOWS[strong.window].label.toLowerCase()} first
              </Text>
            )}
          </View>
        )}

        {/* ── 5 · LUMI NOTICED ── */}
        {(digest.recurrence.length > 0 || digest.avoidance || digest.win) && (
          <View style={styles.card}>
            <Text style={styles.cardEyebrow}>LUMI NOTICED</Text>
            {digest.win && (
              <View style={styles.noticeRow}>
                <Text style={[styles.noticeGlyph, { color: C.glow }]}>✦</Text>
                <Text style={styles.noticeText}>
                  You finished “{digest.win.quest.title}”
                  {digest.win.delayDays > 1
                    ? ` after carrying it ${digest.win.delayDays} days — that one counts double.`
                    : ' — clean and done.'}
                </Text>
              </View>
            )}
            {digest.recurrence.slice(0, 2).map((r) => (
              <View key={r.title} style={styles.noticeRow}>
                <Text style={[styles.noticeGlyph, { color: C.honey }]}>↻</Text>
                <Text style={styles.noticeText}>
                  “{r.title}” keeps coming back — want it to repeat on its
                  own? It&apos;s waiting on Home.
                </Text>
              </View>
            ))}
            {digest.avoidance && (
              <View style={styles.noticeRow}>
                <Text style={[styles.noticeGlyph, { color: C.dusk }]}>◔</Text>
                <Text style={styles.noticeText}>
                  A few {digest.avoidance.label} have been waiting a while.
                  Not a judgment — just naming it, in case one is ready.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── 6 · BEST DAY ── */}
        {dayChip && (
          <View style={styles.dayChip}>
            <Text style={styles.dayChipText}>{dayChip}</Text>
          </View>
        )}

        <Text style={styles.foot}>
          every week, this page knows you a little better ✦
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },
  scroll: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 130 },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    letterSpacing: 2,
    color: C.dusk,
  },
  h1: {
    fontFamily: fonts.fraunces,
    fontSize: 30,
    color: C.bone,
    marginTop: 4,
    paddingRight: 8, // italic overhang
  },
  sub: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    marginTop: 6,
    lineHeight: 19,
    marginBottom: 16,
  },
  card: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
  },
  cardHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.6,
    color: C.mute,
  },
  learningTag: {
    fontFamily: fonts.fraunces,
    fontSize: 11,
    color: C.dusk,
  },
  curveLegend: { flexDirection: 'row', gap: 16, marginTop: 8 },
  legendItem: { fontFamily: fonts.inter, fontSize: 11, color: C.boneDim },
  cardWhisper: {
    fontFamily: fonts.fraunces,
    fontSize: 12,
    color: C.mute,
    marginTop: 10,
    lineHeight: 17,
  },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statNum: {
    fontFamily: fonts.fraunces,
    fontSize: 24,
    paddingHorizontal: 4,
  },
  statTrend: { fontSize: 12 },
  statLabel: {
    fontFamily: fonts.inter,
    fontSize: 10.5,
    color: C.mute,
    marginTop: 3,
  },
  barLabel: { fontFamily: fonts.interMed, fontSize: 13, color: C.bone },
  barPct: { fontFamily: fonts.fraunces, fontSize: 15 },
  barCount: { fontFamily: fonts.inter, fontSize: 11, color: C.mute },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: hexA('#ECE0CB', 0.06),
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: 4 },
  noticeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    alignItems: 'flex-start',
  },
  noticeGlyph: { fontSize: 13, marginTop: 1 },
  noticeText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    lineHeight: 19,
  },
  dayChip: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: hexA('#8EA0B4', 0.35),
    backgroundColor: hexA('#8EA0B4', 0.1),
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 2,
    marginBottom: 6,
  },
  dayChipText: { fontFamily: fonts.fraunces, fontSize: 13, color: C.dusk },
  foot: {
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontSize: 12,
    color: C.mute,
    marginTop: 14,
  },
});
