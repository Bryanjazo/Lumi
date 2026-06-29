import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fonts } from '../../constants/fonts';
import { Importance } from '../../constants/importance';
import {
  WINDOWS,
  WIN_ORDER,
  WindowKey,
  useEffectiveWindows,
  deriveWindowFor,
} from '../../constants/windows';
import {
  CADENCES,
  RDAYS,
  RPARTS,
  RecurRule,
  cadenceText,
  type CadenceKey,
  type RecurPart,
  type WeekdayKey,
} from '../../constants/recur';
import { useQuestStore } from '../../store/questStore';
import { useUserStore } from '../../store/userStore';
import { useAccent, accentFor, type Accent } from '../../lib/theme';
import { useVoice, isVoiceConfigured } from '../../lib/voice';
import { HintBanner } from '../../components/HintBanner';
import { MicIcon } from '../../components/MicIcon';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';
// Same brain Home uses — single structured-extraction call so Capture
// produces the same quality tasks (note, importance, duration, recur,
// date inference, brain-dump splitting, etc.) as the in-app quick
// capture flow.
import { llmUnderstand, type UnderstandContext } from '../../lib/anthropic';
import {
  pickWindowForDemand,
  type CaptureContext,
} from '../../lib/capture';
import { useLearningDigest } from '../../lib/learning';
import {
  useCorrectionsStore,
  summarizeCorrections,
} from '../../store/correctionsStore';

// ═════════════════════════════════════════════════════════════════════
// Palette — taken verbatim from lumi-capture (3).jsx
// ═════════════════════════════════════════════════════════════════════
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE3D2',
  boneDim: '#A4978C',
  ember: '#E0764C',
  emberDk: '#9C4E2E',
  emberLt: '#E0A488',
  honey: '#C9A06A',
  lichen: '#9AAE8E',
  dusk: '#8EA0B4',
  amethyst: '#9A85A8',
  line: '#2A2420',
  lineSoft: '#221C18',
  hair: '#2A2420',
  ash: '#5A5650',
  mute: '#7A6E5E',
} as const;

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// ═════════════════════════════════════════════════════════════════════
// Tiers (Home's language) + theme palette
// ═════════════════════════════════════════════════════════════════════
const TIER_META: Record<
  Importance,
  { color: string; label: string; sigil: string; xp: number }
> = {
  // Trial-tier color is the user accent — pulled live in components
  // via useAccent() since module-level can't read hook state. The hex
  // here is the ember default and is overridden at render time.
  high: { color: accentFor('ember').fg, label: 'Trial', sigil: '◆◆◆', xp: 80 },
  medium: { color: C.honey, label: 'Task', sigil: '◆◆', xp: 40 },
  low: { color: C.lichen, label: 'Whim', sigil: '◆', xp: 20 },
};

type ThemeType = 'todo' | 'worry' | 'idea' | 'remember';
const THEMES: Record<ThemeType, { label: string; glyph: string; color: string }> = {
  todo: { label: 'To-dos', glyph: '◆', color: C.honey },
  worry: { label: 'On your mind', glyph: '◷', color: C.dusk },
  idea: { label: 'Ideas', glyph: '✦', color: C.amethyst },
  remember: { label: "Don't forget", glyph: '❉', color: C.lichen },
};

// ═════════════════════════════════════════════════════════════════════
// Sense-making — the LLM extraction pass.
//
// PRIMARY path: a single structured-extraction LLM call (the same
// `llmUnderstand` Home uses for its in-line capture). Produces titles
// with notes, importance, energyDemand, durationMin, recurrence, and
// inferred when (date / time / part-of-day). The brain is identical
// to Home so task quality matches.
//
// FALLBACK path: the local regex parser below (deterministic). Used
// only when llmUnderstand returns null (offline, quota, network
// error). The user still gets tasks — just slightly less smart ones.
//
// Themes (worry / idea / remember) stay locally derived — they're a
// Capture-only UX layer over what isn't actionable, and the LLM
// already returns only the actionable items as tasks.
// ═════════════════════════════════════════════════════════════════════
type DumpTask = {
  id: number;
  text: string;
  imp: Importance;
  energyDemand?: 'high' | 'medium' | 'low';
  win: WindowKey;
  at: number | null;
  /** YYYY-MM-DD when the LLM resolved a specific date. */
  date: string | null;
  recur: RecurRule | null;
  /** Freeform context from the LLM ("bring the charger"). Shown
   *  under the title on Home/Time once committed. */
  note?: string;
  /** Length in minutes — LLM inferred (e.g. "hour long meeting") OR
   *  fallback to an importance-keyed default at commit time. */
  duration?: number;
  tag: string;
};

interface SenseResult {
  lead: string;
  themes: { type: ThemeType; lines: string[] }[];
  tasks: DumpTask[];
}

