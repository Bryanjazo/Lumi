import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  RadialGradient,
  Stop,
  Path,
} from 'react-native-svg';
import { timeColors as C } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useQuestStore, selectTodayQuests } from '../../store/questStore';
import { useUserStore } from '../../store/userStore';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ── Schedule (mock) ─────────────────────────────────────────────────
// Used when there are no scheduled quests today, so the screen always
// reads as designed. Hour fields match lumi-time.jsx verbatim.
interface ScheduleItem {
  hr: number;
  m: number;
  t: string;
  note: string | null;
  dur?: number;
}

const FALLBACK_SCHEDULE: ScheduleItem[] = [
  { hr: 7, m: 0, t: 'Wake', note: 'slow start, water first' },
  { hr: 8, m: 0, t: 'Morning ritual', note: 'meds + protein' },
  { hr: 10, m: 0, t: 'Deep work', note: 'report draft', dur: 90 },
  { hr: 13, m: 0, t: 'Lunch + walk', note: 'before the dip', dur: 60 },
  { hr: 14, m: 30, t: 'Email replies', note: 'last of the peak', dur: 45 },
  { hr: 16, m: 0, t: 'Grocery run', note: 'movement helps', dur: 60 },
  { hr: 18, m: 30, t: 'Dinner', note: null, dur: 45 },
  { hr: 21, m: 0, t: 'Wind down', note: 'screens off, lamp on', dur: 90 },
];

// Peak / slump windows (will be learned per-user; for now hardcoded
// matching the JSX. Data-architecture doc step 5 wires this to
// energy_curve when sample_days >= 14.)
const PEAK: [number, number] = [11, 14];
const SLUMP: [number, number] = [15, 17];

type Mode = 'approach' | 'imminent' | 'init' | 'open' | 'peak' | 'night';

// ── Helpers ─────────────────────────────────────────────────────────
const partOfDay = (hr: number): string => {
  if (hr < 9) return 'morning';
  if (hr < 12) return 'late morning';
  if (hr < 14) return 'midday';
  if (hr < 17) return 'afternoon';
  if (hr < 20) return 'evening';
  return 'night';
};
const inPeak = (hr: number) => hr >= PEAK[0] && hr < PEAK[1];
const inSlump = (hr: number) => hr >= SLUMP[0] && hr < SLUMP[1];

const nStr = (s: { hr: number; m: number }): string => {
  const h = s.hr % 12 || 12;
  const m = s.m === 0 ? '' : `:${String(s.m).padStart(2, '0')}`;
  return `${h}${m}${s.hr < 12 ? 'a' : 'p'}`;
};

const startMins = (s: { hr: number; m: number }) => s.hr * 60 + s.m;

const formatTodayDate = (d: Date) => {
  const wk = d.toLocaleDateString(undefined, { weekday: 'short' });
  const mon = d.toLocaleDateString(undefined, { month: 'short' });
  return `${wk} · ${mon} ${d.getDate()}`;
};

// ── Sub-components ──────────────────────────────────────────────────
const Eyebrow = ({
  children,
  color,
  pulse,
}: {
  children: React.ReactNode;
  color: string;
  pulse?: boolean;
}) => {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 550,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 550,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulse, opacity]);
  return (
    <Animated.Text
      style={[
        styles.eyebrow,
        { color, opacity: pulse ? opacity : 1 },
      ]}
    >
      {children}
    </Animated.Text>
  );
};

const Loom = ({
  children,
  big,
}: {
  children: React.ReactNode;
  big?: boolean;
}) => (
  <View style={styles.loomRow}>
    <Text style={[styles.loomText, big && styles.loomBig]}>{children}</Text>
  </View>
);

