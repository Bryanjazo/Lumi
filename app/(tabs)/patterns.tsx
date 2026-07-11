// Lumi · Patterns — the shape of you. (v4 portrait redesign)
//
// One composed PORTRAIT, not five stacked cards: zero card chrome,
// sections divided by labeled hairline rules like print. The hero
// energy curve is the only large visual — and it's SCRUBBABLE (drag
// to read any time's energy). Everything computed on-device from the
// learning layer — zero tokens, zero network.
//
// The mock's "day 1 / week 2 / week 6" toggles were demo-state
// switches, not shippable time nav — replaced here with REAL
// navigation on "Showing up": a Week/Month view switcher, ‹ ›
// steppers to any past week or month, and tap-a-day drill-in that
// names what actually got finished that day.
//
// Soul: sparse guards everywhere (day 1 = dotted "first sketch",
// never empty dashboards), gaps are rest not failure, Focused
// companion mode strips the cozy language.

import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { timeColors as C } from '../../constants/colors';
import { fonts, italicNumberFix } from '../../constants/fonts';
import { WINDOWS } from '../../constants/windows';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';
import { useLearningDigest } from '../../lib/learning';
import { useCompanionMode } from '../../lib/companion-mode';
import { useQuestStore } from '../../store/questStore';
import { useUserStore } from '../../store/userStore';

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const localYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** minutes-since-midnight → "9a" / "2:30p" */
const fmtClock = (min: number): string => {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const hr = h % 12 || 12;
  return `${hr}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
};

// ═════════════════════════════════════════════════════════════════════
// Labeled rule — the print-style section divider that replaced cards.
// ═════════════════════════════════════════════════════════════════════
const Rule = ({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) => (
  <View style={styles.ruleRow}>
    <Text style={styles.ruleLabel}>{label}</Text>
    <View style={styles.ruleLine} />
    {typeof right === 'string' ? (
      <Text style={styles.ruleRight}>{right}</Text>
    ) : (
      right ?? null
    )}
  </View>
);

// ═════════════════════════════════════════════════════════════════════
// Hero — the scrubbable energy curve. Drag anywhere on the chart to
// read that time's energy; release and the cursor returns to NOW.
// Baseline (day-1) state renders a dotted "first sketch" instead —
// no scrub, no fill, a promise rather than a fake chart.
// ═════════════════════════════════════════════════════════════════════
const CW = 340;
const CH = 150;
const CTOP = 14;
const CBASE = 126;

const EnergyHero = ({
  slots,
  peakStart,
  peakEnd,
  slumpStart,
  slumpEnd,
  sparse,
  focused,
}: {
  slots: { slot: number; energy: number }[];
  peakStart: number | null;
  peakEnd: number | null;
  slumpStart: number | null;
  slumpEnd: number | null;
  sparse: boolean;
  focused: boolean;
}) => {
  const [scrubH, setScrubH] = useState<number | null>(null);
  const chartWRef = useRef(1);

  // Catmull-Rom → cubic segments: visibly smoother than the old
  // midpoint quadratics at the same point count.
  const geo = useMemo(() => {
    const pts = slots.map(
      (s) =>
        [
          (s.slot / 47) * CW,
          CBASE - (s.energy / 100) * (CBASE - CTOP),
        ] as const,
    );
    let line = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      line += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return { line, area: `${line} L ${CW},${CBASE} L 0,${CBASE} Z` };
  }, [slots]);

  const eAt = (h: number) =>
    slots[Math.max(0, Math.min(47, Math.round(h * 2)))]?.energy ?? 50;

  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const cursor = scrubH ?? nowH;
  const cx = (cursor / 24) * CW;
  const cy = CBASE - (eAt(cursor) / 100) * (CBASE - CTOP);
  const cursorE = Math.round(eAt(cursor));
  const tone: [string, string] =
    cursorE >= 60
      ? ['strong', C.honey]
      : cursorE <= 30
        ? ['runs tender', C.dusk]
        : ['steady', C.boneDim];

  // One pointer handler, no chart deps. Width read through a ref so
  // the responder (created once) never sees a stale layout.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const x = e.nativeEvent.locationX;
        setScrubH(
          Math.max(0, Math.min(23.98, (x / chartWRef.current) * 24)),
        );
      },
      onPanResponderMove: (e) => {
        const x = e.nativeEvent.locationX;
        setScrubH(
          Math.max(0, Math.min(23.98, (x / chartWRef.current) * 24)),
        );
      },
      onPanResponderRelease: () => setScrubH(null),
      onPanResponderTerminate: () => setScrubH(null),
    }),
  ).current;

  const minX = (min: number) => (min / 1440) * CW;
  const readoutLeftPct = Math.min(72, Math.max(2, (cx / CW) * 100 - 11));

  return (
    <View>
      <View
        onLayout={(e) => {
          chartWRef.current = Math.max(1, e.nativeEvent.layout.width);
        }}
        {...(sparse ? {} : pan.panHandlers)}
      >
        <Svg width="100%" height={CH} viewBox={`0 0 ${CW} ${CH}`}>
          <Defs>
            <LinearGradient id="p4fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={C.honey} stopOpacity={0.4} />
              <Stop offset="1" stopColor={C.honey} stopOpacity={0.02} />
            </LinearGradient>
          </Defs>
          {/* peak + dip bands */}
          {peakStart != null && peakEnd != null && (
            <Rect
              x={minX(peakStart)}
              y={CTOP - 4}
              width={Math.max(2, minX(peakEnd) - minX(peakStart))}
              height={CBASE - CTOP + 4}
              fill={hexA(C.ember, 0.09)}
            />
          )}
          {slumpStart != null && slumpEnd != null && (
            <Rect
              x={minX(slumpStart)}
              y={CTOP - 4}
              width={Math.max(2, minX(slumpEnd) - minX(slumpStart))}
              height={CBASE - CTOP + 4}
              fill={hexA(C.dusk, 0.07)}
            />
          )}
          {/* baseline + 6h ticks */}
          {[0, 6, 12, 18, 24].map((h) => (
            <Line
              key={h}
              x1={(h / 24) * CW}
              y1={CBASE}
              x2={(h / 24) * CW}
              y2={CBASE + 4}
              stroke={hexA(C.bone, 0.25)}
              strokeWidth={1}
            />
          ))}
          <Line
            x1={0}
            y1={CBASE}
            x2={CW}
            y2={CBASE}
            stroke={hexA(C.bone, 0.16)}
            strokeWidth={1}
          />
          {/* the curve — dotted first-sketch when sparse */}
          {sparse ? (
            <Path
              d={geo.line}
              fill="none"
              stroke={hexA(C.bone, 0.28)}
              strokeWidth={1.6}
              strokeDasharray="1 5"
              strokeLinecap="round"
            />
          ) : (
            <>
              <Path d={geo.area} fill="url(#p4fill)" />
              <Path
                d={geo.line}
                fill="none"
                stroke={C.honey}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </>
          )}
          {/* cursor: now (ember, dashed) or scrub (bone, solid) */}
          {!sparse && (
            <>
              <Line
                x1={cx}
                y1={cy + 5}
                x2={cx}
                y2={CBASE}
                stroke={hexA(scrubH != null ? C.bone : C.ember, 0.45)}
                strokeWidth={1}
                strokeDasharray={scrubH != null ? undefined : '2 3'}
              />
              <Circle
                cx={cx}
                cy={cy}
                r={4}
                fill={scrubH != null ? C.bone : C.ember}
              />
            </>
          )}
          {[6, 12, 18].map((h) => (
            <SvgText
              key={h}
              x={(h / 24) * CW}
              y={CH - 6}
              textAnchor="middle"
              fontSize={9}
              fill={C.mute}
            >
              {h === 12 ? 'noon' : fmtClock(h * 60)}
            </SvgText>
          ))}
        </Svg>
        {/* scrub / now readout */}
        {!sparse && (
          <View
            pointerEvents="none"
            style={[styles.readout, { left: `${readoutLeftPct}%` }]}
          >
            <Text style={styles.readoutText}>
              {fmtClock(Math.round(cursor * 2) * 30)} ·{' '}
              <Text style={{ color: tone[1] }}>{cursorE}</Text>
              <Text style={{ color: C.mute }}>
                {' '}
                — {scrubH != null ? tone[0] : 'now'}
              </Text>
            </Text>
          </View>
        )}
      </View>
      {peakStart != null && peakEnd != null ? (
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: C.ember }]} />
            <Text style={styles.legendText}>
              peak {fmtClock(peakStart)}–{fmtClock(peakEnd)}
            </Text>
          </View>
          {slumpStart != null && slumpEnd != null && (
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: hexA(C.dusk, 0.7) },
                ]}
              />
              <Text style={styles.legendText}>
                dip {fmtClock(slumpStart)}–{fmtClock(slumpEnd)}
              </Text>
            </View>
          )}
        </View>
      ) : (
        <Text style={styles.sketchLine}>
          a first sketch — check in for a few days and this line becomes
          yours.
        </Text>
      )}
      {peakStart != null && !focused && (
        <Text style={styles.whisper}>
          the hard thing belongs in the ember band — that&apos;s when
          you&apos;re strongest.
        </Text>
      )}
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Showing up — navigable warmth field. Week view (7 big day cells) or
// Month view (a real calendar month), ‹ › steppers to any past period,
// tap a day to see what actually got finished. This replaces the
// mock's demo-stage toggles with genuine time navigation.
// ═════════════════════════════════════════════════════════════════════
type DayLog = Map<string, { count: number; titles: string[] }>;

const MAX_WEEKS_BACK = 26;
const MAX_MONTHS_BACK = 6;

const cellColors = (count: number, max: number) => {
  if (count === 0)
    return { bg: C.void2, border: C.hair, glow: false };
  const t = Math.min(1, count / Math.max(2, max));
  return {
    bg: hexA(C.ember, 0.25 + t * 0.6),
    border: hexA(C.ember, 0.35),
    glow: count >= 2,
  };
};

const ShowingUp = ({
  dayLog,
  focused,
  view,
}: {
  dayLog: DayLog;
  focused: boolean;
  view: 'week' | 'month';
}) => {
  const [offset, setOffset] = useState(0); // periods back from now
  const [selected, setSelected] = useState<string | null>(null);

  const todayYmd = localYmd(new Date());

  // Build the visible period's day list (ymd strings, Sunday-first).
  const days = useMemo<(string | null)[]>(() => {
    const now = new Date();
    if (view === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay() - offset * 7);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return localYmd(d);
      });
    }
    const m = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const lead = m.getDay();
    const dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= dim; d++)
      cells.push(localYmd(new Date(m.getFullYear(), m.getMonth(), d)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view, offset]);

  const periodLabel = useMemo(() => {
    const now = new Date();
    if (view === 'week') {
      if (offset === 0) return 'this week';
      if (offset === 1) return 'last week';
      const first = days.find(Boolean) as string;
      const last = [...days].reverse().find(Boolean) as string;
      const f = new Date(first + 'T12:00');
      const l = new Date(last + 'T12:00');
      return f.getMonth() === l.getMonth()
        ? `${MONTHS[f.getMonth()]} ${f.getDate()} – ${l.getDate()}`
        : `${MONTHS[f.getMonth()]} ${f.getDate()} – ${MONTHS[l.getMonth()]} ${l.getDate()}`;
    }
    if (offset === 0) return 'this month';
    const m = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return m.getFullYear() === now.getFullYear()
      ? MONTHS[m.getMonth()]
      : `${MONTHS[m.getMonth()]} ${m.getFullYear()}`;
  }, [view, offset, days]);

  const maxBack = view === 'week' ? MAX_WEEKS_BACK : MAX_MONTHS_BACK;
  const periodTotal = days.reduce(
    (a, d) => a + (d ? (dayLog.get(d)?.count ?? 0) : 0),
    0,
  );
  const maxInPeriod = days.reduce(
    (a, d) => Math.max(a, d ? (dayLog.get(d)?.count ?? 0) : 0),
    0,
  );

  const step = (dir: 1 | -1) => {
    void Haptics.selectionAsync();
    setSelected(null);
    setOffset((o) => Math.max(0, Math.min(maxBack, o + dir)));
  };
  const sel = selected ? dayLog.get(selected) : null;
  const selDate = selected ? new Date(selected + 'T12:00') : null;

  const renderCell = (ymd: string | null, i: number, big: boolean) => {
    if (!ymd)
      return <View key={`pad${i}`} style={big ? styles.weekCell : styles.monthCell} />;
    const isFuture = ymd > todayYmd;
    const isToday = ymd === todayYmd;
    const count = dayLog.get(ymd)?.count ?? 0;
    const col = cellColors(isFuture ? 0 : count, maxInPeriod);
    return (
      <Pressable
        key={ymd}
        disabled={isFuture}
        onPress={() => {
          void Haptics.selectionAsync();
          setSelected((s) => (s === ymd ? null : ymd));
        }}
        style={[
          big ? styles.weekCell : styles.monthCell,
          {
            backgroundColor: isFuture ? 'transparent' : col.bg,
            borderColor: isToday
              ? hexA(C.ember, 0.7)
              : selected === ymd
                ? hexA(C.bone, 0.5)
                : col.border,
            borderStyle: isToday ? 'dashed' : 'solid',
            opacity: isFuture ? 0.3 : 1,
          },
          col.glow && styles.cellGlow,
        ]}
      >
        {big && count > 0 && (
          <Text style={styles.weekCellNum}>{count}</Text>
        )}
      </Pressable>
    );
  };

  return (
    <View>
      {/* nav strip: ‹ period label › */}
      <View style={styles.navRow}>
        <Pressable
          onPress={() => step(1)}
          disabled={offset >= maxBack}
          hitSlop={10}
          style={{ opacity: offset >= maxBack ? 0.25 : 1 }}
        >
          <Text style={styles.navChev}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.navLabel}>{periodLabel}</Text>
          {periodTotal > 0 && (
            <Text style={styles.navSub}>{periodTotal} finished</Text>
          )}
        </View>
        <Pressable
          onPress={() => step(-1)}
          disabled={offset === 0}
          hitSlop={10}
          style={{ opacity: offset === 0 ? 0.25 : 1 }}
        >
          <Text style={styles.navChev}>›</Text>
        </Pressable>
      </View>

      {view === 'week' ? (
        <View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {days.map((d, i) => renderCell(d, i, true))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            {DOW_LETTER.map((l, i) => (
              <Text key={i} style={styles.dowLetter}>
                {l}
              </Text>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {Array.from({ length: days.length / 7 }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
              {days
                .slice(r * 7, r * 7 + 7)
                .map((d, i) => renderCell(d, r * 7 + i, false))}
            </View>
          ))}
        </View>
      )}

      {/* tapped-day drill-in */}
      {selected && selDate && (
        <View style={styles.dayReadout}>
          <Text style={styles.dayReadoutHead}>
            {DOW[selDate.getDay()]}, {MONTHS[selDate.getMonth()]}{' '}
            {selDate.getDate()}
            {sel && sel.count > 0 ? ` · ${sel.count} finished` : ''}
          </Text>
          {sel && sel.count > 0 ? (
            <Text style={styles.dayReadoutBody}>
              {sel.titles.slice(0, 3).join(' · ')}
              {sel.titles.length > 3
                ? `  +${sel.titles.length - 3} more`
                : ''}
            </Text>
          ) : (
            <Text style={styles.dayReadoutRest}>
              nothing finished — rest counts too.
            </Text>
          )}
        </View>
      )}

      {!focused && (
        <Text style={styles.whisperSmall}>
          warmth = things finished · gaps are rest, not failure
        </Text>
      )}
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════
export default function PatternsScreen() {
  const router = useRouter();
  const digest = useLearningDigest();
  const quests = useQuestStore((s) => s.quests);
  const tasksEver = useUserStore((s) => s.tasksEverCompleted);
  const focusMin = useUserStore((s) => s.focusMinutesLifetime);
  const companion = useCompanionMode();
  const focused = companion.isFocused;
  // Week/Month for "Showing up" — lifted here so the toggle can sit
  // in the section rule while the grid remounts fresh per view.
  const [supView, setSupView] = useState<'week' | 'month'>('week');

  const curve = digest.curve;
  const sparseCurve = curve.source === 'baseline';
  const learned = curve.source === 'learned';
  const ft = digest.followThrough;

  // Every completed quest, bucketed by local day — feeds the
  // navigable warmth field AND the tap-a-day drill-in.
  const dayLog = useMemo<DayLog>(() => {
    const m: DayLog = new Map();
    for (const q of quests) {
      if (!q.completed || !q.completedAt) continue;
      const k = localYmd(new Date(q.completedAt));
      const e = m.get(k) ?? { count: 0, titles: [] };
      e.count += 1;
      e.titles.push(q.title);
      m.set(k, e);
    }
    return m;
  }, [quests]);
  const everLogged = dayLog.size > 0;

  const sparsePage = curve.sampleDays < 3 && !everLogged;

  const trendChar = ft.trend > 0 ? '▲' : ft.trend < 0 ? '▽' : '—';
  const fmtMin = (m: number) =>
    m >= 60
      ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
      : `${m}m`;

  const strong = ft.strongWindow;
  const weak = ft.weakWindow;

  const dayChip =
    digest.peakDow != null &&
    digest.lowDow != null &&
    digest.peakDow !== digest.lowDow
      ? { up: `${DOW[digest.peakDow]}s carry you`, down: `${DOW[digest.lowDow]}s run quieter` }
      : digest.peakDow != null
        ? { up: `${DOW[digest.peakDow]}s tend to be your day`, down: null }
        : null;

  const hasNoticed =
    digest.win != null ||
    digest.recurrence.length > 0 ||
    digest.avoidance != null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* 0 · header, adaptive */}
        <Text style={styles.eyebrow}>✦ PATTERNS</Text>
        <Text style={styles.h1}>The shape of you.</Text>
        <Text style={sparsePage || learned ? styles.sub : styles.subItal}>
          {sparsePage
            ? 'a few days of showing up and this page starts drawing your picture — all of it lives on your phone.'
            : learned
              ? 'drawn from what you actually do — not what a planner thinks you should.'
              : 'still sketching…'}
        </Text>

        {/* 1 · hero curve */}
        <Rule
          label="Your day, as energy"
          right={!learned ? 'still learning' : undefined}
        />
        <EnergyHero
          slots={curve.slots}
          peakStart={sparseCurve ? null : curve.peakStart}
          peakEnd={sparseCurve ? null : curve.peakEnd}
          slumpStart={sparseCurve ? null : curve.slumpStart}
          slumpEnd={sparseCurve ? null : curve.slumpEnd}
          sparse={sparseCurve}
          focused={focused}
        />

        {/* 2 · momentum — mantel numbers, only when data */}
        {(ft.thisWeek.done > 0 || tasksEver > 0 || focusMin > 0) && (
          <View style={styles.mantel}>
            <View style={styles.mantelCol}>
              <Text style={[styles.mantelNum, { color: C.ember }]}>
                {ft.thisWeek.done}
                {ft.lastWeek.set > 0 && (
                  <Text
                    style={[
                      styles.mantelTrend,
                      { color: ft.trend > 0 ? C.honey : C.mute },
                    ]}
                  >
                    {' '}
                    {trendChar}
                  </Text>
                )}
              </Text>
              <Text style={styles.mantelLabel}>done this week</Text>
            </View>
            <View style={styles.mantelDiv} />
            <View style={styles.mantelCol}>
              <Text style={[styles.mantelNum, { color: C.honey }]}>
                {tasksEver}
              </Text>
              <Text style={styles.mantelLabel}>finished, ever</Text>
            </View>
            <View style={styles.mantelDiv} />
            <View style={styles.mantelCol}>
              <Text style={[styles.mantelNum, { color: C.dusk }]}>
                {focusMin === 0 ? '—' : fmtMin(focusMin)}
              </Text>
              <Text style={styles.mantelLabel}>
                {focused ? 'focused time' : 'by the hearth'}
              </Text>
            </View>
          </View>
        )}

        {/* 3 · showing up — REAL time navigation */}
        <Rule
          label="Showing up"
          right={
            <View style={styles.segRow}>
              {(['week', 'month'] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => {
                    if (v === supView) return;
                    void Haptics.selectionAsync();
                    setSupView(v);
                  }}
                  hitSlop={6}
                  style={[styles.segBtn, supView === v && styles.segBtnOn]}
                >
                  <Text
                    style={[
                      styles.segText,
                      supView === v && styles.segTextOn,
                    ]}
                  >
                    {v}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />
        <ShowingUp
          key={supView}
          view={supView}
          dayLog={dayLog}
          focused={focused}
        />

        {/* 4 · windows */}
        {(strong || weak) && (
          <>
            <Rule label="Where things actually happen" />
            {strong && (
              <WindowRow
                name={WINDOWS[strong.window].label}
                note="your strong window"
                done={strong.done}
                set={strong.set}
                color={C.ember}
                glow
              />
            )}
            {weak && (
              <WindowRow
                name={WINDOWS[weak.window].label}
                note="runs tender"
                done={weak.done}
                set={weak.set}
                color={C.dusk}
              />
            )}
            {strong && !focused && (
              <Text style={styles.whisperSmall}>
                Lumi already leans on this — big things get offered to your{' '}
                {WINDOWS[strong.window].label.toLowerCase()} first.
              </Text>
            )}
          </>
        )}

        {/* 5 · Lumi noticed — her voice, typed per insight */}
        {hasNoticed && (
          <>
            <Rule label="Lumi noticed" />
            {digest.win && (
              <View style={styles.winRow}>
                <Text style={styles.winGlyph}>✦</Text>
                <Text style={styles.winText}>
                  you finished “{digest.win.quest.title}”
                  {digest.win.delayDays > 1
                    ? ` after carrying it ${digest.win.delayDays} days — that one counts double.`
                    : ' — clean and done.'}
                </Text>
              </View>
            )}
            {digest.recurrence.slice(0, 2).map((r) => (
              <Pressable
                key={r.title}
                style={styles.doorRow}
                onPress={() => {
                  void Haptics.selectionAsync();
                  router.push('/(tabs)');
                }}
              >
                <View style={styles.doorDot} />
                <Text style={styles.doorText}>
                  “{r.title}” keeps coming back{' '}
                  <Text style={{ color: C.mute }}>
                    — want it to repeat on its own?
                  </Text>
                </Text>
                <Text style={styles.doorCta}>set it up →</Text>
              </Pressable>
            ))}
            {digest.avoidance && !focused && (
              <Text style={styles.avoidLine}>
                a few {digest.avoidance.label} have been waiting a while. not
                a judgment — just naming it, in case one is ready.
              </Text>
            )}
          </>
        )}

        {/* 6 · best-day chip */}
        {dayChip && (
          <View style={styles.chipWrap}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>
                <Text style={{ color: C.honey }}>{dayChip.up}</Text>
                {dayChip.down ? (
                  <Text style={{ color: C.mute }}> · {dayChip.down}</Text>
                ) : null}
              </Text>
            </View>
          </View>
        )}

        {/* 7 · footer */}
        <Text style={styles.foot}>
          every week, this page knows you a little better ✦
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const WindowRow = ({
  name,
  note,
  done,
  set,
  color,
  glow,
}: {
  name: string;
  note: string;
  done: number;
  set: number;
  color: string;
  glow?: boolean;
}) => {
  const pct = set > 0 ? Math.round((done / set) * 100) : 0;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.winHeadRow}>
        <Text style={styles.winName}>
          {name} <Text style={[styles.winNote, { color }]}>— {note}</Text>
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.winCount}>
          <Text style={[styles.winPct, { color }]}>{pct}%</Text> · {done} of{' '}
          {set}
        </Text>
      </View>
      <View style={styles.winTrack}>
        <View
          style={[
            styles.winFill,
            {
              width: `${Math.max(pct, 2)}%`,
              backgroundColor: color,
            },
            glow && {
              shadowColor: C.ember,
              shadowOpacity: 0.5,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },
  scroll: {
    paddingHorizontal: 26,
    paddingTop: 16,
    paddingBottom: FLOATING_NAV_CLEARANCE + 34,
  },

  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.6,
    color: C.dusk,
    textTransform: 'uppercase',
  },
  h1: {
    fontFamily: fonts.fraunces,
    fontSize: 34,
    color: C.bone,
    marginTop: 8,
    lineHeight: 38,
    letterSpacing: -0.8,
    paddingRight: 8,
  },
  sub: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 310,
  },
  subItal: {
    fontFamily: fonts.fraunces,
    fontSize: 13,
    color: C.dusk,
    marginTop: 8,
    paddingRight: 3,
  },

  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 28,
    marginBottom: 14,
  },
  ruleLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: C.mute,
  },
  ruleLine: { flex: 1, height: 1, backgroundColor: C.hair },
  ruleRight: {
    fontFamily: fonts.fraunces,
    fontSize: 12,
    color: C.dusk,
    paddingRight: 3,
  },

  readout: {
    position: 'absolute',
    top: 0,
    backgroundColor: hexA(C.void, 0.85),
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  readoutText: { fontFamily: fonts.inter, fontSize: 11, color: C.bone },
  legendRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontFamily: fonts.inter, fontSize: 11.5, color: C.boneDim },
  sketchLine: {
    fontFamily: fonts.fraunces,
    fontSize: 13,
    color: C.dusk,
    marginTop: 8,
    paddingRight: 3,
  },
  whisper: {
    fontFamily: fonts.fraunces,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 21,
    marginTop: 8,
    paddingRight: 3,
  },
  whisperSmall: {
    fontFamily: fonts.fraunces,
    fontSize: 12.5,
    color: hexA(C.boneDim, 0.85),
    lineHeight: 19,
    marginTop: 12,
    paddingRight: 3,
  },

  mantel: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 26,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.hair,
    paddingVertical: 14,
  },
  mantelCol: { flex: 1, alignItems: 'center' },
  mantelDiv: { width: 1, backgroundColor: C.hair },
  mantelNum: {
    fontFamily: fonts.fraunces,
    fontSize: 26,
    lineHeight: 28,
    ...italicNumberFix,
  },
  mantelTrend: { fontSize: 13 },
  mantelLabel: {
    fontFamily: fonts.inter,
    fontSize: 10,
    color: C.mute,
    marginTop: 5,
  },

  segRow: { flexDirection: 'row', gap: 4 },
  segBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segBtnOn: { borderColor: hexA(C.ember, 0.5), backgroundColor: hexA(C.ember, 0.12) },
  segText: { fontFamily: fonts.inter, fontSize: 11, color: C.mute },
  segTextOn: { color: C.ember, fontFamily: fonts.interMed },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  navChev: {
    fontFamily: fonts.inter,
    fontSize: 24,
    color: C.boneDim,
    paddingHorizontal: 10,
    lineHeight: 28,
  },
  navLabel: {
    fontFamily: fonts.fraunces,
    fontSize: 15,
    color: C.bone,
    paddingRight: 3,
  },
  navSub: {
    fontFamily: fonts.inter,
    fontSize: 10.5,
    color: C.mute,
    marginTop: 2,
  },

  weekCell: {
    flex: 1,
    aspectRatio: 0.9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekCellNum: {
    fontFamily: fonts.fraunces,
    fontSize: 17,
    color: C.bone,
    ...italicNumberFix,
  },
  monthCell: {
    flex: 1,
    aspectRatio: 1.35,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cellGlow: {
    shadowColor: C.ember,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  dowLetter: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.inter,
    fontSize: 10,
    color: C.mute,
  },
  dayReadout: {
    marginTop: 14,
    borderLeftWidth: 2,
    borderLeftColor: hexA(C.ember, 0.5),
    paddingLeft: 12,
  },
  dayReadoutHead: {
    fontFamily: fonts.interMed,
    fontSize: 12.5,
    color: C.bone,
  },
  dayReadoutBody: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.boneDim,
    lineHeight: 19,
    marginTop: 3,
  },
  dayReadoutRest: {
    fontFamily: fonts.fraunces,
    fontSize: 12.5,
    color: C.dusk,
    marginTop: 3,
    paddingRight: 3,
  },

  winHeadRow: { flexDirection: 'row', alignItems: 'baseline' },
  winName: { fontFamily: fonts.inter, fontSize: 14, color: C.bone },
  winNote: { fontFamily: fonts.fraunces, fontSize: 13, paddingRight: 3 },
  winCount: { fontFamily: fonts.inter, fontSize: 11.5, color: C.mute },
  winPct: { fontFamily: fonts.fraunces, fontSize: 14, ...italicNumberFix },
  winTrack: {
    height: 3,
    backgroundColor: C.void2,
    borderRadius: 2,
    marginTop: 7,
  },
  winFill: { height: 3, borderRadius: 2 },

  winRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  winGlyph: { color: C.glow, fontSize: 13, lineHeight: 20 },
  winText: {
    flex: 1,
    fontFamily: fonts.fraunces,
    fontSize: 15,
    color: C.boneDim,
    lineHeight: 24,
    paddingRight: 3,
  },
  doorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: C.hair,
  },
  doorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.amethyst,
  },
  doorText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.bone,
    lineHeight: 20,
  },
  doorCta: { fontFamily: fonts.inter, fontSize: 11.5, color: C.dusk },
  avoidLine: {
    fontFamily: fonts.fraunces,
    fontSize: 13,
    color: C.dusk,
    lineHeight: 21,
    marginTop: 14,
    paddingRight: 3,
  },

  chipWrap: { alignItems: 'center', marginTop: 28 },
  chip: {
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipText: { fontFamily: fonts.inter, fontSize: 12, color: C.boneDim },

  foot: {
    fontFamily: fonts.fraunces,
    fontSize: 12.5,
    color: C.mute,
    textAlign: 'center',
    marginTop: 26,
    paddingRight: 3,
  },
});
