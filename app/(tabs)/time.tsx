// Lumi · Time v3 — "The Load Map"
//
// Spec: lumi-time-loadmap.jsx (carries v2.2's bones forward).
// Thesis: time blindness isn't "how long till the next ping" — it's
// losing where you are in time. v2 fixed within-a-day (the thread);
// v2.2 fixed across-days with Day/Week/Month zoom; v3 makes the
// zoomed views ACTIONABLE:
//   • Load model — every task weighs by tier (◆◆◆ 3 · ◆◆ 2 · ◆ 1);
//     a day reads open / light / full / heavy.
//   • Week = 7 card rows surfacing their load (word + pips) with the
//     day's tasks as chips.
//   • Month = a warm LOAD MAP — heat shows heavy vs light days, the
//     busiest day gets a nudge, heavy days get one-tap "Lighten".
//   • Cross-day drag-and-drop: long-press a chip (Week), a peek row
//     (Month), or a task row (Day) and drop it on any day / open
//     gap. Every move → toast + Undo.
//   • Day = the compact thread: anchors + tasks in time order, NOW
//     breathing between past and future, open stretches as dashed
//     drop targets, the slump as a quiet seam. (v2's pixel-per-
//     minute timeline retired — it spent the screen on empty hours.)
//
// READS only (except drops) — Time is a view over the shared data.
// Each date = `userStore.anchors` (the routine bones) + that date's
// quests from `useQuestStore` (dated + `recur`-expanded). Energy
// seams come from the learned curve. Fresh accounts show anchors
// only — never seeded.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { timeColors as C } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { IMPORTANCE, type Importance } from '../../constants/importance';
import { useEffectiveWindows } from '../../constants/windows';
import { type RecurRule, type WeekdayKey } from '../../constants/recur';
import {
  useUserStore,
  type DailyAnchors,
} from '../../store/userStore';
import { useQuestStore, type Quest } from '../../store/questStore';
import { useLearningDigest } from '../../lib/learning';
import { todayKey } from '../../lib/gamification';
import { useAccent, accentFor, type Accent } from '../../lib/theme';
import { useUncompleteConfirm } from '../../components/TaskDeleteWrap';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';

// ═════════════════════════════════════════════════════════════════════
// Layout constants — compact day-thread columns (loadmap layout)
// ═════════════════════════════════════════════════════════════════════
const MARKER_W = 34; // thread-marker column (dots / now pulse)
const TIME_W = 46; // time-stamp column
const GAP_MIN = 60; // open stretches ≥ this render as droppable gaps
// Unfinished tasks float their radio this far RIGHT of the thread
// line; completing one springs it back onto the line — the day
// physically collects your wins.
const RADIO_OFFSET = 16;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDF = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** 1 → "st", 22 → "nd", 13 → "th" — for the busiest-day nudge copy. */
const ordSuffix = (n: number): string => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
};
const MO = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_TO_NUM: Record<WeekdayKey, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type Scale = 'day' | 'week' | 'month';
const SCALES: { key: Scale; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════
const fmt = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hr = h % 12 || 12;
  const suf = h < 12 ? 'a' : 'p';
  return mm === 0 ? `${hr}${suf}` : `${hr}:${String(mm).padStart(2, '0')}${suf}`;
};

const fmtNow = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hr = h % 12 || 12;
  const suf = h < 12 ? 'am' : 'pm';
  return mm === 0
    ? `${hr} ${suf}`
    : `${hr}:${String(mm).padStart(2, '0')} ${suf}`;
};

const dur = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h > 0) return mm ? `${h}h ${mm}m` : `${h}h`;
  return `${mm}m`;
};

// Local-date stringification — matches lib/gamification.ts → todayKey
// and lib/capture.ts → ymd. UTC would mismatch when the user's local
// clock and UTC fall on different calendar days.
const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** 'YYYY-MM-DD' → local-midnight Date (new Date(iso) would parse UTC). */
const fromIsoLocal = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const addMonths = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};

const startOfWeek = (d: Date): Date => addDays(d, -d.getDay());

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const dayOffset = (d: Date, ref: Date): number =>
  Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime()) /
      86400000,
  );

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// ═════════════════════════════════════════════════════════════════════
// Item model
// ═════════════════════════════════════════════════════════════════════
interface TItem {
  kind: 'anchor' | 'quest';
  min: number;
  title: string;
  tier?: Importance;
  durMin?: number;
  done?: boolean;
  questId?: string;
  recurring?: boolean;
}

const anchorItems = (anchors: DailyAnchors): TItem[] => [
  { kind: 'anchor', min: anchors.wake, title: 'Wake' },
  { kind: 'anchor', min: anchors.breakfast, title: 'Breakfast' },
  { kind: 'anchor', min: anchors.lunch, title: 'Lunch' },
  { kind: 'anchor', min: anchors.dinner, title: 'Dinner' },
  { kind: 'anchor', min: anchors.sleep, title: 'Sleep' },
];

/**
 * Resolve all the items shown on a given date:
 *   anchors (always) + quests whose date matches + recurring quests
 *   whose rule matches this date (projected onto the day).
 *
 * Recurring quest projection: the row in `quests` represents a
 * template; we surface a ghost item on every future matching date.
 * On the row's own date, the actual quest is used (so completion
 * status renders). On past dates we don't backfill — those would
 * have been completed historical instances and the moat lives there.
 */
const recurMatches = (rule: RecurRule, date: Date, today: Date): boolean => {
  const dow = date.getDay();
  switch (rule.every) {
    case 'day':
      return true;
    case 'weekday':
      return dow >= 1 && dow <= 5;
    case 'week':
      if (!rule.day) return false;
      return WEEKDAY_TO_NUM[rule.day] === dow;
    case '2week':
      if (!rule.day) return false;
      if (WEEKDAY_TO_NUM[rule.day] !== dow) return false;
      // Approximate biweekly: even-week alignment with today.
      return Math.floor((date.getTime() - today.getTime()) / (7 * 86400000)) % 2 === 0;
    case 'month':
      return date.getDate() === today.getDate();
    default:
      return false;
  }
};

const buildItemsForDate = (
  date: Date,
  anchors: DailyAnchors,
  quests: Quest[],
  effective: ReturnType<typeof useEffectiveWindows>,
  today: Date,
  nowMin: number = 0,
): TItem[] => {
  const key = ymd(date);
  const items: TItem[] = [...anchorItems(anchors)];
  const isToday = sameDay(date, today);
  const isFuture = date.getTime() > today.getTime() && !isToday;

  const seen = new Set<string>();

  // Dated, non-recurring quests on this exact date.
  for (const q of quests) {
    if (q.window === 'someday') continue;
    if (q.date !== key) continue;
    if (q.recur && !isToday) continue; // recurring shown via projection
    const winStart = effective[q.window].start ?? 12;
    // Stable placement only — anchored quests use their scheduled
    // time, windowed ones render at the window start. The Time tab
    // does NOT recompute against `nowMin` here because that made
    // mid-window tasks shift every minute. If you want a task at a
    // specific clock time, capture decides that ONCE on commit; the
    // render is read-only after that.
    const m =
      q.scheduledHour != null
        ? q.scheduledHour * 60 + (q.scheduledMinute ?? 0)
        : winStart * 60;
    items.push({
      kind: 'quest',
      min: m,
      title: q.title,
      tier: q.importance,
      durMin: q.durationMinutes ?? 30,
      done: q.completed,
      questId: q.id,
      recurring: !!q.recur,
    });
    seen.add(q.id);
  }

  // Recurring quest projections — render the template as a ghost on
  // any matching future date (and today, if not already added above).
  if (isToday || isFuture) {
    for (const q of quests) {
      if (!q.recur) continue;
      if (q.window === 'someday') continue;
      if (seen.has(q.id)) continue;
      if (!recurMatches(q.recur, date, today)) continue;
      const winStart = effective[q.window].start ?? 12;
      const m = winStart * 60;
      items.push({
        kind: 'quest',
        min: m,
        title: q.title,
        tier: q.importance,
        durMin: q.durationMinutes ?? 30,
        done: false,
        questId: q.id,
        recurring: true,
      });
    }
  }

  items.sort((a, b) => a.min - b.min);
  return items;
};

// ═════════════════════════════════════════════════════════════════════
// Load model — per lumi-time-loadmap.jsx. Each task weighs by tier
// (Trial 3 · Task 2 · Whim 1); the sum is the day's load. Words keep
// it humane: nobody needs to know their day scores "8".
// ═════════════════════════════════════════════════════════════════════
const TIER_W: Record<Importance, number> = { high: 3, medium: 2, low: 1 };
const HEAVY_LOAD = 7;

const loadOf = (items: TItem[]): number =>
  items.reduce(
    (s, i) => (i.kind === 'quest' && i.tier ? s + TIER_W[i.tier] : s),
    0,
  );

const loadWord = (l: number): string =>
  l === 0 ? 'open' : l <= 3 ? 'light' : l <= 6 ? 'full' : 'heavy';

