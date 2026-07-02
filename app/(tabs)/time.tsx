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
//   • Cross-day drag-and-drop: long-press a chip (Week) or a peek
//     row (Month) and drop it on any day. Every move → toast + Undo.
//   Day view keeps its own within-day drag-to-retime from v2.
//
// READS only — Time is a view over the shared data. Each date =
// `userStore.anchors` (the routine bones) + that date's quests from
// `useQuestStore` (dated + `recur`-expanded). Energy bands come from
// the learned curve. Fresh accounts show anchors only — never seeded.
//
// Bug fixes carried from v2:
//   - Energy-band labels rendered in a reserved right gutter at
//     zIndex 50 so item cards never cover them (v2 spec §4).
//   - **New** stacking guard: items within MIN_VERTICAL_GAP px after
//     their natural Y get pushed down so cards don't overlap visually.
//     Time labels follow their item so position stays honest.

import {
  useEffect,
  useLayoutEffect,
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
  Modal,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { timeColors as C } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { IMPORTANCE, type Importance } from '../../constants/importance';
import {
  useEffectiveWindows,
  type WindowKey,
} from '../../constants/windows';
import { type RecurRule, type WeekdayKey } from '../../constants/recur';
import {
  useUserStore,
  type DailyAnchors,
} from '../../store/userStore';
import { useQuestStore, type Quest } from '../../store/questStore';
import { useLearningDigest } from '../../lib/learning';
import { todayKey } from '../../lib/gamification';
import { useAccent, accentFor, type Accent } from '../../lib/theme';
import {
  useDeleteConfirm,
  useUncompleteConfirm,
} from '../../components/TaskDeleteWrap';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';

// ═════════════════════════════════════════════════════════════════════
// Layout constants
// ═════════════════════════════════════════════════════════════════════
const PXPM = 1.05;
const TOPPAD = 22;
const THREAD_X = 68;
const CONTENT_X = 80;
const ITEM_RIGHT = 32;
const LABEL_GUTTER = 26;
const SCROLL_TO_NOW_OFFSET = 170;
const OPEN_STRETCH_MIN = 70;
const MIN_VERTICAL_GAP = 28; // stacking guard for adjacent rows
const UP_NEXT_GAP = 76; // the up-next card is ~67px tall; clear it

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

const partOfDay = (m: number): string => {
  const h = m / 60;
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
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
// Band — energy backdrop + rotated label in the reserved gutter.
// ═════════════════════════════════════════════════════════════════════
const Band = ({
  yTop,
  height,
  color,
  label,
}: {
  yTop: number;
  height: number;
  color: string;
  label: string;
}) => (
  <View
    pointerEvents="none"
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      top: yTop,
      height,
    }}
  >
    {/* Horizontal gradient (color → transparent left to right) so the
        band gently announces the energy window without making the
        whole thread feel washed. Matches the mock's
        linear-gradient(90deg, col@10%, col@3% 70%, transparent). */}
    <LinearGradient
      colors={[
        hexA(color, 0.1),
        hexA(color, 0.03),
        'rgba(0,0,0,0)',
      ]}
      locations={[0, 0.7, 1]}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      }}
    />
    {/* Vertical label in the right gutter — letters stacked top-to-
        bottom starting at the band's START TIME. Lives OUTSIDE the
        thread column so it can't be overlapped by task chips, and
        unlike the previous 90°-rotated <Text> (which RN rotated
        around its center and pushed half the glyph above the
        band's top edge), this version is height-deterministic: each
        letter occupies exactly LINE_H pixels, anchored from the
        start time downward, so the label can never get clipped or
        rendered outside the visible band. ' ' chars render as
        middle-dot separators so words read like "PEAK · SHARP". */}
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        right: 4,
        top: 6,
        width: LABEL_GUTTER - 8,
        alignItems: 'center',
      }}
    >
      {label
        // Collapse any run of separator glyphs (spaces, middle
        // dots) into a single space. Source labels like
        // "peak · sharp" expand to [' ', '·', ' '] when split per-
        // char, which then rendered as THREE stacked dots between
        // the words. Normalising first means one separator → one
        // visible middle-dot regardless of how the source is
        // punctuated.
        .replace(/[\s·]+/g, ' ')
        .trim()
        .toUpperCase()
        .split('')
        .map((ch, i) => (
          <Text
            key={`${ch}-${i}`}
            style={{
              fontFamily: fonts.interSemi,
              fontSize: 10,
              lineHeight: 12,
              color: hexA(color, 1),
              letterSpacing: 0,
            }}
          >
            {ch === ' ' ? '·' : ch}
          </Text>
        ))}
    </View>
  </View>
);

