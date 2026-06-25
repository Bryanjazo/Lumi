// Lumi · Time v2.2 — "Day · Week · Month"
//
// Spec: lumi-time-v2-2-spec.md (mockup: lumi-time-v2-2.jsx).
// Thesis: time blindness isn't "how long till the next ping" — it's
// losing where you are in time. v2 fixed within-a-day (the thread);
// v2.2 fixes across-days with Day/Week/Month zoom, free date
// navigation, and a "what's next" bar pinned across every view.
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
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
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
      {!hideTime && (
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
      contentContainerStyle={{ height: dayHeight }}
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
          </View>
        )}
      </View>
    </ScrollView>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Week view — 7 rows, each: date + that day's quests. Tap → Day.
// ═════════════════════════════════════════════════════════════════════
const WeekView = ({
  date,
  today,
  anchors,
  quests,
  effective,
  onPickDate,
  accent,
  styles,
  nowMin,
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
}) => {
  const start = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}
      showsVerticalScrollIndicator={false}
    >
      {days.map((d, i) => {
        const isToday = sameDay(d, today);
        const past = dayOffset(d, today) < 0;
        const items = buildItemsForDate(
          d,
          anchors,
          quests,
          effective,
          today,
          nowMin,
        );
        const dayQuests = items.filter((it) => it.kind === 'quest');
        return (
          <Pressable
            key={i}
            onPress={() => onPickDate(d)}
            style={[
              styles.weekRow,
              i < 6 && styles.weekRowDivider,
              past && { opacity: 0.55 },
            ]}
          >
            <View style={styles.weekDateCell}>
              <Text
                style={[
                  styles.weekDateDow,
                  { color: isToday ? accent.fg : C.mute },
                ]}
              >
                {WD[d.getDay()]}
              </Text>
              <Text
                style={[
                  styles.weekDateNum,
                  { color: isToday ? accent.fg : C.bone },
                ]}
              >
                {d.getDate()}
              </Text>
              {isToday && (
                <Text style={[styles.weekToday, { color: accent.fg }]}>
                  TODAY
                </Text>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingTop: 4, gap: 7 }}>
              {dayQuests.length > 0 ? (
                dayQuests.map((q, k) => (
                  <View key={k} style={styles.weekQuestRow}>
                    <Text style={styles.weekQuestTime}>{fmt(q.min)}</Text>
                    <View
                      style={[
                        styles.weekQuestDot,
                        {
                          backgroundColor:
                            q.tier && IMPORTANCE[q.tier]
                              ? IMPORTANCE[q.tier].color
                              : C.mute,
                        },
                      ]}
                    />
                    <Text numberOfLines={1} style={styles.weekQuestTitle}>
                      {q.title}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.weekEmpty}>just your routine — open</Text>
              )}
            </View>
            <Text style={styles.weekChev}>›</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Month view — calendar grid + density dots. Tap → Day.
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
}) => {
  const y = date.getFullYear();
  const m = date.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let dd = 1; dd <= dim; dd++) cells.push(new Date(y, m, dd));
  while (cells.length % 7) cells.push(null);

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

  // Month summary — quests planned, days with plans, busiest day.
  const summary = useMemo((): {
    monthQuests: number;
    planDays: number;
    busiest: Date | null;
  } => {
    let monthQuests = 0;
    let planDays = 0;
    let busiest: Date | null = null;
    let busiestN = 0;
    cells.forEach((d) => {
      if (!d) return;
      const items = buildItemsForDate(d, anchors, quests, effective, today, nowMin);
      const n = items.filter((i) => i.kind === 'quest').length;
      if (n > 0) {
        planDays += 1;
        monthQuests += n;
      }
      if (n > busiestN) {
        busiestN = n;
        busiest = d;
      }
    });
    return { monthQuests, planDays, busiest };
  }, [cells, anchors, quests, effective, today, nowMin]);

  // Selected-day peek data.
  const peekItems = useMemo(
    () =>
      buildItemsForDate(sel, anchors, quests, effective, today, nowMin)
        .filter((i) => i.kind === 'quest')
        .sort((a, b) => a.min - b.min),
    [sel, anchors, quests, effective, today, nowMin],
  );
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
      {/* Month summary — three stat cards (ember/lichen/dusk). */}
      <View style={styles.monthSummaryRow}>
        <View
          style={[
            styles.monthSummaryCard,
            {
              backgroundColor: hexA(C.ember, 0.09),
              borderColor: hexA(C.ember, 0.22),
            },
          ]}
        >
          <Text style={[styles.monthSummaryNum, { color: C.ember }]}>
            {summary.monthQuests}
          </Text>
          <Text style={styles.monthSummaryLabel}>quests planned</Text>
        </View>
        <View
          style={[
            styles.monthSummaryCard,
            {
              backgroundColor: hexA(C.lichen, 0.09),
              borderColor: hexA(C.lichen, 0.22),
            },
          ]}
        >
          <Text style={[styles.monthSummaryNum, { color: C.lichen }]}>
            {summary.planDays}
          </Text>
          <Text style={styles.monthSummaryLabel}>days with plans</Text>
        </View>
        <View
          style={[
            styles.monthSummaryCard,
            {
              backgroundColor: hexA(C.dusk, 0.09),
              borderColor: hexA(C.dusk, 0.22),
            },
          ]}
        >
          <Text style={[styles.monthSummaryNum, { color: C.dusk }]}>
            {summary.busiest
              ? `${MO[summary.busiest.getMonth()].slice(0, 3)} ${summary.busiest.getDate()}`
              : '—'}
          </Text>
          <Text style={styles.monthSummaryLabel}>busiest day</Text>
        </View>
      </View>

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
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, sel);
              const past = dayOffset(d, today) < 0;
              const items = buildItemsForDate(
                d,
                anchors,
                quests,
                effective,
                today,
                nowMin,
              );
              const qs = items.filter((it) => it.kind === 'quest');
              return (
                <Pressable
                  key={ci}
                  onPress={() => setSel(d)}
                  style={[
                    styles.monthCell,
                    isSelected && { backgroundColor: accent.fg },
                    isToday &&
                      !isSelected && {
                        backgroundColor: hexA(accent.fg, 0.1),
                        borderColor: hexA(accent.fg, 0.45),
                      },
                    past && !isSelected && !isToday && { opacity: 0.4 },
                  ]}
                >
                  <Text
                    style={[
                      styles.monthCellNum,
                      {
                        color: isSelected
                          ? C.void
                          : isToday
                            ? accent.fg
                            : C.bone,
                      },
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                  <View style={styles.monthDotsRow}>
                    {qs.length === 0 ? (
                      <View
                        style={[
                          styles.monthDot,
                          {
                            width: 3,
                            height: 3,
                            backgroundColor: hexA(
                              isSelected ? C.void : C.mute,
                              0.35,
                            ),
                          },
                        ]}
                      />
                    ) : (
                      Array.from({ length: Math.min(3, qs.length) }).map(
                        (_, k) => (
                          <View
                            key={k}
                            style={[
                              styles.monthDot,
                              {
                                // Always render the true tier color
                                // so the day's shape stays readable.
                                // When the cell is selected (ember
                                // bg), warm-toned tiers (terra/ember/
                                // honey) blend in — give them a dark
                                // void ring so they pop against the
                                // background without losing the tier
                                // signal.
                                backgroundColor: qs[k].tier
                                  ? IMPORTANCE[qs[k].tier].color
                                  : C.mute,
                              },
                              isSelected && {
                                // Bump size + add a void ring so the
                                // tier color reads against the ember
                                // background. 4×4 with a 1px border
                                // would leave a 2×2 visible core —
                                // too small to register; 6×6 with the
                                // same border keeps a 4×4 tier core.
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                borderWidth: 1,
                                borderColor: C.void,
                              },
                            ]}
                          />
                        ),
                      )
                    )}
                    {qs.length > 3 && (
                      <Text
                        style={{
                          fontFamily: fonts.interSemi,
                          fontSize: 9,
                          lineHeight: 10,
                          color: isSelected ? hexA(C.void, 0.8) : C.mute,
                          marginLeft: 3,
                          marginTop: -0.5,
                        }}
                      >
                        +{qs.length - 3}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {/* Selected-day peek — fills the space below the grid so the
          month view actually does something useful even before you
          open a thread. Date + relative label, planned count, item
          list, and a CTA to open the day's full thread. */}
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
          <Text style={styles.monthPeekCount}>{peekItems.length} planned</Text>
        </View>
        {peekItems.length > 0 ? (
          <View style={{ gap: 9, marginBottom: 14 }}>
            {peekItems.map((q, k) => (
              <View
                key={k}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Text style={styles.monthPeekTime}>{fmt(q.min)}</Text>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: q.tier
                      ? IMPORTANCE[q.tier].color
                      : C.mute,
                  }}
                />
                <Text
                  style={styles.monthPeekTaskTitle}
                  numberOfLines={1}
                >
                  {q.title}
                </Text>
                {q.durMin != null && (
                  <Text style={styles.monthPeekDur}>
                    {dur(q.durMin)}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.monthPeekEmpty}>
            An open day — just your anchors and room to breathe.
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

      <Text style={styles.monthCaption}>
        Tap any day to peek · dots show how full it is.
      </Text>
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
  const jumpToToday = () => {
    setDate(today);
    setScale('day');
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
          onJumpToToday={jumpToToday}
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
          accent={accent}
          styles={styles}
          nowMin={nowMin}
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
        />
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

    // ── Week view ──
    weekRow: {
      flexDirection: 'row',
      gap: 14,
      paddingHorizontal: 6,
      paddingVertical: 14,
      alignItems: 'flex-start',
    },
    weekRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.7),
    },
    weekDateCell: {
      width: 50,
      alignItems: 'center',
      paddingTop: 2,
    },
    weekDateDow: {
      fontFamily: fonts.interSemi,
      fontSize: 9.5,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    weekDateNum: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 24,
      lineHeight: 26,
      marginTop: 2,
    },
    weekToday: {
      fontFamily: fonts.interSemi,
      fontSize: 8,
      letterSpacing: 1,
      marginTop: 2,
    },
    weekQuestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    weekQuestTime: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12,
      color: C.mute,
      width: 42,
    },
    weekQuestDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    weekQuestTitle: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 13.5,
      color: C.bone,
      letterSpacing: -0.1,
    },
    weekEmpty: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.mute,
      paddingTop: 4,
    },
    weekChev: {
      fontFamily: fonts.inter,
      fontSize: 14,
      color: C.mute,
      alignSelf: 'center',
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
    // ── Month summary cards (v2.2) ─────────────────────────────────
    monthSummaryRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 14,
    },
    monthSummaryCard: {
      flex: 1,
      borderRadius: 13,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    monthSummaryNum: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 21,
      lineHeight: 22,
    },
    monthSummaryLabel: {
      fontFamily: fonts.inter,
      fontSize: 10,
      color: C.boneDim,
      marginTop: 4,
      letterSpacing: -0.05,
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
    // 12px tall so the "+N" overflow text has room to render
    // legibly. Center-aligned so the dots and the text share a baseline.
    monthDotsRow: {
      flexDirection: 'row',
      height: 12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    monthDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
    },
    monthCaption: {
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11.5,
      color: C.mute,
      marginTop: 18,
      lineHeight: 18,
    },
  });

// Default-ember stylesheet for module-level usage (parity with siblings).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _defaults = makeStyles(accentFor('ember'));
void _defaults;
void todayKey;
