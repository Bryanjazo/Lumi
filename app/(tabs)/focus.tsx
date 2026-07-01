// Focus tab — the retired Capture tab, rebuilt as a proper focus
// session flow.
//
// Three sequential steps:
//   1. PICK — pick a task for the selected date, or "Just focus"
//      (an open session with no task attached). Day view lists that
//      day's quests + a suggested top-tier hero card; month view is
//      a calendar with dots on days that have quests.
//   2. DURATION — pick a preset (10/15/25/45) or a custom length,
//      see a duration-scaled preview + a dusk hint tied to the task's
//      tier (big task → shorter first block, gentle → quicker still).
//   3. SESSION — the Ember Hearth burns down. Big Fraunces countdown
//      over the hearth, LunaLick beside it, pause/resume, end early,
//      and a completion state that fans out through completeQuest.
//
// Design principles from lumi-focus-build-spec.md:
//   • Timer is background-safe: driven off useFocusSession's stored
//     startedAt + pauseTotalMs (wall-clock math), NOT a rAF counter
//     that dies when the app is backgrounded. The rAF is used only
//     for the visual hearth breath.
//   • Session persists across navigation: opening the tab while a
//     session is running skips the picker and drops straight into
//     the SessionStep for that session.
//   • Companion Mode: Full = LunaLick + warm copy; Focused = clean
//     hearth-only timer without the cat / "together" framing.
//   • Every session ends up in useFocusSession.lastCompleted (via
//     end({ reason: 'completed' })) so the done screen is state-
//     derived instead of local — matches LumiFocusCard's pattern.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path } from 'react-native-svg';

import { fonts } from '../../constants/fonts';
import { useQuestStore, type Quest } from '../../store/questStore';
import { useUserStore } from '../../store/userStore';
import { useAmbientLunaMood } from '../../lib/luna-mood';
import { useCompanionMode } from '../../lib/companion-mode';
import { EmberHearth } from '../../components/EmberHearth';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';
import {
  useFocusSession,
  selectElapsedSeconds,
  selectRemainingSeconds,
  isLiveActivityAvailable,
} from '../../lib/focusSession';
import { lunaSource, useLunaSkin } from '../../lib/luna-source';

// ═════════════════════════════════════════════════════════════════════
// Palette (kept local so the file is self-contained)
// ═════════════════════════════════════════════════════════════════════
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  surface2: '#241C17',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  hair: '#2A2420',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  dusk: '#8EA0B4',
  honey: '#C9A06A',
  lichen: '#869072',
  glow: '#F4C98A',
} as const;

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

const pad = (n: number): string => String(n).padStart(2, '0');

// Tier metadata — mirrors LumiSuggestCard / hero card so tiers read
// consistently across the app.
const TIER: Record<
  Quest['importance'],
  { color: string; sigil: string; label: string }
> = {
  high: { color: C.ember, sigil: '◆◆◆', label: 'Trial' },
  medium: { color: C.honey, sigil: '◆◆', label: 'Task' },
  low: { color: C.lichen, sigil: '◆', label: 'Whim' },
};

// Duration presets — same set the mockup uses.
const PRESETS = [
  { m: 10, label: 'a quick win' },
  { m: 15, label: 'a short stint' },
  { m: 25, label: 'a pomodoro' },
  { m: 45, label: 'deep work' },
] as const;

const MIN_MIN = 1;
const MAX_MIN = 180;
const clampMin = (v: number) => Math.max(MIN_MIN, Math.min(MAX_MIN, v));

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

