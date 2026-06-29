// Lumi · Onboarding v2 — "the post-signup interview"
//
// Spec: lumi-onboarding-2-spec.md (mockup: lumi-onboarding-2.jsx).
// One warm question at a time: welcome → struggles → rhythm → brain-
// dump → daily anchors → reflection → offer. Each answer SEEDS REAL
// DATA so the app isn't empty on day one:
//   - struggles  → profiles.struggles
//   - rhythm     → sharp/foggy windows (the energy prior)
//   - brain-dump → real quests via the shared parseSmartCapture engine
//   - anchors    → profiles.anchors (frames the Time tab)
//
// Color law: ember = user actions; dusk = Lumi's voice; glow accents
// the "you're seen" emotional beats (welcome, reflection, offer).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Animated,
  Easing,
  Image,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import Svg, { Circle, Rect } from 'react-native-svg';

import { fonts } from '../../constants/fonts';
import { lunaSource } from '../../lib/luna-source';
import { useAmbientLunaMood } from '../../lib/luna-mood';
import {
  useUserStore,
  type StruggleKey,
  type EnergyWindowKey,
  type DailyAnchors,
} from '../../store/userStore';
import { useQuestStore } from '../../store/questStore';
import { useSession } from '../../lib/auth';
import { useVoice } from '../../lib/voice';
import {
  parseSmartCapture,
  difficultyFromImportance,
  type CaptureContext,
} from '../../lib/capture';
import { useEffectiveWindows } from '../../constants/windows';
import { SoftGlow } from '../../components/SoftGlow';
import { MicIcon } from '../../components/MicIcon';
import {
  isCalendarSdkAvailable,
  requestCalendarAccess,
  getDefaultCalendarId,
} from '../../lib/calendar';

// ═════════════════════════════════════════════════════════════════════
// Palette (kept local — onboarding doesn't theme; matches the spec).
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

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// ═════════════════════════════════════════════════════════════════════
// Question data — answers map directly to seed values + reflection lines
// ═════════════════════════════════════════════════════════════════════

interface StruggleDef {
  key: StruggleKey;
  label: string;
  glyph: string;
  /** Reflection line surfaced in step 5 when this struggle is picked. */
  reflect: string;
}

const STRUGGLES: StruggleDef[] = [
  {
    key: 'paralysis',
    label: 'Getting started',
    glyph: '◔',
    reflect:
      "Starting is the hard part for you — so I'll always hand you one small first step, never the whole mountain.",
  },
  {
    key: 'forget',
    label: 'Remembering things',
    glyph: '❉',
    reflect:
      "Things slip your mind — so I'll hold them for you and nudge at the right moment, not before.",
  },
  {
    key: 'follow',
    label: 'Finishing what I begin',
    glyph: '◑',
    reflect:
      "Finishing trips you up — so I'll help you close loops, not just open new ones.",
  },
  {
    key: 'overwhelm',
    label: 'Feeling overwhelmed',
    glyph: '❍',
    reflect:
      "When it piles up it freezes you — so I'll keep your plate light, one thing at a time.",
  },
  {
    key: 'time',
    label: 'Time slipping away',
    glyph: '◴',
    reflect:
      "Time gets away from you — so I'll keep a gentle sense of where you are in the day.",
  },
  {
    key: 'avoid',
    label: 'Staying organized',
    glyph: '◈',
    reflect:
      "Order doesn't come naturally — so I'll do the sorting, and just hand you what's next.",
  },
];

type RhythmKey = 'morning' | 'afternoon' | 'night' | 'varies';
interface RhythmDef {
  key: RhythmKey;
  label: string;
  sub: string;
  glyph: string;
  reflect: string;
  /** Maps to sharp/foggy windows on commit. */
  sharp: EnergyWindowKey | null;
  foggy: EnergyWindowKey | null;
}

const RHYTHMS: RhythmDef[] = [
  {
    key: 'morning',
    label: 'Morning person',
    sub: 'sharp early, fades later',
    glyph: '◔',
    reflect:
      "You're sharpest in the mornings — I'll plan your hardest things for then, and keep afternoons gentle.",
    sharp: 'morning',
    foggy: 'evening',
  },
  {
    key: 'afternoon',
    label: 'Afternoon peak',
    sub: 'slow start, strong midday',
    glyph: '◕',
    reflect:
      "You hit your stride midday — I'll save the heavy lifting for your afternoon peak.",
    sharp: 'afternoon',
    foggy: 'morning',
  },
  {
    key: 'night',
    label: 'Night owl',
    sub: 'come alive in the evening',
    glyph: '●',
    reflect:
      "You come alive at night — I'll let mornings be soft and line up the real work for evening.",
    sharp: 'evening',
    foggy: 'morning',
  },
  {
    key: 'varies',
    label: 'It varies',
    sub: 'different day to day',
    glyph: '◑',
    reflect:
      "Your energy shifts day to day — so I'll read each day as it comes instead of assuming.",
    sharp: null,
    foggy: null,
  },
];

interface AnchorDef {
  key: keyof DailyAnchors;
  label: string;
  glyph: string;
  def: number; // minutes since midnight
}

const ANCHOR_DEFS: AnchorDef[] = [
  { key: 'wake', label: 'Wake', glyph: '☀', def: 7 * 60 },
  { key: 'breakfast', label: 'Breakfast', glyph: '◔', def: 8 * 60 },
  { key: 'lunch', label: 'Lunch', glyph: '◑', def: 12 * 60 + 30 },
  { key: 'dinner', label: 'Dinner', glyph: '◕', def: 18 * 60 + 30 },
  { key: 'sleep', label: 'Sleep', glyph: '☾', def: 22 * 60 + 30 },
];

/** Per-anchor Lumi prompts surfaced when each sub-step appears. */
const ANCHOR_PROMPTS: Record<
  keyof DailyAnchors,
  { title: string; sub: string }
> = {
  wake: {
    title: 'When do you wake up?',
    sub: "I'll plan around this so mornings feel like yours, not someone else's.",
  },
  breakfast: {
    title: "When's breakfast?",
    sub: 'A steady rhythm helps your brain land each day.',
  },
  lunch: {
    title: "When's lunch?",
    sub: "I'll keep your heaviest work away from this break.",
  },
  dinner: {
    title: "When's dinner?",
    sub: 'Knowing this lets me wind down your evening with you.',
  },
  sleep: {
    title: 'When do you head to bed?',
    sub: "I'll start steering you toward rest before then.",
  },
};

