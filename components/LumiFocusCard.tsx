// LumiFocusCard — Home's hero card, re-cast as a living focus session.
//
// One card, three modes:
//   card  — the calm "Lumi suggests" surface (title / meta / Mark it done +
//           collapsed focus picker). Default state.
//   focus — the timer is live. Big countdown ring with tick marks + gradient
//           stroke + leading dot, MM:SS in the center, pause/resume/finish.
//   done  — the timer just wrapped. Check circle, "That's the hard part done",
//           and a big "Mark it done · +xp" button that hands back the same
//           payoff the card mode's button hands back.
//
// The card reads `useFocusSession` for the underlying lifecycle. Local UI
// state only owns the collapsed/expanded picker toggle and the currently-
// chosen duration. Everything the timer needs (elapsed, paused, activityId)
// lives in the store, so the same card can be embedded in the picker modal
// without duplicating state.
//
// Mode derivation:
//   currentFocus?.questId === quest.id                      → 'focus'
//   lastCompleted?.questId === quest.id (post-natural end)  → 'done'
//   otherwise                                                → 'card'
//
// Home passes the hero quest + the callbacks it already had for Mark it done,
// swap, and edit; this component owns the rest of the mechanic.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import { EmberHearth } from './EmberHearth';
import {
  useFocusSession,
  selectElapsedSeconds,
  selectRemainingSeconds,
  isLiveActivityAvailable,
} from '../lib/focusSession';
import type { Quest } from '../store/questStore';

// ── Palette ───────────────────────────────────────────────────────────
// Same 5-color chord Home already uses; kept local so this component
// doesn't reach into any of Home's private consts.
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#211A15',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  glow: '#F4C98A',
  honey: '#C9A06A',
  dusk: '#8EA0B4',
  ash: '#5A5650',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const clampedA = Math.max(0, Math.min(1, a));
  return `rgba(${r},${g},${b},${clampedA.toFixed(3)})`;
};

const pad = (n: number): string => String(n).padStart(2, '0');

// ── Duration picker ───────────────────────────────────────────────────
const QUICK_MINS = [15, 25, 45, 60, 90] as const;
const MIN_MIN = 1;
const MAX_MIN = 180;
const clampMin = (v: number) => Math.max(MIN_MIN, Math.min(MAX_MIN, v));

// ── Ring geometry ─────────────────────────────────────────────────────
// Matches the mock: 248px canvas, 104px radius. Kept as module-level
// constants so both the SVG paths and the center-readout layout can
// reference the same values.
const RING_SIZE = 248;
const RING_R = 104;
const RING_CIRC = 2 * Math.PI * RING_R;
const RING_CENTER = RING_SIZE / 2;

// ── Props ─────────────────────────────────────────────────────────────
export interface LumiFocusCardProps {
  /** Quest this card is bound to. Its title fronts the card mode + is
   *  passed to the Live Activity when a session starts. */
  quest: Quest;
  /** User's pet name — labels the Live Activity. */
  petName: string;
  /** Ambient mood — pushed to the Live Activity as its initial mood. */
  ambientMood: string;
  /** XP awarded on completion (shown in the done screen's button). */
  xpReward: number;
  /** Called when the user taps "Mark it done" from EITHER card mode or
   *  done mode. Home's existing completeQuest flow. */
  onMarkItDone: () => void;
  /** Called when the user taps the "focus on another task" link.
   *  Optional — omit to hide the link. */
  onOpenPicker?: () => void;
  /** Called when the user taps "not feeling it? → show me another".
   *  Optional — omit to hide the link. */
  onSwap?: () => void;
  /** Whether the swap link should render (Home already knows if there
   *  are other candidates). */
  swapAvailable?: boolean;
  /** Optional trigger for a grooming beat (matches Home's triggerLick
   *  hook). Fires when a session starts so the nook cat licks. */
  onFocusStart?: () => void;
  /** Slot rendered top-right in the header (the ⋯ overflow menu). */
  headerRight?: React.ReactNode;
  /** Slot rendered above the title (the YOUR COMMENT pin). */
  aboveTitleSlot?: React.ReactNode;
  /** Slot rendered after the title (Home's HeroDescription with
   *  self-measuring more/less). */
  descriptionSlot?: React.ReactNode;
  /** Slot rendered as the meta row (tier · window · +xp). */
  metaSlot?: React.ReactNode;
}