// ═════════════════════════════════════════════════════════════════════
// Item — uses the pre-computed render Y from the stacking guard so
// overlapping items get nudged down a bit instead of stacking on top.
// ═════════════════════════════════════════════════════════════════════
const Item = ({
  it,
  y,
  nowMin,
  isNextQuest,
  showAsPast,
  hideTime,
  wakeMin,
  dayHeight,
}: {
  it: TItem;
  y: number;
  nowMin: number;
  isNextQuest: boolean;
  showAsPast: boolean;
  hideTime?: boolean;
  wakeMin: number;
  dayHeight: number;
}) => {
  const past = showAsPast && it.min + (it.durMin ?? 0) <= nowMin;
  const tierMeta = it.tier ? IMPORTANCE[it.tier] : null;
  const col =
    it.kind === 'anchor' ? C.mute : tierMeta ? tierMeta.color : C.boneDim;
  const done = it.done === true;
  // A quest is "missed" when its scheduled time/window has already
  // passed today but it isn't completed. We surface this with a small
  // rust tag so the user can see what slipped — the task stays active
  // (not pushed to tomorrow) so they can still do it now or move it
  // explicitly. Anchors are never missed (they're not tasks).
  const missed = past && !done && it.kind === 'quest';
  // Always-visible delete on quest items (anchors come from profile
  // and aren't deletable here). Single tap → destructive confirm.
  // Hide the × on already-completed tasks — they're a record of what
  // you finished and shouldn't be one-tap erasable.
  const confirmDelete = useDeleteConfirm(it.questId ?? '', it.title);
  const canDelete = it.kind === 'quest' && !!it.questId && !done;
  // Tap a completed quest row to UN-complete it — catches accidental
  // taps past Home's 6-second undo window.
  const confirmUncomplete = useUncompleteConfirm(it.questId ?? '', it.title);
  const canUncomplete = it.kind === 'quest' && !!it.questId && done;
  // Missed tasks need a way to finish them in place — the user did
  // the thing late, they shouldn't have to open Home and find it.
  // Tapping the ember "Done" pill toggles complete with a success
  // haptic. Only renders on missed items (past + not done).
  //
  // FAN-OUT: must mirror Home's completeQuest so completing here
  // grants the SAME rewards as completing on Home. Previously this
  // only called toggle(), leaking XP/shards/streak credit. The
  // fan-out is: toggle + addXp(reward) + addShard + registerActivity.
  // We don't trigger Luna cheer here — that's a Home-only visual.
  const markDone = () => {
    if (!it.questId) return;
    // Capture state BEFORE the toggle so we can detect the
    // not-done → done transition. toggle() returns the updated
    // quest; if `next.completed === true` and the prior `prev` was
    // not completed, this is a fresh completion and we fan out
    // the rewards.
    const prev = useQuestStore.getState().quests.find(
      (qq) => qq.id === it.questId,
    );
    const next = useQuestStore.getState().toggle(it.questId);
    if (prev && next && !prev.completed && next.completed) {
      const u = useUserStore.getState();
      u.addXp(next.xpReward);
      u.registerActivity();
      u.addShard();
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ── Drag-and-drop on Day view ───────────────────────────────────
  // Only quest items that aren't done are draggable. Anchors come
  // from the user's profile (not editable here); done tasks are
  // history. Past missed tasks ARE draggable — they should be easy
  // to slide forward to "now or later" without going to Home.
  const canDrag = it.kind === 'quest' && !!it.questId && !done;
  const dragY = useSharedValue(0);
  const isDragging = useSharedValue(0);
  // Live preview of the proposed drop time. Null when not dragging;
  // a snapped minute-of-day while the gesture is active. Drives the
  // time label so the user sees the new time before they release.
  const [proposedMin, setProposedMin] = useState<number | null>(null);
  const previewTime = (translationY: number) => {
    const newY = y + translationY;
    const newMin = (newY - TOPPAD) / PXPM + wakeMin;
    const SNAP = 15;
    // Mirror the hour-magnetic snap from onEnd so the live preview
    // and the committed drop agree. Within 8 min of an hour edge,
    // pull to the hour; otherwise standard 15-min snap.
    const nearestHour = Math.round(newMin / 60) * 60;
    const snapRaw =
      Math.abs(newMin - nearestHour) <= 8
        ? nearestHour
        : Math.round(newMin / SNAP) * SNAP;
    const snapped = Math.max(0, Math.min(24 * 60 - SNAP, snapRaw));
    setProposedMin(snapped);
  };
  const clearPreview = () => setProposedMin(null);

  // Commit a dropped position. Snaps to 15-min intervals, clamps to
  // [wake, sleep] so a wild drag can't yeet the task to 4 AM. Fires
  // questStore.anchor with the new clock time.
  const commitDrop = (newMinRaw: number) => {
    if (!it.questId) return;
    const SNAP = 15;
    const minClamped = Math.max(
      0,
      Math.min(24 * 60 - SNAP, Math.round(newMinRaw / SNAP) * SNAP),
    );
    const h = Math.floor(minClamped / 60);
    const m = minClamped % 60;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    useQuestStore.getState().anchor(it.questId, h, m);
  };

  const startHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // Pan gesture — activeOffsetY ensures a small finger jiggle won't
  // hijack the user's tap on the × delete or the "Mark done" pill.
  // Spring helper used by both the confirm and the cancel paths to
  // return the wrapper to its original position.
  const springBack = () => {
    dragY.value = withSpring(0, { damping: 18, stiffness: 200 });
  };

  // After release, hold the card at its dropped position and open a
  // branded confirm modal. State drives the visibility; the system
  // Alert.alert read as iOS chrome and didn't fit Lumi's surface.
  const [pendingDrop, setPendingDrop] = useState<{
    oldMin: number;
    newMin: number;
  } | null>(null);
  const promptDropConfirm = (newMinSnapped: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPendingDrop({ oldMin: it.min, newMin: newMinSnapped });
  };
  const cancelDrop = () => {
    Haptics.selectionAsync();
    setPendingDrop(null);
    springBack();
    setProposedMin(null);
  };
  const acceptDrop = () => {
    if (!pendingDrop) return;
    commitDrop(pendingDrop.newMin);
    setPendingDrop(null);
    springBack();
    setProposedMin(null);
  };

  const panGesture = Gesture.Pan()
    .enabled(canDrag)
    .activeOffsetY([-10, 10])
    .onBegin(() => {
      'worklet';
      isDragging.value = 1;
      runOnJS(startHaptic)();
    })
    .onUpdate((e) => {
      'worklet';
      dragY.value = e.translationY;
      // Live time label preview during drag.
      runOnJS(previewTime)(e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      isDragging.value = 0;
      // Convert the dropped Y back to a snapped minute. Compute it
      // here in the worklet, then hand both values (old + new) to
      // the JS thread so the confirm Alert can show them.
      const newY = y + e.translationY;
      const SNAP = 15;
      const newMinRaw = (newY - TOPPAD) / PXPM + wakeMin;
      // Hour-magnetic snap: when the raw drop time is within 8 min
      // of an hour boundary, pull to the hour exactly. This fixes
      // the "I dragged to 8 but it landed on 8:15" papercut — the
      // 15-min snap alone has no concept of "round number" and the
      // user's finger rarely lands within 7.5 min of an hour edge
      // perfectly. Outside the magnet zone, fall back to the
      // standard 15-min snap.
      const nearestHour = Math.round(newMinRaw / 60) * 60;
      const distToHour = Math.abs(newMinRaw - nearestHour);
      const snappedRaw =
        distToHour <= 8 ? nearestHour : Math.round(newMinRaw / SNAP) * SNAP;
      const snapped = Math.max(
        0,
        Math.min(24 * 60 - SNAP, snappedRaw),
      );
      if (snapped === it.min) {
        // No change — spring straight back, no prompt needed.
        dragY.value = withSpring(0, { damping: 18, stiffness: 200 });
        runOnJS(clearPreview)();
        return;
      }
      // Hold the card at the drop position until the user confirms;
      // the Alert shows what's about to happen before any state write.
      runOnJS(promptDropConfirm)(snapped);
    });

  // The wrapper hosts the whole Item — all children position
  // RELATIVE to the wrapper's top:y, so animating translateY moves
  // the time label, dot, tick bar, and content card together.
  const wrapperStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
    // Lift active drags above siblings so the card visibly floats.
    zIndex: isDragging.value ? 100 : 1,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: y,
        },
        wrapperStyle,
      ]}
      // Don't intercept touches at the wrapper level — let children
      // (Pressables for delete / mark done) get them first.
      pointerEvents="box-none"
    >
      {it.durMin && it.durMin > 0 && (
        <View
          style={{
            position: 'absolute',
            left: THREAD_X - 2,
            top: 0,
            width: 4,
            height: Math.max(6, it.durMin * PXPM),
            borderRadius: 3,
            backgroundColor: hexA(col, past ? 0.18 : 0.42),
          }}
        />
      )}
      {/* Time label.
          Normally hidden when this row shares the same minute as
          the row above (dedup against the wake anchor or another
          task at the same time — keeps the left rail uncluttered).
          BUT during a drag, the user needs to see where they're
          landing — so the dedup is suppressed and the ember preview
          renders regardless. That's why this conditional ORs in
          `proposedMin != null`. */}
      {(!hideTime || proposedMin != null) && (
        <Text
          style={{
            position: 'absolute',
            left: 0,
            // Widen the slot while dragging so a long time like
            // "11:30" doesn't truncate as it scales up.
            width: proposedMin != null ? 64 : 52,
            top: proposedMin != null ? -10 : -7,
            textAlign: 'right',
            fontFamily:
              proposedMin != null ? fonts.frauncesMed : fonts.fraunces,
            fontStyle: 'italic',
            // Bump size + flip to ember so the time pops on the
            // timeline column where it already lives — no separate
            // floating pill, just a dramatic in-place transformation
            // tied to the existing time label.
            fontSize: proposedMin != null ? 18 : 13,
            color:
              proposedMin != null
                ? C.ember
                : past
                  ? C.ash
                  : C.boneDim,
            letterSpacing: proposedMin != null ? -0.4 : 0,
            opacity: past && proposedMin == null ? 0.7 : 1,
            // Slight glow so the drag-state time is unmistakable
            // against the dark thread.
            textShadowColor: proposedMin != null
              ? hexA(C.ember, 0.6)
              : 'transparent',
            textShadowRadius: proposedMin != null ? 8 : 0,
          }}
        >
          {fmt(proposedMin ?? it.min)}
        </Text>
      )}
      {it.kind === 'anchor' ? (
        <View
          style={{
            position: 'absolute',
            left: THREAD_X - 5,
            top: -5,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: C.void,
            borderWidth: 1.5,
            borderColor: past ? C.hair : C.ash,
          }}
        />
      ) : (
        <>
          {/* Soft 3px halo ring around active quest dots — matches the
              mock's box-shadow: 0 0 0 3px col@16%. Skipped for past
              and completed items so they sit calmly on the thread. */}
          {!past && !done && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: THREAD_X - 9,
                top: -9,
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: hexA(col, 0.16),
              }}
            />
          )}
          <View
            style={{
              position: 'absolute',
              left: THREAD_X - 6,
              top: -6,
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: done ? hexA(col, 0.5) : col,
              borderWidth: 2,
              borderColor: C.void,
            }}
          />
        </>
      )}
      {isNextQuest && tierMeta ? (
        <GestureDetector gesture={panGesture}>
          <View
            style={{
              position: 'absolute',
              left: CONTENT_X,
              right: ITEM_RIGHT,
              top: -13,
              backgroundColor: C.void2,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: hexA(col, 0.45),
            paddingHorizontal: 13,
            paddingVertical: 9,
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
          }}
        >
          {canDelete && (
            <Pressable
              onPress={confirmDelete}
              hitSlop={10}
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: hexA(C.boneDim, 0.25),
              }}
            >
              <Text
                style={{
                  color: C.mute,
                  fontSize: 12,
                  lineHeight: 14,
                  marginTop: -1,
                }}
              >
                ×
              </Text>
            </Pressable>
          )}
          <Text
            style={{
              fontFamily: fonts.interSemi,
              fontSize: 9,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: missed ? C.ember : col,
              marginBottom: 3,
            }}
          >
            {missed ? 'missed' : 'up next'}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: fonts.interMed,
              fontSize: 14.5,
              color: C.bone,
              letterSpacing: -0.2,
              marginBottom: 4,
            }}
          >
            {it.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              style={{
                fontFamily: fonts.inter,
                fontSize: 8,
                color: col,
                letterSpacing: -1,
              }}
            >
              {tierMeta.sigil}
            </Text>
            <Text
              style={{ fontFamily: fonts.inter, fontSize: 11, color: C.mute }}
            >
              {dur(it.durMin ?? 30)}
              {it.recurring ? ' · repeating' : ''}
            </Text>
            {missed && (
              <Pressable
                onPress={markDone}
                hitSlop={6}
                style={{
                  marginLeft: 'auto',
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 100,
                  backgroundColor: C.ember,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.interSemi,
                    fontSize: 11,
                    color: C.void,
                  }}
                >
                  Mark done
                </Text>
              </Pressable>
            )}
          </View>
          </View>
        </GestureDetector>
      ) : (
        <GestureDetector gesture={panGesture}>
        <Pressable
          onPress={canUncomplete ? confirmUncomplete : undefined}
          style={{
            position: 'absolute',
            left: CONTENT_X,
            right: ITEM_RIGHT,
            top: -9,
            // Missed (past + not done) tasks stay readable — they're
            // still active, the user can still finish them. Plain
            // past anchors / completed items fade out as before.
            opacity: missed ? 0.85 : past ? 0.42 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {it.kind === 'anchor' ? (
            <>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: fonts.interMed,
                  fontSize: 14,
                  color: C.boneDim,
                  letterSpacing: -0.1,
                  flexShrink: 0,
                }}
              >
                {it.title}
              </Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: C.hair,
                  borderRadius: 100,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  flexShrink: 0,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.interSemi,
                    fontSize: 8.5,
                    letterSpacing: 0.5,
                    color: C.mute,
                    textTransform: 'uppercase',
                  }}
                >
                  daily
                </Text>
              </View>
            </>
          ) : tierMeta ? (
            <>
              <Text
                style={{
                  fontFamily: fonts.inter,
                  fontSize: 8,
                  color: col,
                  letterSpacing: -1,
                  flexShrink: 0,
                }}
              >
                {tierMeta.sigil}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  fontFamily: fonts.interMed,
                  fontSize: 14,
                  color: done ? C.mute : C.bone,
                  letterSpacing: -0.15,
                  textDecorationLine: done ? 'line-through' : 'none',
                  textDecorationColor: C.ash,
                }}
              >
                {it.title}
              </Text>
              {missed && (
                <>
                  <View
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 100,
                      borderWidth: 1,
                      borderColor: hexA(C.ember, 0.45),
                      backgroundColor: hexA(C.ember, 0.08),
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.interSemi,
                        fontSize: 9,
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        color: C.ember,
                      }}
                    >
                      missed
                    </Text>
                  </View>
                  <Pressable
                    onPress={markDone}
                    hitSlop={6}
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 3,
                      borderRadius: 100,
                      backgroundColor: C.ember,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.interSemi,
                        fontSize: 10,
                        letterSpacing: 0.3,
                        color: C.void,
                      }}
                    >
                      Done
                    </Text>
                  </Pressable>
                </>
              )}
              <Text
                style={{
                  fontFamily: fonts.inter,
                  fontSize: 11,
                  color: C.mute,
                  flexShrink: 0,
                }}
              >
                {done ? 'done' : dur(it.durMin ?? 30)}
              </Text>
              {canDelete && (
                <Pressable
                  onPress={confirmDelete}
                  hitSlop={10}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    borderWidth: 1,
                    borderColor: hexA(C.boneDim, 0.22),
                  }}
                >
                  <Text
                    style={{
                      color: C.mute,
                      fontSize: 12,
                      lineHeight: 14,
                      marginTop: -1,
                    }}
                  >
                    ×
                  </Text>
                </Pressable>
              )}
            </>
          ) : null}
        </Pressable>
        </GestureDetector>
      )}
      {/* Branded "confirm drop" modal — replaces the system Alert
          that read as iOS chrome. Same dusk eyebrow + Fraunces
          italic + bone-on-rust pattern as the delete confirm. */}
      <DropConfirmModal
        visible={pendingDrop != null}
        oldMin={pendingDrop?.oldMin ?? 0}
        newMin={pendingDrop?.newMin ?? 0}
        title={it.title}
        onCancel={cancelDrop}
        onConfirm={acceptDrop}
      />
    </Animated.View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// DropConfirmModal — branded confirm for the drag-and-drop action.