/**
 * Cascading bounds — each anchor must come AFTER the one before it
 * (breakfast can't be before wake, lunch before breakfast, etc.) by a
 * small 15-min gap so two anchors don't land on the same minute. There
 * is no upper cap: pick any time you like as long as it's after the
 * previous anchor. Sleep can extend past 24h (up to 6 AM next day) so
 * night-shift / late-night bedtimes still display correctly.
 */
const GAP = 15;
const HARD_MAX = 30 * 60; // 6 AM next day — generous ceiling for sleep
const anchorBounds = (
  key: keyof DailyAnchors,
  anchors: DailyAnchors,
): { min: number; max: number } => {
  switch (key) {
    case 'wake':
      return { min: 0, max: 24 * 60 - 1 };
    case 'breakfast':
      return { min: anchors.wake + GAP, max: HARD_MAX };
    case 'lunch':
      return { min: anchors.breakfast + GAP, max: HARD_MAX };
    case 'dinner':
      return { min: anchors.lunch + GAP, max: HARD_MAX };
    case 'sleep':
      return { min: anchors.dinner + GAP, max: HARD_MAX };
  }
};

/** Clamp an anchor to its bounds against the current anchors map. */
const clampAnchor = (
  key: keyof DailyAnchors,
  anchors: DailyAnchors,
): DailyAnchors => {
  const { min, max } = anchorBounds(key, anchors);
  const v = anchors[key];
  if (v < min) return { ...anchors, [key]: min };
  if (v > max) return { ...anchors, [key]: max };
  return anchors;
};