// ── ArcLabel ─────────────────────────────────────────────────────
const ArcLabel = ({
  cx,
  cy,
  r,
  from,
  to,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  from: number;
  to: number;
  color: string;
}) => {
  const ang = (h: number) => ((h - 6) / 18) * Math.PI * 2 - Math.PI / 2;
  const a0 = ang(from);
  const a1 = ang(to);
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = (to - from) / 18 > 0.5 ? 1 : 0;
  return (
    <Path
      d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`}
      fill="none"
      stroke={color}
      strokeWidth={3}
      strokeOpacity={0.5}
      strokeLinecap="round"
    />
  );
};

// ── ProgressRing ─────────────────────────────────────────────────
const ProgressRing = ({
  cx,
  cy,
  r,
  pct,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  pct: number;
  color: string;
}) => {
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - pct);
  return (
    <Circle
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeOpacity={0.8}
      strokeLinecap="round"
      strokeDasharray={`${circ}`}
      strokeDashoffset={off}
      transform={`rotate(-90 ${cx} ${cy})`}
    />
  );
};

// ── BreathRing — one of the four concentric circles ─────────────
const BreathRing = ({
  r,
  i,
  calm,
  ringDur,
  opacity,
}: {
  r: number;
  i: number;
  calm: boolean;
  ringDur: number;
  opacity: number;
}) => {
  const animR = useRef(new Animated.Value(r)).current;
  const animO = useRef(new Animated.Value(opacity)).current;
  useEffect(() => {
    const dur = (ringDur + i) * 1000;
    const delta = calm ? 3 : 6;
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(animR, {
            toValue: r + delta,
            duration: dur / 2,
            useNativeDriver: false,
          }),
          Animated.timing(animO, {
            toValue: opacity * 0.3,
            duration: dur / 2,
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(animR, {
            toValue: r,
            duration: dur / 2,
            useNativeDriver: false,
          }),
          Animated.timing(animO, {
            toValue: opacity,
            duration: dur / 2,
            useNativeDriver: false,
          }),
        ]),
      ]),
    ).start();
  }, [r, i, calm, ringDur, opacity, animR, animO]);

  return (
    <AnimatedCircle
      cx={160}
      cy={160}
      r={animR}
      fill="none"
      // C.ash reads brighter than C.hair on the void bg in RN SVG;
      // CSS compositing made hair OK on web but here it disappears.
      stroke={C.ash}
      strokeWidth={1}
      strokeOpacity={animO}
    />
  );
};

// ── Ping — the outward sweeping circle ──────────────────────────
const Ping = ({
  accent,
  prox,
  pingDur,
}: {
  accent: string;
  prox: number;
  pingDur: number;
}) => {
  const animR = useRef(new Animated.Value(20)).current;
  const animO = useRef(new Animated.Value(0.4 + prox * 0.45)).current;
  useEffect(() => {
    const dur = pingDur * 1000;
    const loop = () => {
      animR.setValue(20);
      animO.setValue(0.4 + prox * 0.45);
      Animated.parallel([
        Animated.timing(animR, {
          toValue: 150,
          duration: dur,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(animO, {
          toValue: 0,
          duration: dur,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      ]).start(({ finished }) => {
        if (finished) loop();
      });
    };
    loop();
  }, [animR, animO, prox, pingDur]);

  return (
    <AnimatedCircle
      cx={160}
      cy={160}
      r={animR}
      fill="none"
      stroke={accent}
      strokeWidth={1.5}
      strokeOpacity={animO}
    />
  );
};

// ── RadarField ─────────────────────────────────────────────────
const RadarField = ({
  prox,
  accent,
  calm,
  fill,
  ringDur,
  progress,
}: {
  prox: number;
  accent: string;
  calm: boolean;
  fill: string;
  ringDur: number;
  progress: number | null;
}) => {
  const pingDur = calm ? 6 : Math.max(1.4, 3.5 - prox * 2);
  // Bumped from 0.6 → 0.75 so the rings are clearly visible at smaller
  // opacities. The original CSS-renderer made them look brighter than
  // SVG does on a dark BG.
  const ringBase = calm ? 0.42 : 0.78;

  // Inner core dot pulse
  const dotR = useRef(new Animated.Value(6)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(dotR, {
          toValue: 7.5,
          duration: calm ? 1700 : 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(dotR, {
          toValue: 6,
          duration: calm ? 1700 : 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    ).start();
  }, [calm, dotR]);

  return (
    <Svg viewBox="0 0 320 320" width="100%" height="100%">
      <Defs>
        <RadialGradient id="heat" cx="50%" cy="50%" r="50%">
          <Stop
            offset="0%"
            stopColor={fill}
            stopOpacity={(calm ? 0.05 : 0.1) + prox * 0.24}
          />
          <Stop offset="55%" stopColor={fill} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="core" cx="50%" cy="50%" r="50%">
          <Stop
            offset="0%"
            stopColor={calm ? accent : C.glow}
            stopOpacity={calm ? 0.5 : 0.9}
          />
          <Stop offset="70%" stopColor={accent} stopOpacity={0.45} />
          <Stop offset="100%" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Circle cx={160} cy={160} r={150} fill="url(#heat)" />

      {[44, 78, 112, 146].map((rValue, i) => (
        <BreathRing
          key={rValue}
          r={rValue}
          i={i}
          calm={calm}
          ringDur={ringDur}
          opacity={ringBase - i * 0.12}
        />
      ))}

      {!calm && <Ping accent={accent} prox={prox} pingDur={pingDur} />}

      <ArcLabel
        cx={160}
        cy={160}
        r={146}
        from={PEAK[0]}
        to={PEAK[1]}
        color={C.lichen}
      />
      <ArcLabel
        cx={160}
        cy={160}
        r={146}
        from={SLUMP[0]}
        to={SLUMP[1]}
        color={C.emberDk}
      />

      {progress != null && (
        <ProgressRing
          cx={160}
          cy={160}
          r={132}
          pct={progress}
          color={accent}
        />
      )}

      <Circle cx={160} cy={160} r={30} fill="url(#core)" />
      <AnimatedCircle cx={160} cy={160} r={dotR} fill={calm ? accent : C.glow} />
    </Svg>
  );
};

// ── CoreContent ─────────────────────────────────────────────────
type CoreKind = 'countdown' | 'imminent' | 'init' | 'open' | 'night';

interface CoreData {
  next?: ScheduleItem;
  ctHrs?: number;
  ctMins?: number;
  cur?: ScheduleItem;
  elapsed?: number;
  remain?: number;
  endsAt?: { hr: number; m: number };
  progress?: number;
  nextLabel?: string;
}

const CoreContent = ({
  kind,
  data,
  accent,
}: {
  kind: CoreKind;
  data: CoreData;
  accent: string;
}) => {
  if (kind === 'countdown' && data.next) {
    return (
      <>
        <Eyebrow color={accent}>next · in</Eyebrow>
        <Loom>
          {(data.ctHrs ?? 0) > 0 && (
            <>
              <Text style={styles.loomText}>{data.ctHrs}</Text>
              <Text style={styles.unit}>h</Text>
            </>
          )}
          <Text style={styles.loomText}>{data.ctMins}</Text>
          <Text style={styles.unit}>m</Text>
        </Loom>
        <Text style={styles.coreTitle}>{data.next.t}</Text>
        {data.next.note && <Text style={styles.coreNote}>{data.next.note}</Text>}
        <Text style={[styles.coreAt, { color: accent }]}>
          at {nStr(data.next)}
        </Text>
      </>
    );
  }
  if (kind === 'imminent' && data.next) {
    return (
      <>
        <Eyebrow color={C.ember} pulse>closing in</Eyebrow>
        <Loom big>
          <Text style={[styles.loomText, styles.loomBig]}>{data.ctMins}</Text>
          <Text style={styles.unit}>m</Text>
        </Loom>
        <Text style={styles.coreTitle}>{data.next.t}</Text>
        <Text style={[styles.coreNote, { color: C.ember }]}>
          start wrapping up
        </Text>
        <Text style={[styles.coreAt, { color: C.ember }]}>
          at {nStr(data.next)}
        </Text>
      </>
    );
  }
  if (kind === 'init' && data.cur && data.endsAt) {
    return (
      <>
        <Eyebrow color={accent}>you're in</Eyebrow>
        <Text style={styles.initTitle}>{data.cur.t}</Text>
        <View style={styles.initElapsedRow}>
          <Text style={styles.initElapsed}>{data.elapsed}</Text>
          <Text style={styles.initMinIn}>m in</Text>
        </View>
        <Text style={[styles.coreNote, { marginTop: 10 }]}>
          {data.remain}m left · ends {nStr(data.endsAt)}
        </Text>
      </>
    );
  }
  if (kind === 'open') {
    return (
      <>
        <Eyebrow color={C.mute}>open</Eyebrow>
        <Text style={styles.openMain}>
          nothing's{'\n'}pulling at you
        </Text>
        {data.nextLabel && (
          <Text
            style={[
              styles.coreNote,
              { marginTop: 12, maxWidth: 210, textAlign: 'center' },
            ]}
          >
            {data.nextLabel}
          </Text>
        )}
      </>
    );
  }
  if (kind === 'night') {
    return (
      <>
        <Eyebrow color={C.dusk}>tonight</Eyebrow>
        <Text style={styles.openMain}>
          the day's done{'\n'}pulling
        </Text>
        <View style={[styles.initElapsedRow, { marginTop: 16 }]}>
          <Text style={styles.nightTime}>9:30</Text>
        </View>
        <Text style={[styles.coreNote, { marginTop: 10, color: C.dusk }]}>
          wind down now
        </Text>
      </>
    );
  }
  return null;
};

// ── Main screen ─────────────────────────────────────────────────────
export default function TimeTab() {
  const quests = useQuestStore((s) => s.quests);
  const todayQuests = useMemo(() => selectTodayQuests(quests), [quests]);
  const userName = useUserStore((s) => s.name);

  // current time — tick once a minute
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const hr = now.getHours();
  const min = now.getMinutes();
  const nowMins = hr * 60 + min;

  // Build schedule from user quests, fall back to mock for empty days
  const schedule: ScheduleItem[] = useMemo(() => {
    const scheduled = todayQuests
      .filter((q) => q.scheduledHour !== undefined)
      .map((q) => ({
        hr: q.scheduledHour ?? 0,
        m: q.scheduledMinute ?? 0,
        t: q.title,
        note: null,
        dur: q.durationMinutes,
      }))
      .sort((a, b) => startMins(a) - startMins(b));
    return scheduled.length > 0 ? scheduled : FALLBACK_SCHEDULE;
  }, [todayQuests]);

  // Find current + next
  const cur = schedule.find(
    (s) =>
      s.dur != null &&
      nowMins >= startMins(s) &&
      nowMins < startMins(s) + s.dur,
  );
  const next =
    schedule.find((s) => startMins(s) > nowMins) ??
    schedule[schedule.length - 1];
  const minsToNext = Math.max(0, startMins(next) - nowMins);
  const prox = Math.max(0, Math.min(1, 1 - minsToNext / 180));

  // After / past lists
  const after = schedule
    .filter((s) => startMins(s) > startMins(next))
    .slice(0, 3);
  const past = schedule.filter((s) => startMins(s) <= nowMins).slice(-2);

  // ── Mode derivation ──
  const mode: Mode = useMemo(() => {
    if (hr >= 21) return 'night';
    if (cur) return 'init';
    if (minsToNext < 10) return 'imminent';
    if (minsToNext > 180) return 'open';
    if (inPeak(hr)) return 'peak';
    return 'approach';
  }, [hr, cur, minsToNext]);

  const isNight = mode === 'night';
  const isPeak = mode === 'peak' || inPeak(hr);
  const isSlumpMode = inSlump(hr);
  const isOpen = mode === 'open';

  // Color theme by mode
  let accent: string = C.ember;
  let fillC: string = C.ember;
  let ctxLabel = partOfDay(hr);
  let ctxColor: string = C.mute;
  if (isNight) {
    accent = C.dusk;
    fillC = C.dusk;
    ctxLabel = 'wind-down';
    ctxColor = C.dusk;
  } else if (isPeak) {
    accent = C.lichen;
    fillC = C.lichen;
    ctxLabel = 'peak window';
    ctxColor = C.lichen;
  } else if (isSlumpMode) {
    accent = C.ember;
    fillC = C.ember;
    ctxLabel = 'the slump';
    ctxColor = C.ember;
  }

  // Core data shape
  let coreKind: CoreKind = 'countdown';
  let coreData: CoreData = {};

  if (mode === 'imminent') {
    coreKind = 'imminent';
    coreData = { next, ctMins: minsToNext };
  } else if (mode === 'init' && cur) {
    coreKind = 'init';
    const start = startMins(cur);
    const elapsed = nowMins - start;
    const remain = (cur.dur ?? 0) - elapsed;
    const endMin = start + (cur.dur ?? 0);
    coreData = {
      cur,
      elapsed,
      remain,
      endsAt: { hr: Math.floor(endMin / 60), m: endMin % 60 },
      progress: elapsed / (cur.dur ?? 1),
    };
  } else if (mode === 'open') {
    coreKind = 'open';
    coreData = {
      nextLabel: `next — ${next.t} at ${nStr(next)}, ${Math.floor(minsToNext / 60)}h ${minsToNext % 60}m away`,
    };
  } else if (mode === 'night') {
    coreKind = 'night';
  } else {
    coreKind = 'countdown';
    coreData = {
      next,
      ctHrs: Math.floor(minsToNext / 60),
      ctMins: minsToNext % 60,
    };
  }

  const calm = isOpen || isNight;
  const progress = coreKind === 'init' ? coreData.progress ?? null : null;

  const hourStr = hr % 12 || 12;
  const minStr = String(min).padStart(2, '0');
  const ampm = hr < 12 ? 'am' : 'pm';

  const bgColor = isNight ? C.voidNight : C.void;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: bgColor }]}
      edges={['top']}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerDate}>{formatTodayDate(now)}</Text>
          <View style={styles.ctxRow}>
            <View
              style={[styles.ctxDot, { backgroundColor: ctxColor }]}
            />
            <Text style={[styles.ctxLabel, { color: ctxColor }]}>
              {ctxLabel}
            </Text>
          </View>
        </View>

        {/* NOW big time — render as a single Text with inline AMPM so
            the whole string centers as one optical unit (was rendering
            two siblings with a leading-space hack that visually drifted) */}
        <View style={styles.nowWrap}>
          <Text style={styles.nowLabel}>now</Text>
          <Text style={styles.nowTime}>
            {hourStr}:{minStr}
            <Text style={styles.nowAmpm}>{'  '}{ampm}</Text>
          </Text>
        </View>

        {/* Radar */}
        <View style={styles.radarWrap}>
          <RadarField
            prox={prox}
            accent={accent}
            calm={calm}
            fill={fillC}
            ringDur={calm ? 6 : 4}
            progress={progress}
          />
          <View style={styles.coreOverlay} pointerEvents="none">
            <CoreContent kind={coreKind} data={coreData} accent={accent} />
          </View>
        </View>

        {/* Then list */}
        {!isNight && after.length > 0 && (
          <View style={styles.thenWrap}>
            <Text style={styles.sectionLabel}>
              {isOpen ? 'later today' : 'then'}
            </Text>
            {after.map((s, i) => (
              <View
                key={`${s.hr}-${s.m}-${i}`}
                style={[
                  styles.thenRow,
                  i < after.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: C.hair,
                  },
                  { opacity: 1 - i * 0.18 },
                ]}
              >
                <Text style={styles.thenTime}>{nStr(s)}</Text>
                <Text style={styles.thenTitle}>{s.t}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Behind you */}
        {past.length > 0 && !isNight && (
          <View style={styles.behindWrap}>
            <Text style={[styles.sectionLabel, { color: C.ash }]}>
              behind you
            </Text>
            <View style={styles.behindRow}>
              {past.map((s) => (
                <View
                  key={`${s.hr}-${s.m}`}
                  style={styles.behindItem}
                >
                  <Text style={styles.behindTime}>{nStr(s)}</Text>
                  <Text style={styles.behindTitle}>{s.t}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Sleep formula footer */}
        <View style={styles.formulaWrap}>
          {isNight ? (
            <View>
              <Text style={[styles.sectionLabel, { color: C.dusk }]}>
                your formula
              </Text>
              <Text style={styles.formulaBody}>
                Screens dim. Lights low.{'\n'}
                Nothing past 2pm. Lamp on, not overhead.{'\n'}
                <Text style={{ color: C.dusk }}>
                  You sleep best after a slow hour.
                </Text>
              </Text>
              <View style={styles.sleepStats}>
                <View>
                  <Text style={styles.sleepStatLabel}>last night</Text>
                  <Text style={[styles.sleepStatNum, { color: C.lichen }]}>
                    7h 12m
                  </Text>
                </View>
                <View>
                  <Text style={styles.sleepStatLabel}>7-day avg</Text>
                  <Text style={[styles.sleepStatNum, { color: C.dusk }]}>
                    6h 48m
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.formulaTopRow}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9 }}
                >
                  <Text style={styles.formulaTime}>9:30</Text>
                  <Text style={styles.formulaWindLabel}>— wind-down</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 14 }}>
                  <Text style={styles.formulaSleepInline}>
                    last{' '}
                    <Text style={{ color: C.lichen }}>7h12</Text>
                  </Text>
                  <Text style={styles.formulaSleepInline}>
                    avg <Text style={{ color: C.ember }}>6h48</Text>
                  </Text>
                </View>
              </View>
              <Text style={styles.formulaShortBody}>
                Screens dim, lights low, nothing past 2pm — your formula.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    paddingTop: 24,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerDate: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    color: C.mute,
    textTransform: 'uppercase',
  },
  ctxRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ctxDot: { width: 5, height: 5, borderRadius: 3 },
  ctxLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },

  nowWrap: { paddingTop: 14, paddingHorizontal: 24, alignItems: 'center' },
  nowLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 3,
    color: C.mute,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  nowTime: {
    fontFamily: fonts.fraunces,
    fontSize: 40,
    color: C.bone,
    letterSpacing: -1,
    lineHeight: 42,
    textAlign: 'center',
  },
  nowAmpm: {
    fontFamily: fonts.fraunces,
    fontSize: 18,
    color: C.mute,
  },

  radarWrap: {
    // Combining width: '100%' with aspectRatio + maxHeight on a phone
    // wider than 360pt left-aligned the radar (RN layout defaults).
    // alignSelf + maxWidth keeps it square AND centered on any width.
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    aspectRatio: 1,
    marginTop: -4,
    position: 'relative',
  },
  coreOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  // Core content text
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 3,
    textTransform: 'uppercase',
    // Tucks the "NEXT · IN" tight to the big number below
    marginBottom: 2,
  },
  loomRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  loomText: {
    fontFamily: fonts.fraunces,
    color: C.bone,
    fontSize: 76,
    // JSX uses lineHeight: 0.8 — chars visually overflow the layout
    // box on web, but RN clips strictly. Tightening to 0.82x so the
    // title beneath sits closer to the loom (overlapping the radar's
    // inner ring instead of floating well below it).
    lineHeight: 62,
    letterSpacing: -3,
  },
  loomBig: { fontSize: 96, lineHeight: 78 },
  unit: {
    fontFamily: fonts.inter,
    fontSize: 26,
    color: C.glow,
    marginLeft: 3,
    marginRight: 6,
  },
  coreTitle: {
    // Tighter so the title overlaps the inner ring instead of sitting
    // well below the loom.
    marginTop: 6,
    fontFamily: fonts.fraunces,
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  coreNote: {
    marginTop: 3,
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  coreAt: {
    marginTop: 6,
    fontFamily: fonts.inter,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  initTitle: {
    fontFamily: fonts.fraunces,
    color: C.bone,
    fontSize: 34,
    letterSpacing: -0.8,
    lineHeight: 30,
    textAlign: 'center',
    maxWidth: 220,
    marginTop: 4,
  },
  initElapsedRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  initElapsed: {
    fontFamily: fonts.fraunces,
    fontSize: 52,
    color: C.bone,
    letterSpacing: -2,
    lineHeight: 42,
  },
  initMinIn: { fontFamily: fonts.inter, fontSize: 18, color: C.glow },

  openMain: {
    fontFamily: fonts.fraunces,
    color: C.bone,
    fontSize: 30,
    letterSpacing: -0.6,
    lineHeight: 34,
    textAlign: 'center',
    maxWidth: 230,
    marginTop: 6,
  },

  nightTime: {
    fontFamily: fonts.fraunces,
    fontSize: 44,
    color: C.dusk,
    letterSpacing: -1.5,
    lineHeight: 36,
  },

  thenWrap: { paddingTop: 18, paddingHorizontal: 24 },
  sectionLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    color: C.mute,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  thenRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: 11,
  },
  thenTime: {
    width: 58,
    fontFamily: fonts.fraunces,
    fontSize: 17,
    color: C.boneDim,
    letterSpacing: -0.4,
  },
  thenTitle: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.boneDim,
    letterSpacing: -0.2,
  },

  behindWrap: { paddingTop: 20, paddingHorizontal: 24 },
  behindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  behindItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    opacity: 0.5,
  },
  behindTime: {
    fontFamily: fonts.fraunces,
    fontSize: 14,
    color: C.ash,
  },
  behindTitle: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.ash,
    letterSpacing: -0.1,
    textDecorationLine: 'line-through',
    textDecorationColor: C.hair,
  },

  formulaWrap: {
    marginTop: 26,
    marginHorizontal: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: C.hair,
  },
  formulaBody: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.boneDim,
    lineHeight: 24,
    letterSpacing: -0.1,
  },
  sleepStats: { flexDirection: 'row', gap: 28, marginTop: 18 },
  sleepStatLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1,
    color: C.mute,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  sleepStatNum: {
    fontFamily: fonts.fraunces,
    fontSize: 22,
    letterSpacing: -0.5,
  },

  formulaTopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  formulaTime: {
    fontFamily: fonts.fraunces,
    fontSize: 30,
    color: C.bone,
    letterSpacing: -1,
  },
  formulaWindLabel: {
    fontFamily: fonts.fraunces,
    fontSize: 14,
    color: C.boneDim,
    letterSpacing: -0.2,
  },
  formulaSleepInline: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  formulaShortBody: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
    lineHeight: 19,
    letterSpacing: -0.05,
    marginTop: 8,
    marginBottom: 22,
    maxWidth: 290,
  },
});