// Same visual language as the delete confirm so the app feels
// cohesive (no system Alert chrome).
// ═════════════════════════════════════════════════════════════════════
const DropConfirmModal = ({
  visible,
  oldMin,
  newMin,
  title,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  oldMin: number;
  newMin: number;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const accent = useAccent();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={dropStyles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <SafeAreaView edges={['bottom']} pointerEvents="box-none">
          <View style={dropStyles.card}>
            <Text style={dropStyles.eyebrow}>Move it?</Text>
            <Text style={dropStyles.title}>
              &ldquo;{title || 'This task'}&rdquo;
            </Text>
            <View style={dropStyles.timeRow}>
              <View style={dropStyles.timePill}>
                <Text style={dropStyles.timePillLabel}>from</Text>
                <Text style={dropStyles.timePillValue}>{fmtNow(oldMin)}</Text>
              </View>
              <Text style={dropStyles.arrow}>→</Text>
              <View
                style={[
                  dropStyles.timePill,
                  {
                    backgroundColor: hexA(accent.fg, 0.14),
                    borderColor: hexA(accent.fg, 0.45),
                  },
                ]}
              >
                <Text style={[dropStyles.timePillLabel, { color: accent.fg }]}>
                  to
                </Text>
                <Text
                  style={[dropStyles.timePillValue, { color: accent.fg }]}
                >
                  {fmtNow(newMin)}
                </Text>
              </View>
            </View>
            <View style={dropStyles.btnRow}>
              <Pressable onPress={onCancel} style={dropStyles.cancelBtn}>
                <Text style={dropStyles.cancelText}>Keep it</Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                style={[dropStyles.moveBtn, { backgroundColor: accent.fg }]}
              >
                <Text style={dropStyles.moveText}>Move</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const dropStyles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(8,6,5,0.72)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: C.void2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.hair,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 14,
  },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: C.dusk,
    marginBottom: 10,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.4,
    lineHeight: 28,
    marginBottom: 16,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 22,
  },
  timePill: {
    flex: 1,
    backgroundColor: hexA(C.boneDim, 0.06),
    borderRadius: 14,
    borderWidth: 1,
    borderColor: hexA(C.boneDim, 0.18),
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  timePillLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: C.mute,
    marginBottom: 4,
  },
  timePillValue: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 19,
    color: C.bone,
    letterSpacing: -0.3,
  },
  arrow: {
    color: C.boneDim,
    fontSize: 18,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.boneDim,
  },
  moveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  moveText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.void,
  },
});