const fmtTime = (m: number): string => {
  const adj = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(adj / 60);
  const mm = adj % 60;
  const hr = h % 12 || 12;
  return `${hr}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

// ═════════════════════════════════════════════════════════════════════
// Luna — animated cat sprite for onboarding. Reflects the user's
// ambient state (sleep window, recent activity, streak) when no
// mood is explicitly passed. Brand-new users will see 'idle' by
// default (no data yet) and 'sleep' at night — both gentle and
// honest first impressions.
// ═════════════════════════════════════════════════════════════════════
const Luna = ({
  size = 96,
  mood,
}: {
  size?: number;
  mood?: 'idle' | 'happy' | 'sad' | 'sleep';
}) => {
  const ambient = useAmbientLunaMood();
  return (
    <Image
      source={lunaSource(mood ?? ambient)}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
};

// ═════════════════════════════════════════════════════════════════════
// Says — Lumi's voice line (dusk, with a small Luna avatar)
// ═════════════════════════════════════════════════════════════════════
const Says = ({
  children,
  sub,
}: {
  children: React.ReactNode;
  sub?: string;
}) => (
  <View style={styles.says}>
    <View style={styles.saysAvatar}>
      <Luna size={32} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.saysHeadline}>{children}</Text>
      {sub && <Text style={styles.saysSub}>{sub}</Text>}
    </View>
  </View>
);

// ═════════════════════════════════════════════════════════════════════
// ContinueBtn — the user's action (ember)
// ═════════════════════════════════════════════════════════════════════
const ContinueBtn = ({
  onPress,
  disabled,
  label = 'Continue',
}: {
  onPress: () => void;
  disabled?: boolean;
  label?: string;
}) => (
  <Pressable
    onPress={() => {
      if (disabled) return;
      Haptics.selectionAsync();
      onPress();
    }}
    style={[
      styles.continueBtn,
      disabled
        ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.hair }
        : { backgroundColor: C.ember },
    ]}
  >
    <Text
      style={[
        styles.continueBtnText,
        { color: disabled ? C.mute : C.void },
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

// ═════════════════════════════════════════════════════════════════════
// Reflection cards — bespoke per the user's actual answers
// ═════════════════════════════════════════════════════════════════════
interface ReflectionCard {
  glyph: string;
  color: string;
  text: string;
}

const STRUGGLE_PRIORITY: StruggleKey[] = [
  'overwhelm',
  'paralysis',
  'follow',
  'time',
  'forget',
  'avoid',
];

interface Answers {
  struggles: StruggleKey[];
  rhythm: RhythmKey | null;
  dump: string;
  dumpTaskCount: number;
  anchors: DailyAnchors;
}

const reflectionCards = (ans: Answers): ReflectionCard[] => {
  const out: ReflectionCard[] = [];
  // Rhythm
  const r = RHYTHMS.find((x) => x.key === ans.rhythm);
  if (r) out.push({ glyph: r.glyph, color: C.honey, text: r.reflect });
  // Most-telling struggle
  const pick = STRUGGLE_PRIORITY.find((k) => ans.struggles.includes(k));
  const s = STRUGGLES.find((x) => x.key === pick);
  if (s) out.push({ glyph: s.glyph, color: C.dusk, text: s.reflect });
  // Dump count
  if (ans.dumpTaskCount > 0) {
    out.push({
      glyph: '✦',
      color: C.amethyst,
      text: `You gave me ${ans.dumpTaskCount} thing${ans.dumpTaskCount === 1 ? '' : 's'} on your mind — they're already in your pile, sorted and waiting. Your app won't start empty.`,
    });
  }
  // Anchors framing
  out.push({
    glyph: '❖',
    color: C.lichen,
    text: "Your day's framed now — wake, meals, and sleep — so there's always a shape to land in.",
  });
  return out;
};

// ═════════════════════════════════════════════════════════════════════
// Main screen
// ═════════════════════════════════════════════════════════════════════
// 6 steps: intro, struggles, rhythm, brain-dump, anchors, reflection.
// The old step 6 ("OFFER" — forced single-CTA 7-day trial) was removed
// per lumi-monetization-model-spec-2.md: the offer is now a separate
// optional two-button screen at /onboarding/trial-choice, shown after
// onboarding finalizes. Free-first model means no forced trial gate.
// 9 steps: intro, struggles, rhythm, brain-dump, anchors, reflection,
// companion-mode, calendar-connect, widget-intro. The companion-mode
// pick comes after the warm interview; the two "finishing touch"
// screens at the end are skippable opt-ins for power features
// (calendar sync, iOS home-screen widget) so the user isn't forced
// past them but is also shown the door.
const TOTAL_STEPS = 9;

export default function Onboarding() {
  const router = useRouter();
  const completeOnboardingWith = useUserStore(
    (s) => s.completeOnboardingWith,
  );
  const markOnboardedForUser = useUserStore((s) => s.markOnboardedForUser);
  const setCompanionMode = useUserStore((s) => s.setCompanionMode);
  const addQuest = useQuestStore((s) => s.addQuest);
  const { session } = useSession();
  const effectiveWindows = useEffectiveWindows();

  // ── State ────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  // Step 4 (anchors) is split into one sub-screen per anchor so each
  // gets its own Lumi prompt and the user only commits to one time at
  // a time. Cascading constraints enforce the natural order (you can't
  // eat breakfast before you wake, etc.).
  const [anchorIdx, setAnchorIdx] = useState(0);
  const [struggles, setStruggles] = useState<StruggleKey[]>([]);
  const [rhythm, setRhythm] = useState<RhythmKey | null>(null);
  const [dump, setDump] = useState('');
  const [anchors, setAnchors] = useState<DailyAnchors>(
    () =>
      Object.fromEntries(
        ANCHOR_DEFS.map((a) => [a.key, a.def]),
      ) as unknown as DailyAnchors,
  );
  // Companion-mode picker (step 6). Default 'full' so the cozy
  // companion stays the natural choice unless the user dials down.
  // Only 'full' and 'focused' are offered in onboarding; 'minimal'
  // is available later from Profile → Personalize so we don't
  // overwhelm the first-time decision.
  const [companionPick, setCompanionPick] = useState<'full' | 'focused'>(
    'full',
  );
  // Calendar-connect step (7) — single state machine for the button.
  // 'connected' freezes the row to its success state so the user
  // can move on without re-tapping; 'error' shows the iOS error so
  // we can debug if perms misbehave.
  const [calendarStatus, setCalendarStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'skipped' | 'error'
  >('idle');
  const [calendarErrorMsg, setCalendarErrorMsg] = useState<string | null>(
    null,
  );

  // Slide transition between steps (and between anchor sub-steps).
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    slide.setValue(20);
    Animated.timing(slide, {
      toValue: 0,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [step, anchorIdx, slide]);

  // Reflection cards — staggered reveal (step 5 only).
  const [revealed, setRevealed] = useState(0);
  const dumpTaskCount = useMemo(() => {
    const t = dump.trim();
    if (!t) return 0;
    return Math.max(
      1,
      t.split(/[.,\n;]| and | then /i).filter((x) => x.trim().length > 2)
        .length,
    );
  }, [dump]);
  const cards = useMemo(
    () =>
      reflectionCards({
        struggles,
        rhythm,
        dump,
        dumpTaskCount,
        anchors,
      }),
    [struggles, rhythm, dump, dumpTaskCount, anchors],
  );
  useEffect(() => {
    if (step !== 5) {
      setRevealed(0);
      return;
    }
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= cards.length) clearInterval(id);
    }, 560);
    return () => clearInterval(id);
  }, [step, cards.length]);

  // ── Voice for the brain-dump ────────────────────────────────────
  const voice = useVoice();
  const handleMic = useCallback(async () => {
    if (voice.state === 'idle') {
      await voice.start();
    } else if (voice.state === 'recording') {
      const transcript = await voice.stopAndTranscribe();
      if (transcript && transcript.trim()) {
        setDump((d) => (d ? `${d.trim()} ${transcript.trim()}` : transcript.trim()));
      }
    }
  }, [voice]);

  // ── Step navigation ──────────────────────────────────────────────
  const next = () => {
    Haptics.selectionAsync();
    if (step === 4 && anchorIdx < ANCHOR_DEFS.length - 1) {
      // Advance to next anchor sub-step. Snap the next anchor's
      // current value into its bounds against the just-set previous
      // anchor (cascading default — keeps things sensible).
      const nextKey = ANCHOR_DEFS[anchorIdx + 1].key;
      setAnchors((cur) => clampAnchor(nextKey, cur));
      setAnchorIdx((i) => i + 1);
      return;
    }
    if (step === 3) {
      // Entering anchors — reset to the first sub-step.
      setAnchorIdx(0);
    }
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  };
  const back = () => {
    Haptics.selectionAsync();
    if (step === 4 && anchorIdx > 0) {
      setAnchorIdx((i) => i - 1);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  };

  const toggleStruggle = (k: StruggleKey) => {
    Haptics.selectionAsync();
    setStruggles((cur) =>
      cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
    );
  };

  /** Nudge an anchor by +/- minutes, clamped to its cascading bounds. */
  const nudgeAnchor = (
    k: keyof DailyAnchors,
    delta: number,
    silent = false,
  ) => {
    if (!silent) Haptics.selectionAsync();
    setAnchors((cur) => {
      const { min, max } = anchorBounds(k, cur);
      const raw = cur[k] + delta;
      const clamped = Math.max(min, Math.min(max, raw));
      return { ...cur, [k]: clamped };
    });
  };

  // ── Press-and-hold acceleration on the steppers ──────────────────
  // Quick tap = single 15-min nudge. Holding the button ticks rapidly
  // so jumping from e.g. 4 AM to 11 AM doesn't require 28 taps. After
  // 400ms hold we tick every 80ms (3 hours / sec); after 1.4s total
  // we tick every 40ms (6 hours / sec) for the really long jumps.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const fastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupNudge = useCallback(() => {
    if (nudgeTimer.current) {
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = null;
    }
    if (fastTimer.current) {
      clearTimeout(fastTimer.current);
      fastTimer.current = null;
    }
    if (nudgeInterval.current) {
      clearInterval(nudgeInterval.current);
      nudgeInterval.current = null;
    }
  }, []);
  useEffect(() => cleanupNudge, [cleanupNudge]);

  const startNudge = (k: keyof DailyAnchors, delta: number) => {
    cleanupNudge();
    nudgeAnchor(k, delta); // immediate single tick
    nudgeTimer.current = setTimeout(() => {
      nudgeTimer.current = null;
      // Phase 1 — moderate scroll (12 ticks/sec).
      nudgeInterval.current = setInterval(() => nudgeAnchor(k, delta, true), 80);
      fastTimer.current = setTimeout(() => {
        fastTimer.current = null;
        // Phase 2 — fast scroll (25 ticks/sec) for big jumps.
        if (nudgeInterval.current) clearInterval(nudgeInterval.current);
        nudgeInterval.current = setInterval(() => nudgeAnchor(k, delta, true), 40);
      }, 1000);
    }, 400);
  };
  const stopNudge = () => cleanupNudge();

  // ── Calendar connect handler for step 7 ─────────────────────────
  // Same shape as profile.tsx::connectCalendar but inline so we don't
  // have to route the user through Profile during onboarding. Sets
  // calendarEnabled + calendarId + autoSyncTasksWithTimes in one
  // pass so the very first task with a time mirrors to their
  // calendar without another decision.
  const handleConnectCalendarStep = async () => {
    Haptics.selectionAsync();
    setCalendarErrorMsg(null);
    if (!isCalendarSdkAvailable()) {
      setCalendarErrorMsg(
        'Calendar module not in this build — connect later from Profile.',
      );
      setCalendarStatus('error');
      return;
    }
    setCalendarStatus('connecting');
    try {
      const result = await requestCalendarAccess();
      if (!result.ok) {
        if (result.reason === 'denied') {
          setCalendarErrorMsg(
            'Calendar access denied. You can enable it later in Profile → Calendar.',
          );
        } else if (result.reason === 'no-sdk') {
          setCalendarErrorMsg(
            'Calendar module not available in this build.',
          );
        } else {
          setCalendarErrorMsg(`iOS rejected calendar access: ${result.message}`);
        }
        setCalendarStatus('error');
        return;
      }
      const defaultId = await getDefaultCalendarId();
      const u = useUserStore.getState();
      u.setCalendarEnabled(true);
      if (defaultId) u.setCalendarId(defaultId);
      u.setAutoSyncTasksWithTimes(true);
      setCalendarStatus('connected');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[onboarding] connect calendar threw', message);
      setCalendarErrorMsg(message);
      setCalendarStatus('error');
    }
  };
  const skipCalendarStep = () => {
    Haptics.selectionAsync();
    setCalendarStatus('skipped');
    next();
  };

  // ── Final commit — happens on step 8 (widget intro) → "I'm ready" ───
  const finalize = () => {
    const rhythmDef = RHYTHMS.find((r) => r.key === rhythm);
    const sharp = rhythmDef?.sharp ?? null;
    const foggy = rhythmDef?.foggy ?? null;

    // Apply the user's companion-mode pick before completing
    // onboarding so the very first Home render reflects their choice
    // (cozy room + XP visible for 'full', clean organizer for
    // 'focused'). The setter is a single Zustand call — no async.
    setCompanionMode(companionPick);

    completeOnboardingWith({
      struggles,
      sharpWindow: sharp,
      foggyWindow: foggy,
      wakeHour: Math.floor(anchors.wake / 60),
      anchors,
    });
    if (session?.user.id) markOnboardedForUser(session.user.id);

    // Seed the brain-dump as real quests via the shared smart-capture
    // engine so the app isn't empty on day one. (Spec §3 + §8.4.)
    const trimmed = dump.trim();
    if (trimmed) {
      const now = new Date();
      const ctx: CaptureContext = {
        sharpWindow: sharp,
        foggyWindow: foggy,
        peakStart: null,
        peakEnd: null,
        effectiveWindows,
        now,
        nowMin: now.getHours() * 60 + now.getMinutes(),
        wakeMin: anchors.wake,
        sleepMin: anchors.sleep,
      };
      const tasks = parseSmartCapture(trimmed, ctx);
      for (const t of tasks) {
        const hasTime = t.at != null;
        addQuest({
          title: t.title,
          difficulty: difficultyFromImportance(t.importance),
          importance: t.importance,
          window: t.window,
          ...(hasTime && {
            scheduledHour: Math.floor((t.at as number) / 60),
            scheduledMinute: (t.at as number) % 60,
            durationMinutes: 30,
          }),
          ...(t.date && { date: t.date }),
          ...(t.recur && { recur: t.recur }),
        });
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Route straight to the trial-choice screen so the user doesn't
    // flicker through /(tabs) first. The layout would catch this
    // anyway via the !trialChoiceSeen gate; this just keeps the
    // transition clean.
    router.replace('/onboarding/trial-choice' as never);
  };

  // ═════════════════════════════════════════════════════════════════
  // Renders
  // ═════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Ambient glow — soft halo behind the content */}
        <SoftGlow
          color={C.ember}
          opacity={0.1}
          fade={0.65}
          cx={0.5}
          cy={0.1}
          style={styles.ambient}
        />

        {/* Top bar (back + progress) — hidden on welcome */}
        {step > 0 && (
          <View style={styles.topBar}>
            <Pressable onPress={back} style={styles.backBtn} hitSlop={8}>
              <Text style={styles.backGlyph}>‹</Text>
            </Pressable>
            <View style={styles.progressRow}>
              {Array.from({ length: TOTAL_STEPS - 1 }).map((_, i) => {
                // Segment i represents "user has reached step i+1".
                // For the anchors segment (i === 3), partially fill as
                // the user moves through the 5 sub-steps so the bar
                // doesn't look stuck on a single segment for ages.
                let fill = i < step ? 1 : 0;
                if (step === 4 && i === 3) {
                  fill = (anchorIdx + 1) / ANCHOR_DEFS.length;
                }
                return (
                  <View key={i} style={styles.progressSeg}>
                    {fill > 0 && (
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${fill * 100}%` },
                        ]}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <Animated.View
          style={{
            flex: 1,
            transform: [{ translateX: slide }],
          }}
        >
          {/* ── 0 · WELCOME ── */}
          {step === 0 && (
            <View style={[styles.stepWrap, styles.centerWrap]}>
              <View style={styles.welcomeLuna}>
                <SoftGlow
                  color={C.glow}
                  opacity={0.22}
                  fade={0.65}
                  style={styles.welcomeGlow}
                />
                <Luna size={128}/>
              </View>
              <Text style={styles.eyebrowGlow}>Hi, I&apos;m Luna</Text>
              <Text style={styles.welcomeTitle}>
                I&apos;m here to help your brain feel a little lighter.
              </Text>
              <Text style={styles.welcomeBody}>
                Mind if I ask you a few things, so I can get to know you? It
                only takes a minute.
              </Text>
              <View style={{ width: '100%', marginTop: 28 }}>
                <ContinueBtn onPress={next} label="Let's begin →" />
              </View>
              <Text style={styles.welcomeFootnote}>
                No right answers. Nothing you can get wrong.
              </Text>
            </View>
          )}

          {/* ── 1 · STRUGGLES ── */}
          {step === 1 && (
            <View style={styles.stepWrap}>
              <Says sub="Pick as many as feel true — this is just load to help with, never a flaw.">
                What&apos;s hardest for you right now?
              </Says>
              <ScrollView
                contentContainerStyle={{ paddingBottom: 4 }}
                showsVerticalScrollIndicator={false}
              >
                <View style={{ gap: 9 }}>
                  {STRUGGLES.map((s) => {
                    const on = struggles.includes(s.key);
                    return (
                      <Pressable
                        key={s.key}
                        onPress={() => toggleStruggle(s.key)}
                        style={[
                          styles.chipRow,
                          on
                            ? {
                                backgroundColor: hexA(C.ember, 0.12),
                                borderColor: C.ember,
                              }
                            : {
                                backgroundColor: C.void2,
                                borderColor: C.hair,
                              },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipGlyph,
                            { color: on ? C.ember : C.mute },
                          ]}
                        >
                          {s.glyph}
                        </Text>
                        <Text
                          style={[
                            styles.chipLabel,
                            {
                              color: on ? C.bone : C.boneDim,
                              fontFamily: on ? fonts.interSemi : fonts.inter,
                            },
                          ]}
                        >
                          {s.label}
                        </Text>
                        <View
                          style={[
                            styles.chipCheck,
                            on
                              ? { backgroundColor: C.ember, borderColor: C.ember }
                              : { borderColor: C.ash },
                          ]}
                        >
                          {on && <Text style={styles.chipCheckGlyph}>✓</Text>}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={{ marginTop: 18 }}>
                <ContinueBtn
                  onPress={next}
                  disabled={struggles.length === 0}
                  label={
                    struggles.length === 0 ? 'Pick at least one' : 'Continue'
                  }
                />
              </View>
            </View>
          )}

          {/* ── 2 · RHYTHM ── */}
          {step === 2 && (
            <View style={styles.stepWrap}>
              <Says sub="So I can plan your hardest things for your good hours — and keep the foggy ones gentle.">
                When do you feel sharpest?
              </Says>
              <View style={{ gap: 9, flex: 1 }}>
                {RHYTHMS.map((r) => {
                  const on = rhythm === r.key;
                  return (
                    <Pressable
                      key={r.key}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRhythm(r.key);
                      }}
                      style={[
                        styles.chipRow,
                        on
                          ? {
                              backgroundColor: hexA(C.ember, 0.12),
                              borderColor: C.ember,
                            }
                          : {
                              backgroundColor: C.void2,
                              borderColor: C.hair,
                            },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipGlyph,
                          { color: on ? C.ember : C.mute },
                        ]}
                      >
                        {r.glyph}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.chipLabel,
                            {
                              color: on ? C.bone : C.boneDim,
                              fontFamily: on ? fonts.interSemi : fonts.inter,
                            },
                          ]}
                        >
                          {r.label}
                        </Text>
                        <Text style={styles.chipSub}>{r.sub}</Text>
                      </View>
                      <View
                        style={[
                          styles.radioOuter,
                          { borderColor: on ? C.ember : C.ash },
                        ]}
                      >
                        {on && <View style={styles.radioInner} />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ marginTop: 18 }}>
                <ContinueBtn onPress={next} disabled={!rhythm} />
              </View>
            </View>
          )}

          {/* ── 3 · BRAIN-DUMP ── */}
          {step === 3 && (
            <View style={styles.stepWrap}>
              <Says sub="Messy is perfect. Don't sort it — that's my job. Talk it out if that's easier.">
                What&apos;s on your mind right now?
              </Says>
              <View
                style={[
                  styles.dumpBox,
                  voice.state === 'recording' && { borderColor: C.ember },
                ]}
              >
                <TextInput
                  value={dump}
                  onChangeText={setDump}
                  placeholder="the report's due Friday, need to call mom, three emails I keep avoiding, that app idea, mom's birthday coming up…"
                  placeholderTextColor={C.mute}
                  multiline
                  style={styles.dumpInput}
                  editable={voice.state !== 'transcribing'}
                />
                <Pressable
                  onPress={handleMic}
                  style={[
                    styles.micChip,
                    voice.state === 'recording'
                      ? { backgroundColor: C.ember, borderColor: C.ember }
                      : {
                          backgroundColor: hexA(C.ember, 0.12),
                          borderColor: hexA(C.ember, 0.4),
                        },
                  ]}
                >
                  <MicIcon
                    size={15}
                    color={voice.state === 'recording' ? C.void : C.ember}
                  />
                  <Text
                    style={[
                      styles.micLabel,
                      {
                        color:
                          voice.state === 'recording' ? C.void : C.ember,
                      },
                    ]}
                  >
                    {voice.state === 'recording'
                      ? 'listening — tap to stop'
                      : voice.state === 'transcribing'
                        ? 'sorting that out…'
                        : 'or talk it out'}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.dumpFootnote}>
                I&apos;ll turn this into your first sorted pile.
              </Text>
              <View style={{ marginTop: 16 }}>
                <ContinueBtn
                  onPress={next}
                  label={dump.trim() ? 'Continue' : 'Skip for now →'}
                />
              </View>
            </View>
          )}

          {/* ── 4 · ANCHORS ── one at a time, cascading. */}
          {step === 4 && (() => {
            const cur = ANCHOR_DEFS[anchorIdx];
            const v = anchors[cur.key];
            const changed = v !== cur.def;
            const { min, max } = anchorBounds(cur.key, anchors);
            const atMin = v <= min;
            const atMax = v >= max;
            const prompt = ANCHOR_PROMPTS[cur.key];
            const isLast = anchorIdx === ANCHOR_DEFS.length - 1;
            return (
              <View style={styles.stepWrap}>
                <Says sub={prompt.sub}>{prompt.title}</Says>
                <Text style={styles.anchorIndexLabel}>
                  {anchorIdx + 1} of {ANCHOR_DEFS.length} · {cur.label}
                </Text>
                <View style={styles.singleAnchorWrap}>
                  <View style={styles.singleAnchorRow}>
                    <Text style={[styles.anchorGlyph, { color: C.honey }]}>
                      {cur.glyph}
                    </Text>
                    <Text style={styles.anchorLabel}>{cur.label}</Text>
                  </View>
                  <View style={styles.singleAnchorStepperRow}>
                    <Pressable
                      onPressIn={() => !atMin && startNudge(cur.key, -15)}
                      onPressOut={stopNudge}
                      disabled={atMin}
                      style={[
                        styles.anchorStepperBtnLg,
                        atMin && { opacity: 0.35 },
                      ]}
                    >
                      <Text style={styles.anchorStepperGlyphLg}>−</Text>
                    </Pressable>
                    <Text
                      style={[
                        styles.anchorTimeBig,
                        { color: changed ? C.ember : C.bone },
                      ]}
                    >
                      {fmtTime(v)}
                    </Text>
                    <Pressable
                      onPressIn={() => !atMax && startNudge(cur.key, 15)}
                      onPressOut={stopNudge}
                      disabled={atMax}
                      style={[
                        styles.anchorStepperBtnLg,
                        atMax && { opacity: 0.35 },
                      ]}
                    >
                      <Text style={styles.anchorStepperGlyphLg}>+</Text>
                    </Pressable>
                  </View>
                  {anchorIdx > 0 && (
                    <Text style={styles.anchorBoundsHint}>
                      after {ANCHOR_DEFS[anchorIdx - 1].label.toLowerCase()} at{' '}
                      {fmtTime(anchors[ANCHOR_DEFS[anchorIdx - 1].key])}
                    </Text>
                  )}
                </View>
                <View style={{ marginTop: 16 }}>
                  <ContinueBtn
                    onPress={next}
                    label={isLast ? 'That looks right →' : 'Continue'}
                  />
                </View>
              </View>
            );
          })()}

          {/* ── 5 · REFLECTION ── */}
          {step === 5 && (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.stepWrap, { paddingTop: 6 }]}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.reflectionHeader}>
                <View style={styles.reflectionLuna}>
                  <SoftGlow
                    color={C.glow}
                    opacity={0.2}
                    fade={0.65}
                    style={styles.reflectionGlow}
                  />
                  <Luna size={88}/>
                </View>
                <Text style={styles.reflectionEyebrow}>
                  Here&apos;s what I already know
                </Text>
                <Text style={styles.reflectionTitle}>
                  I think I&apos;ve got you.
                </Text>
              </View>
              <View style={{ gap: 10 }}>
                {cards.map((c, i) => (
                  <RevealCard key={i} card={c} shown={i < revealed} />
                ))}
              </View>
              {revealed >= cards.length && (
                <View style={{ marginTop: 24 }}>
                  {/* Advance to the Companion Mode picker (the very
                      last screen). The final finalize() call lives
                      on that screen's CTA so the mode is applied
                      before the user lands in the app. */}
                  <ContinueBtn onPress={next} label="One more thing →" />
                </View>
              )}
            </ScrollView>
          )}

          {/* Step 6 — Companion Mode picker.
              Two presets only (Full + Focused). Minimal is a more
              nuanced mid-point that's available later via
              Profile → Personalize — surfacing three options here
              would overload the first-time decision. */}
          {step === 6 && (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.stepWrap, { paddingTop: 6 }]}
              showsVerticalScrollIndicator={false}
            >
              <Says sub="There’s a cozy side to Lumi — a pixel cat in a little world that grows as you care for yourself. Lovely for some, not for everyone. Your call.">
                How do you want Lumi to feel?
              </Says>

              <View style={{ gap: 12, marginTop: 18 }}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setCompanionPick('full');
                  }}
                  style={[
                    styles.companionCard,
                    companionPick === 'full' && styles.companionCardOn,
                  ]}
                >
                  <View style={styles.companionCardHeader}>
                    <Text style={styles.companionCardGlyph}>◈◈</Text>
                    <Text
                      style={[
                        styles.companionCardTitle,
                        companionPick === 'full' && {
                          color: C.ember,
                        },
                      ]}
                    >
                      A cozy companion
                    </Text>
                    <View
                      style={[
                        styles.companionCardRadio,
                        companionPick === 'full' && {
                          backgroundColor: C.ember,
                          borderColor: C.ember,
                        },
                      ]}
                    >
                      {companionPick === 'full' && (
                        <Text style={styles.companionCardCheck}>✓</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.companionCardBody}>
                    Lumi the pixel cat, a living room that blooms, gentle
                    streaks &amp; little rewards as you go.
                  </Text>
                  <View style={styles.companionTagRow}>
                    {['PIXEL PET', 'STREAKS', 'REWARDS'].map((t) => (
                      <View key={t} style={styles.companionTag}>
                        <Text style={styles.companionTagText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setCompanionPick('focused');
                  }}
                  style={[
                    styles.companionCard,
                    companionPick === 'focused' && styles.companionCardOn,
                  ]}
                >
                  <View style={styles.companionCardHeader}>
                    <Text style={styles.companionCardGlyph}>◷</Text>
                    <Text
                      style={[
                        styles.companionCardTitle,
                        companionPick === 'focused' && {
                          color: C.ember,
                        },
                      ]}
                    >
                      Just the essentials
                    </Text>
                    <View
                      style={[
                        styles.companionCardRadio,
                        companionPick === 'focused' && {
                          backgroundColor: C.ember,
                          borderColor: C.ember,
                        },
                      ]}
                    >
                      {companionPick === 'focused' && (
                        <Text style={styles.companionCardCheck}>✓</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.companionCardBody}>
                    No pet, no points, no streaks. A calm, clean planner
                    and nothing extra.
                  </Text>
                  <View style={styles.companionTagRow}>
                    {['QUIET', 'NO GAME', 'MINIMAL'].map((t) => (
                      <View
                        key={t}
                        style={[
                          styles.companionTag,
                          styles.companionTagMuted,
                        ]}
                      >
                        <Text
                          style={[
                            styles.companionTagText,
                            { color: C.mute },
                          ]}
                        >
                          {t}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Pressable>
              </View>

              <Text style={styles.companionFootHint}>
                You can switch anytime in Settings.
              </Text>

              <View style={{ marginTop: 18 }}>
                <ContinueBtn onPress={next} label="Continue" />
              </View>
            </ScrollView>
          )}

          {/* Step 7 — Calendar connect.
              Optional. Auto-enables sync to the OS default calendar
              when granted; user can change which calendar later from
              Profile. Skip is a first-class action — never punishes
              the user for opting out. */}
          {step === 7 && (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.stepWrap, { paddingTop: 6 }]}
              showsVerticalScrollIndicator={false}
            >
              <Says sub="Tasks with a time can show up in whatever calendar you already use — Apple, Google, Outlook. Off until you say yes.">
                Want Lumi on your calendar?
              </Says>

              <View style={{ gap: 12, marginTop: 18 }}>
                <View
                  style={[
                    styles.companionCard,
                    calendarStatus === 'connected' && {
                      borderColor: C.glow,
                      backgroundColor: hexA(C.glow, 0.08),
                    },
                  ]}
                >
                  <View style={styles.companionCardHeader}>
                    <Text style={styles.companionCardGlyph}>◷</Text>
                    <Text
                      style={[
                        styles.companionCardTitle,
                        calendarStatus === 'connected' && { color: C.glow },
                      ]}
                    >
                      {calendarStatus === 'connected'
                        ? 'Calendar connected'
                        : 'Connect my calendar'}
                    </Text>
                  </View>
                  <Text style={styles.companionCardBody}>
                    {calendarStatus === 'connected'
                      ? 'Tasks with a time will appear alongside the rest of your day.'
                      : 'Lumi will ask iOS for permission and pick your default calendar.'}
                  </Text>
                  {calendarStatus !== 'connected' && (
                    <Pressable
                      onPress={handleConnectCalendarStep}
                      disabled={calendarStatus === 'connecting'}
                      style={[
                        styles.companionTagRow,
                        {
                          marginTop: 14,
                          backgroundColor: C.ember,
                          borderRadius: 10,
                          paddingVertical: 12,
                          paddingHorizontal: 18,
                          alignSelf: 'flex-start',
                          opacity: calendarStatus === 'connecting' ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: C.void,
                          fontFamily: fonts.interSemi,
                          fontSize: 13,
                        }}
                      >
                        {calendarStatus === 'connecting'
                          ? 'Asking iOS…'
                          : 'Connect'}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {calendarErrorMsg && (
                  <Text
                    style={[
                      styles.companionFootHint,
                      { color: '#C97A6E', textAlign: 'left' },
                    ]}
                  >
                    {calendarErrorMsg}
                  </Text>
                )}
              </View>

              <View
                style={{
                  marginTop: 22,
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <Pressable
                  onPress={skipCalendarStep}
                  style={{ paddingVertical: 12, paddingHorizontal: 14 }}
                >
                  <Text
                    style={{
                      color: C.mute,
                      fontFamily: fonts.inter,
                      fontSize: 13,
                    }}
                  >
                    Skip for now
                  </Text>
                </Pressable>
                {(calendarStatus === 'connected' ||
                  calendarStatus === 'error') && (
                  <View style={{ flex: 1 }}>
                    <ContinueBtn onPress={next} label="Continue" />
                  </View>
                )}
              </View>
            </ScrollView>
          )}

          {/* Step 8 — Widget intro.
              Informational only. Shows a mock of the widget + the
              three-step recipe to add it. "I'm ready" finalizes
              onboarding regardless of whether the user actually adds
              it (the widget is opt-in, not a gate). */}
          {step === 8 && (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.stepWrap, { paddingTop: 6 }]}
              showsVerticalScrollIndicator={false}
            >
              <Says sub="Glanceable on your home screen — my mood, plus how many tasks you've done today.">
                Add me to your home screen
              </Says>

              <View style={styles.widgetMockWrap}>
                <View style={styles.widgetMock}>
                  <Image
                    source={lunaSource('idle')}
                    style={styles.widgetMockCat}
                  />
                  <Text style={styles.widgetMockLabel}>Lumi · 3 done</Text>
                </View>
              </View>

              <View style={{ gap: 12, marginTop: 22 }}>
                {[
                  { n: 1, t: 'Long-press any blank spot on your home screen.' },
                  { n: 2, t: 'Tap the + in the top corner, search "Lumi".' },
                  { n: 3, t: 'Pick the small size and add it. You’re set.' },
                ].map((s) => (
                  <View key={s.n} style={styles.widgetStepRow}>
                    <View style={styles.widgetStepBubble}>
                      <Text style={styles.widgetStepNum}>{s.n}</Text>
                    </View>
                    <Text style={styles.widgetStepText}>{s.t}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.companionFootHint}>
                Optional — you can always add me later from your home
                screen.
              </Text>

              <View style={{ marginTop: 18 }}>
                <ContinueBtn onPress={finalize} label="I’m ready" />
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// RevealCard — staggered card with fade + slide
// ═════════════════════════════════════════════════════════════════════
const RevealCard = ({
  card,
  shown,
}: {
  card: ReflectionCard;
  shown: boolean;
}) => {
  const op = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(10)).current;
  useEffect(() => {
    if (!shown) return;
    Animated.parallel([
      Animated.timing(op, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(ty, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [shown, op, ty]);
  return (
    <Animated.View
      style={[
        styles.reflectionCard,
        {
          backgroundColor: hexA(card.color, 0.1),
          borderColor: hexA(card.color, 0.32),
          opacity: op,
          transform: [{ translateY: ty }],
        },
      ]}
    >
      <Text style={[styles.reflectionGlyph, { color: card.color }]}>
        {card.glyph}
      </Text>
      <Text style={styles.reflectionText}>{card.text}</Text>
    </Animated.View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },
  // Container only — SoftGlow paints the actual fade inside.
  ambient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 6,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    fontFamily: fonts.inter,
    fontSize: 17,
    color: C.boneDim,
    lineHeight: 20,
  },
  progressRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
  },
  progressSeg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.hair,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: C.ember,
    borderRadius: 2,
  },

  // ── Step shell ──
  stepWrap: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 22,
  },

  // ── Companion Mode picker (step 6) ──
  companionCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.hair,
    backgroundColor: C.void2,
    padding: 18,
    gap: 10,
  },
  companionCardOn: {
    borderColor: C.ember,
    backgroundColor: hexA(C.ember, 0.08),
  },
  companionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  companionCardGlyph: {
    color: C.ember,
    fontSize: 13,
  },
  companionCardTitle: {
    flex: 1,
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 19,
    color: C.bone,
    letterSpacing: -0.3,
  },
  companionCardRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.boneDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  companionCardCheck: {
    color: C.void,
    fontFamily: fonts.interSemi,
    fontSize: 14,
    lineHeight: 14,
  },
  companionCardBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 19,
  },
  companionTagRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  companionTag: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.45),
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  companionTagMuted: {
    borderColor: hexA(C.bone, 0.18),
  },
  companionTagText: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    color: C.ember,
    letterSpacing: 1,
  },
  companionFootHint: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
    textAlign: 'center',
    marginTop: 22,
  },

  // ── Widget intro (step 8) ──
  widgetMockWrap: {
    alignItems: 'center',
    paddingVertical: 22,
  },
  widgetMock: {
    width: 158,
    height: 158,
    borderRadius: 24,
    backgroundColor: '#141210',
    borderWidth: 1,
    borderColor: hexA('#FFFFFF', 0.06),
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    // Soft outer glow so it reads as "floating on a home screen"
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  widgetMockCat: {
    width: 90,
    height: 90,
    resizeMode: 'contain',
    marginBottom: 6,
  },
  widgetMockLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    color: '#ECE0CB',
    letterSpacing: 0.2,
  },
  widgetStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 4,
  },
  widgetStepBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: hexA(C.ember, 0.14),
    borderWidth: 1,
    borderColor: hexA(C.ember, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  widgetStepNum: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    color: C.ember,
  },
  widgetStepText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.bone,
    lineHeight: 22,
    paddingTop: 3,
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Says ──
  says: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 26,
  },
  saysAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: hexA(C.dusk, 0.12),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  saysHeadline: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  saysSub: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.mute,
    marginTop: 9,
    lineHeight: 19,
    letterSpacing: -0.05,
  },

  // ── Continue button ──
  continueBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 14.5,
    letterSpacing: 0.2,
  },

  // ── Chip rows (struggles + rhythm) ──
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
  },
  chipGlyph: {
    fontSize: 17,
    width: 22,
    textAlign: 'center',
  },
  chipLabel: {
    flex: 1,
    fontSize: 15,
    letterSpacing: -0.15,
  },
  chipSub: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
    marginTop: 2,
  },
  chipCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCheckGlyph: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    color: C.void,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: C.ember,
  },

  // ── Welcome step ──
  welcomeLuna: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  // Container only — SoftGlow paints the actual fade inside.
  welcomeGlow: {
    position: 'absolute',
    width: 240,
    height: 240,
  },
  eyebrowGlow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: C.dusk,
    marginBottom: 14,
  },
  welcomeTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    color: C.bone,
    letterSpacing: -0.6,
    lineHeight: 34,
    textAlign: 'center',
    maxWidth: 320,
  },
  welcomeBody: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.boneDim,
    lineHeight: 22,
    marginTop: 16,
    maxWidth: 280,
    textAlign: 'center',
  },
  welcomeFootnote: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    marginTop: 14,
  },

  // ── Brain-dump step ──
  dumpBox: {
    flex: 1,
    backgroundColor: C.void2,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.hair,
    padding: 16,
    minHeight: 180,
  },
  dumpInput: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 15.5,
    color: C.bone,
    letterSpacing: -0.1,
    lineHeight: 25,
    textAlignVertical: 'top',
  },
  micChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    marginTop: 8,
  },
  micGlyph: {
    fontSize: 15,
  },
  micLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
  },
  dumpFootnote: {
    textAlign: 'center',
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
    marginTop: 12,
  },

  // ── Anchors step ──
  anchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: C.void2,
  },
  anchorGlyph: {
    fontSize: 17,
    width: 24,
    textAlign: 'center',
  },
  anchorLabel: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 15,
    color: C.bone,
    letterSpacing: -0.1,
  },
  anchorStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  anchorStepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorStepperGlyph: {
    fontSize: 17,
    color: C.boneDim,
    lineHeight: 20,
  },
  anchorTime: {
    minWidth: 90,
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 16,
  },

  // ── Single-anchor sub-step layout ──
  anchorIndexLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.mute,
    textAlign: 'center',
    marginBottom: 18,
  },
  singleAnchorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Bias upward into the optical center (~40% from top of available
    // space). True flex center reads as "too low" when a button is
    // pinned to the bottom — paddingBottom shifts the centroid up.
    paddingBottom: 160,
  },
  singleAnchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 28,
  },
  singleAnchorStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  anchorStepperBtnLg: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorStepperGlyphLg: {
    fontFamily: fonts.inter,
    fontSize: 22,
    color: C.boneDim,
    lineHeight: 26,
  },
  anchorTimeBig: {
    minWidth: 140,
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 30,
    letterSpacing: -0.3,
  },
  anchorBoundsHint: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11.5,
    color: C.mute,
    marginTop: 24,
  },

  // ── Reflection step ──
  reflectionHeader: {
    alignItems: 'center',
    marginBottom: 22,
  },
  reflectionLuna: {
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  // Container only — SoftGlow paints the actual fade inside.
  reflectionGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
  },
  reflectionEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: C.glow,
    marginBottom: 8,
  },
  reflectionTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 24,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 29,
    textAlign: 'center',
  },
  reflectionCard: {
    flexDirection: 'row',
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 15,
    borderWidth: 1,
  },
  reflectionGlyph: {
    fontSize: 16,
    marginTop: 1,
  },
  reflectionText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.bone,
    lineHeight: 22,
    letterSpacing: -0.1,
  },

});
