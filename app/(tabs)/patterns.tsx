// Lumi · Patterns — the shape of you. (v4 portrait redesign)
//
// One composed PORTRAIT, not five stacked cards: zero card chrome,
// sections divided by labeled hairline rules like print. The hero
// energy curve is the only large visual — and it's SCRUBBABLE (drag
// to read any time's energy). Everything computed on-device from the
// learning layer — zero tokens, zero network.
//
// "Showing up" carries REAL time navigation (the mock's day-1/week-2
// toggles were demo-state switches): Week/Month segmented views,
// ‹ › steppers to any past week or month, tap-a-day drill-in.
//
// Post-audit hardening (two independent auditors, Jul 2026):
// - one x-scale for everything (minutes); slots plot at slot CENTERS
// - preserveAspectRatio="none" so touch math matches the drawing on
//   every device width (letterboxing skewed scrubs ~70min on Pro Max)
// - scrub claims the gesture only on horizontal intent and refuses
//   termination — no more ScrollView stealing mid-drag
// - "now" ticks every 60s while focused (was frozen at render time)
// - the two "this week" numbers agree (both count completions in the
//   Sunday-anchored calendar week)
// - history merges userStore.doneLog so deleting old quests on Home
//   can never turn a past warm day cold
// - focused companion mode strips ALL cozy strings, not just whispers
//
// Soul: sparse guards everywhere (day 1 = dotted "first sketch",
// never empty dashboards), gaps are rest not failure.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { fonts, italicNumberFixLarge } from '../../constants/fonts';
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
const DOW_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday',
];
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
      (right ?? null)
    )}
  </View>
);

// ═════════════════════════════════════════════════════════════════════
// Hero — the scrubbable energy curve. Drag horizontally to read any
// time's energy; release and the cursor breathes back to NOW.
// Baseline (day-1) state renders a dotted "first sketch" instead —
// no scrub, no fill, a promise rather than a fake chart.
//
// ONE coordinate system: minutes-since-midnight / 1440 → x. Slots
// plot at their CENTER minute (slot·30+15) so the now-dot, bands,
// ticks and the line itself all agree (the old /47-vs-/1440 split
// floated the dot ~7px off the curve by evening).
// ═════════════════════════════════════════════════════════════════════
const CW = 340;
const CH = 150;
const CTOP = 14;
const CBASE = 126;

const xAtMin = (min: number) => (min / 1440) * CW;
const yAtE = (e: number) => CBASE - (e / 100) * (CBASE - CTOP);