// ═════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════
export function LumiFocusCard({
  quest,
  petName,
  ambientMood,
  xpReward,
  onMarkItDone,
  onOpenPicker,
  onSwap,
  swapAvailable,
  onFocusStart,
  headerRight,
  aboveTitleSlot,
  descriptionSlot,
  metaSlot,
}: LumiFocusCardProps) {
  // ── Session state ────────────────────────────────────────────────
  const currentFocus = useFocusSession((s) => s.current);
  const lastCompleted = useFocusSession((s) => s.lastCompleted);
  const start = useFocusSession((s) => s.start);
  const pause = useFocusSession((s) => s.pause);
  const resume = useFocusSession((s) => s.resume);
  const end = useFocusSession((s) => s.end);
  const clearLastCompleted = useFocusSession((s) => s.clearLastCompleted);

  const focusAvailable = isLiveActivityAvailable();
  const isOurSession = currentFocus?.questId === quest.id;
  const isOurCompletion = lastCompleted?.questId === quest.id;
  const isPaused = currentFocus?.pausedAt != null;

  // ── Mode ──────────────────────────────────────────────────────────
  // Order matters: an active session on this quest beats a stale
  // completion record from an earlier one.
  const mode: 'card' | 'focus' | 'done' = isOurSession
    ? 'focus'
    : isOurCompletion
      ? 'done'
      : 'card';

  // ── Duration picker (card mode) ──────────────────────────────────
  //
  // Priority chain for the default focus length:
  //   1. LLM-extracted duration (respect what the user said or the
  //      model inferred — e.g. "30-min call" → 30).
  //   2. Scheduled tasks with no duration → 45 (they tend to be
  //      meetings / calls that carry more weight).
  //   3. Otherwise fall back by importance tier — the "how long
  //      should I focus?" answer is really "how big is this?":
  //         high   (Trial)  → 60  — a real deep-work block
  //         medium (Task)   → 30  — a solid chunk, not overwhelming
  //         low    (Whim)   → 15  — quick win, low activation cost
  //      Reads as: Lumi's suggestion matches the shape of the task
  //      instead of always defaulting to a generic 25.
  const defaultMins = useMemo(() => {
    if (quest.durationMinutes) return quest.durationMinutes;
    if (quest.scheduledHour != null) return 45;
    if (quest.importance === 'high') return 60;
    if (quest.importance === 'low') return 15;
    return 30;
  }, [quest.durationMinutes, quest.scheduledHour, quest.importance]);
  const [mins, setMins] = useState(defaultMins);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Reset the chosen minutes when the underlying quest changes so the
  // picker stays in sync with the currently-suggested task.
  useEffect(() => {
    setMins(defaultMins);
  }, [defaultMins]);

  // ── Smooth countdown re-render loop (focus mode) ─────────────────
  // The store holds startedAt / pauseTotalMs / pausedAt; the card
  // computes remain from those on every render. To animate the ring
  // + MM:SS smoothly we force a re-render 10× per second while a
  // session is running and NOT paused. Cheap — just a state bump.
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (mode !== 'focus' || isPaused) return;
    const id = setInterval(() => forceRender((n) => (n + 1) % 1_000_000), 100);
    return () => clearInterval(id);
  }, [mode, isPaused]);

  // ── Breathing halo (focus + done modes) ──────────────────────────
  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (mode === 'card') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(halo, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, halo]);

  // ── Done-mode celebration ────────────────────────────────────────
  // Three layered anims fire when the user lands on the done state:
  //   1) Sun rays rotate slowly behind the medallion (20s loop)
  //   2) Ring draws in via strokeDashoffset (700ms out-cubic)
  //   3) Checkmark draws in after the ring settles (starts 500ms
  //      in, 420ms out-ease)
  // Native driver stays true for the rays' rotation transform but
  // false for the SVG strokeDashoffset animations (SVG props don't
  // support the native driver).
  const raysRot = useRef(new Animated.Value(0)).current;
  const ringDraw = useRef(new Animated.Value(1)).current;
  const checkDraw = useRef(new Animated.Value(1)).current;
  const DONE_RING_R = 40;
  const DONE_RING_CIRC = 2 * Math.PI * DONE_RING_R;
  const DONE_CHECK_LEN = 50;
  useEffect(() => {
    if (mode !== 'done') return;
    ringDraw.setValue(1);
    checkDraw.setValue(1);
    Animated.sequence([
      Animated.timing(ringDraw, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(checkDraw, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
    const raysLoop = Animated.loop(
      Animated.timing(raysRot, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    raysLoop.start();
    return () => raysLoop.stop();
  }, [mode, raysRot, ringDraw, checkDraw]);
  const ringDashOffset = ringDraw.interpolate({
    inputRange: [0, 1],
    outputRange: [0, DONE_RING_CIRC],
  });
  const checkDashOffset = checkDraw.interpolate({
    inputRange: [0, 1],
    outputRange: [0, DONE_CHECK_LEN],
  });
  const raysRotationStr = raysRot.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── Derived values ──────────────────────────────────────────────
  const total = currentFocus?.durationSec ?? mins * 60;
  const remain = mode === 'focus' ? selectRemainingSeconds(currentFocus) : 0;
  const elapsed =
    mode === 'focus' ? selectElapsedSeconds(currentFocus) : 0;
  const frac = total > 0 ? Math.max(0, Math.min(1, remain / total)) : 0;
  const mm = Math.floor(remain / 60);
  const ss = Math.floor(remain % 60);
  const elapsedMin = Math.floor(elapsed / 60);
  const sessionMins = Math.round(total / 60);

  // For the done screen — read the finished session's duration.
  const doneMins = lastCompleted
    ? Math.round(lastCompleted.durationSec / 60)
    : mins;
  const doneTitle = lastCompleted?.taskTitle ?? quest.title;

  // ── Actions ──────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!focusAvailable) return;
    Haptics.selectionAsync();
    onFocusStart?.();
    await start({
      questId: quest.id,
      taskTitle: quest.title,
      petName,
      durationSec: mins * 60,
      mood: ambientMood,
    });
  };

  const handleTogglePause = async () => {
    Haptics.selectionAsync();
    if (isPaused) {
      await resume();
    } else {
      await pause();
    }
  };

  const handleFinish = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Finish counts as completed — surfaces the done screen and
    // lets the user reap the mark-done payoff even if they wrap up
    // early.
    await end({ reason: 'completed' });
  };

  const handleCancel = async () => {
    Haptics.selectionAsync();
    await end({ reason: 'cancelled' });
  };

  const handleDoneMarkIt = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    clearLastCompleted();
    onMarkItDone();
  };

  const handleDoneDismiss = () => {
    Haptics.selectionAsync();
    clearLastCompleted();
  };

  // ═════════════════════════════════════════════════════════════════
  // DONE MODE
  // ═════════════════════════════════════════════════════════════════
  if (mode === 'done') {
    return (
      <Shell glow>
        <View style={styles.doneWrap}>
          <View style={styles.doneRingWrap}>
            {/* Soft radial halo — SVG RadialGradient so it fades
               smoothly to transparent with NO hard circle edge (the
               previous borderRadius+backgroundColor approach was
               reading as a dark disc behind the medallion). Fills
               the full 220px container so the softening happens
               well beyond the ring. */}
            <View style={styles.doneRingHaloWrap} pointerEvents="none">
              <Svg width={220} height={220} viewBox="0 0 220 220">
                <Defs>
                  <RadialGradient
                    id="doneHaloGrad"
                    cx="50%"
                    cy="50%"
                    r="50%"
                    fx="50%"
                    fy="50%"
                  >
                    <Stop offset="0" stopColor={C.glow} stopOpacity={0.22} />
                    <Stop
                      offset="0.4"
                      stopColor={C.ember}
                      stopOpacity={0.1}
                    />
                    <Stop offset="1" stopColor={C.ember} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={110} cy={110} r={110} fill="url(#doneHaloGrad)" />
              </Svg>
            </View>

            {/* Rotating sun rays — 14 tapered gradient bars extending
               from just outside the ring (~r=45) outward to ~r=100.
               Wider footprint and brighter middle stop than the
               previous version; wrapped Animated.View rotates the
               whole SVG at 20s. Positioned to extend past the 168
               medallion area — the wrap is 220 to give the rays
               room. */}
            <Animated.View
              style={[
                styles.doneRays,
                { transform: [{ rotate: raysRotationStr }] },
              ]}
              pointerEvents="none"
            >
              <Svg width={220} height={220} viewBox="0 0 220 220">
                <Defs>
                  <LinearGradient
                    id="doneRayGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <Stop offset="0" stopColor={C.glow} stopOpacity={0} />
                    <Stop
                      offset="0.5"
                      stopColor={C.glow}
                      stopOpacity={0.42}
                    />
                    <Stop offset="1" stopColor={C.glow} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                {Array.from({ length: 14 }).map((_, i) => {
                  const angle = (i / 14) * 360;
                  return (
                    <G
                      key={i}
                      rotation={angle}
                      originX={110}
                      originY={110}
                    >
                      <Rect
                        x={108}
                        y={10}
                        width={4}
                        height={65}
                        fill="url(#doneRayGrad)"
                      />
                    </G>
                  );
                })}
              </Svg>
            </Animated.View>

            {/* Medallion — radial fill + gradient ring + drawn check.
               Ring + check both animate in via strokeDashoffset when
               the done state mounts. */}
            <Svg width={150} height={150} viewBox="0 0 150 150">
              <Defs>
                <LinearGradient
                  id="doneMedalRing"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <Stop offset="0" stopColor={C.ember} />
                  <Stop offset="1" stopColor={C.glow} />
                </LinearGradient>
                <RadialGradient
                  id="doneMedalFill"
                  cx="50%"
                  cy="42%"
                  r="60%"
                  fx="50%"
                  fy="42%"
                >
                  <Stop offset="0" stopColor={C.glow} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={C.ember} stopOpacity={0.04} />
                </RadialGradient>
              </Defs>
              <Circle
                cx={75}
                cy={75}
                r={DONE_RING_R}
                fill="url(#doneMedalFill)"
              />
              <AnimatedCircle
                cx={75}
                cy={75}
                r={DONE_RING_R}
                fill="none"
                stroke="url(#doneMedalRing)"
                strokeWidth={4.5}
                strokeLinecap="round"
                strokeDasharray={`${DONE_RING_CIRC}`}
                strokeDashoffset={ringDashOffset}
                transform="rotate(-90 75 75)"
              />
              <AnimatedPath
                d="M60 76 L71 87 L92 63"
                fill="none"
                stroke="#FFF3D6"
                strokeWidth={5.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${DONE_CHECK_LEN}`}
                strokeDashoffset={checkDashOffset}
              />
            </Svg>
          </View>
          <Text style={styles.doneEyebrow}>{doneMins} minutes of focus</Text>
          <Text style={styles.doneTitle}>That&apos;s the hard part done.</Text>
          <Text style={styles.doneBody}>
            {doneTitle} — you stayed with it the whole time.
          </Text>
          <Pressable
            onPress={handleDoneMarkIt}
            style={({ pressed }) => [
              styles.doneMarkBtn,
              pressed && { opacity: 0.86 },
            ]}
          >
            <View style={styles.markCheck}>
              <Text style={styles.markCheckGlyph}>✓</Text>
            </View>
            <Text style={styles.doneMarkText}>
              Mark it done · +{xpReward} xp
            </Text>
          </Pressable>
          <Pressable
            onPress={handleDoneDismiss}
            style={styles.doneDismiss}
            hitSlop={8}
          >
            <Text style={styles.doneDismissText}>Not yet — dismiss</Text>
          </Pressable>
        </View>
      </Shell>
    );
  }

  // ═════════════════════════════════════════════════════════════════
  // FOCUS MODE
  // ═════════════════════════════════════════════════════════════════
  if (mode === 'focus') {
    return (
      <Shell focus>
        {/* Status header — running dot + label + × close */}
        <View style={styles.focusHeader}>
          <View
            style={[
              styles.focusDot,
              {
                backgroundColor: isPaused ? C.mute : C.ember,
                shadowColor: isPaused ? 'transparent' : C.ember,
                shadowOpacity: isPaused ? 0 : 0.7,
                shadowRadius: isPaused ? 0 : 6,
              },
            ]}
          />
          <Text
            style={[
              styles.focusHeaderLabel,
              { color: isPaused ? C.mute : C.ember },
            ]}
          >
            {isPaused ? 'Paused' : 'In focus'}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={handleCancel}
            style={styles.focusCloseBtn}
            hitSlop={4}
          >
            <Text style={styles.focusCloseGlyph}>×</Text>
          </Pressable>
        </View>

        {/* The living hearth — shared component with the Focus tab.
           EmberHearth handles the well depth, ticks, gradient arc,
           comet head, and the breathing core. LumiFocusCard just
           overlays the MM:SS readout on top. */}
        <View style={styles.ringWrap}>
          <EmberHearth frac={frac} running={!isPaused} size={RING_SIZE} />
          <View style={styles.ringReadout} pointerEvents="none">
            <Text style={styles.ringMMSS}>
              {pad(mm)}:{pad(ss)}
            </Text>
            <Text style={styles.ringSub}>
              {elapsedMin} of {sessionMins} min
            </Text>
          </View>
        </View>

        {/* Focusing on */}
        <View style={styles.focusOnWrap}>
          <Text style={styles.focusOnLabel}>Focusing on</Text>
          <Text style={styles.focusOnTitle} numberOfLines={2}>
            {currentFocus?.taskTitle ?? quest.title}
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.focusControls}>
          <Pressable
            onPress={handleTogglePause}
            style={({ pressed }) => [
              styles.focusCtrlBtn,
              isPaused ? styles.focusCtrlBtnFilled : styles.focusCtrlBtnOutline,
              pressed && { opacity: 0.86 },
            ]}
          >
            <Text
              style={[
                styles.focusCtrlBtnText,
                { color: isPaused ? C.void : C.ember },
              ]}
            >
              {isPaused ? '▶ Resume' : '❚❚ Pause'}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleFinish}
            style={({ pressed }) => [
              styles.focusFinishBtn,
              pressed && { opacity: 0.86 },
            ]}
          >
            <Text style={styles.focusFinishText}>Finish</Text>
          </Pressable>
        </View>
      </Shell>
    );
  }

  // ═════════════════════════════════════════════════════════════════
  // CARD MODE (default)
  // ═════════════════════════════════════════════════════════════════
  return (
    <Shell glow>
      {/* Header */}
      <View style={styles.cardHeader}>
        <Text style={styles.cardHeaderGlyph}>✦</Text>
        <Text style={styles.cardHeaderLabel}>Lumi suggests</Text>
        <View style={{ flex: 1 }} />
        {headerRight}
      </View>

      {aboveTitleSlot}
      <Text style={styles.cardTitle}>{quest.title}</Text>
      {descriptionSlot}
      {metaSlot}

      {/* Mark it done — primary CTA */}
      <Pressable
        onPress={onMarkItDone}
        style={({ pressed }) => [
          styles.markDoneBtn,
          pressed && { opacity: 0.86 },
        ]}
      >
        <View style={styles.markCheck}>
          <Text style={styles.markCheckGlyph}>✓</Text>
        </View>
        <Text style={styles.markDoneText}>Mark it done</Text>
      </Pressable>

      {/* Focus picker — collapsed by default, blooms open on tap */}
      {focusAvailable && (
        <View style={styles.focusPickerWrap}>
          {pickerOpen && (
            <View style={styles.pickerCard}>
              <View style={styles.pickerStepperRow}>
                <Pressable
                  onPress={() => setMins((m) => clampMin(m - 1))}
                  style={styles.pickerStepBtn}
                  hitSlop={6}
                >
                  <Text style={styles.pickerStepGlyph}>−</Text>
                </Pressable>
                <View style={styles.pickerCountBlock}>
                  <Text style={styles.pickerCount}>{mins}</Text>
                  <Text style={styles.pickerCountUnit}>min</Text>
                </View>
                <Pressable
                  onPress={() => setMins((m) => clampMin(m + 1))}
                  style={styles.pickerStepBtn}
                  hitSlop={6}
                >
                  <Text style={styles.pickerStepGlyph}>+</Text>
                </Pressable>
              </View>
              <View style={styles.pickerQuickRow}>
                {QUICK_MINS.map((q) => {
                  const on = mins === q;
                  return (
                    <Pressable
                      key={q}
                      onPress={() => setMins(q)}
                      style={[
                        styles.pickerChip,
                        on && styles.pickerChipOn,
                      ]}
                      hitSlop={4}
                    >
                      <Text
                        style={[
                          styles.pickerChipText,
                          { color: on ? C.void : C.boneDim },
                        ]}
                      >
                        {q}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          <View style={styles.focusStartRow}>
            <Pressable
              onPress={handleStart}
              style={({ pressed }) => [
                styles.focusStartBtn,
                pressed && { opacity: 0.86 },
              ]}
            >
              <Text style={styles.focusStartText}>▶ Start {mins}-min focus</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setPickerOpen((p) => !p);
              }}
              style={[
                styles.focusPickerToggle,
                pickerOpen && styles.focusPickerToggleOn,
              ]}
              hitSlop={4}
            >
              <Text
                style={[
                  styles.focusPickerToggleText,
                  { color: pickerOpen ? C.ember : C.mute },
                ]}
              >
                {pickerOpen ? 'done' : '◷'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Footer links */}
      <View style={styles.footerLinks}>
        {onOpenPicker && (
          <Pressable onPress={onOpenPicker} hitSlop={6}>
            <Text style={styles.footerLinkPrimary}>
              Focus on another task →
            </Text>
          </Pressable>
        )}
        {swapAvailable && onSwap && (
          <Pressable onPress={onSwap} hitSlop={6}>
            <Text style={styles.footerLinkMuted}>
              not feeling it? → show me another
            </Text>
          </Pressable>
        )}
      </View>
    </Shell>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Shell — outer card container with the ember-lit border + shadow
// ═════════════════════════════════════════════════════════════════════
function Shell({
  children,
  glow,
  focus,
}: {
  children: React.ReactNode;
  glow?: boolean;
  focus?: boolean;
}) {
  return (
    <View
      style={[
        styles.shell,
        {
          borderColor: focus ? hexA(C.ember, 0.35) : hexA(C.ember, 0.22),
          shadowOpacity: glow ? 0.55 : 0.45,
        },
      ]}
    >
      {children}
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // ── Shell ──
  shell: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 22,
    backgroundColor: C.void2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowRadius: 40,
    elevation: 12,
  },

  // ── Card mode ──
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardHeaderGlyph: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.dusk,
  },
  cardHeaderLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 2,
    color: C.dusk,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 32,
    color: C.bone,
    letterSpacing: -0.6,
    lineHeight: 36,
    marginBottom: 10,
  },

  // ── Mark it done ──
  markDoneBtn: {
    backgroundColor: C.ember,
    borderRadius: 15,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    marginTop: 16,
    shadowColor: C.ember,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    shadowOpacity: 0.35,
  },
  markCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.6,
    borderColor: C.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markCheckGlyph: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.void,
    lineHeight: 14,
  },
  markDoneText: {
    fontFamily: fonts.interSemi,
    fontSize: 16,
    color: C.void,
    letterSpacing: 0.1,
  },

  // ── Focus picker ──
  focusPickerWrap: {
    marginTop: 12,
  },
  pickerCard: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: hexA(C.void, 0.4),
    padding: 14,
    marginBottom: 10,
  },
  pickerStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginBottom: 13,
  },
  pickerStepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: hexA(C.bone, 0.05),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerStepGlyph: {
    fontFamily: fonts.inter,
    fontSize: 24,
    color: C.boneDim,
    lineHeight: 26,
  },
  pickerCountBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    minWidth: 112,
  },
  pickerCount: {
    fontFamily: fonts.fraunces,
    fontSize: 52,
    color: C.ember,
    letterSpacing: -1,
    lineHeight: 52,
  },
  pickerCountUnit: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.mute,
    letterSpacing: 0.3,
  },
  pickerQuickRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  pickerChip: {
    minWidth: 40,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
  },
  pickerChipOn: {
    backgroundColor: C.ember,
    borderColor: C.ember,
  },
  pickerChipText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
  },
  focusStartRow: {
    flexDirection: 'row',
    gap: 10,
  },
  focusStartBtn: {
    flex: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.45),
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusStartText: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
    color: C.ember,
    letterSpacing: 0.1,
  },
  focusPickerToggle: {
    width: 52,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusPickerToggleOn: {
    borderColor: hexA(C.ember, 0.45),
    backgroundColor: hexA(C.ember, 0.12),
  },
  focusPickerToggleText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
  },

  // ── Footer links ──
  footerLinks: {
    marginTop: 16,
    gap: 8,
    alignItems: 'center',
  },
  footerLinkPrimary: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.dusk,
    letterSpacing: 0.1,
  },
  footerLinkMuted: {
    fontFamily: fonts.fraunces,
    fontSize: 13,
    color: C.mute,
  },

  // ── Focus mode ──
  focusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  focusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  focusHeaderLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  focusCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusCloseGlyph: {
    fontFamily: fonts.inter,
    fontSize: 20,
    color: C.mute,
    lineHeight: 22,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
    position: 'relative',
  },
  ringHalo: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: (RING_SIZE - 12) / 2,
    backgroundColor: hexA(C.ember, 0.22),
  },
  ringReadout: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringMMSS: {
    fontFamily: fonts.fraunces,
    fontSize: 56,
    color: C.bone,
    letterSpacing: -1,
    lineHeight: 60,
  },
  ringSub: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    letterSpacing: 0.2,
    marginTop: 6,
  },
  focusOnWrap: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  focusOnLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.dusk,
    marginBottom: 5,
  },
  focusOnTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 19,
    color: C.boneDim,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  focusControls: {
    flexDirection: 'row',
    gap: 10,
  },
  focusCtrlBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusCtrlBtnFilled: {
    backgroundColor: C.ember,
  },
  focusCtrlBtnOutline: {
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.5),
    backgroundColor: 'transparent',
  },
  focusCtrlBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
    letterSpacing: 0.1,
  },
  focusFinishBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: 'transparent',
    paddingVertical: 15,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusFinishText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.boneDim,
  },

  // ── Done mode ──
  doneWrap: {
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingTop: 8,
  },
  doneRingWrap: {
    // 220 gives the rays room to extend well outside the medallion
    // (which is 150 tall, centered in this box). Bumped from 168.
    width: 220,
    height: 220,
    marginBottom: 12,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneRingHaloWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 220,
    height: 220,
  },
  doneRays: {
    position: 'absolute',
    width: 220,
    height: 220,
    top: 0,
    left: 0,
  },
  doneCheckMount: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneCheckGlyph: {
    fontFamily: fonts.interSemi,
    fontSize: 44,
    color: C.glow,
    lineHeight: 44,
  },
  doneEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: C.glow,
    marginBottom: 9,
  },
  doneTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 27,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 32,
    textAlign: 'center',
    marginBottom: 7,
  },
  doneBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: 22,
  },
  doneMarkBtn: {
    width: '100%',
    backgroundColor: C.ember,
    borderRadius: 15,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  doneMarkText: {
    fontFamily: fonts.interSemi,
    fontSize: 15,
    color: C.void,
    letterSpacing: 0.1,
  },
  doneDismiss: {
    marginTop: 12,
    paddingVertical: 4,
  },
  doneDismissText: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
  },
});