// ── Fragment splitter shared between the local parser and the
// themes-only post-pass. Lifted out of makeSenseLocal so we can run
// just the theme classifier on the LLM-extracted result.
const splitFragments = (text: string): string[] =>
  text
    .replace(/\n+/g, '. ')
    .split(
      /(?:,? (?:and then|and also|and|then|also|plus|oh|but|so)\b|[.;!?])/i,
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

const deriveTag = (text: string): string => {
  const low = ' ' + text.toLowerCase() + ' ';
  if (/\b(call|email|text|reply|reach)\b/.test(low)) return 'reach out';
  if (/\b(buy|order|pick up|grab|get|store)\b/.test(low)) return 'errand';
  if (/\b(pay|bill|rent|bank)\b/.test(low)) return 'money';
  if (/\b(book|appointment|schedule|dentist|doctor)\b/.test(low)) return 'schedule';
  if (/\b(fix|clean|laundry|home)\b/.test(low)) return 'home';
  return 'task';
};

// Themes (worry / idea / remember) ARE Capture-only — derived locally
// from the raw text by sentiment. Tasks come from the LLM; this just
// surfaces the non-actionable stuff so the user feels heard.
const deriveThemes = (
  text: string,
  taskFragments: Set<string>,
): Record<ThemeType, string[]> => {
  const out: Record<ThemeType, string[]> = {
    todo: [],
    worry: [],
    idea: [],
    remember: [],
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  for (const t of splitFragments(text)) {
    // Skip fragments already represented as tasks by the LLM —
    // otherwise the same line appears as both a To-do and a task chip.
    const norm = t.toLowerCase();
    let inTask = false;
    for (const tf of taskFragments) {
      if (norm.includes(tf) || tf.includes(norm)) {
        inTask = true;
        break;
      }
    }
    if (inTask) continue;
    const low = ' ' + norm + ' ';
    const isWorry =
      /\b(worried|stress|anxious|afraid|nervous|scared|overwhelm|dread|hope|what if|behind|forgot|late|can'?t|struggling|hard|too much)\b/.test(
        low,
      );
    const isIdea =
      /\b(idea|maybe|could|might|want to|thinking about|app|build|design|someday|wish)\b/.test(
        low,
      );
    const isRemember =
      /\b(birthday|anniversary|remember|don'?t forget|appointment|due|deadline|meeting|is on|happening)\b/.test(
        low,
      );
    if (isWorry) out.worry.push(cap(t));
    else if (isIdea) out.idea.push(cap(t));
    else if (isRemember) out.remember.push(cap(t));
  }
  return out;
};

const buildLead = (
  taskCount: number,
  worryCount: number,
): string => {
  if (worryCount >= 2) {
    return 'Sounds like a full head — a few real worries mixed in with the doing.';
  }
  if (taskCount >= 3) return "Mostly action in there — here's the shape of it.";
  return "Here's what I'm hearing, sorted out.";
};

const parseTimeToMin = (hhmm: string | undefined): number | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const recurToRule = (
  r: NonNullable<
    NonNullable<
      import('../../lib/anthropic').UnderstoodTask['when']
    >['recur']
  >,
  fallbackPart: RecurPart,
  atMin: number | null,
): RecurRule => ({
  every: r.every as CadenceKey,
  part: fallbackPart,
  ...(r.day ? { day: r.day as WeekdayKey } : {}),
  ...(r.interval != null ? { interval: r.interval } : {}),
  ...(atMin != null ? { at: atMin } : {}),
});

const importanceDefaultDuration: Record<Importance, number> = {
  high: 60,
  medium: 30,
  low: 15,
};

// ── LLM-powered understanding. Returns null only on hard failure.
//
// Placement logic:
//   1. If the LLM explicitly named a part-of-day, honor it.
//   2. Else if the LLM gave a clock time, derive window from time.
//   3. Else route through the energy-aware placer using importance
//      + energyDemand — never default to 'midday', which would
//      ignore the LLM's energy signal entirely.
const makeSenseLLM = async (
  text: string,
  ctx: UnderstandContext,
  capCtx: CaptureContext,
): Promise<SenseResult | null> => {
  const result = await llmUnderstand(text, ctx);
  if (!result || result.tasks.length === 0) return null;

  const tasks: DumpTask[] = result.tasks.map((u, i) => {
    const atMin = parseTimeToMin(u.when?.time);
    // Pick the window with the right priority — don't fall back
    // to a static 'midday' default, which would ignore the LLM's
    // energy assessment.
    let win: WindowKey;
    let date: string | null = u.when?.date ?? null;
    if (u.when?.part) {
      win = u.when.part as WindowKey;
    } else if (atMin != null) {
      // Time-anchored — derive window from the time.
      const hourOfDay = Math.floor(atMin / 60);
      win =
        hourOfDay < 11
          ? 'morning'
          : hourOfDay < 14
            ? 'midday'
            : hourOfDay < 17
              ? 'afternoon'
              : 'evening';
    } else {
      // Use energyDemand to route — high-demand → peak, low → slump.
      const pick = pickWindowForDemand(u.importance, u.energyDemand, capCtx);
      win = pick.window;
      // Honor the late-night roll so the task lands on tomorrow's
      // actionable window instead of today's already-passed one.
      if (pick.rolledToTomorrow && !date) {
        const r = new Date(capCtx.now);
        r.setDate(r.getDate() + 1);
        date = `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, '0')}-${String(r.getDate()).padStart(2, '0')}`;
      }
    }
    return {
      id: i,
      text: u.title,
      imp: u.importance,
      energyDemand: u.energyDemand,
      win,
      at: atMin,
      date,
      recur: u.when?.recur
        ? recurToRule(u.when.recur, win as RecurPart, atMin)
        : null,
      note: u.note,
      duration: u.when?.durationMin ?? importanceDefaultDuration[u.importance],
      tag: deriveTag(u.title),
    };
  });

  // Theme pass over what the LLM didn't lift into a task.
  const taskFragmentsLower = new Set(
    tasks.map((t) => t.text.toLowerCase()),
  );
  const themes = deriveThemes(text, taskFragmentsLower);
  const order: ThemeType[] = ['todo', 'worry', 'idea', 'remember'];
  const themesOut = order
    .map((k) => ({
      type: k,
      lines: k === 'todo' ? tasks.map((t) => t.text) : themes[k],
    }))
    .filter((t) => t.lines.length > 0);

  return {
    lead: buildLead(tasks.length, themes.worry.length),
    themes: themesOut,
    tasks,
  };
};

// ── Local fallback. Same heuristics as before, kept for offline +
// quota-exhausted cases. The LLM path is preferred.
const makeSenseLocal = (text: string): SenseResult => {
  const raw = splitFragments(text);
  const themes: Record<ThemeType, string[]> = {
    todo: [],
    worry: [],
    idea: [],
    remember: [],
  };
  const tasks: DumpTask[] = [];

  raw.forEach((t) => {
    const low = ' ' + t.toLowerCase() + ' ';
    const isAction =
      /\b(call|email|text|reply|buy|order|pick up|grab|get|pay|book|schedule|fix|clean|send|finish|do|submit|return|cancel|renew|sign|file|make|write|prep)\b/.test(
        low,
      );
    const isWorry =
      /\b(worried|stress|anxious|afraid|nervous|scared|overwhelm|dread|hope|what if|behind|forgot|late|can'?t|struggling|hard|too much)\b/.test(
        low,
      );
    const isIdea =
      /\b(idea|maybe|could|might|want to|thinking about|app|build|design|someday|wish)\b/.test(
        low,
      );
    const isRemember =
      /\b(birthday|anniversary|remember|don'?t forget|appointment|due|deadline|meeting|is on|happening)\b/.test(
        low,
      );

    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    if (isWorry && !isAction) {
      themes.worry.push(cap(t));
      return;
    }
    if (isIdea && !isAction) {
      themes.idea.push(cap(t));
      return;
    }
    if (isRemember && !isAction) {
      themes.remember.push(cap(t));
      return;
    }

    const cleaned = cap(
      t.replace(
        /^(i\s+)?(need to|should|gotta|have to|remember to|don'?t forget to|maybe|oh)\s+/i,
        '',
      ),
    );
    themes.todo.push(cleaned);

    let imp: Importance = 'medium';
    if (/\b(today|asap|urgent|due|deadline|tonight|now|important|by |before|overdue)\b/.test(low)) imp = 'high';
    else if (/\b(someday|maybe|eventually|sometime|could|might)\b/.test(low)) imp = 'low';

    // Default placement routes by importance so the cards naturally
    // SPACE across windows instead of bundling into midday — easy
    // tasks land in slump, hard tasks in peak. Explicit phrasing
    // ("tonight", "morning") still wins.
    let win: WindowKey =
      imp === 'high' ? 'morning' : imp === 'low' ? 'afternoon' : 'midday';
    if (/\b(tonight|evening|dinner|after work)\b/.test(low)) win = 'evening';
    else if (/\b(morning|breakfast|early)\b/.test(low)) win = 'morning';

    tasks.push({
      id: tasks.length,
      text: cleaned,
      imp,
      win,
      at: null,
      date: null,
      recur: null,
      duration: importanceDefaultDuration[imp],
      tag: deriveTag(cleaned),
    });
  });

  const order: ThemeType[] = ['todo', 'worry', 'idea', 'remember'];
  return {
    lead: buildLead(tasks.length, themes.worry.length),
    themes: order
      .map((k) => ({ type: k, lines: themes[k] }))
      .filter((t) => t.lines.length > 0),
    tasks,
  };
};

// ═════════════════════════════════════════════════════════════════════
// Waveform — animated bars during recording
// ═════════════════════════════════════════════════════════════════════
const Waveform = ({ active }: { active: boolean }) => {
  const accent = useAccent();
  const [, force] = useState(0);
  const tRef = useRef(0);
  useEffect(() => {
    if (!active) return;
    let raf: number;
    const tick = () => {
      tRef.current++;
      force((v) => (v + 1) % 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  const t = tRef.current;
  return (
    <View style={styles.waveRow}>
      {Array.from({ length: 22 }).map((_, i) => {
        const h = active
          ? 4 +
            Math.abs(Math.sin(t * 0.12 + i * 0.6)) *
              20 *
              (0.5 + Math.sin(i * 1.3) * 0.5)
          : 3;
        const op = active
          ? 0.5 + Math.abs(Math.sin(t * 0.1 + i)) * 0.5
          : 0.4;
        return (
          <View
            key={i}
            style={{
              width: 3,
              height: h,
              borderRadius: 2,
              backgroundColor: accent.fg,
              opacity: op,
            }}
          />
        );
      })}
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SortSpinner — three concentric rotating rings + ✦
// ═════════════════════════════════════════════════════════════════════
const SortSpinner = () => {
  const rotations = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  useEffect(() => {
    const loops = rotations.map((v, i) =>
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: 2000 + i * 600,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={styles.spinWrap}>
      {rotations.map((v, i) => {
        const size = 80 - i * 20;
        const op = 0.5 - i * 0.13;
        const rot = v.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '360deg'],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.spinRing,
              {
                width: size,
                height: size,
                opacity: op,
                transform: [{ rotate: rot }],
                top: (80 - size) / 2,
                left: (80 - size) / 2,
              },
            ]}
          />
        );
      })}
      <Text style={styles.spinSpark}>✦</Text>
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// MicButton — large center action
// ═════════════════════════════════════════════════════════════════════
const MicButton = ({
  state,
  onPress,
  disabled,
}: {
  state: 'idle' | 'recording' | 'transcribing';
  onPress: () => void;
  disabled?: boolean;
}) => {
  const accent = useAccent();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
    return undefined;
  }, [state, pulse]);

  const recording = state === 'recording';
  return (
    <View style={styles.micCenterWrap}>
      {recording && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.micRing,
            {
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.6, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.5],
                  }),
                },
              ],
            },
          ]}
        />
      )}
      <Pressable
        onPress={onPress}
        disabled={disabled || state === 'transcribing'}
        style={[
          styles.micBig,
          recording && styles.micBigRec,
          disabled && { opacity: 0.4 },
        ]}
      >
        {state === 'transcribing' ? (
          <ActivityIndicator size="small" color={accent.fg} />
        ) : recording ? (
          // Clean stop indicator — a soft rounded square on the dark
          // void color so it reads crisp against the ember fill. The
          // iOS ⏸ emoji is plasticky and inconsistent with the rest
          // of Lumi's drawn-line iconography; this matches Voice
          // Memos / iMessage stop visuals.
          <View style={styles.micStopShape} />
        ) : (
          <MicIcon size={36} color={accent.fg} strokeWidth={1.9} />
        )}
      </Pressable>
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SettingRow — collapsible composer row (matches Home)
// ═════════════════════════════════════════════════════════════════════
const SettingRow = ({
  label,
  value,
  valueColor,
  icon,
  disabled,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  valueColor?: string;
  icon?: string;
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) => (
  <View style={styles.sRowWrap}>
    <Pressable
      onPress={disabled ? undefined : onToggle}
      style={[styles.sRow, disabled && { opacity: 0.45 }]}
    >
      <Text style={styles.sRowLabel}>{label}</Text>
      <View style={styles.sRowRight}>
        {icon ? <Text style={styles.sRowIcon}>{icon}</Text> : null}
        <Text style={[styles.sRowValue, { color: valueColor ?? C.bone }]}>
          {value}
        </Text>
        {!disabled && (
          <Text
            style={[
              styles.sRowChev,
              open && { transform: [{ rotate: '180deg' }] },
            ]}
          >
            ▾
          </Text>
        )}
      </View>
    </Pressable>
    {open && !disabled && <View style={styles.sRowBody}>{children}</View>}
  </View>
);

// ═════════════════════════════════════════════════════════════════════
// TaskCard — Home-grade controls, no swipe
// ═════════════════════════════════════════════════════════════════════
type Decision = 'quest' | 'later' | 'toss';
const TIME_PRESETS: { lbl: string; val: number }[] = [
  { lbl: '9a', val: 540 },
  { lbl: '12p', val: 720 },
  { lbl: '3p', val: 900 },
  { lbl: '6p', val: 1080 },
  { lbl: '9p', val: 1260 },
];

const TaskCard = ({
  task,
  state,
  onUpdate,
  onDecide,
}: {
  task: DumpTask;
  state?: Decision;
  onUpdate: (patch: Partial<DumpTask>) => void;
  onDecide: (d: Decision | undefined) => void;
}) => {
  const accent = useAccent();
  const effectiveWindows = useEffectiveWindows();
  const [pane, setPane] = useState<'diff' | 'when' | 'repeat' | null>(null);
  const T = TIER_META[task.imp];
  const W = WINDOWS[task.win];

  const decided = !!state;
  const tossed = state === 'toss';
  const stripeColor =
    state === 'quest' ? accent.fg : state === 'later' ? C.honey : null;

  return (
    <View
      style={[
        styles.taskCard,
        {
          borderColor:
            decided && state !== 'toss' ? `${T.color}44` : C.line,
          opacity: tossed ? 0.4 : 1,
        },
      ]}
    >
      {stripeColor && (
        <View style={[styles.taskStripe, { backgroundColor: stripeColor }]} />
      )}

      <View style={styles.taskHead}>
        <View style={styles.tagPill}>
          <Text style={styles.tagPillText}>{task.tag}</Text>
        </View>
        <View style={styles.taskHeadRight}>
          <Text style={[styles.tierSigil, { color: T.color }]}>{T.sigil}</Text>
          <Text style={[styles.tierXp, { color: T.color }]}>+{T.xp}</Text>
        </View>
      </View>

      <Text
        style={[
          styles.taskText,
          tossed && {
            textDecorationLine: 'line-through',
            textDecorationColor: C.mute,
          },
        ]}
      >
        {task.text}
      </Text>

      {decided ? (
        <Pressable onPress={() => onDecide(undefined)} style={{ marginTop: 8 }}>
          <Text
            style={[
              styles.decidedLine,
              {
                color:
                  state === 'quest'
                    ? accent.fg
                    : state === 'later'
                      ? C.honey
                      : C.mute,
              },
            ]}
          >
            {state === 'quest'
              ? '✓ kept as a quest'
              : state === 'later'
                ? '✓ saved for someday'
                : 'tossed'}{' '}
            · undo
          </Text>
        </Pressable>
      ) : (
        <View style={{ marginTop: 13 }}>
          {/* Difficulty */}
          <SettingRow
            label="Difficulty"
            value={T.label}
            valueColor={T.color}
            open={pane === 'diff'}
            onToggle={() => setPane(pane === 'diff' ? null : 'diff')}
          >
            <View style={styles.diffRow}>
              {(Object.entries(TIER_META) as [Importance, typeof T][]).map(
                ([k, v]) => {
                  const sel = task.imp === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => {
                        Haptics.selectionAsync();
                        onUpdate({ imp: k });
                      }}
                      style={[
                        styles.diffChip,
                        {
                          backgroundColor: sel
                            ? `${v.color}1a`
                            : 'transparent',
                          borderColor: sel ? v.color : C.hair,
                        },
                      ]}
                    >
                      <Text style={[styles.tierSigil, { color: v.color }]}>
                        {v.sigil}
                      </Text>
                      <Text
                        style={[
                          styles.diffLabel,
                          { color: sel ? v.color : C.boneDim },
                        ]}
                      >
                        {v.label}
                      </Text>
                    </Pressable>
                  );
                },
              )}
            </View>
          </SettingRow>

          {/* When */}
          <SettingRow
            label="When"
            value={
              task.recur
                ? '—'
                : task.at != null
                  ? `${Math.floor(task.at / 60) % 12 || 12}:${String(task.at % 60).padStart(2, '0')}${task.at < 720 ? 'am' : 'pm'}`
                  : W.label
            }
            valueColor={
              task.recur ? C.ash : task.at != null ? accent.fg : W.color
            }
            disabled={!!task.recur}
            open={pane === 'when'}
            onToggle={() => setPane(pane === 'when' ? null : 'when')}
          >
            <View style={styles.modeToggle}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onUpdate({ at: null });
                }}
                style={[
                  styles.modeOption,
                  task.at == null && styles.modeOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeOptionText,
                    task.at == null && { color: C.void },
                  ]}
                >
                  Window
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  if (task.at == null) onUpdate({ at: 15 * 60 });
                }}
                style={[
                  styles.modeOption,
                  task.at != null && styles.modeOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeOptionText,
                    task.at != null && { color: C.void },
                  ]}
                >
                  Exact time
                </Text>
              </Pressable>
            </View>

            {task.at == null ? (
              <View style={styles.winChipRow}>
                {WIN_ORDER.map((wk) => {
                  const ww = WINDOWS[wk];
                  const sel = task.win === wk;
                  return (
                    <Pressable
                      key={wk}
                      onPress={() => {
                        Haptics.selectionAsync();
                        onUpdate({ win: wk });
                      }}
                      style={[
                        styles.winChip,
                        {
                          backgroundColor: sel
                            ? `${ww.color}1a`
                            : 'transparent',
                          borderColor: sel ? ww.color : C.hair,
                        },
                      ]}
                    >
                      <Text style={[styles.winGlyph, { color: ww.color }]}>
                        {ww.glyph}
                      </Text>
                      <Text
                        style={[
                          styles.winLabel,
                          { color: sel ? ww.color : C.boneDim },
                        ]}
                      >
                        {ww.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View>
                <View style={styles.stepperRow}>
                  <Pressable
                    onPress={() =>
                      onUpdate({ at: Math.max(0, (task.at ?? 900) - 15) })
                    }
                    style={styles.stepperBtn}
                  >
                    <Text style={styles.stepperBtnText}>−</Text>
                  </Pressable>
                  <View style={{ alignItems: 'center', minWidth: 96 }}>
                    <Text style={styles.stepperBig}>
                      {Math.floor((task.at ?? 900) / 60) % 12 || 12}:
                      {String((task.at ?? 900) % 60).padStart(2, '0')}
                      <Text style={styles.stepperAmPm}>
                        {(task.at ?? 900) < 720 ? ' am' : ' pm'}
                      </Text>
                    </Text>
                    <Text
                      style={[
                        styles.stepperWinHint,
                        { color: WINDOWS[deriveWindowFor(effectiveWindows, task.at ?? 900)].color },
                      ]}
                    >
                      {WINDOWS[deriveWindowFor(effectiveWindows, task.at ?? 900)].glyph} falls in{' '}
                      {WINDOWS[
                        deriveWindowFor(effectiveWindows, task.at ?? 900)
                      ].label.toLowerCase()}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() =>
                      onUpdate({ at: Math.min(1425, (task.at ?? 900) + 15) })
                    }
                    style={styles.stepperBtn}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </Pressable>
                </View>
                <View style={styles.presetRow}>
                  {TIME_PRESETS.map((p) => {
                    const sel = task.at === p.val;
                    return (
                      <Pressable
                        key={p.val}
                        onPress={() => {
                          Haptics.selectionAsync();
                          onUpdate({ at: p.val });
                        }}
                        style={[
                          styles.presetChip,
                          {
                            backgroundColor: sel
                              ? `${accent.fg}1a`
                              : 'transparent',
                            borderColor: sel ? accent.fg : C.hair,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.presetText,
                            { color: sel ? accent.fg : C.boneDim },
                          ]}
                        >
                          {p.lbl}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </SettingRow>

          {/* Repeat */}
          <SettingRow
            label="Repeat"
            value={task.recur ? cadenceText(task.recur) : 'Never'}
            valueColor={task.recur ? C.dusk : C.boneDim}
            icon={task.recur ? '🔁' : undefined}
            open={pane === 'repeat'}
            onToggle={() => setPane(pane === 'repeat' ? null : 'repeat')}
          >
            <View
              style={[
                styles.cadenceRow,
                { marginBottom: task.recur ? 12 : 0 },
              ]}
            >
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onUpdate({ recur: null });
                }}
                style={[
                  styles.recurChip,
                  {
                    backgroundColor: !task.recur
                      ? `${C.dusk}22`
                      : 'transparent',
                    borderColor: !task.recur ? C.dusk : C.hair,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.recurChipText,
                    { color: !task.recur ? C.dusk : C.boneDim },
                  ]}
                >
                  Never
                </Text>
              </Pressable>
              {CADENCES.map((c) => {
                const sel = task.recur?.every === c.key;
                const fallbackPart: RecurPart =
                  task.win === 'someday' ? 'morning' : (task.win as RecurPart);
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      onUpdate({
                        recur: {
                          every: c.key as CadenceKey,
                          day: task.recur?.day ?? 'Mon',
                          part: task.recur?.part ?? fallbackPart,
                        },
                      });
                    }}
                    style={[
                      styles.recurChip,
                      {
                        backgroundColor: sel ? `${C.dusk}22` : 'transparent',
                        borderColor: sel ? C.dusk : C.hair,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.recurChipText,
                        { color: sel ? C.dusk : C.boneDim },
                      ]}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {task.recur &&
              (task.recur.every === 'week' || task.recur.every === '2week') && (
                <View style={styles.dayPickRow}>
                  {RDAYS.map((d) => {
                    const sel = task.recur?.day === d;
                    return (
                      <Pressable
                        key={d}
                        onPress={() => {
                          Haptics.selectionAsync();
                          onUpdate({
                            recur: task.recur
                              ? { ...task.recur, day: d as WeekdayKey }
                              : task.recur,
                          });
                        }}
                        style={[
                          styles.dayPickPill,
                          {
                            backgroundColor: sel ? C.dusk : 'transparent',
                            borderColor: sel ? C.dusk : C.hair,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayPickText,
                            { color: sel ? C.void : C.mute },
                          ]}
                        >
                          {d[0]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

            {task.recur && (
              <View style={styles.partPickRow}>
                {RPARTS.map((pt) => {
                  const sel = task.recur?.part === pt;
                  return (
                    <Pressable
                      key={pt}
                      onPress={() => {
                        Haptics.selectionAsync();
                        onUpdate({
                          recur: task.recur
                            ? { ...task.recur, part: pt }
                            : task.recur,
                        });
                      }}
                      style={[
                        styles.partPickPill,
                        {
                          backgroundColor: sel ? `${C.dusk}1f` : 'transparent',
                          borderColor: sel ? C.dusk : C.hair,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.partPickText,
                          { color: sel ? C.dusk : C.mute },
                        ]}
                      >
                        {pt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </SettingRow>

          {/* Decide */}
          <View style={styles.decideRow}>
            <Pressable
              onPress={() => onDecide('toss')}
              style={[styles.decideBtn, styles.decideToss]}
            >
              <Text style={styles.decideTossText}>Toss</Text>
            </Pressable>
            <Pressable
              onPress={() => onDecide('later')}
              style={[styles.decideBtn, styles.decideLater]}
            >
              <Text style={styles.decideLaterText}>Someday</Text>
            </Pressable>
            <Pressable
              onPress={() => onDecide('quest')}
              style={[styles.decideBtn, styles.decideKeep]}
            >
              <Text style={styles.decideKeepText}>Keep →</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════
type Phase = 'dump' | 'thinking' | 'sense';
const DRAFT_KEY = 'lumi.capture.draft';

export default function CaptureScreen() {
  const router = useRouter();
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('dump');
  const [result, setResult] = useState<SenseResult | null>(null);
  const [tasks, setTasks] = useState<DumpTask[]>([]);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  // Snapshot of what the LLM originally returned, by task id. When
  // the user keeps a task that's been edited (title / window /
  // importance / window), we diff against this snapshot and write
  // a correction so the LLM learns the user's preferences. Same
  // pattern Home uses on its preview edits.
  const [originals, setOriginals] = useState<Map<number, DumpTask>>(
    new Map(),
  );

  const voice = useVoice();
  const addQuest = useQuestStore((s) => s.addQuest);
  const addXp = useUserStore((s) => s.addXp);
  const registerActivity = useUserStore((s) => s.registerActivity);

  // Context the LLM needs to read time/energy/anchors correctly —
  // built the same way Home builds it so capture quality matches.
  const userName = useUserStore((s) => s.name);
  const sharpWindow = useUserStore((s) => s.sharpWindow);
  const foggyWindow = useUserStore((s) => s.foggyWindow);
  const struggles = useUserStore((s) => s.struggles);
  const anchors = useUserStore((s) => s.anchors);
  const quests = useQuestStore((s) => s.quests);
  const digest = useLearningDigest();
  const recentCorrections = useCorrectionsStore((s) => s.recent);
  const recordCorrection = useCorrectionsStore((s) => s.record);
  // Window helper needed for the energy-aware placement context.
  const effectiveWindows = useEffectiveWindows();

  // Persist draft — losing a half-typed dump is the worst failure here.
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then((d) => {
      if (d) setText(d);
    });
  }, []);
  useEffect(() => {
    if (phase === 'dump') {
      AsyncStorage.setItem(DRAFT_KEY, text).catch(() => {});
    }
  }, [text, phase]);

  useEffect(() => {
    if (voice.error) Alert.alert('Voice', voice.error);
  }, [voice.error]);

  const wordCount = useMemo(
    () => (text.trim() ? text.trim().split(/\s+/).length : 0),
    [text],
  );

  const recording = voice.state === 'recording';
  const transcribing = voice.state === 'transcribing';

  const handleMic = useCallback(async () => {
    if (voice.state === 'idle') {
      // Two-stage feedback so the mic feels mechanical and decisive:
      //   1. Heavy impact = "the button took my tap"
      //   2. Success notification = "recording is now live"
      // Combined on iOS they're audibly distinct enough that the
      // user gets both a tactile click and the subtle "mic is hot"
      // confirmation without needing a real audio asset.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await voice.start();
      if (voice.state !== 'idle') {
        // start() succeeded — confirm with a notification haptic
        // that has a different texture than the press itself.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } else if (recording) {
      // Stop tap — a single medium impact, distinct from the heavy
      // start tap. User feels the difference between "starting" and
      // "stopping."
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const t = await voice.stopAndTranscribe();
      if (t) setText((cur) => (cur.trim() ? cur + ' ' + t : t));
    }
  }, [voice, recording]);

  // ── Same UnderstandContext builder Home uses, so the LLM gets
  // identical signal (now-time, energy curves, anchors, struggles,
  // recent corrections, user name). Without this, Capture's tasks
  // would feel dumber than Home's even on the same prompt.
  const buildUnderstandCtx = (): UnderstandContext => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayISO = `${y}-${m}-${d}`;
    const dow = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ][now.getDay()];
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const fmtAnchor = (mins: number) => {
      const h = Math.floor(mins / 60);
      const mn = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
    };
    return {
      nowLabel: `${dow}, ${todayISO} ${hh}:${mm}`,
      todayISO,
      sharpWindow,
      foggyWindow,
      peakRange:
        digest.curve.peakStart != null && digest.curve.peakEnd != null
          ? `${fmtAnchor(digest.curve.peakStart)}–${fmtAnchor(digest.curve.peakEnd)}`
          : null,
      slumpRange:
        digest.curve.slumpStart != null && digest.curve.slumpEnd != null
          ? `${fmtAnchor(digest.curve.slumpStart)}–${fmtAnchor(digest.curve.slumpEnd)}`
          : null,
      curveTrusted: quests.filter((q) => q.completed).length >= 14,
      anchors: {
        wake: fmtAnchor(anchors.wake),
        breakfast: fmtAnchor(anchors.breakfast),
        lunch: fmtAnchor(anchors.lunch),
        dinner: fmtAnchor(anchors.dinner),
        sleep: fmtAnchor(anchors.sleep),
      },
      struggles: struggles.slice(0, 3),
      recentCorrections: summarizeCorrections(recentCorrections(6)),
      userName: userName.trim() || undefined,
    };
  };

  const go = async () => {
    const raw = text.trim();
    if (!raw) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhase('thinking');

    // Build the CaptureContext (same shape Home uses) so the LLM's
    // energyDemand can route through the energy-aware placer when
    // no explicit part-of-day was named.
    const nowRef = new Date();
    const capCtx: CaptureContext = {
      sharpWindow,
      foggyWindow,
      peakStart: digest.curve.peakStart,
      peakEnd: digest.curve.peakEnd,
      slumpStart: digest.curve.slumpStart,
      slumpEnd: digest.curve.slumpEnd,
      effectiveWindows,
      now: nowRef,
      nowMin: nowRef.getHours() * 60 + nowRef.getMinutes(),
      wakeMin: anchors.wake,
      sleepMin: anchors.sleep,
    };

    // Race the LLM call against a min spinner duration so the
    // "thinking" animation never flashes (under ~900ms feels
    // glitchy). The LLM usually returns in 1.2–2.5s; we wait at
    // least that long unless the call resolves fast.
    const llmPromise = makeSenseLLM(raw, buildUnderstandCtx(), capCtx);
    const minDelay = new Promise<void>((res) => setTimeout(res, 900));
    const [llmResult] = await Promise.all([llmPromise, minDelay]);

    // Prefer the LLM result. If it failed (offline, quota, network),
    // fall back to the local heuristic so the user still gets tasks
    // — just less smart ones. Either way they reach the same
    // sense-making UI.
    const r = llmResult ?? makeSenseLocal(raw);
    setResult(r);
    setTasks(r.tasks);
    // Snapshot the LLM's originals so we can diff against any user
    // tweaks at commit time and persist the corrections.
    setOriginals(new Map(r.tasks.map((t) => [t.id, { ...t }])));
    setDecisions({});
    setPhase('sense');
  };

  const reset = () => {
    setText('');
    setPhase('dump');
    setResult(null);
    setTasks([]);
    setDecisions({});
    AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
  };

  const updateTask = (id: number, patch: Partial<DumpTask>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const decide = (id: number, d: Decision | undefined) => {
    Haptics.selectionAsync();
    setDecisions((prev) => {
      const next = { ...prev };
      if (d === undefined) delete next[id];
      else next[id] = d;
      return next;
    });
    if (d === 'quest' || d === 'later') {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      // Same commit shape Home uses — note, duration, date, and
      // scheduledMinute all flow through so Capture-created tasks
      // are indistinguishable from Home-created ones.
      const difficulty =
        task.imp === 'high'
          ? 'hard'
          : task.imp === 'medium'
            ? 'medium'
            : 'easy';
      const effectiveDuration =
        task.duration ?? importanceDefaultDuration[task.imp];
      if (task.recur) {
        addQuest({
          title: task.text,
          difficulty,
          importance: task.imp,
          window: task.recur.part,
          recur: task.recur,
          durationMinutes: effectiveDuration,
          ...(task.note ? { note: task.note } : {}),
        });
      } else if (task.at != null) {
        const h = Math.floor(task.at / 60);
        const m = task.at % 60;
        addQuest({
          title: task.text,
          difficulty,
          importance: task.imp,
          scheduledHour: h,
          scheduledMinute: m,
          durationMinutes: effectiveDuration,
          ...(task.date ? { date: task.date } : {}),
          ...(task.note ? { note: task.note } : {}),
        });
      } else {
        addQuest({
          title: task.text,
          difficulty,
          importance: task.imp,
          window: d === 'later' ? 'someday' : task.win,
          durationMinutes: effectiveDuration,
          ...(task.date ? { date: task.date } : {}),
          ...(task.note ? { note: task.note } : {}),
        });
      }
      addXp(5);
      registerActivity();

      // ── Feed the learning loop ──
      //
      //  Diff the committed task against the LLM's original snapshot.
      //  Any field the user changed (title, importance, window) gets
      //  written as a correction so future LLM calls see this pattern
      //  in recentCorrections context — same mechanism Home uses.
      const orig = originals.get(id);
      if (orig) {
        const delta: Parameters<typeof recordCorrection>[0]['delta'] = {};
        if (orig.text !== task.text) {
          delta.title = { from: orig.text, to: task.text };
        }
        if (orig.imp !== task.imp) {
          delta.importance = { from: orig.imp, to: task.imp };
        }
        if (orig.win !== task.win) {
          delta.window = { from: orig.win, to: task.win };
        }
        if (Object.keys(delta).length > 0) {
          recordCorrection({
            date: new Date().toISOString().slice(0, 10),
            raw: text || orig.text,
            delta,
          });
        }
      }
    }
  };

  const decidedCount = Object.keys(decisions).length;
  const keptCount = Object.values(decisions).filter(
    (d) => d === 'quest' || d === 'later',
  ).length;
  const allDone = tasks.length > 0 && decidedCount >= tasks.length;

  // Bulk action: one-tap accept every still-undecided task as a
  // quest. Skips already-decided rows so re-tapping doesn't double-
  // process them. Strong success haptic so the user feels the
  // commit weight without us having to animate every card.
  const acceptAll = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    for (const t of tasks) {
      if (decisions[t.id] === undefined) decide(t.id, 'quest');
    }
  };

  const goHome = () => {
    reset();
    router.push('/');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>Capture</Text>
        {phase === 'dump' && wordCount > 0 && (
          <Text style={styles.headerStat}>{wordCount} words out</Text>
        )}
        {phase === 'sense' && (
          <Pressable onPress={reset}>
            <Text style={styles.headerLink}>start over</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
      </View>
      {/* First-visit hint (architecture §6.2). Persists once dismissed. */}
      <HintBanner hintKey="capture-first">
        Dump everything — messy is fine. I&apos;ll group it into themes and
        pull out the doable parts.
      </HintBanner>

      {/* ── DUMP ── */}
      {phase === 'dump' && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          {/* Tap the intro text / above the field to dismiss the
              keyboard. iOS multiline TextInputs can't be dismissed
              with the Return key (it inserts a newline instead), so
              we make the surrounding chrome tap-to-dismiss. */}
          <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
            <View style={styles.dumpIntro}>
              <Text style={styles.h1}>What&apos;s in your head?</Text>
              <Text style={styles.intro}>
                Say it all, messy is fine. I&apos;ll make sense of it for you.
              </Text>
              <Text style={styles.dismissHint}>
                Tap here or below to close the keyboard.
              </Text>
            </View>
          </TouchableWithoutFeedback>

          {/* Big open field — flexes to fill most of the screen */}
          <View style={styles.fieldWrap}>
            <View
              style={[
                styles.field,
                { borderColor: recording ? accent.fg : C.line },
              ]}
            >
              {/* While recording, we show the LIVE partial transcript
                  appended to whatever the user had typed, in a
                  read-only Text overlay. When they stop, the final
                  transcript replaces this and gets committed to
                  `text`. This keeps the user oriented as they speak
                  ("did it hear that?") without having to wait for
                  the end. */}
              {recording ? (
                <View style={styles.fieldInput}>
                  {text.trim().length > 0 && (
                    <Text style={styles.partialFinal}>{text} </Text>
                  )}
                  <Text style={styles.partialLive}>
                    {voice.partial || 'listening…'}
                  </Text>
                </View>
              ) : (
                <TextInput
                  value={text}
                  onChangeText={setText}
                  autoFocus
                  placeholder="i'm kind of behind on the report and it's stressing me out, also need to call the dentist, oh and buy coffee, i keep thinking about that app idea, mom's birthday is coming up don't forget…"
                  placeholderTextColor={C.mute}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  style={styles.fieldInput}
                />
              )}
              {recording && <Waveform active />}
            </View>
          </View>

          {/* Mic + CTA — wrapped so tapping the surrounding chrome
              also dismisses the keyboard. */}
          <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
            <View style={styles.micArea}>
              <MicButton
                state={voice.state}
                onPress={() => {
                  Keyboard.dismiss();
                  handleMic();
                }}
                disabled={!isVoiceConfigured}
              />
            <Text
              style={[
                styles.micCaption,
                recording && { color: accent.fg, fontFamily: fonts.interSemi },
              ]}
            >
              {transcribing
                ? 'reading what you said…'
                : recording
                  ? 'listening — tap to stop'
                  : isVoiceConfigured
                    ? 'tap to talk it all out'
                    : 'type your dump above'}
            </Text>
            {wordCount > 0 && (
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  go();
                }}
                style={styles.makeSenseBtn}
              >
                <Text style={styles.makeSenseBtnText}>Make sense of this →</Text>
              </Pressable>
            )}
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      )}

      {/* ── THINKING ── */}
      {phase === 'thinking' && (
        <View style={styles.thinkingWrap}>
          <SortSpinner />
          <Text style={styles.thinkingH1}>Making sense of it…</Text>
          <Text style={styles.thinkingSub}>
            reading what you said, finding the threads
          </Text>
        </View>
      )}

      {/* ── SENSE ── */}
      {phase === 'sense' && result && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: FLOATING_NAV_CLEARANCE }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Lead */}
          <View style={styles.senseLeadWrap}>
            <View style={styles.senseEyebrowRow}>
              <Text style={styles.senseSpark}>✦</Text>
              <Text style={styles.senseEyebrow}>here&apos;s what I heard</Text>
            </View>
            <Text style={styles.senseLead}>{result.lead}</Text>
          </View>

          {/* Themed summary — the hero */}
          <View style={{ paddingHorizontal: 24, paddingTop: 14 }}>
            {result.themes.map((th) => {
              const T = THEMES[th.type];
              return (
                <View key={th.type} style={{ marginBottom: 18 }}>
                  <View style={styles.themeHeadRow}>
                    <Text style={[styles.themeGlyph, { color: T.color }]}>
                      {T.glyph}
                    </Text>
                    <Text style={[styles.themeLabel, { color: T.color }]}>
                      {T.label}
                    </Text>
                    <Text style={styles.themeCount}>· {th.lines.length}</Text>
                  </View>
                  <View
                    style={[
                      styles.themeBody,
                      { borderLeftColor: `${T.color}44` },
                    ]}
                  >
                    {th.lines.map((ln, i) => (
                      <Text key={i} style={styles.themeLine}>
                        {ln}
                      </Text>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Task list — grouped by window so high-energy stuff lands
              in peak slots and easy lifts go to the slump. Visual
              section headers + an "Accept all" bulk action keep the
              review surface from feeling like one long pile. */}
          {tasks.length > 0 && (
            <View style={styles.tasksOuter}>
              <View style={styles.tasksDivider} />
              <View style={styles.tasksTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tasksH1}>
                    {allDone
                      ? 'All sorted.'
                      : `Found ${tasks.length} thing${tasks.length === 1 ? '' : 's'} to do`}
                  </Text>
                  {!allDone && (
                    <Text style={styles.tasksHint}>
                      {decidedCount > 0
                        ? `${decidedCount}/${tasks.length} sorted. Tap a card to tweak.`
                        : 'Tap any card to tweak the window or difficulty.'}
                    </Text>
                  )}
                </View>
                {!allDone &&
                  tasks.length - decidedCount > 1 && (
                    <Pressable
                      onPress={acceptAll}
                      style={styles.acceptAllBtn}
                      hitSlop={6}
                    >
                      <Text style={styles.acceptAllText}>Accept all</Text>
                    </Pressable>
                  )}
              </View>
              {/*
               * Group tasks by their suggested window so the surface
               * communicates the placement intent. Sections render
               * in the natural day order; empty windows are skipped.
               */}
              {WIN_ORDER.map((wk) => {
                const tasksInWin = tasks.filter((t) => t.win === wk);
                if (tasksInWin.length === 0) return null;
                const meta = WINDOWS[wk];
                // Show a small subtitle when the window is the user's
                // sharp/foggy slot — frames each section as "this is
                // your peak" or "this is your slump" without being
                // preachy.
                const energyHint =
                  wk === sharpWindow
                    ? 'your peak'
                    : wk === foggyWindow
                      ? 'easy lifts'
                      : null;
                return (
                  <View key={wk} style={styles.windowSection}>
                    <View style={styles.windowHeader}>
                      <View
                        style={[
                          styles.windowDot,
                          { backgroundColor: meta.color },
                        ]}
                      />
                      <Text
                        style={[
                          styles.windowLabel,
                          { color: meta.color },
                        ]}
                      >
                        {meta.label.toUpperCase()}
                      </Text>
                      {energyHint && (
                        <Text style={styles.windowHint}>· {energyHint}</Text>
                      )}
                    </View>
                    <View style={styles.taskListWrap}>
                      {tasksInWin.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          state={decisions[t.id]}
                          onUpdate={(patch) => updateTask(t.id, patch)}
                          onDecide={(d) => decide(t.id, d)}
                        />
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Done beat */}
          <View style={styles.doneArea}>
            {allDone && (
              <View style={{ alignItems: 'center', marginBottom: 14 }}>
                <Text style={styles.doneH1}>Head&apos;s clearer now.</Text>
                <Text style={styles.doneSub}>
                  {keptCount > 0
                    ? `${keptCount} ${keptCount === 1 ? 'quest' : 'quests'} waiting in Home.`
                    : 'All sorted out.'}
                </Text>
              </View>
            )}
            {allDone && keptCount > 0 && (
              <Pressable onPress={goHome} style={styles.donePrimaryBtn}>
                <Text style={styles.donePrimaryText}>
                  See {keptCount} in Home →
                </Text>
              </Pressable>
            )}
            {allDone && (
              <Pressable onPress={reset} style={styles.doneSecondaryBtn}>
                <Text style={styles.doneSecondaryText}>Dump again</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const makeStyles = (accent: Accent) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },

  header: {
    paddingLeft: 24,
    // Reserve room for the floating ProfileIcon (38px wide,
    // sits at right:20). Header content stops short of the icon
    // so they never collide visually.
    paddingRight: 66,
    paddingTop: 14,
    paddingBottom: 4,
    // Floating icon is 38px tall, anchored at top: insets.top + 14.
    // Header must extend at least that far so screen content below
    // (the HintBanner, etc.) starts BELOW the icon's footprint —
    // otherwise the icon visually overhangs into the next element.
    minHeight: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    color: C.mute,
    textTransform: 'uppercase',
  },
  headerStat: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  headerLink: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11,
    color: C.mute,
  },

  // ── DUMP ──
  dumpIntro: { paddingHorizontal: 24, paddingTop: 16 },
  h1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 32,
    color: C.bone,
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  intro: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.mute,
    lineHeight: 21,
    marginTop: 10,
    letterSpacing: -0.1,
  },
  dismissHint: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
    marginTop: 6,
    fontStyle: 'italic',
    opacity: 0.7,
  },

  fieldWrap: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  field: {
    flex: 1,
    backgroundColor: C.void2,
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 18,
    paddingBottom: 14,
  },
  fieldInput: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 16,
    color: C.bone,
    lineHeight: 26,
    letterSpacing: -0.1,
  },
  // Live-transcription read-only overlay (only visible while
  // recording). Previously-typed text stays in its normal color;
  // the streamed partial is dim so the user sees that it's still
  // tentative and replaces it on stop.
  partialFinal: {
    fontFamily: fonts.inter,
    fontSize: 16,
    color: C.bone,
    lineHeight: 26,
  },
  partialLive: {
    fontFamily: fonts.inter,
    fontSize: 16,
    color: C.boneDim,
    lineHeight: 26,
    fontStyle: 'italic',
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 30,
    marginTop: 8,
  },

  micArea: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    alignItems: 'center',
    gap: 16,
  },
  micCenterWrap: {
    width: 74,
    height: 74,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  micRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1,
    borderColor: accent.fg,
  },
  micBig: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hexA(accent.fg, 0.1),
    borderWidth: 1.5,
    borderColor: hexA(accent.fg, 0.4),
  },
  micBigRec: {
    backgroundColor: accent.fg,
    borderColor: accent.fg,
    shadowColor: accent.fg,
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  // Stop indicator shown inside the ember mic while recording.
  // Soft rounded square in void-dark for contrast against the ember
  // fill. 22pt edge ≈ 30% of the 74pt button — feels intentional,
  // not lost-in-the-middle. Border-radius 5 gives it iOS-native
  // visual weight (~22% of edge, matches Voice Memos).
  micStopShape: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: C.void,
  },

  micCaption: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12.5,
    color: C.mute,
  },

  makeSenseBtn: {
    width: '100%',
    backgroundColor: accent.fg,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  makeSenseBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.void,
    letterSpacing: 0.2,
  },

  // ── THINKING ──
  thinkingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  spinWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: accent.fg,
    borderRadius: 999,
    borderTopColor: 'transparent',
  },
  spinSpark: { fontSize: 24, color: accent.fg },
  thinkingH1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.4,
  },
  thinkingSub: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: C.mute,
  },

  // ── SENSE ──
  senseLeadWrap: { paddingHorizontal: 24, paddingTop: 22 },
  senseEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  senseSpark: { color: accent.fg, fontSize: 12 },
  senseEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: accent.fg,
    textTransform: 'uppercase',
  },
  senseLead: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 23,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 30,
    marginBottom: 8,
  },

  themeHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 9,
  },
  themeGlyph: { fontSize: 12 },
  themeLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  themeCount: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  themeBody: {
    borderLeftWidth: 2,
    paddingLeft: 14,
    gap: 8,
  },
  themeLine: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.boneDim,
    lineHeight: 22,
    letterSpacing: -0.1,
  },

  // ── Tasks list ──
  tasksOuter: { paddingHorizontal: 24, paddingTop: 8, marginTop: 6 },
  tasksDivider: {
    height: 1,
    backgroundColor: C.line,
    marginBottom: 20,
  },
  tasksH1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 20,
    color: C.bone,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  tasksHint: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
    marginBottom: 16,
    letterSpacing: -0.05,
    lineHeight: 19,
  },
  tasksTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  acceptAllBtn: {
    backgroundColor: accent.fg,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    alignSelf: 'flex-start',
    marginTop: 2,
    shadowColor: accent.fg,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  acceptAllText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.void,
    letterSpacing: -0.05,
  },
  windowSection: {
    marginTop: 18,
  },
  windowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  windowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  windowLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 1.4,
  },
  windowHint: {
    fontFamily: fonts.inter,
    fontStyle: 'italic',
    fontSize: 11.5,
    color: C.mute,
    letterSpacing: -0.05,
  },
  taskListWrap: { gap: 10 },

  // ── TaskCard ──
  taskCard: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 15,
    position: 'relative',
    overflow: 'hidden',
  },
  taskStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
  },
  taskHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  taskHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tagPill: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagPillText: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.4,
    color: C.mute,
    textTransform: 'uppercase',
  },
  tierSigil: { fontSize: 8, letterSpacing: -1 },
  tierXp: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 15,
    paddingRight: 3,
    includeFontPadding: false,
  },
  taskText: {
    fontFamily: fonts.interMed,
    fontSize: 16,
    color: C.bone,
    letterSpacing: -0.2,
    lineHeight: 21,
  },
  decidedLine: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11.5,
  },

  // SettingRow shared
  sRowWrap: { borderTopWidth: 1, borderTopColor: C.hair },
  sRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  sRowLabel: {
    fontFamily: fonts.interMed,
    fontSize: 12.5,
    color: C.boneDim,
    letterSpacing: -0.1,
  },
  sRowRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sRowIcon: { fontSize: 11 },
  sRowValue: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    letterSpacing: -0.1,
  },
  sRowChev: { fontSize: 10, color: C.mute },
  sRowBody: { paddingBottom: 12, gap: 10 },

  // Difficulty
  diffRow: { flexDirection: 'row', gap: 6 },
  diffChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  diffLabel: { fontFamily: fonts.interSemi, fontSize: 12 },

  // When
  modeToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 100,
    overflow: 'hidden',
  },
  modeOption: { paddingHorizontal: 16, paddingVertical: 5 },
  modeOptionActive: { backgroundColor: accent.fg },
  modeOptionText: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    color: C.boneDim,
  },
  winChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  winChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
  },
  winGlyph: { fontSize: 10 },
  winLabel: { fontFamily: fonts.interSemi, fontSize: 11 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: C.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: { color: C.boneDim, fontSize: 18 },
  stepperBig: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    color: C.bone,
    letterSpacing: -1,
    lineHeight: 32,
  },
  stepperAmPm: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 14,
    color: C.mute,
  },
  stepperWinHint: {
    fontFamily: fonts.inter,
    fontSize: 10,
    marginTop: 4,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  presetChip: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 100,
    borderWidth: 1,
  },
  presetText: { fontFamily: fonts.interSemi, fontSize: 11 },

  // Repeat
  cadenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  recurChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
  },
  recurChipText: { fontFamily: fonts.interSemi, fontSize: 12 },
  dayPickRow: { flexDirection: 'row', gap: 5, marginBottom: 12 },
  dayPickPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
  },
  dayPickText: { fontFamily: fonts.interSemi, fontSize: 11 },
  partPickRow: { flexDirection: 'row', gap: 6 },
  partPickPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
  },
  partPickText: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    textTransform: 'capitalize',
  },

  // Decide
  decideRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 13,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: C.hair,
  },
  decideBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  decideToss: {
    borderWidth: 1,
    borderColor: C.line,
  },
  decideTossText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.mute,
  },
  decideLater: {
    borderWidth: 1,
    borderColor: hexA(C.honey, 0.4),
  },
  decideLaterText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.honey,
  },
  decideKeep: {
    flex: 1.3,
    backgroundColor: accent.fg,
  },
  decideKeepText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.void,
  },

  // Done
  doneArea: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
  doneH1: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.4,
    marginBottom: 4,
    textAlign: 'center',
  },
  doneSub: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.mute,
    textAlign: 'center',
  },
  donePrimaryBtn: {
    backgroundColor: accent.fg,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  donePrimaryText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.void,
    letterSpacing: 0.2,
  },
  doneSecondaryBtn: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneSecondaryText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.mute,
  },
});

// Ember-default styles for module-level sub-components (Waveform,
// MicButton, TaskCard, etc) — they shadow these with their own
// useAccent + useMemo locally where they need the active accent.
const styles = makeStyles(accentFor('ember'));