const EnergyHero = ({
  slots,
  peakStart,
  peakEnd,
  slumpStart,
  slumpEnd,
  sparse,
  learned,
  focused,
  nowMs,
  wakeMin,
  sleepMin,
}: {
  slots: { slot: number; energy: number }[];
  peakStart: number | null;
  peakEnd: number | null;
  slumpStart: number | null;
  slumpEnd: number | null;
  sparse: boolean;
  learned: boolean;
  focused: boolean;
  nowMs: number;
  wakeMin: number | null;
  sleepMin: number | null;
}) => {
  const [scrubH, setScrubH] = useState<number | null>(null);
  const chartWRef = useRef(1);
  const lastSlotRef = useRef(-1);

  const geo = useMemo(() => {
    // Catmull-Rom → cubic segments, points at slot-center minutes.
    const pts = slots.map(
      (s) => [xAtMin(s.slot * 30 + 15), yAtE(s.energy)] as const,
    );
    let line = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      line += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    return {
      line,
      area: `${line} L ${last[0].toFixed(1)},${CBASE} L ${first[0].toFixed(1)},${CBASE} Z`,
    };
  }, [slots]);

  // Interpolated energy at an hour-float — the cursor glides along
  // the curve instead of stair-stepping between half-hour slots.
  const eLerp = (h: number) => {
    const f = Math.max(0, Math.min(47, h * 2 - 0.5));
    const lo = Math.floor(f);
    const hi = Math.min(47, lo + 1);
    const t = f - lo;
    const a = slots[lo]?.energy ?? 50;
    const b = slots[hi]?.energy ?? a;
    return a + (b - a) * t;
  };

  const nowDate = new Date(nowMs);
  const nowH = nowDate.getHours() + nowDate.getMinutes() / 60;
  const cursor = scrubH ?? nowH;
  const cx = xAtMin(cursor * 60);
  const cy = yAtE(eLerp(cursor));
  const cursorE = Math.round(eLerp(cursor));
  const tone: [string, string] =
    cursorE >= 60
      ? ['strong', C.honey]
      : cursorE <= 30
        ? ['runs tender', C.dusk]
        : ['steady', C.boneDim];
  // Scrub label snaps to the half-hour it reads (clamped to 11:30p —
  // the old rounding could label the last slot "12a"); the NOW label
  // shows the actual clock time.
  const labelMin =
    scrubH != null
      ? Math.min(1410, Math.round(scrubH * 2) * 30)
      : nowDate.getHours() * 60 + nowDate.getMinutes();

  // Horizontal-intent gesture: never claims a vertical scroll, and
  // once scrubbing it refuses termination so the ScrollView can't
  // steal mid-drag and snap the cursor home.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const h = Math.max(
          0,
          Math.min(23.98, (e.nativeEvent.locationX / chartWRef.current) * 24),
        );
        lastSlotRef.current = Math.round(h * 2);
        setScrubH(h);
      },
      onPanResponderMove: (e) => {
        const h = Math.max(
          0,
          Math.min(23.98, (e.nativeEvent.locationX / chartWRef.current) * 24),
        );
        const slot = Math.round(h * 2);
        if (slot !== lastSlotRef.current) {
          lastSlotRef.current = slot;
          void Haptics.selectionAsync();
        }
        setScrubH(h);
      },
      onPanResponderRelease: () => setScrubH(null),
      onPanResponderTerminate: () => setScrubH(null),
    }),
  ).current;

  const readoutLeftPct = Math.min(72, Math.max(2, (cx / CW) * 100 - 11));

  return (
    <View>
      <View
        accessible
        accessibilityLabel={
          sparse
            ? 'Energy curve — still sketching'
            : `Energy curve.${peakStart != null && peakEnd != null ? ` Peak ${fmtClock(peakStart)} to ${fmtClock(peakEnd)}.` : ''} Right now ${Math.round(eLerp(nowH))} out of 100.`
        }
        onLayout={(e) => {
          chartWRef.current = Math.max(1, e.nativeEvent.layout.width);
        }}
        {...(sparse ? {} : pan.panHandlers)}
      >
        {/* preserveAspectRatio="none": the touch math divides by the
            CONTAINER width, so the drawing must fill it exactly —
            default "meet" letterboxed ~19pt per side on Pro Max and
            skewed edge scrubs by ~70 minutes. Heights match, so only
            x stretches (safe). */}
        <Svg
          width="100%"
          height={CH}
          viewBox={`0 0 ${CW} ${CH}`}
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id="p4fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={C.honey} stopOpacity={0.4} />
              <Stop offset="1" stopColor={C.honey} stopOpacity={0.02} />
            </LinearGradient>
          </Defs>
          {/* peak + dip bands */}
          {peakStart != null && peakEnd != null && (
            <Rect
              x={xAtMin(peakStart)}
              y={CTOP - 4}
              width={Math.max(2, xAtMin(peakEnd) - xAtMin(peakStart))}
              height={CBASE - CTOP + 4}
              fill={hexA(C.ember, 0.09)}
            />
          )}
          {slumpStart != null && slumpEnd != null && (
            <Rect
              x={xAtMin(slumpStart)}
              y={CTOP - 4}
              width={Math.max(2, xAtMin(slumpEnd) - xAtMin(slumpStart))}
              height={CBASE - CTOP + 4}
              fill={hexA(C.dusk, 0.07)}
            />
          )}
          {/* baseline + 6h ticks */}
          {[0, 6, 12, 18, 24].map((h) => (
            <Line
              key={h}
              x1={xAtMin(h * 60)}
              y1={CBASE}
              x2={xAtMin(h * 60)}
              y2={CBASE + 4}
              stroke={hexA(C.bone, 0.25)}
              strokeWidth={1}
            />
          ))}
          {/* wake/sleep anchors — faint glow ticks so a shift-worker
              sees the curve is drawn around THEIR day */}
          {wakeMin != null && (
            <Line
              x1={xAtMin(wakeMin)}
              y1={CBASE}
              x2={xAtMin(wakeMin)}
              y2={CBASE + 7}
              stroke={hexA(C.glow, 0.45)}
              strokeWidth={1.5}
            />
          )}
          {sleepMin != null && (
            <Line
              x1={xAtMin(sleepMin)}
              y1={CBASE}
              x2={xAtMin(sleepMin)}
              y2={CBASE + 7}
              stroke={hexA(C.glow, 0.45)}
              strokeWidth={1.5}
            />
          )}
          <Line
            x1={0}
            y1={CBASE}
            x2={CW}
            y2={CBASE}
            stroke={hexA(C.bone, 0.16)}
            strokeWidth={1}
          />
          {/* the curve — dotted first-sketch when sparse; slightly
              translucent while still learning */}
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
                strokeOpacity={learned ? 1 : 0.82}
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
              x={xAtMin(h * 60)}
              y={CH - 6}
              textAnchor="middle"
              fontFamily={fonts.inter}
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
              {fmtClock(labelMin)} ·{' '}
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
            <View
              style={[styles.legendSwatch, { backgroundColor: C.ember }]}
            />
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
          {focused
            ? 'not enough data yet — a few check-ins draw this line.'
            : 'a first sketch — check in for a few days and this line becomes yours.'}
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
// Month view (a real calendar month with its weekday header), ‹ ›
// steppers to any past period, tap a day to see what got finished.
// ═════════════════════════════════════════════════════════════════════
type DayLog = Map<string, { count: number; titles: string[] }>;

const MAX_WEEKS_BACK = 26;
const MAX_MONTHS_BACK = 6;

const cellColors = (count: number, max: number) => {
  if (count === 0) return { bg: C.void2, border: C.hair, glow: false };
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
  todayYmd,
}: {
  dayLog: DayLog;
  focused: boolean;
  view: 'week' | 'month';
  todayYmd: string;
}) => {
  const [offset, setOffset] = useState(0); // periods back from now
  const [selected, setSelected] = useState<string | null>(null);

  // Build the visible period's day list (ymd strings, Sunday-first).
  const days = useMemo<(string | null)[]>(() => {
    const now = new Date(todayYmd + 'T12:00');
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
    const cells: (string | null)[] = Array.from(
      { length: lead },
      () => null,
    );
    for (let d = 1; d <= dim; d++)
      cells.push(localYmd(new Date(m.getFullYear(), m.getMonth(), d)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view, offset, todayYmd]);

  const periodLabel = useMemo(() => {
    const now = new Date(todayYmd + 'T12:00');
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
  }, [view, offset, days, todayYmd]);

  const maxBack = view === 'week' ? MAX_WEEKS_BACK : MAX_MONTHS_BACK;
  const periodTotal = days.reduce(
    (a, d) => a + (d ? (dayLog.get(d)?.count ?? 0) : 0),
    0,
  );
  const maxInPeriod = days.reduce(
    (a, d) => Math.max(a, d ? (dayLog.get(d)?.count ?? 0) : 0),
    0,
  );

  // Presence, framed as showing up — never as obligation.
  const presence = useMemo(() => {
    let n = 0;
    const t = new Date(todayYmd + 'T12:00');
    for (let i = 0; i < 30; i++) {
      const d = new Date(t);
      d.setDate(t.getDate() - i);
      if ((dayLog.get(localYmd(d))?.count ?? 0) > 0) n++;
    }
    return n;
  }, [dayLog, todayYmd]);

  const step = (dir: 1 | -1) => {
    void Haptics.selectionAsync();
    setSelected(null);
    setOffset((o) => Math.max(0, Math.min(maxBack, o + dir)));
  };

  const sel = selected ? dayLog.get(selected) : null;
  const selDate = selected ? new Date(selected + 'T12:00') : null;

  const renderCell = (ymd: string | null, i: number, big: boolean) => {
    if (!ymd)
      return (
        <View
          key={`pad${i}`}
          style={big ? styles.weekCell : styles.monthCell}
        />
      );
    const isFuture = ymd > todayYmd;
    const isToday = ymd === todayYmd;
    const count = dayLog.get(ymd)?.count ?? 0;
    const col = cellColors(isFuture ? 0 : count, maxInPeriod);
    const d = new Date(ymd + 'T12:00');
    return (
      <Pressable
        key={ymd}
        disabled={isFuture}
        accessibilityRole="button"
        accessibilityLabel={`${DOW_FULL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${
          count > 0 ? `, ${count} finished` : ', nothing finished'
        }`}
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
          // NOTE: iOS-only glow (shadow* props). Deliberate for the
          // iOS launch; revisit with elevation art before Android.
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
          accessibilityRole="button"
          accessibilityLabel={`previous ${view}`}
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
          accessibilityRole="button"
          accessibilityLabel={`next ${view}`}
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
          {/* weekday header — a calendar grid without S-M-T-W-T-F-S
              is unreadable (you can't tell which column is Saturday) */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {DOW_LETTER.map((l, i) => (
              <Text key={i} style={styles.dowLetter}>
                {l}
              </Text>
            ))}
          </View>
          {Array.from({ length: days.length / 7 }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
              {days
                .slice(r * 7, r * 7 + 7)
                .map((d, i) => renderCell(d, r * 7 + i, false))}
            </View>
          ))}
        </View>
      )}

      {/* quiet past periods get a designed line, not dead space */}
      {periodTotal === 0 && offset > 0 && !focused && (
        <Text style={styles.quietLine}>
          a quiet {view} — rest counts.
        </Text>
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
              {sel.count > 3 ? `  +${sel.count - 3} more` : ''}
            </Text>
          ) : focused ? (
            <Text style={styles.dayReadoutBodyMuted}>
              nothing finished.
            </Text>
          ) : (
            <Text style={styles.dayReadoutRest}>
              nothing finished — rest counts too.
            </Text>
          )}
        </View>
      )}

      {presence > 0 && (
        <Text style={styles.presenceLine}>
          showed up {presence} of the last 30 days
        </Text>
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
  const doneLog = useUserStore((s) => s.doneLog);
  const anchors = useUserStore((s) => s.anchors);
  const companion = useCompanionMode();
  const focused = companion.isFocused;
  // Week/Month for "Showing up" — lifted here so the toggle can sit
  // in the section rule while the grid remounts fresh per view.
  const [supView, setSupView] = useState<'week' | 'month'>('week');

  // "Now" heartbeat — ticks every 60s while the tab is focused so
  // the ember cursor and today-boundaries stay honest across long
  // sessions and midnight (they used to freeze at render time).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNowMs(Date.now());
      const id = setInterval(() => setNowMs(Date.now()), 60_000);
      return () => clearInterval(id);
    }, []),
  );
  const todayYmd = localYmd(new Date(nowMs));

  const curve = digest.curve;
  const sparseCurve = curve.source === 'baseline';
  const learned = curve.source === 'learned';
  const ft = digest.followThrough;

  // Every completed quest bucketed by local day, MERGED with the
  // persisted doneLog ledger — deleting old quests on Home must
  // never turn a past warm day cold (titles vanish, warmth stays).
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
    for (const [k, n] of Object.entries(doneLog)) {
      const e = m.get(k);
      if (!e) m.set(k, { count: n, titles: [] });
      else e.count = Math.max(e.count, n);
    }
    return m;
  }, [quests, doneLog]);
  const everLogged = dayLog.size > 0;

  const sparsePage = curve.sampleDays < 3 && !everLogged;

  // Mantel week counts come from the SAME Sunday-anchored calendar
  // week + completion-day bucketing as the grid below — the old
  // planned-date rolling-7 source made two adjacent "this week"
  // numbers disagree.
  const { thisWeekDone, lastWeekDone } = useMemo(() => {
    const t = new Date(todayYmd + 'T12:00');
    const sumWeek = (weeksBack: number) => {
      const start = new Date(t);
      start.setDate(t.getDate() - t.getDay() - weeksBack * 7);
      let n = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        n += dayLog.get(localYmd(d))?.count ?? 0;
      }
      return n;
    };
    return { thisWeekDone: sumWeek(0), lastWeekDone: sumWeek(1) };
  }, [dayLog, todayYmd]);
  const trendChar =
    thisWeekDone > lastWeekDone
      ? '▲'
      : thisWeekDone < lastWeekDone
        ? '▽'
        : '—';

  const fmtMin = (m: number) =>
    m >= 60
      ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
      : `${m}m`;

  const strong = ft.strongWindow;
  const weak = ft.weakWindow;

  // Best-day chip: guarded against tiny samples — one check-in must
  // never yield "Tuesdays tend to be your day".
  const dayChip =
    curve.sampleDays >= 5
      ? digest.peakDow != null &&
        digest.lowDow != null &&
        digest.peakDow !== digest.lowDow
        ? {
            up: `${DOW[digest.peakDow]}s carry you`,
            down: `${DOW[digest.lowDow]}s run quieter`,
          }
        : digest.peakDow != null
          ? { up: `${DOW[digest.peakDow]}s tend to be your day`, down: null }
          : null
      : null;

  const hasNoticed =
    digest.win != null ||
    digest.recurrence.length > 0 ||
    digest.avoidance != null;

  const learningTag = !learned
    ? curve.sampleDays > 0
      ? `still learning · day ${Math.min(curve.sampleDays, 13)} of 14`
      : 'still learning'
    : undefined;

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
        <Rule label="Your day, as energy" right={learningTag} />
        <EnergyHero
          slots={curve.slots}
          peakStart={sparseCurve ? null : curve.peakStart}
          peakEnd={sparseCurve ? null : curve.peakEnd}
          slumpStart={sparseCurve ? null : curve.slumpStart}
          slumpEnd={sparseCurve ? null : curve.slumpEnd}
          sparse={sparseCurve}
          learned={learned}
          focused={focused}
          nowMs={nowMs}
          wakeMin={anchors?.wake ?? null}
          sleepMin={anchors?.sleep ?? null}
        />

        {/* 2 · momentum — mantel numbers, only when data */}
        {(thisWeekDone > 0 || tasksEver > 0 || focusMin > 0) && (
          <View style={styles.mantel}>
            <View style={styles.mantelCol}>
              <Text style={[styles.mantelNum, { color: C.ember }]}>
                {thisWeekDone}
                {lastWeekDone > 0 && (
                  <Text
                    style={[
                      styles.mantelTrend,
                      {
                        color:
                          thisWeekDone > lastWeekDone ? C.honey : C.mute,
                      },
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

        {/* 3 · showing up — real time navigation */}
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: supView === v }}
                  accessibilityLabel={`${v} view`}
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
          todayYmd={todayYmd}
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
                your {WINDOWS[strong.window].label.toLowerCase()} carries
                the big things well — worth leaning on.
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
                    ? focused
                      ? ` after ${digest.win.delayDays} days.`
                      : ` after carrying it ${digest.win.delayDays} days — that one counts double.`
                    : focused
                      ? '.'
                      : ' — clean and done.'}
                </Text>
              </View>
            )}
            {digest.recurrence.slice(0, 2).map((r) => (
              <Pressable
                key={r.id}
                style={styles.doorRow}
                accessibilityRole="button"
                accessibilityLabel={`${r.title} keeps coming back. Set it up to repeat.`}
                onPress={() => {
                  void Haptics.selectionAsync();
                  router.push({
                    pathname: '/(tabs)',
                    params: { suggest: r.id },
                  });
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
                a few {digest.avoidance.label} have been waiting a while.
                not a judgment — just naming it, in case one is ready.
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

        {/* 7 · footer — quiet in focused mode */}
        {!focused && (
          <Text style={styles.foot}>
            every week, this page knows you a little better ✦
          </Text>
        )}
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
            // iOS-only glow — deliberate for the iOS launch.
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
  quietLine: {
    fontFamily: fonts.fraunces,
    fontSize: 12.5,
    color: C.dusk,
    textAlign: 'center',
    marginTop: 12,
    paddingRight: 3,
  },
  presenceLine: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
    marginTop: 12,
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
    ...italicNumberFixLarge,
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
  segBtnOn: {
    borderColor: hexA(C.ember, 0.5),
    backgroundColor: hexA(C.ember, 0.12),
  },
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
    paddingRight: 3,
    includeFontPadding: false,
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
  dayReadoutBodyMuted: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
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
  winCount: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
  },
  winPct: { fontFamily: fonts.fraunces, fontSize: 14 },
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