// Date → YYYY-MM-DD (matches Quest.date format).
const isoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const dayLabel = (d: Date, today: Date): string => {
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return `${WD[d.getDay()]}, ${MO[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
};

// Duration hint by task tier — dusk-toned nudge in the mockup. Keeps
// the language short and unpressured.
const durationHint = (tier: Quest['importance'] | null): string => {
  if (tier === 'high')
    return "This one's a big one — maybe start with 25 and see how it feels.";
  if (tier === 'low')
    return 'A quick 10 or 15 might be all it needs.';
  return 'A calm 25 should carve out real progress.';
};

// ═════════════════════════════════════════════════════════════════════
// Task shape flowing between the steps.
// ═════════════════════════════════════════════════════════════════════
interface PickedTask {
  /** Real quest id, or null for "Just focus" (open session). */
  questId: string | null;
  title: string;
  tier: Quest['importance'] | null;
  atLabel: string;
  xpReward: number;
}

// ═════════════════════════════════════════════════════════════════════
// STEP 1 — Pick a task
// ═════════════════════════════════════════════════════════════════════
function PickStep({
  today,
  onPick,
  companion,
}: {
  today: Date;
  onPick: (task: PickedTask) => void;
  companion: ReturnType<typeof useCompanionMode>;
}) {
  const [date, setDate] = useState<Date>(today);
  const [view, setView] = useState<'day' | 'month'>('day');
  const [query, setQuery] = useState('');
  const quests = useQuestStore((s) => s.quests);

  // Quests scheduled for the picked day, incomplete only. The Home
  // hero picks by energy; here we surface the top tier so the user
  // has an obvious "start here" without recomputing suggestion logic.
  const dayIso = isoDate(date);
  const dayQuests = useMemo(
    () => quests.filter((q) => q.date === dayIso && !q.completed),
    [quests, dayIso],
  );

  const suggested = useMemo<Quest | null>(() => {
    if (dayQuests.length === 0) return null;
    return (
      dayQuests.find((q) => q.importance === 'high') ??
      dayQuests.find((q) => q.importance === 'medium') ??
      dayQuests[0]
    );
  }, [dayQuests]);

  const list = useMemo(() => {
    const base = suggested
      ? dayQuests.filter((q) => q.id !== suggested.id)
      : dayQuests;
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return base;
    return base.filter((q) => q.title.toLowerCase().includes(trimmed));
  }, [dayQuests, suggested, query]);

  // Month grid — day cells with quest dots.
  const monthYear = date.getFullYear();
  const monthIdx = date.getMonth();
  const leadingBlanks = new Date(monthYear, monthIdx, 1).getDay();
  const daysInMonth = new Date(monthYear, monthIdx + 1, 0).getDate();
  const monthCells: (Date | null)[] = useMemo(() => {
    const cells: (Date | null)[] = [];
    for (let i = 0; i < leadingBlanks; i++) cells.push(null);
    for (let dd = 1; dd <= daysInMonth; dd++) {
      cells.push(new Date(monthYear, monthIdx, dd));
    }
    return cells;
  }, [leadingBlanks, daysInMonth, monthYear, monthIdx]);

  const pickQuest = (q: Quest) => {
    Haptics.selectionAsync();
    onPick({
      questId: q.id,
      title: q.title,
      tier: q.importance,
      atLabel:
        q.scheduledHour != null
          ? `${((q.scheduledHour + 11) % 12) + 1}${
              q.scheduledMinute
                ? ':' + String(q.scheduledMinute).padStart(2, '0')
                : ''
            }${q.scheduledHour < 12 ? 'am' : 'pm'}`
          : q.window,
      xpReward: q.xpReward,
    });
  };

  const pickOpen = () => {
    Haptics.selectionAsync();
    onPick({
      questId: null,
      title: 'Open focus',
      tier: null,
      atLabel: 'just focus',
      xpReward: 0,
    });
  };

  return (
    <ScrollView
      style={styles.stepScroll}
      contentContainerStyle={styles.stepScrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>✦ Focus</Text>
      <Text style={styles.h1}>What are we focusing on?</Text>

      {/* Day / Month toggle + prev/next */}
      <View style={styles.toggleRow}>
        <View style={styles.viewToggle}>
          {(['day', 'month'] as const).map((v) => {
            const on = view === v;
            return (
              <Pressable
                key={v}
                onPress={() => {
                  Haptics.selectionAsync();
                  setView(v);
                }}
                style={[
                  styles.viewToggleChip,
                  { backgroundColor: on ? C.ember : 'transparent' },
                ]}
              >
                <Text
                  style={[
                    styles.viewToggleChipText,
                    { color: on ? C.void : C.boneDim },
                  ]}
                >
                  {v}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {view === 'day' && (
          <View style={styles.dayNavRow}>
            {/* "Today" jump — only appears when the picker is on
               a day other than today. Ember-tinted so it reads as
               the "get me back" affordance without competing with
               the ‹ › arrows. */}
            {!sameDay(date, today) && (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setDate(today);
                }}
                style={styles.dayNavTodayBtn}
                hitSlop={6}
              >
                <Text style={styles.dayNavTodayText}>Today</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setDate(addDays(date, -1))}
              style={styles.dayNavBtn}
              hitSlop={6}
            >
              <Text style={styles.dayNavGlyph}>‹</Text>
            </Pressable>
            <Pressable
              onPress={() => setDate(addDays(date, 1))}
              style={styles.dayNavBtn}
              hitSlop={6}
            >
              <Text style={styles.dayNavGlyph}>›</Text>
            </Pressable>
          </View>
        )}
      </View>

      {view === 'day' ? (
        <>
          <View style={styles.dayHeadRow}>
            <Text style={styles.dayHeadLabel}>{dayLabel(date, today)}</Text>
            {dayQuests.length > 0 && (
              <Text style={styles.dayHeadCount}>
                · {dayQuests.length} task{dayQuests.length > 1 ? 's' : ''}
              </Text>
            )}
          </View>

          {/* Just focus — always reachable at the top of the list. */}
          <Pressable style={styles.justFocusCard} onPress={pickOpen}>
            <Text style={styles.justFocusGlyph}>❋</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.justFocusTitle}>Just focus</Text>
              <Text style={styles.justFocusSub}>
                {companion.isFocused
                  ? 'open time — no task attached'
                  : 'open time with Luna — no task'}
              </Text>
            </View>
            <Text style={styles.rowChev}>›</Text>
          </Pressable>

          {dayQuests.length > 3 && (
            <View style={styles.searchRow}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Circle
                  cx={11}
                  cy={11}
                  r={7}
                  stroke={C.mute}
                  strokeWidth={2}
                />
                <Path
                  d="m20 20-3.5-3.5"
                  stroke={C.mute}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Find a task…"
                placeholderTextColor={C.mute}
                style={styles.searchInput}
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={6}>
                  <Text style={styles.searchClear}>×</Text>
                </Pressable>
              )}
            </View>
          )}

          {!query && suggested && (
            <Pressable
              style={styles.suggestCard}
              onPress={() => pickQuest(suggested)}
            >
              <View style={styles.suggestHeader}>
                <Text style={styles.suggestHeaderGlyph}>✦</Text>
                <Text style={styles.suggestHeaderLabel}>
                  Lumi suggests starting here
                </Text>
              </View>
              <View style={styles.suggestBody}>
                <Text
                  style={[
                    styles.suggestSigil,
                    { color: TIER[suggested.importance].color },
                  ]}
                >
                  {TIER[suggested.importance].sigil}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.suggestTitle} numberOfLines={1}>
                    {suggested.title}
                  </Text>
                  <Text style={styles.suggestSub}>
                    {TIER[suggested.importance].label}
                  </Text>
                </View>
                <Text style={[styles.rowChev, { color: C.ember }]}>›</Text>
              </View>
            </Pressable>
          )}

          {list.length > 0 && (
            <Text style={styles.listSectionLabel}>
              {query
                ? `${list.length} match${list.length !== 1 ? 'es' : ''}`
                : 'Everything else'}
            </Text>
          )}
          {list.map((q) => (
            <Pressable
              key={q.id}
              style={styles.listRow}
              onPress={() => pickQuest(q)}
            >
              <Text
                style={[styles.listSigil, { color: TIER[q.importance].color }]}
              >
                {TIER[q.importance].sigil}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.listTitle} numberOfLines={1}>
                  {q.title}
                </Text>
                <Text style={styles.listSub}>{TIER[q.importance].label}</Text>
              </View>
              <Text style={styles.rowChev}>›</Text>
            </Pressable>
          ))}
          {query && list.length === 0 && (
            <Text style={styles.emptyMatch}>No task matches “{query}”.</Text>
          )}
          {dayQuests.length === 0 && (
            <View style={styles.emptyDay}>
              <Text style={styles.emptyDayText}>
                Nothing scheduled — a good day for open focus.
              </Text>
            </View>
          )}
        </>
      ) : (
        <View>
          <Text style={styles.monthTitle}>
            {MO[monthIdx]} {monthYear}
          </Text>
          <View style={styles.monthWeekdayRow}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
              <Text key={i} style={styles.monthWeekday}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.monthGrid}>
            {monthCells.map((d, i) => {
              if (!d)
                return <View key={`b${i}`} style={styles.monthCellBlank} />;
              const isToday = sameDay(d, today);
              const isSel = sameDay(d, date);
              const cellIso = isoDate(d);
              const cellCount = quests.filter(
                (q) => q.date === cellIso && !q.completed,
              ).length;
              return (
                <Pressable
                  key={cellIso}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setDate(d);
                    setView('day');
                  }}
                  style={[
                    styles.monthCell,
                    isSel && { backgroundColor: C.ember, borderColor: C.ember },
                    isToday &&
                      !isSel && {
                        backgroundColor: hexA(C.ember, 0.1),
                        borderColor: hexA(C.ember, 0.45),
                      },
                  ]}
                >
                  <Text
                    style={[
                      styles.monthCellDate,
                      {
                        color: isSel
                          ? C.void
                          : isToday
                            ? C.ember
                            : C.bone,
                      },
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                  <View style={styles.monthDotRow}>
                    {Array.from({ length: Math.min(3, cellCount) }).map(
                      (_, k) => (
                        <View
                          key={k}
                          style={[
                            styles.monthDot,
                            {
                              backgroundColor: isSel
                                ? hexA(C.void, 0.5)
                                : C.ember,
                            },
                          ]}
                        />
                      ),
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.monthFoot}>
            Dots mark days with tasks — tap a day to see them.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// STEP 2 — Choose a duration
// ═════════════════════════════════════════════════════════════════════
function DurationStep({
  task,
  onBack,
  onStart,
}: {
  task: PickedTask;
  onBack: () => void;
  onStart: (mins: number) => void;
}) {
  const [mins, setMins] = useState<number>(25);
  const [custom, setCustom] = useState(false);
  const hint = durationHint(task.tier);

  return (
    <ScrollView
      style={styles.stepScroll}
      contentContainerStyle={styles.stepScrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backBtn} hitSlop={6}>
        <Text style={styles.backBtnText}>‹ back</Text>
      </Pressable>

      <Text style={styles.smallEyebrow}>Focusing on</Text>
      <View style={styles.focusOnRow}>
        {task.tier && (
          <Text style={[styles.tierSigil, { color: TIER[task.tier].color }]}>
            {TIER[task.tier].sigil}
          </Text>
        )}
        <Text style={styles.focusOnTitle} numberOfLines={2}>
          {task.title}
        </Text>
      </View>

      <Text style={styles.h1}>How long feels right?</Text>

      {/* Dusk hint — Lumi's voice */}
      <View style={styles.hintCard}>
        <Text style={styles.hintGlyph}>✦</Text>
        <Text style={styles.hintText}>{hint}</Text>
      </View>

      {/* Preset grid */}
      <View style={styles.presetGrid}>
        {PRESETS.map((p) => {
          const on = !custom && mins === p.m;
          const frac = p.m / 45;
          return (
            <Pressable
              key={p.m}
              onPress={() => {
                Haptics.selectionAsync();
                setCustom(false);
                setMins(p.m);
              }}
              style={[styles.presetCard, on && styles.presetCardOn]}
            >
              <View style={styles.presetCountRow}>
                <Text
                  style={[
                    styles.presetCount,
                    { color: on ? C.glow : C.bone },
                  ]}
                >
                  {p.m}
                </Text>
                <Text
                  style={[
                    styles.presetCountUnit,
                    { color: on ? hexA(C.glow, 0.85) : C.mute },
                  ]}
                >
                  min
                </Text>
              </View>
              <View style={styles.presetTrack}>
                <View
                  style={[
                    styles.presetTrackFill,
                    {
                      width: `${Math.min(1, frac) * 100}%`,
                      backgroundColor: on ? C.ember : hexA(C.boneDim, 0.38),
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.presetLabel,
                  { color: on ? hexA(C.glow, 0.88) : C.mute },
                ]}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Custom stepper */}
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          setCustom(true);
        }}
        style={[styles.customCard, custom && styles.customCardOn]}
      >
        {custom ? (
          <View style={styles.customStepRow}>
            <Pressable
              onPress={() => setMins((m) => clampMin(m - 5))}
              style={styles.customStepBtn}
              hitSlop={6}
            >
              <Text style={styles.customStepGlyph}>−</Text>
            </Pressable>
            <View style={styles.customCountBlock}>
              <Text style={styles.customCount}>{mins}</Text>
              <Text style={styles.customCountUnit}>min</Text>
            </View>
            <Pressable
              onPress={() => setMins((m) => clampMin(m + 5))}
              style={styles.customStepBtn}
              hitSlop={6}
            >
              <Text style={styles.customStepGlyph}>+</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.customLabel}>Custom length</Text>
        )}
      </Pressable>

      {/* Live preview — the hearth waiting to be lit. Scales with mins. */}
      <View style={styles.previewCard}>
        <View style={styles.previewGlowMount}>
          <View
            style={[
              styles.previewGlow,
              {
                width: Math.min(66, 32 + mins * 0.85),
                height: Math.min(66, 32 + mins * 0.85),
              },
            ]}
          />
          <View style={styles.previewDot} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.previewTitle}>
            About {mins} minutes of calm focus
          </Text>
          <Text style={styles.previewSub}>
            Luna sits with you the whole time — you&apos;re not doing it
            alone.
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onStart(mins);
        }}
        style={styles.startBtn}
      >
        <Text style={styles.startBtnText}>Start focusing →</Text>
      </Pressable>
    </ScrollView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// STEP 3 — Session (ember hearth + numerals + Luna body-double)
// ═════════════════════════════════════════════════════════════════════
function SessionStep({
  task,
  onEndEarly,
  onCompleted,
  companion,
}: {
  task: PickedTask;
  onEndEarly: () => void;
  onCompleted: () => void;
  companion: ReturnType<typeof useCompanionMode>;
}) {
  const currentFocus = useFocusSession((s) => s.current);
  const lastCompleted = useFocusSession((s) => s.lastCompleted);
  const pause = useFocusSession((s) => s.pause);
  const resume = useFocusSession((s) => s.resume);
  const end = useFocusSession((s) => s.end);
  const clearLastCompleted = useFocusSession((s) => s.clearLastCompleted);
  const lunaSkin = useLunaSkin();

  const isPaused = currentFocus?.pausedAt != null;
  const doneMode = currentFocus == null && lastCompleted != null;

  // Smooth countdown re-render — 10 fps ticker while running so the
  // ring + MM:SS animate cleanly. Store owns the time; this is only
  // a nudge to re-read it.
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (doneMode || isPaused || !currentFocus) return;
    const id = setInterval(() => forceRender((n) => (n + 1) % 1_000_000), 100);
    return () => clearInterval(id);
  }, [doneMode, isPaused, currentFocus]);

  const total = doneMode
    ? lastCompleted!.durationSec
    : (currentFocus?.durationSec ?? 0);
  const remain = doneMode ? 0 : selectRemainingSeconds(currentFocus);
  const elapsed = doneMode
    ? Math.round((lastCompleted?.durationSec ?? 0) / 60)
    : Math.floor(selectElapsedSeconds(currentFocus) / 60);
  const frac = total > 0 ? Math.max(0, Math.min(1, remain / total)) : 0;
  const mm = Math.floor(remain / 60);
  const ss = Math.floor(remain % 60);
  const sessionMins = Math.round(total / 60);

  const handleTogglePause = async () => {
    Haptics.selectionAsync();
    if (isPaused) await resume();
    else await pause();
  };

  const handleFinish = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await end({ reason: 'completed' });
  };

  const handleEndEarly = async () => {
    Haptics.selectionAsync();
    await end({ reason: 'cancelled' });
    onEndEarly();
  };

  const handleAnotherBlock = async () => {
    // Reset the done state and hand control back so the caller
    // relaunches the picker (or restarts on the same task — for now
    // we bounce back to picker to keep the flow simple).
    Haptics.selectionAsync();
    clearLastCompleted();
    onEndEarly();
  };

  const handleMarkItDone = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    clearLastCompleted();
    onCompleted();
  };

  // ── Done mode ────────────────────────────────────────────────────
  if (doneMode) {
    return (
      <View style={styles.sessionWrap}>
        {!companion.isFocused && (
          <View style={styles.doneCatMount}>
            <Image
              source={lunaSource('lick', lunaSkin)}
              style={styles.doneCat}
              resizeMode="contain"
            />
          </View>
        )}
        <Text style={styles.doneEyebrow}>
          {sessionMins} minutes {companion.isFocused ? 'of focus' : 'together'}
        </Text>
        <Text style={styles.doneH1}>
          You stayed with it — that&apos;s the hard part done.
        </Text>
        <Text style={styles.doneBody}>
          {task.title !== 'Open focus'
            ? `“${task.title}”`
            : 'Open focus'}
          {companion.isFocused ? '.' : ' — I was right here the whole time.'}
        </Text>
        {task.questId ? (
          <Pressable style={styles.doneMarkBtn} onPress={handleMarkItDone}>
            <Text style={styles.doneMarkText}>
              {companion.showXp
                ? `Mark it done · +${task.xpReward} xp`
                : 'Mark it done'}
            </Text>
          </Pressable>
        ) : (
          <Pressable style={styles.doneMarkBtn} onPress={handleMarkItDone}>
            <Text style={styles.doneMarkText}>Nice — log it</Text>
          </Pressable>
        )}
        <Pressable style={styles.doneAnotherBtn} onPress={handleAnotherBlock}>
          <Text style={styles.doneAnotherText}>Do one more block</Text>
        </Pressable>
      </View>
    );
  }

  // ── Live session ─────────────────────────────────────────────────
  return (
    <View style={styles.sessionWrap}>
      <Text style={styles.sessionEyebrow}>
        {isPaused
          ? 'Paused — take your time'
          : companion.isFocused
            ? 'In focus'
            : "I'm right here with you"}
      </Text>
      <Text style={styles.sessionTitle} numberOfLines={2}>
        {task.title === 'Open focus'
          ? companion.isFocused
            ? 'Open focus'
            : 'Just this, together.'
          : task.title}
      </Text>

      {/* Ember hearth + big numerals */}
      <View style={styles.hearthMount}>
        <EmberHearth frac={frac} running={!isPaused} size={272} />
        <View style={styles.hearthReadout} pointerEvents="none">
          <Text style={styles.hearthMMSS}>
            {pad(mm)}:{pad(ss)}
          </Text>
          <Text style={styles.hearthSub}>
            {elapsed} of {sessionMins} min
          </Text>
        </View>
      </View>

      {/* Luna licking beside the hearth — hidden in Focused mode. */}
      {!companion.isFocused && (
        <View style={styles.sessionCatMount}>
          <Image
            source={lunaSource('lick', lunaSkin)}
            style={styles.sessionCat}
            resizeMode="contain"
          />
        </View>
      )}

      {/* Controls */}
      <View style={styles.sessionControls}>
        <Pressable
          onPress={handleTogglePause}
          style={[
            styles.sessionCtrlBtn,
            isPaused
              ? styles.sessionCtrlBtnFilled
              : styles.sessionCtrlBtnOutline,
          ]}
        >
          <Text
            style={[
              styles.sessionCtrlBtnText,
              { color: isPaused ? C.void : C.ember },
            ]}
          >
            {isPaused ? '▶ Resume' : '❚❚ Pause'}
          </Text>
        </Pressable>
        <Pressable style={styles.sessionFinishBtn} onPress={handleFinish}>
          <Text style={styles.sessionFinishText}>Finish</Text>
        </Pressable>
      </View>
      <Pressable onPress={handleEndEarly} hitSlop={6} style={{ marginTop: 12 }}>
        <Text style={styles.endEarlyText}>end early — that&apos;s okay</Text>
      </Pressable>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Focus screen — step machine + auto-resume when a session is live
// ═════════════════════════════════════════════════════════════════════
export default function FocusScreen() {
  const companion = useCompanionMode();
  const petName = useUserStore((s) => s.petName);
  const ambientMood = useAmbientLunaMood();
  const currentFocus = useFocusSession((s) => s.current);
  const lastCompleted = useFocusSession((s) => s.lastCompleted);
  const start = useFocusSession((s) => s.start);
  const toggle = useQuestStore((s) => s.toggle);
  const addXp = useUserStore((s) => s.addXp);
  const addShard = useUserStore((s) => s.addShard);
  const registerActivity = useUserStore((s) => s.registerActivity);

  // Today is captured on first render so day-navigation math is
  // stable across a session (the "Today" label doesn't jitter if the
  // user hits midnight while picking).
  const today = useRef(new Date()).current;

  // Step machine.
  //   picking  → user is on the picker
  //   duration → user chose a task, is choosing a length
  //   session  → focus is live (or has just wrapped into done)
  //
  // If a session is already running (started from Home's
  // LumiFocusCard for example), skip straight to session. Same for
  // an unacknowledged done screen — surface it so the user can
  // "Mark it done" from here.
  const [step, setStep] = useState<'picking' | 'duration' | 'session'>(
    () => (currentFocus || lastCompleted ? 'session' : 'picking'),
  );
  const [pickedTask, setPickedTask] = useState<PickedTask | null>(null);

  // If the store's session state changes underneath us (e.g., user
  // starts a session from Home, then switches to Focus), jump into
  // the right step.
  useEffect(() => {
    if ((currentFocus || lastCompleted) && step === 'picking') {
      setStep('session');
    }
  }, [currentFocus, lastCompleted, step]);

  // ── Session task derivation ──
  // The task in scope during the session comes from either:
  //   (a) the local pickedTask (fresh flow: pick → duration → start), OR
  //   (b) the store's currentFocus / lastCompleted (resumed session).
  // For (b) we don't have xpReward / tier on hand, so we look up the
  // quest by id and rehydrate.
  const quests = useQuestStore((s) => s.quests);
  const sessionTask = useMemo<PickedTask | null>(() => {
    if (pickedTask) return pickedTask;
    const sess = currentFocus ?? null;
    const lc = lastCompleted;
    const questId = sess?.questId ?? lc?.questId ?? null;
    const title = sess?.taskTitle ?? lc?.taskTitle ?? 'Open focus';
    if (!questId) {
      return {
        questId: null,
        title,
        tier: null,
        atLabel: 'just focus',
        xpReward: 0,
      };
    }
    const q = quests.find((x) => x.id === questId);
    return {
      questId,
      title,
      tier: q?.importance ?? null,
      atLabel: q?.scheduledHour != null ? 'scheduled' : '',
      xpReward: q?.xpReward ?? 0,
    };
  }, [pickedTask, currentFocus, lastCompleted, quests]);

  const handleStartSession = async (mins: number) => {
    if (!pickedTask) return;
    if (!isLiveActivityAvailable()) {
      // ActivityKit unavailable — start the session anyway; the
      // store just skips the Live Activity call and we run purely
      // in-app. Not fatal.
    }
    await start({
      questId: pickedTask.questId ?? `open-${Date.now()}`,
      taskTitle: pickedTask.title,
      petName,
      durationSec: mins * 60,
      mood: ambientMood,
    });
    setStep('session');
  };

  const handleSessionCompleted = () => {
    if (sessionTask?.questId) {
      // Full completion fan-out — matches Home's completeQuest
      // minus the celebration chrome (the done screen already did
      // that). Focus is just another entry point for a task getting
      // completed, so XP / shard / activity still fire.
      const q = quests.find((x) => x.id === sessionTask.questId);
      if (q && !q.completed) {
        toggle(q.id);
        addXp(q.xpReward);
        addShard();
        registerActivity();
      }
    }
    setPickedTask(null);
    setStep('picking');
  };

  const handleSessionEndedEarly = () => {
    setPickedTask(null);
    setStep('picking');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {step === 'picking' && (
        <PickStep
          today={today}
          companion={companion}
          onPick={(t) => {
            setPickedTask(t);
            setStep('duration');
          }}
        />
      )}
      {step === 'duration' && pickedTask && (
        <DurationStep
          task={pickedTask}
          onBack={() => setStep('picking')}
          onStart={handleStartSession}
        />
      )}
      {step === 'session' && sessionTask && (
        <SessionStep
          task={sessionTask}
          companion={companion}
          onEndEarly={handleSessionEndedEarly}
          onCompleted={handleSessionCompleted}
        />
      )}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.void,
  },
  stepScroll: {
    flex: 1,
  },
  stepScrollContent: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: FLOATING_NAV_CLEARANCE + 20,
  },

  // ── Common typography ──
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: C.dusk,
    marginBottom: 8,
  },
  smallEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.mute,
    marginBottom: 6,
  },
  h1: {
    fontFamily: fonts.fraunces,
    fontSize: 28,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 32,
  },

  // ── Pick step ──
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 14,
  },
  viewToggle: {
    flexDirection: 'row',
    borderRadius: 100,
    borderWidth: 1,
    borderColor: C.hair,
    overflow: 'hidden',
  },
  viewToggleChip: {
    paddingHorizontal: 15,
    paddingVertical: 7,
  },
  viewToggleChipText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    textTransform: 'capitalize',
  },
  dayNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNavGlyph: {
    fontFamily: fonts.inter,
    fontSize: 16,
    color: C.boneDim,
    lineHeight: 18,
  },
  dayNavTodayBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.45),
    backgroundColor: hexA(C.ember, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNavTodayText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    color: C.ember,
    letterSpacing: 0.1,
  },
  dayHeadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
    marginBottom: 14,
  },
  dayHeadLabel: {
    fontFamily: fonts.fraunces,
    fontSize: 19,
    color: C.ember,
  },
  dayHeadCount: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
  },
  justFocusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: hexA(C.dusk, 0.08),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.35),
    marginBottom: 16,
  },
  justFocusGlyph: {
    fontFamily: fonts.inter,
    fontSize: 15,
    color: C.dusk,
  },
  justFocusTitle: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.bone,
  },
  justFocusSub: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    marginTop: 2,
  },
  rowChev: {
    fontFamily: fonts.inter,
    fontSize: 15,
    color: C.mute,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 13,
    paddingHorizontal: 13,
    height: 46,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.bone,
    padding: 0,
  },
  searchClear: {
    fontFamily: fonts.inter,
    fontSize: 18,
    color: C.mute,
    lineHeight: 20,
  },
  suggestCard: {
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: hexA(C.ember, 0.08),
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.45),
    marginBottom: 18,
  },
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  suggestHeaderGlyph: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.dusk,
  },
  suggestHeaderLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: C.dusk,
  },
  suggestBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  suggestSigil: {
    fontFamily: fonts.inter,
    fontSize: 10,
    letterSpacing: -1,
  },
  suggestTitle: {
    fontFamily: fonts.inter,
    fontSize: 16,
    color: C.bone,
    letterSpacing: -0.2,
  },
  suggestSub: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
    marginTop: 2,
  },
  listSectionLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: C.mute,
    marginBottom: 10,
    marginTop: 4,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    marginBottom: 8,
  },
  listSigil: {
    fontFamily: fonts.inter,
    fontSize: 9,
    letterSpacing: -1,
  },
  listTitle: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.bone,
    letterSpacing: -0.15,
  },
  listSub: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    marginTop: 2,
  },
  emptyMatch: {
    fontFamily: fonts.fraunces,
    fontSize: 13,
    color: C.mute,
    textAlign: 'center',
    paddingVertical: 20,
  },
  emptyDay: {
    padding: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.hair,
    marginTop: 14,
  },
  emptyDayText: {
    fontFamily: fonts.fraunces,
    fontSize: 13.5,
    color: C.mute,
    textAlign: 'center',
  },

  // Month view
  monthTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 19,
    color: C.bone,
    textAlign: 'center',
    marginBottom: 12,
  },
  monthWeekdayRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  monthWeekday: {
    flex: 1,
    fontFamily: fonts.interSemi,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: C.mute,
    textAlign: 'center',
    paddingVertical: 4,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthCellBlank: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
  },
  monthCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  monthCellDate: {
    fontFamily: fonts.fraunces,
    fontSize: 15,
    lineHeight: 16,
  },
  monthDotRow: {
    flexDirection: 'row',
    gap: 2,
    height: 4,
  },
  monthDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  monthFoot: {
    fontFamily: fonts.fraunces,
    fontSize: 11.5,
    color: C.mute,
    textAlign: 'center',
    marginTop: 16,
  },

  // ── Duration step ──
  backBtn: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backBtnText: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.mute,
  },
  focusOnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 26,
  },
  tierSigil: {
    fontFamily: fonts.inter,
    fontSize: 10,
    letterSpacing: -1,
  },
  focusOnTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.3,
    flex: 1,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: hexA(C.dusk, 0.1),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.3),
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginTop: 12,
    marginBottom: 24,
  },
  hintGlyph: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.dusk,
    marginTop: 1,
  },
  hintText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.dusk,
    lineHeight: 19,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  presetCard: {
    width: '48%',
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 15,
    borderRadius: 18,
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
  },
  presetCardOn: {
    backgroundColor: hexA(C.ember, 0.12),
    borderColor: C.ember,
  },
  presetCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  presetCount: {
    fontFamily: fonts.fraunces,
    fontSize: 36,
    lineHeight: 36,
  },
  presetCountUnit: {
    fontFamily: fonts.inter,
    fontSize: 11,
  },
  presetTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: hexA(C.bone, 0.08),
    marginTop: 12,
    marginBottom: 9,
    overflow: 'hidden',
  },
  presetTrackFill: {
    height: '100%',
    borderRadius: 2,
  },
  presetLabel: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    letterSpacing: -0.1,
  },
  customCard: {
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: 'transparent',
  },
  customCardOn: {
    borderColor: hexA(C.ember, 0.4),
    backgroundColor: hexA(C.ember, 0.08),
    padding: 18,
  },
  customLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.boneDim,
    textAlign: 'center',
  },
  customStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  customStepBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: hexA(C.bone, 0.05),
    alignItems: 'center',
    justifyContent: 'center',
  },
  customStepGlyph: {
    fontFamily: fonts.inter,
    fontSize: 22,
    color: C.boneDim,
    lineHeight: 24,
  },
  customCountBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    minWidth: 96,
    justifyContent: 'center',
  },
  customCount: {
    fontFamily: fonts.fraunces,
    fontSize: 44,
    color: C.ember,
    lineHeight: 44,
  },
  customCountUnit: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
  },
  previewCard: {
    marginTop: 18,
    borderRadius: 18,
    padding: 18,
    backgroundColor: hexA(C.ember, 0.06),
    borderWidth: 1,
    borderColor: C.hair,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  previewGlowMount: {
    width: 66,
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  previewGlow: {
    position: 'absolute',
    borderRadius: 100,
    backgroundColor: hexA(C.glow, 0.28),
  },
  previewDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: C.glow,
    shadowColor: C.glow,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0.9,
  },
  previewTitle: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
    color: C.bone,
    letterSpacing: -0.1,
  },
  previewSub: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.dusk,
    marginTop: 3,
    lineHeight: 18,
  },
  startBtn: {
    backgroundColor: C.ember,
    borderRadius: 15,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: C.ember,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    shadowOpacity: 0.35,
  },
  startBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 15.5,
    color: C.void,
    letterSpacing: 0.1,
  },

  // ── Session step ──
  // justifyContent centers the whole timer stack vertically so the
  // cat + hearth sit in the visible middle instead of pinned to the
  // top (which read as "content jammed against the notch"). Kept
  // paddingTop light so the eyebrow + task title still get a small
  // top offset from safe-area top.
  sessionWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: FLOATING_NAV_CLEARANCE + 20,
  },
  sessionEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.dusk,
    marginBottom: 8,
    textAlign: 'center',
  },
  sessionTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 18,
    color: C.boneDim,
    letterSpacing: -0.2,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 6,
  },
  hearthMount: {
    width: 272,
    height: 272,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  hearthReadout: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hearthMMSS: {
    fontFamily: fonts.fraunces,
    fontSize: 60,
    color: C.bone,
    letterSpacing: -1.5,
    lineHeight: 64,
    // Ember glow behind the digits (mockup: 0 2px 22px ember@45%) —
    // matches LumiFocusCard's ringMMSS so both timers feel hearth-lit.
    textShadowColor: hexA(C.ember, 0.45),
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 22,
  },
  hearthSub: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
    letterSpacing: 0.3,
    marginTop: 6,
  },
  sessionCatMount: {
    // Push the cat DOWN from the hearth's bottom edge — was
    // marginTop: -6 which pulled it up INTO the hearth's glow
    // ring, reading as "cat is stuck to the clock". Positive top
    // margin gives visible breathing room between the ring and
    // Luna.
    marginTop: 24,
    marginBottom: 8,
  },
  sessionCat: {
    width: 108,
    height: 108,
  },
  sessionControls: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    maxWidth: 320,
    marginTop: 12,
  },
  sessionCtrlBtn: {
    flex: 1,
    borderRadius: 15,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionCtrlBtnFilled: {
    backgroundColor: C.ember,
  },
  sessionCtrlBtnOutline: {
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.5),
  },
  sessionCtrlBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
  },
  sessionFinishBtn: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.hair,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionFinishText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.boneDim,
  },
  endEarlyText: {
    fontFamily: fonts.fraunces,
    fontSize: 12.5,
    color: C.mute,
    textAlign: 'center',
  },

  // ── Done state ──
  doneCatMount: {
    marginBottom: 4,
  },
  doneCat: {
    width: 128,
    height: 128,
  },
  doneEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: C.glow,
    marginBottom: 10,
  },
  doneH1: {
    fontFamily: fonts.fraunces,
    fontSize: 26,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 32,
    textAlign: 'center',
    maxWidth: 320,
  },
  doneBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    marginTop: 12,
    maxWidth: 300,
    textAlign: 'center',
    lineHeight: 20,
  },
  doneMarkBtn: {
    width: '100%',
    maxWidth: 320,
    marginTop: 26,
    backgroundColor: C.ember,
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneMarkText: {
    fontFamily: fonts.interSemi,
    fontSize: 15,
    color: C.void,
  },
  doneAnotherBtn: {
    width: '100%',
    maxWidth: 320,
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 15,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneAnotherText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.boneDim,
  },
});