/** Three little dots that read a day's load at a glance. */
const Pips = ({ load }: { load: number }) => {
  const n = load === 0 ? 0 : load <= 3 ? 1 : load <= 6 ? 2 : 3;
  const col = n === 3 ? C.ember : n === 2 ? C.honey : C.lichen;
  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: i < n ? hexA(col, 0.9) : hexA(C.bone, 0.1),
          }}
        />
      ))}
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Cross-day drag-and-drop — long-press a task chip (Week) or peek row
// (Month), drag, drop on any day target.
//
// Architecture: the ghost's position lives in shared values (60fps on
// the UI thread, zero re-renders); React state only holds the dragged
// task's static info + which target is hovered (changes rarely). Drop
// targets register their View refs; ALL rects are measured once via
// measureInWindow at drag start — you can't scroll mid-drag (the pan
// owns the touch), so the rects can't go stale during the gesture.
// ═════════════════════════════════════════════════════════════════════
interface DragTask {
  questId: string;
  title: string;
  tier: Importance;
  min: number;
  fromIso: string;
}

interface DragCtl {
  gx: SharedValue<number>;
  gy: SharedValue<number>;
  active: SharedValue<number>;
  begin: (t: DragTask) => void;
  hover: (x: number, y: number) => void;
  drop: (x: number, y: number) => void;
  cancel: () => void;
  registerTarget: (key: string, ref: View | null) => void;
  /** "day:YYYY-MM-DD" currently hovered, or null. */
  overKey: string | null;
  /** questId being dragged (chips dim themselves), or null. */
  draggingId: string | null;
}

/** Wraps a chip/row to make it long-press-draggable. Long-press (not
 *  plain pan) so taps and the parent ScrollView keep working. */
const DragChip = ({
  task,
  ctl,
  children,
}: {
  task: DragTask;
  ctl: DragCtl;
  children: ReactElement;
}) => {
  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart((e) => {
      'worklet';
      ctl.active.value = 1;
      ctl.gx.value = e.absoluteX;
      ctl.gy.value = e.absoluteY;
      runOnJS(ctl.begin)(task);
    })
    .onUpdate((e) => {
      'worklet';
      ctl.gx.value = e.absoluteX;
      ctl.gy.value = e.absoluteY;
      runOnJS(ctl.hover)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      'worklet';
      ctl.active.value = 0;
      runOnJS(ctl.drop)(e.absoluteX, e.absoluteY);
    })
    .onFinalize((_e, success) => {
      'worklet';
      if (!success) {
        ctl.active.value = 0;
        runOnJS(ctl.cancel)();
      }
    });
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
};