// ═════════════════════════════════════════════════════════════════════
// Day thread — the warm timeline. Same as v2 but parameterized by
// date + isToday so the now-marker / past-scrim only render on today.
// ═════════════════════════════════════════════════════════════════════
interface DayThreadProps {
  date: Date;
  isToday: boolean;
  items: TItem[];
  nowMin: number;
  wakeMin: number;
  sleepMin: number;
  accent: Accent;
  styles: ReturnType<typeof makeStyles>;
  peakStart: number | null;
  peakEnd: number | null;
  slumpStart: number | null;
  slumpEnd: number | null;
}

const DayThread = ({
  isToday,
  items,
  nowMin,
  wakeMin,
  sleepMin,
  accent,
  styles,
  peakStart,
  peakEnd,
  slumpStart,
  slumpEnd,
}: DayThreadProps) => {
  const yOf = (m: number): number =>
    Math.round(TOPPAD + Math.max(0, m - wakeMin) * PXPM);

  // Next quest first — both the up-next card AND the stacking guard
  // need to know which item gets the big card so we can clear it.
  const nextQuest = useMemo(
    () =>
      isToday
        ? items.find(
            (i) => i.kind === 'quest' && i.min >= nowMin && !i.done,
          )
        : items.find((i) => i.kind === 'quest'),
    [items, isToday, nowMin],
  );

  // ── Stacking guard — push items down so they don't paint over each
  // other. Adjacent rows get MIN_VERTICAL_GAP. The previous item being
  // the up-next card needs a bigger gap (the card itself is ~67px tall
  // so a normal 28px nudge isn't enough — the next anchor/quest would
  // still get covered, which is the bug from the screenshot).
  // Also flag items that share their minute with the previous item so
  // the renderer can suppress the duplicate time label.
  const renderItems = useMemo(() => {
    let prevY = -Infinity;
    let prevWasUpNext = false;
    let prevMin = -Infinity;
    return items.map((it) => {
      const natural = yOf(it.min);
      const isUpNextHere =
        nextQuest != null &&
        it.kind === 'quest' &&
        it.questId === nextQuest.questId;
      const gap = prevWasUpNext ? UP_NEXT_GAP : MIN_VERTICAL_GAP;
      const y = Math.max(natural, prevY + gap);
      const hideTime = it.min === prevMin;
      prevY = y;
      prevWasUpNext = isUpNextHere;
      prevMin = it.min;
      return { it, y, natural, hideTime };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, wakeMin, nextQuest]);

  const lastY = renderItems.length
    ? renderItems[renderItems.length - 1].y
    : yOf(sleepMin);
  const dayHeight = Math.max(yOf(sleepMin), lastY) + 80;

  // Open stretches based on the natural minutes (not rendered Y).
  const stretches = useMemo(() => {
    const out: { start: number; end: number; gap: number }[] = [];
    const future = items.filter(
      (i) => i.min + (i.durMin ?? 0) >= (isToday ? nowMin : wakeMin),
    );
    for (let i = 0; i < future.length - 1; i++) {
      const a = future[i];
      const b = future[i + 1];
      const start = Math.max(
        isToday ? nowMin : wakeMin,
        a.min + (a.durMin ?? 0),
      );
      const gap = b.min - start;
      if (gap >= OPEN_STRETCH_MIN) out.push({ start, end: b.min, gap });
    }
    return out;
  }, [items, isToday, nowMin, wakeMin]);

  // "Open water ahead" — time until the next not-done item, shown by
  // the now marker (loadmap mock). Only for real stretches (≥60m) so
  // the label can never collide with the next row's card.
  const openAhead = useMemo(() => {
    if (!isToday) return null;
    const next = items.find((i) => i.min > nowMin && !i.done);
    if (!next) return null;
    const gap = next.min - nowMin;
    return gap >= 60 ? gap : null;
  }, [items, isToday, nowMin]);

  const scrollRef = useRef<ScrollView>(null);
  useLayoutEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: isToday ? Math.max(0, yOf(nowMin) - SCROLL_TO_NOW_OFFSET) : 0,
        animated: false,
      });
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, wakeMin]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      // dayHeight + nav clearance so the user can scroll the last
      // anchor (Sleep) clear of the floating glass nav. Without
      // this Sleep sits flush at the bottom and gets hidden under
      // the pill.
      contentContainerStyle={{ height: dayHeight + FLOATING_NAV_CLEARANCE }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ height: dayHeight, position: 'relative' }}>
        {(() => {
          // Render energy bands only when they actually intersect
          // the visible wake→sleep thread. Without this guard a
          // band entirely outside the user's awake window (which
          // can happen if upstream data ever gets weird — e.g. a
          // slump computed before wakeMin) would clamp to TOPPAD
          // via yOf() and paint at the top of the day, even though
          // the user is "asleep" there. Returning null in that case
          // means any pathological data degrades silently to no
          // band, instead of a misplaced one.
          const visible = (start: number, end: number) =>
            end > wakeMin && start < sleepMin;
          const clip = (start: number, end: number) => ({
            s: Math.max(start, wakeMin),
            e: Math.min(end, sleepMin),
          });
          return (
            <>
              {peakStart != null &&
                peakEnd != null &&
                visible(peakStart, peakEnd) &&
                (() => {
                  const { s, e } = clip(peakStart, peakEnd);
                  return (
                    <Band
                      yTop={yOf(s)}
                      height={Math.max(20, (e - s) * PXPM)}
                      color={C.lichen}
                      label="peak · sharp"
                    />
                  );
                })()}
              {slumpStart != null &&
                slumpEnd != null &&
                visible(slumpStart, slumpEnd) &&
                (() => {
                  const { s, e } = clip(slumpStart, slumpEnd);
                  return (
                    <Band
                      yTop={yOf(s)}
                      height={Math.max(20, (e - s) * PXPM)}
                      color={C.dusk}
                      label="the slump"
                    />
                  );
                })()}
            </>
          );
        })()}

        <View
          style={{
            position: 'absolute',
            left: THREAD_X - 1,
            top: yOf(wakeMin),
            width: 2,
            height: yOf(sleepMin) - yOf(wakeMin),
            backgroundColor: C.hair,
          }}
        />

        {isToday && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: Math.max(0, yOf(nowMin)),
              backgroundColor: hexA(C.void, 0.55),
            }}
          />
        )}

        {stretches.map((s, i) => {
          const my = (yOf(s.start) + yOf(s.end)) / 2;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: CONTENT_X,
                right: ITEM_RIGHT,
                top: my - 14,
                alignItems: 'center',
              }}
            >
              <View style={styles.stretchPill}>
                <Text style={styles.stretchTime}>{dur(s.gap)} open</Text>
                <Text style={styles.stretchSub}>· room for one thing</Text>
              </View>
            </View>
          );
        })}

        {renderItems.map(({ it, y, hideTime }, i) => (
          <Item
            key={
              it.questId
                ? `q-${it.questId}-${i}`
                : `${it.kind}-${i}-${it.min}`
            }
            it={it}
            y={y}
            nowMin={nowMin}
            isNextQuest={
              nextQuest != null &&
              it.kind === 'quest' &&
              it.questId === nextQuest.questId
            }
            showAsPast={isToday}
            hideTime={hideTime}
            wakeMin={wakeMin}
            dayHeight={dayHeight}
          />
        ))}

        {isToday && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: yOf(nowMin),
            }}
          >
            <View
              style={{
                position: 'absolute',
                left: THREAD_X,
                right: ITEM_RIGHT,
                top: -0.5,
                height: 1.5,
                backgroundColor: accent.fg,
                opacity: 0.85,
              }}
            />
            {/* Soft 4px halo ring around the NOW dot — matches the
                mock's box-shadow: 0 0 0 4px ember@20%. Sits BEHIND
                the actual ember dot so it reads as a glow. */}
            <View
              style={{
                position: 'absolute',
                left: THREAD_X - 11,
                top: -11,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: hexA(accent.fg, 0.2),
              }}
            />
            <View
              style={[
                styles.nowNode,
                { backgroundColor: accent.fg, shadowColor: accent.fg },
              ]}
            />
            <Text style={[styles.nowMarkerLabel, { color: accent.fg }]}>
              now
            </Text>
            {openAhead != null && (
              <Text style={styles.openWaterLabel}>
                {dur(openAhead)} of open water ahead
              </Text>
            )}
          </View>
        )}
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
  const wakeMin = anchors.wake;
  const sleepMin = anchors.sleep;

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

  const hasRealQuests = items.some((i) => i.kind === 'quest');

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
   *  re-scheduling) — but a cross-day DRAG carries intent about the
   *  time too, so we re-anchor to the original clock time after. */
  const applyMoves = (
    moves: { id: string; toIso: string }[],
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
      if (q.scheduledHour != null) {
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
    if (!t || !k || !k.startsWith('day:')) return;
    const toIso = k.slice(4);
    if (toIso === t.fromIso) return;
    const d = fromIsoLocal(toIso);
    const short =
      t.title.length > 26 ? `${t.title.slice(0, 24)}…` : t.title;
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
  const slumpEnd = digest.curve.slumpEnd;

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
        <View style={{ flex: 1 }}>
          <DayThread
            date={date}
            isToday={isToday}
            items={items}
            nowMin={nowMin}
            wakeMin={wakeMin}
            sleepMin={sleepMin}
            accent={accent}
            styles={styles}
            peakStart={peakStart}
            peakEnd={peakEnd}
            slumpStart={slumpStart}
            slumpEnd={slumpEnd}
          />
          {isToday && !hasRealQuests && (
            <View style={styles.emptyHint}>
              <Text style={styles.emptyHintTitle}>The bones of your day.</Text>
              <Text style={styles.emptyHintBody}>
                Capture or plan a quest from Home — it&apos;ll land here on the
                thread at its time or window.
              </Text>
            </View>
          )}
        </View>
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

    // ── Day thread bits (carry from v2) ──
    nowNode: {
      position: 'absolute',
      left: THREAD_X - 7,
      top: -7,
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: C.void,
      shadowOpacity: 0.55,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
    },
    nowMarkerLabel: {
      position: 'absolute',
      left: 0,
      width: 52,
      top: -9,
      textAlign: 'right',
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    stretchPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: hexA(C.lichen, 0.4),
      borderRadius: 100,
      paddingHorizontal: 13,
      paddingVertical: 6,
      backgroundColor: hexA(C.void, 0.6),
    },
    stretchTime: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11,
      color: C.lichen,
    },
    stretchSub: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.mute,
    },

    // ── Empty hint ──
    emptyHint: {
      position: 'absolute',
      left: CONTENT_X,
      right: ITEM_RIGHT,
      top: 30,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: hexA(C.void2, 0.85),
    },
    emptyHintTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 15,
      color: C.bone,
      marginBottom: 4,
    },
    emptyHintBody: {
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.boneDim,
      lineHeight: 18,
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
    // ── Open water label (now marker) ──────────────────────────────
    openWaterLabel: {
      position: 'absolute',
      left: CONTENT_X,
      top: 6,
      fontFamily: fonts.inter,
      fontSize: 10.5,
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