// ═════════════════════════════════════════════════════════════════════
// NowPulse — the breathing ember dot on the day thread's now row.
// ═════════════════════════════════════════════════════════════════════
const NowPulse = () => {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [t]);
  const halo = useAnimatedStyle(() => ({
    transform: [{ scale: 0.85 + t.value * 0.4 }],
    opacity: 0.7 + t.value * 0.3,
  }));
  return (
    <View style={{ width: 13, height: 13 }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: -6,
            left: -6,
            width: 25,
            height: 25,
            borderRadius: 13,
            backgroundColor: hexA(C.ember, 0.28),
          },
          halo,
        ]}
      />
      <View
        style={{
          width: 13,
          height: 13,
          borderRadius: 7,
          backgroundColor: C.ember,
          shadowColor: C.ember,
          shadowOpacity: 0.8,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        }}
      />
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// DayTaskRow — one task on the compact day thread (loadmap style).
//
// The marker is a RADIO with physical meaning: an unfinished task
// floats its hollow ring RADIO_OFFSET px right of the thread line —
// visibly not part of the day's record yet. Tap the ring → the task
// completes and the marker SPRINGS LEFT onto the line, morphing into
// the lichen check as it lands (the thread collects the win). Un-
// completing springs it back off. Anchors and the now-pulse always
// live on the line; tasks have to earn their place.
//
//   done     → check bead ON the line, strikethrough, tap row to
//              un-complete
//   past due → its own DIMMED state (ash time, quiet title, no glow)
//              with a MISSED tag — the radio completes it (same
//              reward fan-out as Home so no XP leaks)
//   active   → floating radio ring in the tier color (high glows),
//              sigil + duration, handle dots when draggable
//
// NO delete here by design — Time is where you SEE and MOVE the day,
// not where you manage the task list. Completing (and un-completing)
// is the only state change a row offers; deleting lives on Home.
// ═════════════════════════════════════════════════════════════════════
const DayTaskRow = ({
  it,
  isToday,
  isPast,
  nowMin,
  inPeak,
  styles,
}: {
  it: TItem;
  isToday: boolean;
  isPast: boolean;
  nowMin: number;
  inPeak: boolean;
  styles: ReturnType<typeof makeStyles>;
}) => {
  const tierCol = it.tier ? IMPORTANCE[it.tier].color : C.boneDim;
  const done = it.done === true;
  // Past due = the whole day is behind you, OR its slot already
  // passed today. (Previously only the today case existed, so an
  // unfinished task on yesterday rendered exactly like "up next".)
  const missed =
    !done && (isPast || (isToday && it.min + (it.durMin ?? 0) <= nowMin));
  // Radio-complete works on real quest rows only. Future dates show
  // recurring TEMPLATES as ghost projections — completing one of
  // those would mark the template itself done, which is a lie.
  const canComplete = !!it.questId && (!it.recurring || isToday || isPast);

  // ── The clip-to-thread animation ─────────────────────────────────
  // slide 1 = floating right of the line (unfinished), 0 = seated on
  // the line (done). Syncs to `done` with a spring on every change,
  // so BOTH completion paths (radio tap, missed Mark-done pill) get
  // the clip effect, and un-completing springs the marker back off.
  const slide = useSharedValue(done ? 0 : 1);
  useEffect(() => {
    slide.value = withSpring(done ? 0 : 1, {
      damping: 13,
      stiffness: 160,
    });
  }, [done, slide]);
  const markerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slide.value * RADIO_OFFSET }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: slide.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: 1 - slide.value,
    transform: [{ scale: 0.6 + 0.4 * (1 - slide.value) }],
  }));
  const confirmUncomplete = useUncompleteConfirm(it.questId ?? '', it.title);

  // FAN-OUT mirrors Home's completeQuest (XP + shard + activity) so
  // finishing a missed task here grants the same rewards.
  const markDone = () => {
    if (!it.questId) return;
    const prev = useQuestStore
      .getState()
      .quests.find((qq) => qq.id === it.questId);
    const next = useQuestStore.getState().toggle(it.questId);
    if (prev && next && !prev.completed && next.completed) {
      const u = useUserStore.getState();
      u.addXp(next.xpReward);
      u.registerActivity();
      u.addShard();
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <Pressable
      onPress={done ? confirmUncomplete : undefined}
      style={styles.dayRow}
    >
      {/* Peak-hours sheen — tasks sitting in the sharp window get a
          soft glow wash so "do the hard thing now" reads ambiently.
          Skipped once a task is past due — a missed task shouldn't
          glow like an invitation. */}
      {inPeak && !done && !missed && (
        <LinearGradient
          colors={[hexA(C.glow, 0.05), 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 0.7, y: 0.5 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 10 }]}
        />
      )}
      <View style={styles.dayMarkerCol}>
        <Pressable
          disabled={done || !canComplete}
          onPress={markDone}
          hitSlop={12}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={`Mark done: ${it.title}`}
        >
          <Animated.View style={[styles.dayRadioWrap, markerStyle]}>
            {/* hollow radio — floats off the line until earned.
                Past due dims to a rust outline (no glow): the ring
                stops advertising and starts recording. */}
            <Animated.View
              style={[
                styles.dayRadio,
                {
                  borderColor: missed ? hexA(C.ember, 0.5) : tierCol,
                },
                it.tier === 'high' && !missed && styles.peekDotHigh,
                ringStyle,
              ]}
            />
            {/* check bead — scales in as the marker clips to the
                thread. */}
            <Animated.View style={[styles.dayRadioCheck, checkStyle]}>
              <Text style={styles.peekDoneCheckGlyph}>✓</Text>
            </Animated.View>
          </Animated.View>
        </Pressable>
      </View>
      <Text
        style={[
          styles.dayRowTime,
          { color: done ? C.mute : missed ? C.ash : C.ember },
        ]}
      >
        {fmt(it.min)}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={2}
          style={[
            styles.dayRowTitle,
            missed && { color: C.boneDim },
            done && {
              color: C.mute,
              textDecorationLine: 'line-through',
              textDecorationColor: hexA(C.mute, 0.6),
            },
          ]}
        >
          {it.title}
        </Text>
        {!done && (
          <View style={styles.dayRowMeta}>
            {missed ? (
              // Past-due meta: just the state + duration ("can I
              // still squeeze this in"). No Mark-done pill — the
              // radio IS the completion affordance, same as every
              // other row.
              <>
                <View style={styles.missedTag}>
                  <Text style={styles.missedTagText}>missed</Text>
                </View>
                <Text style={styles.dayRowDur}>{dur(it.durMin ?? 30)}</Text>
              </>
            ) : (
              <>
                <Text style={[styles.peekSigil, { color: tierCol }]}>
                  {it.tier ? IMPORTANCE[it.tier].sigil : '◆'}
                </Text>
                <Text style={styles.dayRowDur}>
                  {dur(it.durMin ?? 30)}
                  {it.recurring ? ' · repeating' : ''}
                </Text>
              </>
            )}
          </View>
        )}
      </View>
      {!done && !!it.questId && !it.recurring && (
        <View style={[styles.peekHandle, { marginTop: 5 }]}>
          {[0, 1, 2].map((r) => (
            <View key={r} style={styles.peekHandleRow}>
              <View style={styles.peekHandleDot} />
              <View style={styles.peekHandleDot} />
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Day view — THE THREAD, compact (lumi-time-loadmap.jsx). A flat list
// of anchors + tasks in time order; NOW breathes between past and
// future; open stretches ≥1h render as dashed DROP TARGETS (drag a
// task in to re-time it); the slump gets a quiet seam label.
//
// v2's pixel-per-minute timeline is retired — proportional spacing
// read as "truthful" but spent most of the screen on empty hours,
// and the drag-to-retime it enabled is covered better by the gap
// targets (you drop into actual room, not a raw minute).
// ═════════════════════════════════════════════════════════════════════
type DayRow =
  | { kind: 'now' }
  | { kind: 'seam'; label: string }
  | { kind: 'gap'; from: number; to: number; key: string }
  | { kind: 'item'; it: TItem };

const DayView = ({
  date,
  isToday,
  isPast,
  items,
  nowMin,
  slumpStart,
  peakStart,
  peakEnd,
  styles,
  ctl,
}: {
  date: Date;
  isToday: boolean;
  isPast: boolean;
  items: TItem[];
  nowMin: number;
  slumpStart: number | null;
  peakStart: number | null;
  peakEnd: number | null;
  styles: ReturnType<typeof makeStyles>;
  ctl: DragCtl;
}) => {
  const dIso = ymd(date);
  const hasQuests = items.some((i) => i.kind === 'quest');

  const rows = useMemo((): DayRow[] => {
    const out: DayRow[] = [];
    let nowPlaced = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const prev = items[i - 1];
      const prevEnd = prev ? prev.min + (prev.durMin ?? 15) : 6 * 60;
      if (isToday && !nowPlaced && it.min > nowMin) {
        out.push({ kind: 'now' });
        nowPlaced = true;
      }
      const gapFrom = Math.max(prevEnd, isToday ? nowMin : prevEnd);
      // Gaps ("room for one thing") only where dropping makes sense:
      // never on a day that's already over, never before the first
      // item (the mock's 6am seed painted a phantom stretch above
      // Wake), and today only ahead of now.
      if (
        prev &&
        !isPast &&
        it.min - gapFrom >= GAP_MIN &&
        (!isToday || it.min > nowMin)
      ) {
        out.push({
          kind: 'gap',
          from: gapFrom,
          to: it.min,
          key: `gap:${dIso}:${gapFrom}`,
        });
      }
      if (
        slumpStart != null &&
        !isPast &&
        it.min >= slumpStart &&
        prev &&
        prev.min < slumpStart
      ) {
        out.push({ kind: 'seam', label: 'the 3pm dip · keep it light' });
      }
      out.push({ kind: 'item', it });
    }
    if (isToday && !nowPlaced) out.push({ kind: 'now' });
    return out;
  }, [items, isToday, isPast, nowMin, slumpStart, dIso]);

  // Open water — minutes until the next not-done item after now.
  const openAhead = useMemo(() => {
    if (!isToday) return null;
    const next = items.find((i) => i.min > nowMin && !i.done);
    if (!next) return null;
    const gap = next.min - nowMin;
    return gap >= 15 ? gap : null;
  }, [items, isToday, nowMin]);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 22,
        paddingTop: 4,
        paddingBottom: FLOATING_NAV_CLEARANCE,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ position: 'relative' }}>
        {/* the thread — one soft line down the marker column */}
        <LinearGradient
          colors={[hexA(C.ash, 0.4), hexA(C.bone, 0.07)]}
          style={styles.dayThreadLine}
        />
        {!hasQuests && (
          <View style={styles.dayEmpty}>
            <Text style={styles.dayEmptyTitle}>Just your routine — open.</Text>
            <Text style={styles.dayEmptyBody}>
              Anchors below hold the shape. Drag something here from another
              day, or dump a thought.
            </Text>
          </View>
        )}
        {rows.map((r, i) => {
          if (r.kind === 'now') {
            return (
              <View key="now" style={styles.dayNowRow}>
                <View style={styles.dayMarkerCol}>
                  <NowPulse />
                </View>
                <Text style={styles.dayNowLabel}>now · {fmt(nowMin)}</Text>
                {openAhead != null && (
                  <Text numberOfLines={1} style={styles.dayNowSub}>
                    {dur(openAhead)} of open water ahead
                  </Text>
                )}
              </View>
            );
          }
          if (r.kind === 'seam') {
            return (
              <View key={`seam${i}`} style={styles.daySeamRow}>
                <LinearGradient
                  colors={[hexA(C.dusk, 0.4), 'rgba(0,0,0,0)']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{ flex: 1, height: 1 }}
                />
                <Text style={styles.daySeamLabel}>{r.label}</Text>
              </View>
            );
          }
          if (r.kind === 'gap') {
            const over = ctl.overKey === r.key;
            const dragging = ctl.draggingId != null;
            return (
              <View
                key={r.key}
                ref={(ref) => ctl.registerTarget(r.key, ref)}
                collapsable={false}
                style={[
                  styles.dayGap,
                  over && {
                    borderColor: C.ember,
                    backgroundColor: hexA(C.ember, 0.1),
                  },
                ]}
              >
                <Text
                  style={{
                    color: over ? C.ember : hexA(C.dusk, 0.9),
                    fontSize: 11,
                  }}
                >
                  ◦
                </Text>
                <Text style={[styles.dayGapTime, over && { color: C.ember }]}>
                  {dur(r.to - r.from)} open
                </Text>
                <Text style={styles.dayGapSub}>
                  {over
                    ? 'drop it here'
                    : dragging
                      ? 'room for this'
                      : 'room for one thing'}
                </Text>
              </View>
            );
          }
          const it = r.it;
          if (it.kind === 'anchor') {
            return (
              <View key={`a${i}`} style={styles.dayAnchorRow}>
                <View style={styles.dayMarkerCol}>
                  <View style={styles.dayAnchorDot} />
                </View>
                <Text style={styles.dayAnchorTime}>{fmt(it.min)}</Text>
                <Text style={styles.dayAnchorTitle}>
                  {it.title.toLowerCase() === 'sleep'
                    ? 'wind down'
                    : it.title.toLowerCase()}
                </Text>
              </View>
            );
          }
          const inPeak =
            peakStart != null &&
            peakEnd != null &&
            it.min >= peakStart &&
            it.min < peakEnd &&
            !it.done;
          // No drag on past days — gaps are suppressed there, so the
          // gesture would have nowhere to land. (Today's missed rows
          // still drag forward into open gaps.)
          const draggable =
            !it.done && !!it.questId && !it.recurring && !isPast;
          const row = (
            <DayTaskRow
              it={it}
              isToday={isToday}
              isPast={isPast}
              nowMin={nowMin}
              inPeak={inPeak}
              styles={styles}
            />
          );
          return draggable ? (
            <DragChip
              key={it.questId ?? `q${i}`}
              ctl={ctl}
              task={{
                questId: it.questId as string,
                title: it.title,
                tier: it.tier ?? 'medium',
                min: it.min,
                fromIso: dIso,
              }}
            >
              <View
                style={
                  ctl.draggingId === it.questId ? { opacity: 0.3 } : undefined
                }
              >
                {row}
              </View>
            </DragChip>
          ) : (
            <View key={it.questId ?? `q${i}`}>{row}</View>
          );
        })}
      </View>
    </ScrollView>
  );
};
// ═════════════════════════════════════════════════════════════════════
// Week view — 7 card rows per lumi-time-loadmap.jsx. Each surfaces
// its LOAD (word + pips) and the day's tasks as chips. Tap the row →
// Day thread; long-press-drag a chip onto another row to move it.
// ═════════════════════════════════════════════════════════════════════
const WeekView = ({
  date,
  today,
  anchors,
  quests,
  effective,
  onPickDate,
  styles,
  nowMin,
  ctl,
}: {
  date: Date;
  today: Date;
  anchors: DailyAnchors;
  quests: Quest[];
  effective: ReturnType<typeof useEffectiveWindows>;
  onPickDate: (d: Date) => void;
  styles: ReturnType<typeof makeStyles>;
  nowMin: number;
  ctl: DragCtl;
}) => {
  const start = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingTop: 2,
        paddingBottom: FLOATING_NAV_CLEARANCE,
        gap: 8,
      }}
      showsVerticalScrollIndicator={false}
    >
      {days.map((d) => {
        const isToday = sameDay(d, today);
        const past = dayOffset(d, today) < 0;
        const dIso = ymd(d);
        const items = buildItemsForDate(
          d,
          anchors,
          quests,
          effective,
          today,
          nowMin,
        );
        const dayQuests = items.filter((it) => it.kind === 'quest');
        const load = loadOf(items);
        const over = ctl.overKey === `day:${dIso}`;
        return (
          <View
            key={dIso}
            ref={(r) => ctl.registerTarget(`day:${dIso}`, r)}
            collapsable={false}
            style={[
              styles.weekCard,
              isToday && styles.weekCardToday,
              past && !over && { opacity: 0.55 },
              over && styles.weekCardOver,
            ]}
          >
            <Pressable
              onPress={() => onPickDate(d)}
              style={styles.weekCardHead}
              hitSlop={4}
            >
              <Text
                style={[
                  styles.weekCardDate,
                  { color: isToday ? C.glow : C.bone },
                ]}
              >
                {WD[d.getDay()]} {d.getDate()}
              </Text>
              {isToday && (
                <View style={styles.weekTodayTag}>
                  <Text style={styles.weekTodayTagText}>today</Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              <Text
                style={[
                  styles.weekLoadWord,
                  { color: load > 6 ? C.ember : C.mute },
                ]}
              >
                {loadWord(load)}
              </Text>
              <Pips load={load} />
            </Pressable>
            {dayQuests.length === 0 ? (
              <Text style={styles.weekCardEmpty}>
                {over
                  ? 'drop it here — plenty of room'
                  : 'just your routine — open'}
              </Text>
            ) : (
              <View style={styles.weekChipsWrap}>
                {dayQuests.map((q, k) => {
                  const tierCol = q.tier ? IMPORTANCE[q.tier].color : C.mute;
                  const dragging = ctl.draggingId === q.questId;
                  const canDrag = !q.done && !!q.questId && !q.recurring;
                  const chip = (
                    <View
                      style={[
                        styles.weekChip,
                        {
                          borderColor: hexA(tierCol, q.done ? 0.2 : 0.4),
                          opacity: dragging ? 0.3 : q.done ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.weekChipSigil, { color: tierCol }]}
                      >
                        {q.tier ? IMPORTANCE[q.tier].sigil : '◆'}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.weekChipTitle,
                          q.done && {
                            color: C.mute,
                            textDecorationLine: 'line-through',
                          },
                        ]}
                      >
                        {q.title}
                      </Text>
                      <Text style={styles.weekChipTime}>{fmt(q.min)}</Text>
                    </View>
                  );
                  return canDrag ? (
                    <DragChip
                      key={q.questId ?? k}
                      ctl={ctl}
                      task={{
                        questId: q.questId as string,
                        title: q.title,
                        tier: q.tier ?? 'medium',
                        min: q.min,
                        fromIso: dIso,
                      }}
                    >
                      {chip}
                    </DragChip>
                  ) : (
                    <View key={q.questId ?? `s${k}`}>{chip}</View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
      <Text style={styles.dragCaption}>
        hold + drag a task onto another day to rebalance
      </Text>
    </ScrollView>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Month view — THE LOAD MAP (lumi-time-loadmap.jsx). Heat shows heavy
// vs light days (the warmer a cell, the fuller the day), the busiest
// day gets a nudge, tapping a day peeks it, dragging a peek row onto
// any cell moves the task, and heavy days offer one-tap "Lighten".
// ═════════════════════════════════════════════════════════════════════
const MonthView = ({
  date,
  today,
  anchors,
  quests,
  effective,
  onPickDate,
  accent,
  styles,
  nowMin,
  ctl,
  onLighten,
}: {
  date: Date;
  today: Date;
  anchors: DailyAnchors;
  quests: Quest[];
  effective: ReturnType<typeof useEffectiveWindows>;
  onPickDate: (d: Date) => void;
  accent: Accent;
  styles: ReturnType<typeof makeStyles>;
  nowMin: number;
  ctl: DragCtl;
  onLighten: (d: Date) => void;
}) => {
  const y = date.getFullYear();
  const m = date.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let dd = 1; dd <= dim; dd++) cells.push(new Date(y, m, dd));
  while (cells.length % 7) cells.push(null);

  // Per-day load + count in one pass — drives the heat cells, the
  // stats row, and the busiest-day nudge.
  const dayStats = useMemo(() => {
    const map = new Map<string, { load: number; count: number }>();
    for (const d of cells) {
      if (!d) continue;
      const qs = buildItemsForDate(
        d,
        anchors,
        quests,
        effective,
        today,
        nowMin,
      ).filter((i) => i.kind === 'quest');
      map.set(ymd(d), { load: loadOf(qs), count: qs.length });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, m, anchors, quests, effective, today, nowMin]);

  // Selected day starts on today (if today's in the viewed month) or
  // on the 1st otherwise. Tracks taps so the peek panel reflects the
  // currently-focused day without opening the thread.
  const inMonthDefault = useMemo(
    () =>
      today.getMonth() === m && today.getFullYear() === y
        ? today
        : new Date(y, m, 1),
    [m, y, today],
  );
  const [sel, setSel] = useState<Date>(inMonthDefault);
  useEffect(() => {
    setSel(inMonthDefault);
  }, [inMonthDefault]);

  // Month stats — planned, days with plans, days open, busiest day.
  const summary = useMemo((): {
    monthQuests: number;
    planDays: number;
    openDays: number;
    busiest: Date | null;
    busiestLoad: number;
  } => {
    let monthQuests = 0;
    let planDays = 0;
    let monthDayCount = 0;
    let busiest: Date | null = null;
    let busiestLoad = 0;
    cells.forEach((d) => {
      if (!d) return;
      monthDayCount += 1;
      const st = dayStats.get(ymd(d));
      if (!st) return;
      if (st.count > 0) {
        planDays += 1;
        monthQuests += st.count;
      }
      if (st.load > busiestLoad) {
        busiestLoad = st.load;
        busiest = d;
      }
    });
    return {
      monthQuests,
      planDays,
      openDays: monthDayCount - planDays,
      busiest,
      busiestLoad,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStats]);
  // TS can't see through the forEach closure — busiest is Date | null.
  const busiestDay: Date | null = summary.busiest;

  // Selected-day peek data.
  const peekItems = useMemo(
    () =>
      buildItemsForDate(sel, anchors, quests, effective, today, nowMin)
        .filter((i) => i.kind === 'quest')
        .sort((a, b) => a.min - b.min),
    [sel, anchors, quests, effective, today, nowMin],
  );
  const selIso = ymd(sel);
  const selLoad = loadOf(peekItems);
  const hardCount = peekItems.filter((t) => t.tier === 'high').length;
  const selToday = sameDay(sel, today);
  const selOff = dayOffset(sel, today);
  const selLabel =
    selToday
      ? 'Today'
      : selOff === 1
        ? 'Tomorrow'
        : selOff === -1
          ? 'Yesterday'
          : selOff < 0
            ? `${Math.abs(selOff)}d ago`
            : `in ${selOff}d`;

  // Build the calendar as rows of 7 — flexWrap-with-percent was
  // overflowing by a few px so Sunday wrapped to the next row. With
  // explicit rows + `flex: 1` per cell, the math is exact and Sunday
  // sits in the rightmost column always.
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.monthHeaderRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <Text key={i} style={styles.monthHeaderCell}>
            {w}
          </Text>
        ))}
      </View>

      {/* Grid — explicit rows so Sunday always sits in column 7. */}
      <View style={{ gap: 5 }}>
        {rows.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap: 5 }}>
            {row.map((d, ci) => {
              if (!d) {
                return <View key={ci} style={{ flex: 1, aspectRatio: 1 }} />;
              }
              const dI = ymd(d);
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, sel);
              const load = dayStats.get(dI)?.load ?? 0;
              const heavy = load >= HEAVY_LOAD;
              const over = ctl.overKey === `day:${dI}`;
              // Heat — the warmer a day, the fuller it is. Alpha
              // ramps 0.08 → 0.48 with load, capped at 9.
              const a =
                load === 0 ? 0 : 0.08 + (Math.min(load, 9) / 9) * 0.4;
              return (
                <Pressable
                  key={ci}
                  ref={(r) => ctl.registerTarget(`day:${dI}`, r)}
                  collapsable={false}
                  onPress={() => setSel(d)}
                  style={[
                    styles.monthCell,
                    {
                      backgroundColor: over
                        ? hexA(C.ember, 0.28)
                        : load > 0
                          ? hexA(C.ember, a)
                          : 'transparent',
                      borderColor: over
                        ? C.glow
                        : isSelected
                          ? C.ember
                          : isToday
                            ? hexA(C.glow, 0.6)
                            : load > 0
                              ? hexA(C.ember, 0.12 + a * 0.5)
                              : hexA(C.hair, 0.7),
                    },
                    (heavy || over) && styles.monthCellGlow,
                  ]}
                >
                  <Text
                    style={[
                      styles.monthCellNum,
                      {
                        color: isToday
                          ? C.glow
                          : load >= 4
                            ? C.bone
                            : C.boneDim,
                      },
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                  {heavy && <View style={styles.monthHeavyDot} />}
                  {isToday && (
                    <Text style={styles.monthCellTodayTag}>today</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <Text style={styles.monthCaption}>
        the warmer a day, the fuller it is — tap to peek, hold + drag a
        task onto a day to move it
      </Text>

      {/* Busiest-day nudge — only when it's genuinely heavy. */}
      {busiestDay != null && summary.busiestLoad >= HEAVY_LOAD && (
        <Pressable
          onPress={() => setSel(busiestDay)}
          style={styles.monthNudge}
        >
          <Text style={styles.monthNudgeSpark}>✦</Text>
          <Text style={styles.monthNudgeText}>
            {WDF[busiestDay.getDay()]} the {busiestDay.getDate()}
            {ordSuffix(busiestDay.getDate())} is your heaviest — tap to
            peek, or spread it out.
          </Text>
        </Pressable>
      )}

      {/* Selected-day peek — compact rows you can drag straight onto
          the grid above. Heavy days offer one-tap Lighten. */}
      <View style={styles.monthPeekCard}>
        <View style={styles.monthPeekHead}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9 }}>
            <Text style={styles.monthPeekTitle}>
              {WD[sel.getDay()]}, {MO[sel.getMonth()].slice(0, 3)}{' '}
              {sel.getDate()}
            </Text>
            <Text
              style={[
                styles.monthPeekRel,
                { color: selToday ? accent.fg : C.mute },
              ]}
            >
              {selLabel}
            </Text>
          </View>
          <Text
            style={[
              styles.monthPeekCount,
              selLoad >= HEAVY_LOAD && { color: C.ember },
            ]}
          >
            {peekItems.length
              ? `${peekItems.length} planned${hardCount ? ` · ${hardCount} hard` : ''}`
              : 'open'}
          </Text>
        </View>
        {peekItems.length > 0 ? (
          <View style={{ gap: 6, marginBottom: 12 }}>
            {peekItems.map((q, k) => {
              const tierCol = q.tier ? IMPORTANCE[q.tier].color : C.mute;
              const dragging = ctl.draggingId === q.questId;
              const canDrag = !q.done && !!q.questId && !q.recurring;
              const row = (
                <View
                  style={[styles.peekRow, dragging && { opacity: 0.3 }]}
                >
                  {q.done ? (
                    <View style={styles.peekDoneCheck}>
                      <Text style={styles.peekDoneCheckGlyph}>✓</Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.peekDot,
                        { borderColor: tierCol },
                        q.tier === 'high' && styles.peekDotHigh,
                      ]}
                    />
                  )}
                  <Text
                    style={[
                      styles.monthPeekTime,
                      { color: q.done ? C.mute : C.ember },
                    ]}
                  >
                    {fmt(q.min)}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.monthPeekTaskTitle,
                        q.done && {
                          color: C.mute,
                          textDecorationLine: 'line-through',
                        },
                      ]}
                    >
                      {q.title}
                    </Text>
                    {!q.done && (
                      <View style={styles.peekMetaRow}>
                        <Text
                          style={[styles.peekSigil, { color: tierCol }]}
                        >
                          {q.tier ? IMPORTANCE[q.tier].sigil : '◆'}
                        </Text>
                        <Text style={styles.monthPeekDur}>
                          {dur(q.durMin ?? 30)}
                          {q.recurring ? ' · repeating' : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                  {canDrag && (
                    <View style={styles.peekHandle}>
                      {[0, 1, 2].map((r) => (
                        <View key={r} style={styles.peekHandleRow}>
                          <View style={styles.peekHandleDot} />
                          <View style={styles.peekHandleDot} />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
              return canDrag ? (
                <DragChip
                  key={q.questId ?? k}
                  ctl={ctl}
                  task={{
                    questId: q.questId as string,
                    title: q.title,
                    tier: q.tier ?? 'medium',
                    min: q.min,
                    fromIso: selIso,
                  }}
                >
                  {row}
                </DragChip>
              ) : (
                <View key={q.questId ?? `s${k}`}>{row}</View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.monthPeekEmpty}>
            Nothing here yet — a good landing spot for something heavy.
          </Text>
        )}
        {selLoad >= HEAVY_LOAD && (
          <Pressable
            onPress={() => onLighten(sel)}
            style={styles.lightenBtn}
          >
            <Text style={styles.lightenBtnText}>
              Lighten this day — move the lighter ones
            </Text>
          </Pressable>
        )}
        {peekItems.length > 0 && selLoad < HEAVY_LOAD && (
          <Text style={styles.peekHint}>
            hold + drag a task onto any day above
          </Text>
        )}
        <Pressable
          onPress={() => onPickDate(sel)}
          style={[
            styles.monthPeekCta,
            {
              backgroundColor: hexA(accent.fg, 0.14),
              borderColor: hexA(accent.fg, 0.45),
            },
          ]}
        >
          <Text style={[styles.monthPeekCtaText, { color: accent.fg }]}>
            Open this day&apos;s thread →
          </Text>
        </Pressable>
      </View>

      {/* Month stats — planned · days with plans · days open. */}
      <View style={styles.monthSummaryRow}>
        {(
          [
            [summary.monthQuests, 'planned'],
            [summary.planDays, 'days with plans'],
            [summary.openDays, 'days open'],
          ] as const
        ).map(([n, l]) => (
          <View key={l} style={styles.monthSummaryCard}>
            <Text style={styles.monthSummaryNum}>{n}</Text>
            <Text style={styles.monthSummaryLabel}>{l}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

// ═════════════════════════════════════════════════════════════════════
// NextBar — pinned across all views. Shows the next upcoming item
// today, rolls to tomorrow if today's clear. Tap → Today's thread.
// ═════════════════════════════════════════════════════════════════════
const NextBar = ({
  anchors,
  quests,
  effective,
  today,
  nowMin,
  onJumpToToday,
  accent,
  styles,
}: {
  anchors: DailyAnchors;
  quests: Quest[];
  effective: ReturnType<typeof useEffectiveWindows>;
  today: Date;
  nowMin: number;
  onJumpToToday: () => void;
  accent: Accent;
  styles: ReturnType<typeof makeStyles>;
}) => {
  const nextUp = useMemo(() => {
    const todays = buildItemsForDate(
      today,
      anchors,
      quests,
      effective,
      today,
      nowMin,
    );
    const todayNext = todays.find(
      (i) => i.min >= nowMin && !i.done,
    );
    if (todayNext) {
      return {
        item: todayNext,
        when: `in ${dur(Math.max(1, todayNext.min - nowMin))}`,
        isToday: true,
      };
    }
    const tomorrow = addDays(today, 1);
    const tmrItems = buildItemsForDate(
      tomorrow,
      anchors,
      quests,
      effective,
      today,
    );
    const first = tmrItems[0];
    if (!first) return null;
    return {
      item: first,
      when: `tomorrow · ${fmt(first.min)}`,
      isToday: false,
    };
  }, [anchors, quests, effective, today, nowMin]);

  if (!nextUp) return null;
  return (
    <Pressable
      onPress={onJumpToToday}
      style={[
        styles.nextBar,
        {
          borderColor: hexA(accent.fg, 0.4),
          backgroundColor: hexA(accent.fg, 0.08),
        },
      ]}
    >
      <View
        style={[
          styles.nextBarArrow,
          { backgroundColor: hexA(accent.fg, 0.2) },
        ]}
      >
        <Text style={[styles.nextBarArrowGlyph, { color: accent.fg }]}>
          ▸
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.nextBarEyebrow, { color: accent.fg }]}>
          {nextUp.isToday ? 'Up next' : 'Next · tomorrow'}
        </Text>
        <Text numberOfLines={1} style={styles.nextBarTitle}>
          {nextUp.item.title}
        </Text>
      </View>
      <Text style={[styles.nextBarWhen, { color: accent.fg }]}>
        {nextUp.when}
      </Text>
    </Pressable>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════
export default function Time() {
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  const effectiveWindows = useEffectiveWindows();

  const anchors = useUserStore((s) => s.anchors);
  const allQuests = useQuestStore((s) => s.quests);
  const digest = useLearningDigest();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const today = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);

  const [scale, setScale] = useState<Scale>('day');
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const nowMin = now.getHours() * 60 + now.getMinutes();

  const items = useMemo(
    () =>
      buildItemsForDate(
        date,
        anchors,
        allQuests,
        effectiveWindows,
        today,
        nowMin,
      ),
    [date, anchors, allQuests, effectiveWindows, today, nowMin],
  );

  // ── Navigation ──────────────────────────────────────────────────
  const shift = (dir: number) => {
    if (scale === 'day') setDate((d) => addDays(d, dir));
    else if (scale === 'week') setDate((d) => addDays(d, dir * 7));
    else setDate((d) => addMonths(d, dir));
  };
  // [Today] snaps the DATE back without yanking you out of the scale
  // you're in — day view returns to today's thread, week to this
  // week, month to this month. (The NextBar separately jumps to
  // today's thread via pickDate.)
  const jumpToToday = () => {
    setDate(today);
  };
  const pickDate = (d: Date) => {
    setDate(d);
    setScale('day');
  };

  const isCurrent =
    scale === 'day'
      ? sameDay(date, today)
      : scale === 'week'
        ? startOfWeek(date).getTime() === startOfWeek(today).getTime()
        : date.getMonth() === today.getMonth() &&
          date.getFullYear() === today.getFullYear();

  // ── Cross-day drag controller ───────────────────────────────────
  const insets = useSafeAreaInsets();
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const dragActive = useSharedValue(0);
  const [dragTask, setDragTask] = useState<DragTask | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragTaskRef = useRef<DragTask | null>(null);
  const targetRefs = useRef(new Map<string, View>()).current;
  const targetRects = useRef(
    new Map<string, { x: number; y: number; w: number; h: number }>(),
  ).current;

  // Undo — snapshot of the moved quests' previous date + anchor so
  // one tap puts everything back exactly where it was.
  const undoRef = useRef<
    { id: string; date: string; h: number | null; m: number | null }[] | null
  >(null);
  const [moveToast, setMoveToast] = useState<string | null>(null);
  const moveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showMoveToast = (msg: string) => {
    setMoveToast(msg);
    if (moveToastTimer.current) clearTimeout(moveToastTimer.current);
    moveToastTimer.current = setTimeout(() => setMoveToast(null), 6000);
  };
  useEffect(
    () => () => {
      if (moveToastTimer.current) clearTimeout(moveToastTimer.current);
    },
    [],
  );

  const registerTarget = (key: string, ref: View | null) => {
    if (ref) targetRefs.set(key, ref);
    else targetRefs.delete(key);
  };
  const beginDrag = (t: DragTask) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dragTaskRef.current = t;
    setDragTask(t);
    setOverKey(null);
    // Measure every registered target ONCE — the pan owns the touch
    // from here, nothing can scroll mid-drag, so rects stay valid.
    targetRects.clear();
    targetRefs.forEach((ref, key) => {
      ref.measureInWindow((x, y, w, h) => {
        targetRects.set(key, { x, y, w, h });
      });
    });
  };
  const hitTest = (x: number, y: number): string | null => {
    for (const [key, r] of targetRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return key;
      }
    }
    return null;
  };
  const hoverDrag = (x: number, y: number) => {
    const k = hitTest(x, y);
    setOverKey((cur) => (cur === k ? cur : k));
  };
  const cancelDrag = () => {
    dragTaskRef.current = null;
    setDragTask(null);
    setOverKey(null);
  };

  /** Move quests to new dates (keeping their clock time) + arm Undo.
   *  setDate deliberately un-anchors (a deferred task usually needs
   *  re-scheduling) — but a DRAG carries intent about the time too,
   *  so we re-anchor after: to `newT` when the drop names a time (a
   *  day-thread gap), else to the original clock time. */
  const applyMoves = (
    moves: { id: string; toIso: string; newT?: number }[],
    msg: string,
  ) => {
    const st = useQuestStore.getState();
    const snapshot: NonNullable<typeof undoRef.current> = [];
    for (const mv of moves) {
      const q = st.quests.find((qq) => qq.id === mv.id);
      if (!q) continue;
      snapshot.push({
        id: q.id,
        date: q.date ?? todayKey(),
        h: q.scheduledHour ?? null,
        m: q.scheduledMinute ?? null,
      });
      st.setDate(mv.id, mv.toIso);
      if (mv.newT != null) {
        st.anchor(mv.id, Math.floor(mv.newT / 60), mv.newT % 60);
      } else if (q.scheduledHour != null) {
        st.anchor(mv.id, q.scheduledHour, q.scheduledMinute ?? 0);
      }
    }
    if (!snapshot.length) return;
    undoRef.current = snapshot;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showMoveToast(msg);
  };
  const undoMoves = () => {
    const snap = undoRef.current;
    undoRef.current = null;
    setMoveToast(null);
    if (!snap) return;
    const st = useQuestStore.getState();
    for (const s of snap) {
      st.setDate(s.id, s.date);
      if (s.h != null) st.anchor(s.id, s.h, s.m ?? 0);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const dropDrag = (x: number, y: number) => {
    const t = dragTaskRef.current;
    const k = hitTest(x, y);
    cancelDrag();
    if (!t || !k) return;
    const short =
      t.title.length > 26 ? `${t.title.slice(0, 24)}…` : t.title;
    // Day-thread gap → re-time into the open stretch (snapped up to
    // the next quarter hour so nothing lands at 2:16p).
    if (k.startsWith('gap:')) {
      const [, toIso, fromStr] = k.split(':');
      const from = parseInt(fromStr, 10);
      if (!Number.isFinite(from)) return;
      const newT = Math.min(24 * 60 - 15, Math.ceil(from / 15) * 15);
      applyMoves(
        [{ id: t.questId, toIso, newT }],
        `“${short}” → ${fmt(newT)}`,
      );
      return;
    }
    if (!k.startsWith('day:')) return;
    const toIso = k.slice(4);
    if (toIso === t.fromIso) return;
    const d = fromIsoLocal(toIso);
    applyMoves(
      [{ id: t.questId, toIso }],
      `Moved “${short}” → ${WD[d.getDay()]} ${d.getDate()}`,
    );
  };
  const dragCtl: DragCtl = {
    gx,
    gy,
    active: dragActive,
    begin: beginDrag,
    hover: hoverDrag,
    drop: dropDrag,
    cancel: cancelDrag,
    registerTarget,
    overKey,
    draggingId: dragTask?.questId ?? null,
  };

  /** One-tap "Lighten this day" — move the movable (non-high, not
   *  done, not recurring) tasks to the calmest other future days of
   *  the same week. The heavy stuff stays put; the day just breathes. */
  const lightenDay = (day: Date) => {
    const dIso = ymd(day);
    const st = useQuestStore.getState();
    const movable = st.quests.filter(
      (q) =>
        q.date === dIso &&
        !q.completed &&
        !q.recur &&
        q.window !== 'someday' &&
        q.importance !== 'high',
    );
    if (!movable.length) return;
    const ws = startOfWeek(day);
    const others = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter(
      (d) => !sameDay(d, day) && dayOffset(d, today) >= 0,
    );
    if (!others.length) return;
    const loadFor = (d: Date) =>
      loadOf(
        buildItemsForDate(d, anchors, allQuests, effectiveWindows, today, nowMin),
      );
    others.sort((a, b) => loadFor(a) - loadFor(b));
    const nTargets = Math.min(2, others.length);
    const moves = movable.map((q, i) => ({
      id: q.id,
      toIso: ymd(others[i % nTargets]),
    }));
    applyMoves(
      moves,
      `Lightened ${WD[day.getDay()]} ${day.getDate()} — moved ${moves.length} to calmer days`,
    );
  };

  // Drag ghost — rides the finger via shared values (UI thread only).
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: dragActive.value,
    transform: [
      { translateX: gx.value },
      { translateY: gy.value - insets.top },
    ],
  }));

  // ── Header title + sub-context ─────────────────────────────────
  const off = dayOffset(date, today);
  let title: string;
  if (scale === 'day') {
    if (sameDay(date, today)) title = 'Today';
    else if (off === 1) title = 'Tomorrow';
    else if (off === -1) title = 'Yesterday';
    else
      title = `${WD[date.getDay()]}, ${MO[date.getMonth()].slice(0, 3)} ${date.getDate()}`;
  } else if (scale === 'week') {
    const s = startOfWeek(date);
    const e = addDays(s, 6);
    title =
      s.getMonth() === e.getMonth()
        ? `${MO[s.getMonth()].slice(0, 3)} ${s.getDate()}–${e.getDate()}`
        : `${MO[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${MO[e.getMonth()].slice(0, 3)} ${e.getDate()}`;
  } else {
    title = `${MO[date.getMonth()]} ${date.getFullYear()}`;
  }

  const peakStart = digest.curve.peakStart;
  const peakEnd = digest.curve.peakEnd;
  const slumpStart = digest.curve.slumpStart;

  const inPeak =
    peakStart != null &&
    peakEnd != null &&
    nowMin >= peakStart &&
    nowMin < peakEnd;
  const isToday = sameDay(date, today);
  const dayQuestCount = items.filter((i) => i.kind === 'quest').length;
  const daySubContext =
    scale !== 'day'
      ? null
      : isToday
        ? inPeak
          ? `peak window · now ${fmtNow(nowMin)}`
          : `now ${fmtNow(nowMin)}`
        : `${dayQuestCount} planned`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header — scale segmented control + Today + arrows + title */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.scaleSegment}>
            {SCALES.map(({ key, label }) => {
              const on = scale === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setScale(key)}
                  style={[
                    styles.scaleTab,
                    on && { backgroundColor: accent.fg },
                  ]}
                >
                  <Text
                    style={[
                      styles.scaleTabText,
                      { color: on ? C.void : C.boneDim },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flex: 1 }} />
          {!isCurrent && (
            // [Today] sits at the right, leaving the canonical
            // floating-ProfileIcon slot above it untouched. The
            // header reserves paddingRight so this button stops
            // short of the icon's footprint.
            <Pressable
              onPress={jumpToToday}
              style={[
                styles.todayBtn,
                { borderColor: hexA(accent.fg, 0.4) },
              ]}
            >
              <Text style={[styles.todayBtnText, { color: accent.fg }]}>
                Today
              </Text>
            </Pressable>
          )}
        </View>
        <View style={styles.headerNavRow}>
          <Pressable onPress={() => shift(-1)} style={styles.navArrow}>
            <Text style={styles.navArrowGlyph}>‹</Text>
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.headerTitle}>{title}</Text>
            {daySubContext && (
              <Text
                style={[
                  styles.headerSub,
                  {
                    color: isToday
                      ? inPeak
                        ? C.lichen
                        : accent.fg
                      : C.mute,
                  },
                ]}
              >
                {daySubContext}
              </Text>
            )}
          </View>
          <Pressable onPress={() => shift(1)} style={styles.navArrow}>
            <Text style={styles.navArrowGlyph}>›</Text>
          </Pressable>
        </View>
      </View>

      {/* NextBar — pinned across every view */}
      <View style={styles.nextBarWrap}>
        <NextBar
          anchors={anchors}
          quests={allQuests}
          effective={effectiveWindows}
          today={today}
          nowMin={nowMin}
          onJumpToToday={() => pickDate(today)}
          accent={accent}
          styles={styles}
        />
      </View>

      {/* Active view */}
      {scale === 'day' ? (
        <DayView
          date={date}
          isToday={isToday}
          isPast={dayOffset(date, today) < 0}
          items={items}
          nowMin={nowMin}
          slumpStart={slumpStart}
          peakStart={peakStart}
          peakEnd={peakEnd}
          styles={styles}
          ctl={dragCtl}
        />
      ) : scale === 'week' ? (
        <WeekView
          date={date}
          today={today}
          anchors={anchors}
          quests={allQuests}
          effective={effectiveWindows}
          onPickDate={pickDate}
          styles={styles}
          nowMin={nowMin}
          ctl={dragCtl}
        />
      ) : (
        <MonthView
          date={date}
          today={today}
          anchors={anchors}
          quests={allQuests}
          effective={effectiveWindows}
          onPickDate={pickDate}
          accent={accent}
          styles={styles}
          nowMin={nowMin}
          ctl={dragCtl}
          onLighten={lightenDay}
        />
      )}

      {/* Move toast + Undo — every drop / lighten can be reversed. */}
      {moveToast && (
        <View style={styles.moveToast}>
          <Text style={styles.moveToastCheck}>✓</Text>
          <Text numberOfLines={1} style={styles.moveToastText}>
            {moveToast}
          </Text>
          <Pressable onPress={undoMoves} style={styles.moveToastUndo} hitSlop={6}>
            <Text style={styles.moveToastUndoText}>Undo</Text>
          </Pressable>
        </View>
      )}

      {/* Drag ghost — the task pill floating at the finger. */}
      {dragTask && (
        <Animated.View
          pointerEvents="none"
          style={[styles.ghostWrap, ghostStyle]}
        >
          <View style={styles.ghost}>
            <Text
              style={[
                styles.ghostSigil,
                { color: IMPORTANCE[dragTask.tier].color },
              ]}
            >
              {IMPORTANCE[dragTask.tier].sigil}
            </Text>
            <Text numberOfLines={1} style={styles.ghostTitle}>
              {dragTask.title}
            </Text>
            <Text style={styles.ghostTime}>{fmt(dragTask.min)}</Text>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const makeStyles = (accent: Accent) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.void },

    // ── Header ──
    header: {
      paddingLeft: 20,
      // Reserve canonical room for the floating ProfileIcon
      // (38px wide @ right:20). Buttons in this header (Today,
      // scale tabs) stop short of that slot.
      paddingRight: 66,
      paddingTop: 14,
      paddingBottom: 14,
      // Floor for the icon's footprint so nothing below the
      // header ever sits visually under the icon.
      minHeight: 52,
      borderBottomWidth: 1,
      borderBottomColor: C.hair,
    },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 14,
    },
    scaleSegment: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 100,
      overflow: 'hidden',
    },
    scaleTab: {
      paddingHorizontal: 16,
      paddingVertical: 7,
    },
    scaleTabText: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
      letterSpacing: -0.1,
    },
    todayBtn: {
      borderWidth: 1,
      borderRadius: 100,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    todayBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
    },
    headerNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // The parent .header reserves paddingRight: 66 for the
      // floating ProfileIcon (which sits in the row ABOVE this).
      // The nav row lives BELOW the icon, where there's nothing to
      // collide with, so we pull it back to symmetric padding so
      // the arrows + "Today" title sit centered on the full screen
      // width — not inside the icon-reserved gutter.
      marginRight: -46,
    },
    navArrow: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: C.hair,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navArrowGlyph: {
      fontSize: 18,
      color: C.boneDim,
      lineHeight: 22,
    },
    headerTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 24,
      color: C.bone,
      letterSpacing: -0.5,
      lineHeight: 26,
      includeFontPadding: false,
    },
    headerSub: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginTop: 6,
    },

    // ── NextBar ──
    nextBarWrap: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.hair,
    },
    nextBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderWidth: 1,
      borderRadius: 13,
    },
    nextBarArrow: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextBarArrowGlyph: {
      fontSize: 11,
      fontFamily: fonts.interSemi,
    },
    nextBarEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 9,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    nextBarTitle: {
      fontFamily: fonts.interMed,
      fontSize: 13.5,
      color: C.bone,
      letterSpacing: -0.1,
    },
    nextBarWhen: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 16,
      lineHeight: 18,
    },

    // ── Day view (compact thread) ──
    dayThreadLine: {
      position: 'absolute',
      left: MARKER_W / 2 - 1,
      top: 8,
      bottom: 14,
      width: 2,
      borderRadius: 1,
    },
    dayRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
      paddingVertical: 11,
      paddingRight: 2,
      borderRadius: 10,
    },
    dayMarkerCol: {
      width: MARKER_W,
      alignItems: 'center',
      flexShrink: 0,
    },
    // ── The task radio (clip-to-thread completion) ──
    dayRadioWrap: {
      width: 18,
      height: 18,
      marginTop: 1,
    },
    dayRadio: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 9,
      borderWidth: 2,
      backgroundColor: C.void,
    },
    dayRadioCheck: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 9,
      backgroundColor: hexA(C.lichen, 0.16),
      borderWidth: 1,
      borderColor: hexA(C.lichen, 0.5),
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayRowTime: {
      width: TIME_W,
      flexShrink: 0,
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 13.5,
      marginTop: 1,
      // Breathing room from the floating radio (which rests
      // RADIO_OFFSET px into the gap between the columns).
      marginLeft: 10,
      fontVariant: ['tabular-nums'],
    },
    dayRowTitle: {
      fontFamily: fonts.inter,
      fontSize: 14,
      color: C.bone,
      letterSpacing: -0.15,
      lineHeight: 18,
    },
    dayRowMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    dayRowDur: {
      fontFamily: fonts.inter,
      fontSize: 10.5,
      color: C.mute,
    },
    missedTag: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 100,
      borderWidth: 1,
      borderColor: hexA(C.ember, 0.45),
      backgroundColor: hexA(C.ember, 0.08),
    },
    missedTagText: {
      fontFamily: fonts.interSemi,
      fontSize: 9,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: C.ember,
    },
    dayNowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 9,
    },
    dayNowLabel: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 14,
      color: C.glow,
      fontVariant: ['tabular-nums'],
    },
    dayNowSub: {
      flexShrink: 1,
      fontFamily: fonts.inter,
      fontSize: 10.5,
      color: C.mute,
    },
    daySeamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 9,
      paddingLeft: MARKER_W + 10,
    },
    daySeamLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 9,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: C.dusk,
    },
    dayGap: {
      marginVertical: 3,
      marginLeft: MARKER_W + 10,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: hexA(C.dusk, 0.35),
      backgroundColor: hexA(C.dusk, 0.05),
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    dayGapTime: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 13,
      color: C.dusk,
    },
    dayGapSub: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.mute,
    },
    dayAnchorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 6,
      opacity: 0.68,
    },
    dayAnchorDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: C.void,
      borderWidth: 1.4,
      borderColor: hexA(C.honey, 0.7),
    },
    dayAnchorTime: {
      width: TIME_W,
      flexShrink: 0,
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12,
      color: C.mute,
      fontVariant: ['tabular-nums'],
    },
    dayAnchorTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12,
      color: C.boneDim,
    },
    dayEmpty: {
      paddingLeft: MARKER_W + 10,
      paddingTop: 14,
      paddingBottom: 6,
    },
    dayEmptyTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 16,
      color: C.dusk,
      lineHeight: 22,
    },
    dayEmptyBody: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.mute,
      marginTop: 5,
      lineHeight: 16,
    },

    // ── Week view (loadmap card rows) ──
    weekCard: {
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: hexA(C.bone, 0.025),
      borderWidth: 1.5,
      borderColor: hexA(C.hair, 0.9),
    },
    weekCardToday: {
      backgroundColor: hexA(C.ember, 0.05),
      borderColor: hexA(C.ember, 0.35),
    },
    weekCardOver: {
      backgroundColor: hexA(C.ember, 0.1),
      borderColor: C.ember,
    },
    weekCardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    weekCardDate: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 16,
      letterSpacing: -0.2,
    },
    weekTodayTag: {
      borderWidth: 1,
      borderColor: hexA(C.ember, 0.45),
      borderRadius: 100,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    weekTodayTagText: {
      fontFamily: fonts.interSemi,
      fontSize: 8.5,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: C.ember,
    },
    weekLoadWord: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11,
    },
    weekCardEmpty: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11.5,
      color: C.dusk,
      marginTop: 6,
    },
    weekChipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 9,
    },
    weekChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 100,
      backgroundColor: hexA(C.surface, 0.9),
      borderWidth: 1,
      maxWidth: '100%',
    },
    weekChipSigil: {
      fontFamily: fonts.inter,
      fontSize: 8,
      letterSpacing: -1,
    },
    weekChipTitle: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.bone,
      letterSpacing: -0.1,
      flexShrink: 1,
    },
    weekChipTime: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 10.5,
      color: C.mute,
    },
    dragCaption: {
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11,
      color: C.mute,
      paddingVertical: 4,
    },

    // ── Month view ──
    monthHeaderRow: {
      flexDirection: 'row',
      marginBottom: 8,
      marginTop: 4,
    },
    monthHeaderCell: {
      flex: 1,
      textAlign: 'center',
      fontFamily: fonts.interSemi,
      fontSize: 9,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: C.mute,
      paddingVertical: 4,
    },
    // Old flex-wrap grid retired — explicit rows now own the layout
    // (see MonthView). Kept the style as a no-op to avoid churning
    // every reference outside the file.
    monthGrid: {},
    monthCell: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    // ── Month stats row (bottom, per loadmap mock) ─────────────────
    monthSummaryRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    monthSummaryCard: {
      flex: 1,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: hexA(C.hair, 0.9),
      paddingHorizontal: 6,
      paddingVertical: 10,
      alignItems: 'center',
    },
    monthSummaryNum: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 19,
      lineHeight: 21,
      color: C.bone,
    },
    monthSummaryLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 9,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: C.mute,
      marginTop: 3,
      textAlign: 'center',
    },
    // ── Load-map cell extras ───────────────────────────────────────
    monthCellGlow: {
      shadowColor: C.ember,
      shadowOpacity: 0.3,
      shadowRadius: 13,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    monthHeavyDot: {
      position: 'absolute',
      top: 4,
      right: 5,
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: C.glow,
      shadowColor: C.glow,
      shadowOpacity: 0.8,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
    },
    monthCellTodayTag: {
      fontFamily: fonts.interSemi,
      fontSize: 6.5,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: C.glow,
    },
    // ── Busiest-day nudge ──────────────────────────────────────────
    monthNudge: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
      marginTop: 2,
      marginBottom: 12,
      paddingHorizontal: 13,
      paddingVertical: 11,
      borderRadius: 13,
      backgroundColor: hexA(C.dusk, 0.07),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.25),
    },
    monthNudgeSpark: {
      color: C.dusk,
      fontSize: 11,
      marginTop: 1,
    },
    monthNudgeText: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.dusk,
      lineHeight: 18,
    },
    // ── Peek rows (compact, draggable) ─────────────────────────────
    peekRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 12,
      backgroundColor: hexA(C.bone, 0.035),
      borderWidth: 1,
      borderColor: hexA(C.hair, 0.9),
    },
    peekDoneCheck: {
      width: 17,
      height: 17,
      marginTop: 1,
      borderRadius: 9,
      backgroundColor: hexA(C.lichen, 0.16),
      borderWidth: 1,
      borderColor: hexA(C.lichen, 0.5),
      alignItems: 'center',
      justifyContent: 'center',
    },
    peekDoneCheckGlyph: {
      fontFamily: fonts.interSemi,
      fontSize: 9,
      color: C.lichen,
      lineHeight: 11,
    },
    peekDot: {
      width: 10,
      height: 10,
      marginTop: 4,
      borderRadius: 5,
      backgroundColor: C.void,
      borderWidth: 1.6,
    },
    peekDotHigh: {
      shadowColor: C.ember,
      shadowOpacity: 0.4,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
    },
    peekMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    peekSigil: {
      fontFamily: fonts.inter,
      fontSize: 8,
      letterSpacing: -1,
    },
    peekHandle: {
      marginTop: 4,
      gap: 3,
    },
    peekHandleRow: {
      flexDirection: 'row',
      gap: 3,
    },
    peekHandleDot: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: hexA(C.mute, 0.5),
    },
    peekHint: {
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 10.5,
      color: C.mute,
      marginBottom: 11,
    },
    lightenBtn: {
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: hexA(C.dusk, 0.1),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.4),
      alignItems: 'center',
      marginBottom: 11,
    },
    lightenBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 13,
      color: C.dusk,
    },
    // ── Move toast + Undo ──────────────────────────────────────────
    moveToast: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: FLOATING_NAV_CLEARANCE + 8,
      zIndex: 80,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: 15,
      paddingVertical: 12,
      borderRadius: 15,
      backgroundColor: hexA('#241C17', 0.97),
      borderWidth: 1,
      borderColor: hexA(C.lichen, 0.4),
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 15,
      shadowOffset: { width: 0, height: 12 },
      elevation: 14,
    },
    moveToastCheck: {
      color: C.lichen,
      fontSize: 13,
    },
    moveToastText: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.bone,
      letterSpacing: -0.1,
    },
    moveToastUndo: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 100,
      borderWidth: 1,
      borderColor: hexA(C.ember, 0.45),
    },
    moveToastUndoText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
      color: C.ember,
    },
    // ── Drag ghost ─────────────────────────────────────────────────
    ghostWrap: {
      position: 'absolute',
      left: 0,
      top: 0,
      zIndex: 999,
    },
    ghost: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: 100,
      backgroundColor: C.surface,
      borderWidth: 1.5,
      borderColor: C.ember,
      shadowColor: '#000',
      shadowOpacity: 0.6,
      shadowRadius: 17,
      shadowOffset: { width: 0, height: 14 },
      elevation: 16,
      transform: [
        { translateX: -80 },
        { translateY: -56 },
        { rotate: '-2deg' },
      ],
    },
    ghostSigil: {
      fontFamily: fonts.inter,
      fontSize: 8,
      letterSpacing: -1,
    },
    ghostTitle: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
      color: C.bone,
      maxWidth: 170,
    },
    ghostTime: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11,
      color: C.mute,
    },
    // ── Selected-day peek panel (v2.2) ─────────────────────────────
    monthPeekCard: {
      marginTop: 16,
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 14,
    },
    monthPeekHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 13,
    },
    monthPeekTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 20,
      color: C.bone,
      letterSpacing: -0.4,
    },
    monthPeekRel: {
      fontFamily: fonts.interSemi,
      fontSize: 10.5,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    monthPeekCount: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.mute,
    },
    monthPeekTime: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.boneDim,
      width: 46,
    },
    monthPeekTaskTitle: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 14,
      color: C.bone,
      letterSpacing: -0.1,
    },
    monthPeekDur: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.mute,
    },
    monthPeekEmpty: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 13,
      color: C.mute,
      lineHeight: 19,
      marginBottom: 14,
    },
    monthPeekCta: {
      borderRadius: 12,
      borderWidth: 1,
      paddingVertical: 12,
      alignItems: 'center',
    },
    monthPeekCtaText: {
      fontFamily: fonts.interSemi,
      fontSize: 13,
      letterSpacing: 0.1,
    },
    monthCellNum: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 15,
      lineHeight: 16,
    },
    monthCaption: {
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11,
      color: C.mute,
      marginTop: 10,
      marginBottom: 10,
      lineHeight: 17,
      paddingHorizontal: 10,
    },
  });

// Default-ember stylesheet for module-level usage (parity with siblings).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _defaults = makeStyles(accentFor('ember'));
void _defaults;
