// Lumi · Profile / Account · v2 — "Your space with Lumi"
//
// Warm personal corner: who you are, how far you've come, and what
// Lumi understands about you — with practical settings handled gently
// below. Built per lumi-profile-v2-spec.md.
//
// Color law: ember = USER actions, dusk = Lumi's intelligence (the
// "What Lumi knows" section is dusk-lit; everywhere else the user's
// chosen accent applies). Functional wiring carried forward from the
// previous canonical settings screen.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScrollView as ScrollViewType, View as ViewType } from 'react-native';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  Alert,
  Animated,
  Easing,
  Linking,
  Platform,
  Share,
  Switch,
  TextInput,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Rect, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { DayRibbon } from '../components/DayRibbon';

import { fonts } from '../constants/fonts';
import { skins } from '../constants/skins';
import { lunaSource, type LunaMood } from '../lib/luna-source';
import { useAmbientLunaMood } from '../lib/luna-mood';
import {
  useUserStore,
  type NotificationPrefs,
  type ThemeKey,
  type EnergyWindowKey,
  type DailyAnchors,
  type StruggleKey,
} from '../store/userStore';
import { useQuestStore } from '../store/questStore';
import { useCheckinStore } from '../store/checkinStore';
import { useSuggestionsStore } from '../store/suggestionsStore';
import { signOut, useSession, changeEmail, deleteAccount } from '../lib/auth';
import { useAccessStatus } from '../lib/subscription';
import { useAccent, accentFor, type Accent } from '../lib/theme';
import { languageLabel } from '../lib/languages';
import { useLearningDigest } from '../lib/learning';
import {
  isCalendarSdkAvailable,
  requestCalendarAccess,
  listWritableCalendars,
  getDefaultCalendarId,
  type WritableCalendar,
} from '../lib/calendar';
import { EditProfileSheet } from '../components/EditProfileSheet';
import { LanguagePickerSheet } from '../components/LanguagePickerSheet';
import { WindowEditorSheet } from '../components/WindowEditorSheet';
import { SoftGlow } from '../components/SoftGlow';

// Enable LayoutAnimation on Android — used for insight + anchors expand.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  emberLt: '#E0A488',
  glow: '#F4C98A',
  lichen: '#869072',
  honey: '#C9A06A',
  dusk: '#8EA0B4',
  amethyst: '#9A85A8',
  bloom: '#E0A0B4',
  rust: '#C56A4A',
  ash: '#5A5650',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

const fmtTime = (m: number): string => {
  const adj = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(adj / 60);
  const mm = adj % 60;
  const hr = h % 12 || 12;
  return `${hr}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

// ─────────────────────────────────────────────────────────────────────
// SkinLuna — animated cat sprite used in the profile header and the
// skin picker. Backed by the shared `lunaSource()` helper. `skinId`
// and `animate` are accepted for API compat with existing callers
// but ignored (the GIF carries its own animation). Mood defaults to
// 'idle' but callers can swap when context warrants.
// ─────────────────────────────────────────────────────────────────────
const SkinLuna = ({
  size = 70,
  skinId: _skinId = 'default',
  animate: _animate = false,
  mood = 'idle',
}: {
  size?: number;
  skinId?: string;
  animate?: boolean;
  mood?: LunaMood;
}) => (
  <Image
    source={lunaSource(mood)}
    style={{ width: size, height: size }}
    resizeMode="contain"
  />
);

// ─────────────────────────────────────────────────────────────────────
// Helpers — derive real lifetime stats from history
// ─────────────────────────────────────────────────────────────────────
const daysBetween = (iso: string | null): number => {
  if (!iso) return 0;
  const start = new Date(iso).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
};

const longestStreakFromQuests = (
  quests: { completed: boolean; completedAt: string | null }[],
): number => {
  const days = new Set<string>();
  for (const q of quests) {
    if (q.completed && q.completedAt) {
      days.add(q.completedAt.slice(0, 10));
    }
  }
  if (days.size === 0) return 0;
  const sorted = [...days].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = new Date(sorted[i - 1] + 'T00:00:00');
    const b = new Date(sorted[i] + 'T00:00:00');
    const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
    if (diff === 1) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
};

const memberSinceLabel = (iso: string | null): string => {
  if (!iso) return 'just getting started';
  const d = new Date(iso);
  return `with Lumi since ${d.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })}`;
};

// Group completed quests into weekly buckets for "Your weeks."
interface WeekBucket {
  start: Date;
  range: string;
  done: number;
  mood: string;
  note: string;
}
const buildWeekBuckets = (
  quests: { completed: boolean; completedAt: string | null }[],
): WeekBucket[] => {
  const byWeek: Record<
    string,
    { start: Date; end: Date; done: number }
  > = {};
  for (const q of quests) {
    if (!q.completed || !q.completedAt) continue;
    const d = new Date(q.completedAt);
    const dow = d.getDay();
    const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    // LOCAL Y-M-D key — `sunday` is a local Date; toISOString would
    // shift it to UTC and bucket a Sunday completed late evening into
    // Monday's week, splitting weeks across the boundary.
    const key = `${sunday.getFullYear()}-${String(
      sunday.getMonth() + 1,
    ).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    if (!byWeek[key]) {
      const sat = new Date(sunday);
      sat.setDate(sunday.getDate() + 6);
      byWeek[key] = { start: sunday, end: sat, done: 0 };
    }
    byWeek[key].done += 1;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const moodCycle = [C.lichen, C.honey, C.ember, C.dusk, C.bloom];
  return Object.values(byWeek)
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .map((w, i) => ({
      start: w.start,
      range: `${fmt(w.start)} – ${fmt(w.end)}`,
      done: w.done,
      mood: moodCycle[i % moodCycle.length],
      note: noteForWeek(w.done),
    }));
};

const noteForWeek = (done: number): string => {
  if (done === 0) return 'A quiet week with Lumi';
  if (done < 8) return 'A gentle week — and that was okay';
  if (done < 16) return 'A steady rhythm — small and real';
  if (done < 24) return 'Strong follow-through';
  return 'You moved a lot — well done';
};

// ─────────────────────────────────────────────────────────────────────
// Reusable primitives — Group / Row / Card / SectionLabel / Toggle
// ─────────────────────────────────────────────────────────────────────
const SectionLabel = ({
  children,
  color = C.mute,
}: {
  children: React.ReactNode;
  color?: string;
}) => (
  <Text style={[styles.sectionLabel, { color }]}>{children}</Text>
);

const Group = ({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) => (
  <View style={styles.groupWrap}>
    {title && <SectionLabel>{title}</SectionLabel>}
    <View style={styles.groupCard}>{children}</View>
  </View>
);

const Card = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) => <View style={[styles.card, style]}>{children}</View>;

interface RowProps {
  icon?: string;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}
const Row = ({ icon, label, sub, right, onPress, danger, last }: RowProps) => {
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {icon ? (
        <Text
          style={[
            styles.rowIcon,
            { color: danger ? C.emberLt : C.boneDim },
          ]}
        >
          {icon}
        </Text>
      ) : (
        <View style={{ width: 20 }} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[
            styles.rowLabel,
            { color: danger ? C.emberLt : C.bone, marginBottom: sub ? 2 : 0 },
          ]}
        >
          {label}
        </Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {right !== undefined ? (
        right
      ) : onPress ? (
        <Text style={styles.rowChev}>›</Text>
      ) : null}
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
};

// ─────────────────────────────────────────────────────────────────────
// Rhythm / Theme / Skin pickers — data
// ─────────────────────────────────────────────────────────────────────
type RhythmKey = 'morning' | 'afternoon' | 'night' | 'varies';

const RHYTHMS: { key: RhythmKey; label: string; icon: string }[] = [
  { key: 'morning', label: 'Morning person', icon: '☀' },
  { key: 'afternoon', label: 'Afternoon peak', icon: '◑' },
  { key: 'night', label: 'Night owl', icon: '☾' },
  { key: 'varies', label: 'It varies', icon: '∿' },
];

const rhythmFromSharpWindow = (
  w: EnergyWindowKey | null,
): RhythmKey => {
  if (w === 'morning') return 'morning';
  if (w === 'afternoon' || w === 'midday') return 'afternoon';
  if (w === 'evening') return 'night';
  return 'varies';
};

const sharpWindowFromRhythm = (
  k: RhythmKey,
): EnergyWindowKey | null => {
  if (k === 'morning') return 'morning';
  if (k === 'afternoon') return 'afternoon';
  if (k === 'night') return 'evening';
  return null;
};

const ANCHOR_DEFS: {
  key: keyof DailyAnchors;
  label: string;
  glyph: string;
}[] = [
  { key: 'wake', label: 'Wake', glyph: '☀' },
  { key: 'breakfast', label: 'Breakfast', glyph: '◔' },
  { key: 'lunch', label: 'Lunch', glyph: '◑' },
  { key: 'dinner', label: 'Dinner', glyph: '◕' },
  { key: 'sleep', label: 'Sleep', glyph: '☾' },
];

const THEMES: { k: ThemeKey; label: string; color: string }[] = [
  { k: 'ember', label: 'Ember', color: accentFor('ember').fg },
  { k: 'lichen', label: 'Lichen', color: accentFor('lichen').fg },
  { k: 'amethyst', label: 'Amethyst', color: accentFor('amethyst').fg },
  // 'dusk' is RESERVED for Lumi's intelligence — never selectable as a
  // user accent. See color-law note in profile-v2 spec.
];

const STRUGGLE_LABELS: Record<StruggleKey, string> = {
  paralysis: 'Getting started',
  time: 'Time blindness',
  follow: 'Following through',
  avoid: 'Avoidance',
  overwhelm: 'Feeling overwhelmed',
  forget: 'Forgetting',
};

// ─────────────────────────────────────────────────────────────────────
// ModePreview — tiny 64×84 mock of what Home looks like in each mode,
// rendered inside the Companion-mode picker so users can SEE the
// difference, not just read about it. Ported from
// lumi-playful-setting.jsx (the design composer mockup).
//   - Full   → cozy room: blue→warm gradient, window, Luna at floor,
//              little fire emoji for streak
//   - Minimal → ember-tint task card mock with a tiny Luna in corner
//   - Focused → dusk-tint plain task-list with checkboxes, no Luna
// ─────────────────────────────────────────────────────────────────────
const ModePreview = ({
  mode,
}: {
  mode: 'full' | 'minimal' | 'focused';
}) => {
  if (mode === 'full') {
    return (
      <View style={previewStyles.frame}>
        <LinearGradient
          colors={['#2a3550', '#5a3d2a', '#1a1410']}
          locations={[0, 0.6, 1]}
          style={previewStyles.fill}
        />
        {/* Window */}
        <View style={previewStyles.window}>
          <LinearGradient
            colors={['#8a96b0', '#e8c886']}
            style={previewStyles.fill}
          />
        </View>
        {/* Luna on the floor */}
        <Image
          source={lunaSource('idle')}
          style={previewStyles.fullLuna}
        />
        {/* Streak ember */}
        <Text style={previewStyles.streakGlyph}>🔥</Text>
      </View>
    );
  }
  if (mode === 'minimal') {
    return (
      <View style={previewStyles.frame}>
        <LinearGradient
          colors={[hexAStatic('#E07A4F', 0.12), '#120E0C']}
          locations={[0, 0.6]}
          style={previewStyles.fill}
          start={{ x: 0.7, y: 0.1 }}
          end={{ x: 0.3, y: 1 }}
        />
        <View style={previewStyles.innerPad}>
          <View style={previewStyles.minHeadBar} />
          <View style={previewStyles.minCard}>
            <View style={previewStyles.minCardBar1} />
            <View style={previewStyles.minCardBar2} />
          </View>
        </View>
        <Image
          source={lunaSource('idle')}
          style={previewStyles.minLuna}
        />
      </View>
    );
  }
  return (
    <View style={previewStyles.frame}>
      <LinearGradient
        colors={[hexAStatic('#8EA0B4', 0.1), '#120E0C']}
        locations={[0, 0.62]}
        style={previewStyles.fill}
        start={{ x: 0.7, y: 0.1 }}
        end={{ x: 0.3, y: 1 }}
      />
      <View style={previewStyles.innerPad}>
        <View style={previewStyles.focusHeadBar} />
        {[0, 1, 2].map((i) => (
          <View key={i} style={previewStyles.focusRow}>
            <View style={previewStyles.focusCheckbox} />
            <View style={previewStyles.focusRowBar} />
          </View>
        ))}
      </View>
    </View>
  );
};

// Static hex→rgba (ModePreview lives above AccountScreen and can't
// reach the closure-level hexA — same logic inlined here).
const hexAStatic = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const previewStyles = StyleSheet.create({
  frame: {
    width: 64,
    height: 84,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#2A2420',
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  window: {
    position: 'absolute',
    top: 8,
    left: 21,
    width: 22,
    height: 24,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#2A2018',
    overflow: 'hidden',
  },
  fullLuna: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    width: 32,
    height: 32,
  },
  streakGlyph: {
    position: 'absolute',
    top: 3,
    left: 5,
    fontSize: 8,
    lineHeight: 9,
  },
  innerPad: { padding: 7 },
  minHeadBar: {
    width: '60%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A2420',
    marginBottom: 5,
  },
  minCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(224,122,79,0.4)',
    backgroundColor: 'rgba(224,122,79,0.08)',
    height: 30,
    padding: 4,
  },
  minCardBar1: {
    width: '70%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(236,224,203,0.5)',
    marginBottom: 4,
  },
  minCardBar2: {
    width: '100%',
    height: 8,
    borderRadius: 3,
    backgroundColor: '#E07A4F',
  },
  minLuna: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 22,
    height: 22,
    opacity: 0.8,
  },
  focusHeadBar: {
    width: '50%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A2420',
    marginBottom: 6,
  },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 5,
  },
  focusCheckbox: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.4,
    borderColor: '#5A5650',
  },
  focusRowBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(236,224,203,0.28)',
  },
});

// ─────────────────────────────────────────────────────────────────────
// PulseDot — small steady-pulse status indicator used in the calendar
// "Synced just now" affordance. Loops opacity 1 ↔ 0.3 on a 2s cycle,
// matching the design composer mockup's @keyframes cpulse animation.
// ─────────────────────────────────────────────────────────────────────
const PulseDot = ({ color, size = 6 }: { color: string; size?: number }) => {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, {
          toValue: 0.3,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(op, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [op]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: op,
      }}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────
// ConfidenceDots — three dusk dots showing how sure Lumi is about
// a given insight. Lit dots glow softly; unlit dots are faint at
// 22% alpha. Per lumi-knows.jsx mockup.
// ─────────────────────────────────────────────────────────────────────
const ConfidenceDots = ({ level }: { level: 1 | 2 | 3 }) => (
  <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
    {[1, 2, 3].map((i) => (
      <View
        key={i}
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor:
            i <= level ? '#8EA0B4' : 'rgba(142,160,180,0.22)',
          shadowColor: '#8EA0B4',
          shadowOpacity: i <= level ? 0.6 : 0,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
    ))}
  </View>
);

// ─────────────────────────────────────────────────────────────────────
// RhythmCurve — tiny SVG energy curve under the "Your rhythm" insight.
// Lights up the peak by the user's sharpWindow: morning peak puts the
// glow dot at index 1, midday/afternoon at 4, evening at 6. The shape
// is a fixed gentle wave so the visual is recognizable; only the lit
// peak position moves.
// ─────────────────────────────────────────────────────────────────────
const RhythmCurve = ({ sharp }: { sharp: EnergyWindowKey | null }) => {
  const W = 240;
  const H = 40;
  // Sample 8 x-positions across the day. Each insight's peak fills
  // its slot to ~0.9 height; the rest taper down. Keeps the silhouette
  // unambiguous on a small canvas.
  const peakIdx =
    sharp === 'morning'
      ? 1
      : sharp === 'midday'
        ? 3
        : sharp === 'afternoon'
          ? 5
          : sharp === 'evening'
            ? 6
            : 4;
  const pts = Array.from({ length: 8 }, (_, i) => {
    // Gentle bell around peakIdx, floor 0.25
    const dist = Math.abs(i - peakIdx);
    return Math.max(0.25, 0.95 - dist * 0.16);
  });
  const x = (i: number) => 6 + (i / (pts.length - 1)) * (W - 12);
  const y = (v: number) => H - 4 - v * (H - 10);
  // Build smooth quadratic path
  let d = `M ${x(0)} ${y(pts[0])}`;
  for (let i = 1; i < pts.length; i++) {
    const xc = (x(i - 1) + x(i)) / 2;
    const yc = (y(pts[i - 1]) + y(pts[i])) / 2;
    d += ` Q ${x(i - 1)} ${y(pts[i - 1])}, ${xc} ${yc}`;
  }
  d += ` L ${x(pts.length - 1)} ${y(pts[pts.length - 1])}`;
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Path d={d} stroke="#8EA0B4" strokeWidth={1.6} fill="none" />
      {/* Peak dot + halo */}
      <Circle
        cx={x(peakIdx)}
        cy={y(pts[peakIdx])}
        r={5.5}
        fill="rgba(244,201,138,0.25)"
      />
      <Circle
        cx={x(peakIdx)}
        cy={y(pts[peakIdx])}
        r={2.6}
        fill="#F4C98A"
      />
    </Svg>
  );
};

// ─────────────────────────────────────────────────────────────────────
// MiniRibbon — compact 12px-tall version of the DayRibbon for the
// "Your daily anchors" insight. Same proportions and palette as the
// full ribbon in Personalize, just thinner with no labels/markers so
// it reads as a glanceable strip in the Knows card.
// ─────────────────────────────────────────────────────────────────────
const MiniRibbon = ({
  wakeMin,
  sleepMin,
  middayHour,
  afternoonHour,
  eveningHour,
}: {
  wakeMin: number;
  sleepMin: number;
  middayHour: number;
  afternoonHour: number;
  eveningHour: number;
}) => {
  const span = Math.max(1, sleepMin - wakeMin);
  const cls = (m: number) => Math.max(wakeMin, Math.min(sleepMin, m));
  const fracs = [
    Math.max(0, cls(middayHour * 60) - wakeMin) / span,
    Math.max(0, cls(afternoonHour * 60) - cls(middayHour * 60)) / span,
    Math.max(0, cls(eveningHour * 60) - cls(afternoonHour * 60)) / span,
    Math.max(0, sleepMin - cls(eveningHour * 60)) / span,
  ];
  const colors = ['#C9A06A', '#869072', '#E07A4F', '#8EA0B4'];
  return (
    <View
      style={{
        flexDirection: 'row',
        height: 12,
        borderRadius: 6,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#2A2420',
      }}
    >
      {fracs.map((f, i) =>
        f > 0 ? (
          <View
            key={i}
            style={{
              flexGrow: f,
              flexShrink: 1,
              flexBasis: 0,
              backgroundColor: colors[i] + '99',
            }}
          />
        ) : null,
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────
export default function AccountScreen() {
  const router = useRouter();
  const { session } = useSession();
  const access = useAccessStatus(session);
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  // Ambient mood for the main header avatar — Luna's expression here
  // tracks the user's state (sleeping if past bedtime, happy on a
  // good streak, sad if buried, idle otherwise).
  const headerMood = useAmbientLunaMood();
  // Pet name powers user-facing strings ("{name}'s look" etc.) so
  // anyone who renamed their cat sees the right name.
  const petName = useUserStore((s) => s.petName);

  // Sheet visibility
  const [editOpen, setEditOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [windowsOpen, setWindowsOpen] = useState(false);

  // Insight panel + anchors disclosure
  const [knowOpen, setKnowOpen] = useState<string | null>(null);
  const [anchorsOpen, setAnchorsOpen] = useState(false);
  // Refs for the "Adjust this →" affordance in the Knows section.
  // When the user taps Adjust on the anchors insight we expand the
  // Anchors row AND scroll the page to it; without the scroll the
  // user is left looking at the Knows card with nothing visibly
  // different, even though the section did open way below.
  const scrollRef = useRef<ScrollViewType>(null);
  const anchorsTriggerRef = useRef<ViewType>(null);
  // Collapsible state for the Companion-mode picker. Matches the
  // anchors / language patterns elsewhere in Personalize — the
  // current pick is shown summarized while collapsed so users
  // don't have to expand it to see what they're on.
  const [companionOpen, setCompanionOpen] = useState(false);
  // Calendar integration — collapsible card mirrors the anchors /
  // companion patterns: closed shows current state, expanded shows
  // the connect button or calendar picker + auto-sync toggle.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarList, setCalendarList] = useState<WritableCalendar[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Identity
  const name = useUserStore((s) => s.name) || 'Friend';
  const avatar = useUserStore((s) => s.avatar);
  const onboardedAt = useUserStore((s) => s.onboardedAt);
  const email = session?.user.email ?? 'no email on file';

  // Inline name edit
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(name);
  useEffect(() => {
    if (!editingName) setDraftName(name);
  }, [name, editingName]);
  const commitName = () => {
    const t = draftName.trim();
    if (t && t !== name) useUserStore.getState().setName(t);
    setEditingName(false);
  };

  // Settings state
  const notifPrefs = useUserStore((s) => s.notifPrefs);
  const setNotifPref = useUserStore((s) => s.setNotifPref);
  const voiceEnabled = useUserStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useUserStore((s) => s.setVoiceEnabled);
  const captureLang = useUserStore((s) => s.captureLang);
  const theme = useUserStore((s) => s.theme);
  const setTheme = useUserStore((s) => s.setTheme);
  const companionMode = useUserStore((s) => s.companionMode);
  const setCompanionMode = useUserStore((s) => s.setCompanionMode);
  const calendarEnabled = useUserStore((s) => s.calendarEnabled);
  const setCalendarEnabled = useUserStore((s) => s.setCalendarEnabled);
  const calendarIds = useUserStore((s) => s.calendarIds);
  const setCalendarIds = useUserStore((s) => s.setCalendarIds);
  const toggleCalendarId = useUserStore((s) => s.toggleCalendarId);
  const autoSyncTasksWithTimes = useUserStore(
    (s) => s.autoSyncTasksWithTimes,
  );
  const setAutoSyncTasksWithTimes = useUserStore(
    (s) => s.setAutoSyncTasksWithTimes,
  );
  const subscriptionStatus = useUserStore((s) => s.subscriptionStatus);
  const subscriptionTier = useUserStore((s) => s.subscriptionTier);
  const subscriptionEnd = useUserStore((s) => s.subscriptionCurrentPeriodEnd);
  const sharpWindow = useUserStore((s) => s.sharpWindow);
  const struggles = useUserStore((s) => s.struggles);
  const anchors = useUserStore((s) => s.anchors);
  const setAnchor = useUserStore((s) => s.setAnchor);
  // Selected so the DayRibbon (rendered in the anchors expanded body)
  // reflects the user's current part-of-day boundaries alongside their
  // anchors. Both surface drive the same visual.
  const windowOverrides = useUserStore((s) => s.windowOverrides);

  // Real history → digests
  const quests = useQuestStore((s) => s.quests);
  const checkins = useCheckinStore((s) => s.checkins);
  // Chronotype is now auto-derived inside useLearningDigest from
  // sharpWindow + foggyWindow — passing nothing here mirrors every
  // other surface (Time, Home, Untangle, Recap, Insights).
  const digest = useLearningDigest();

  // Stores for export + delete
  const resetUser = useUserStore((s) => s.reset);
  const resetQuests = useQuestStore((s) => s.reset);
  const resetCheckins = useCheckinStore((s) => s.reset);
  const resetSuggestions = useSuggestionsStore((s) => s.reset);

  // Premium UI gating — Premium only when status='active' OR a real
  // 7-day trial is still in window (a defaulted-'trial' user with the
  // window expired sees the upgrade card instead).
  const trialActive =
    subscriptionStatus === 'trial' && access.inTrial && access.trialDaysLeft > 0;
  const isPremium = subscriptionStatus === 'active' || trialActive;

  const planLabel = useMemo(() => {
    if (subscriptionStatus === 'active') {
      const tier = subscriptionTier === 'annual' ? 'yearly' : 'monthly';
      if (subscriptionEnd) {
        const d = new Date(subscriptionEnd);
        return `Premium · ${tier} · renews ${d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`;
      }
      return `Premium · ${tier}`;
    }
    if (trialActive) {
      return `Free trial · ${access.trialDaysLeft} day${
        access.trialDaysLeft === 1 ? '' : 's'
      } left`;
    }
    return 'Free';
  }, [
    subscriptionStatus,
    subscriptionTier,
    subscriptionEnd,
    trialActive,
    access.trialDaysLeft,
  ]);

  // ── Lifetime snapshot — real numbers from history ────────────────
  const stats = useMemo(() => {
    const completedQuests = quests.filter((q) => q.completed).length;
    const untangleCount = checkins.length;
    const days = daysBetween(onboardedAt);
    const longest = longestStreakFromQuests(quests);
    return [
      { label: 'days with Lumi', value: String(days), color: C.honey },
      {
        label: 'untangled',
        value: String(untangleCount),
        color: C.dusk,
      },
      {
        label: 'quests cleared',
        value: String(completedQuests),
        color: C.ember,
      },
      {
        label: 'longest streak',
        value: String(longest),
        suffix: 'd',
        color: C.bloom,
      },
    ];
  }, [quests, checkins, onboardedAt]);

  // ── Weekly archive ───────────────────────────────────────────────
  const weeks = useMemo(() => buildWeekBuckets(quests).slice(0, 4), [quests]);
  const totalWeeks = useMemo(() => buildWeekBuckets(quests).length, [quests]);

  // ── "What Lumi knows" insights — real, only show if we have data ─
  // Each item now carries:
  //   - confidence: 1..3 dots (how sure Lumi is about this insight)
  //   - viz: 'curve' | 'ribbon' | 'tags' | undefined — what to render
  //   - tags: optional list for the 'tags' viz
  const knowsItems = useMemo(() => {
    const items: {
      key: string;
      glyph: string;
      title: string;
      line: string;
      detail: string;
      confidence: 1 | 2 | 3;
      viz?: 'curve' | 'ribbon' | 'tags';
      tags?: string[];
      action?: 'anchors' | 'windows';
    }[] = [];

    // Rhythm — confidence 3 if we have a sharpWindow seed; curve viz
    if (sharpWindow) {
      const label =
        sharpWindow === 'morning'
          ? 'mornings'
          : sharpWindow === 'evening'
            ? 'evenings'
            : 'middays';
      items.push({
        key: 'rhythm',
        glyph: '◔',
        title: 'Your rhythm',
        line: `Sharpest in the ${label}`,
        detail: `You're at your best in the ${label}. I front-load your hardest quests there and keep the other windows lighter.`,
        confidence: 3,
        viz: 'curve',
        action: 'windows',
      });
    }

    // Pattern Lumi noticed — confidence based on how many recurring
    // titles we've seen (1 → 1 dot, 2-3 → 2 dots, 4+ → 3 dots)
    if (digest.recurrence[0]) {
      const p = digest.recurrence[0];
      const recCount = digest.recurrence.length;
      items.push({
        key: 'pattern',
        glyph: '🔁',
        title: 'A pattern I noticed',
        line: p.title,
        detail: `You've done "${p.title}" — ${p.span.toLowerCase()}. Want me to surface it on its rhythm so it never sneaks up on you?`,
        confidence: recCount >= 4 ? 3 : recCount >= 2 ? 2 : 1,
      });
    }

    // Daily anchors — always confidence 3 (we know these from onboarding)
    // + mini-ribbon viz that mirrors the full DayRibbon
    items.push({
      key: 'anchors',
      glyph: '❖',
      title: 'Your daily anchors',
      line: `Wake ${fmtTime(anchors.wake)} · Sleep ${fmtTime(anchors.sleep)}`,
      detail: `Wake ${fmtTime(anchors.wake)} · Breakfast ${fmtTime(
        anchors.breakfast,
      )} · Lunch ${fmtTime(anchors.lunch)} · Dinner ${fmtTime(
        anchors.dinner,
      )} · Sleep ${fmtTime(
        anchors.sleep,
      )}. These frame every day so there's always a shape to land in.`,
      confidence: 3,
      viz: 'ribbon',
      action: 'anchors',
    });

    // What you find hard — confidence by struggle count (1→1, 2-3→2, 4+→3)
    if (struggles.length > 0) {
      const tags = struggles
        .slice(0, 3)
        .map((s) => STRUGGLE_LABELS[s] ?? s);
      items.push({
        key: 'hard',
        glyph: '❍',
        title: 'What you find hard',
        line: tags.slice(0, 2).join(' · '),
        detail: `${tags.join(' · ')} — so I hand you one small first step, and keep your plate to a doable few.`,
        confidence:
          struggles.length >= 4 ? 3 : struggles.length >= 2 ? 2 : 1,
        viz: 'tags',
        tags,
      });
    }

    // Focus pattern from follow-through stats — confidence depends on
    // whether we have enough quest history to compute it (digest.pattern
    // is non-null only after a threshold of completed quests)
    if (digest.pattern) {
      items.push({
        key: 'focus',
        glyph: '◈',
        title: 'How you focus best',
        line: digest.pattern.headline,
        detail: digest.pattern.body,
        confidence: 2,
      });
    }

    return items;
  }, [sharpWindow, anchors, struggles, digest]);

  // Learning meter — how much of Lumi's picture is filled in. Each
  // source the user has seeded adds 20%. Anchors are always there
  // (free), so the floor is 20%.
  const learningPct = useMemo(() => {
    let pct = 20; // anchors floor
    if (sharpWindow) pct += 20;
    if (struggles.length > 0) pct += 20;
    if (digest.pattern) pct += 20;
    if (digest.recurrence.length > 0) pct += 20;
    return Math.min(100, pct);
  }, [sharpWindow, struggles, digest]);

  // ── Handlers ─────────────────────────────────────────────────────
  const handleChangeEmail = () => {
    if (!session) {
      Alert.alert(
        'Sign in first',
        'You need to be signed in to change your email.',
      );
      return;
    }
    if (Platform.OS !== 'ios') {
      Alert.alert(
        'Change email',
        'To change your email, contact support — in-app change is iOS-only for now.',
      );
      return;
    }
    Alert.prompt(
      'Change email',
      `Currently ${email}. We'll send a confirmation link to your new address.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async (next?: string) => {
            const trimmed = next?.trim();
            if (!trimmed || !trimmed.includes('@')) {
              Alert.alert('That email looks off — try again.');
              return;
            }
            try {
              await changeEmail(trimmed);
              Alert.alert(
                'Check both inboxes',
                "Supabase sent a confirmation link to your old AND new address. Click both to finish the switch — you stay signed in under the old email until then.",
              );
            } catch (e) {
              Alert.alert(
                'Could not change email',
                e instanceof Error ? e.message : 'Try again later.',
              );
            }
          },
        },
      ],
      'plain-text',
      '',
      'email-address',
    );
  };

  const handleSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/auth/sign-up');
        },
      },
    ]);
  };

  const handleExport = async () => {
    const allQuests = useQuestStore.getState().quests;
    const allCheckins = useCheckinStore.getState().checkins;
    const profile = {
      name,
      email,
      sharpWindow: useUserStore.getState().sharpWindow,
      foggyWindow: useUserStore.getState().foggyWindow,
      struggles: useUserStore.getState().struggles,
      anchors: useUserStore.getState().anchors,
      onboardedAt: useUserStore.getState().onboardedAt,
      notifPrefs,
      voiceEnabled,
      captureLang,
      theme,
      avatar: useUserStore.getState().avatar,
    };
    const blob = {
      app: 'Lumi',
      version: 2,
      exportedAt: new Date().toISOString(),
      profile,
      quests: allQuests,
      checkins: allCheckins,
    };
    try {
      await Share.share({
        title: 'Lumi · your data',
        message: JSON.stringify(blob, null, 2),
      });
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete account?',
      'This permanently erases everything: your quests, your check-ins, what Lumi has learned about you. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              'Last check. This wipes the local data right now and signs you out. If you have a Premium subscription, cancel it separately in your app store.',
              [
                { text: 'Keep my data', style: 'cancel' },
                {
                  text: 'Permanently erase everything',
                  style: 'destructive',
                  onPress: async () => {
                    let serverPurged = true;
                    try {
                      await deleteAccount();
                    } catch (e) {
                      serverPurged = false;
                      console.warn(
                        '[lumi] server delete failed',
                        e instanceof Error ? e.message : e,
                      );
                    }
                    resetQuests();
                    resetCheckins();
                    resetSuggestions();
                    resetUser();
                    await signOut().catch(() => {});
                    router.replace('/onboarding/welcome');
                    if (!serverPurged) {
                      Alert.alert(
                        'Local data cleared',
                        'Your data on this device is gone. Server-side deletion is queued — email us to confirm if you need it expedited.',
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const manageSubscription = () => {
    const url =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    Linking.openURL(url).catch(() => {
      Alert.alert('Subscription', 'Open your app store to manage your plan.');
    });
  };

  const pickTheme = (next: ThemeKey) => {
    if (!isPremium && next !== 'ember') {
      Alert.alert(
        'Premium theme',
        'Accent themes are part of Lumi Premium. Unlock with a 7-day free trial.',
      );
      return;
    }
    Haptics.selectionAsync();
    setTheme(next);
  };

  const pickRhythm = (k: RhythmKey) => {
    Haptics.selectionAsync();
    useUserStore.setState({ sharpWindow: sharpWindowFromRhythm(k) });
  };

  const toggleKnow = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setKnowOpen((cur) => (cur === key ? null : key));
  };

  const toggleAnchors = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAnchorsOpen((o) => !o);
  };
  const toggleCompanion = () => {
    Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCompanionOpen((o) => !o);
  };
  const toggleCalendar = () => {
    Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCalendarOpen((o) => !o);
  };

  // Refresh the writable calendar list whenever the panel opens and
  // we're connected — covers the case where the user added a new
  // calendar to iOS Settings between sessions.
  useEffect(() => {
    if (!calendarOpen || !calendarEnabled) return;
    let cancelled = false;
    listWritableCalendars()
      .then((list) => {
        if (!cancelled) setCalendarList(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [calendarOpen, calendarEnabled]);

  const connectCalendar = async () => {
    if (!isCalendarSdkAvailable()) {
      setCalendarError(
        'Calendar needs a custom build — not available in Expo Go.',
      );
      return;
    }
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      const result = await requestCalendarAccess();
      if (!result.ok) {
        if (result.reason === 'no-sdk') {
          setCalendarError(
            'Calendar module not bundled in this build. Rebuild the app.',
          );
        } else if (result.reason === 'denied') {
          setCalendarError(
            'Calendar access denied. Open Settings → Lumi → Calendars to enable it.',
          );
        } else {
          // reason === 'error' — surface the actual native message so we
          // can see what iOS is rejecting (and so the user can screenshot
          // a real error if they need to send it).
          setCalendarError(`iOS rejected calendar access: ${result.message}`);
        }
        return;
      }
      const writable = await listWritableCalendars();
      setCalendarList(writable);
      setCalendarEnabled(true);
      // Pre-select the OS default writable calendar so the user
      // doesn't have to make a choice just to start. Multi-cal: we
      // initialize with just the default; the user can tick others.
      if (calendarIds.length === 0) {
        const def = await getDefaultCalendarId();
        if (def) setCalendarIds([def]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[calendar] connectCalendar threw', message);
      setCalendarError(message);
    } finally {
      setCalendarBusy(false);
    }
  };

  const disconnectCalendar = () => {
    Alert.alert(
      'Disconnect calendar?',
      "Lumi will stop writing tasks to your calendar. Events already added stay where they are — they won't be removed.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            setCalendarEnabled(false);
            setCalendarList([]);
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
          },
        },
      ],
    );
  };

  const nudgeAnchor = (k: keyof DailyAnchors, delta: number) => {
    Haptics.selectionAsync();
    const cur = useUserStore.getState().anchors[k];
    setAnchor(k, cur + delta);
  };

  const handleInsightAction = (action?: 'anchors' | 'windows') => {
    if (action === 'anchors') {
      // Expand the Anchors collapsible AND scroll the user to it —
      // without the scroll, "Adjust this →" appears to do nothing
      // because the affected section is way below the Knows card.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAnchorsOpen(true);
      // Defer the scroll by a beat so the LayoutAnimation has time
      // to commit the expanded body, then measure + scroll.
      setTimeout(() => {
        const scrollNode = scrollRef.current;
        const target = anchorsTriggerRef.current;
        if (!scrollNode || !target) return;
        // measureLayout against the ScrollView's inner content so
        // the y we get is in scroll-content coordinates.
        const scrollInner = (scrollNode as unknown as {
          getInnerViewNode?: () => number;
        }).getInnerViewNode;
        const handle =
          typeof scrollInner === 'function'
            ? scrollInner.call(scrollNode)
            : null;
        if (handle == null) return;
        (target as unknown as {
          measureLayout: (
            ref: number,
            ok: (x: number, y: number) => void,
            fail: () => void,
          ) => void;
        }).measureLayout(
          handle,
          (_x, y) => {
            scrollNode.scrollTo({
              y: Math.max(0, y - 20),
              animated: true,
            });
          },
          () => {},
        );
      }, 120);
    } else if (action === 'windows') {
      setWindowsOpen(true);
    }
  };

  const rhythm = rhythmFromSharpWindow(sharpWindow);

  // Avatar option list for the inline picker — only unlocked.
  const skinChoices = useMemo(() => {
    const xp = useUserStore.getState().xp;
    const cream = { id: 'default', label: 'Cream' };
    const unlocked = skins
      .filter((s) => xp >= s.xpToUnlock)
      .map((s) => ({ id: s.id, label: s.name }));
    return [cream, ...unlocked];
  }, [avatar]); // re-derive when avatar changes (proxy for store activity)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <View style={styles.backCircle}>
            <Text style={styles.backGlyph}>‹</Text>
          </View>
        </Pressable>
        <Text style={styles.topEyebrow}>Your space</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1 · WARM HEADER ─────────────────────────────────────── */}
        <View style={styles.headerWrap}>
          <SoftGlow
            color={C.glow}
            opacity={0.16}
            fade={0.62}
            cx={0.82}
            cy={0}
            style={StyleSheet.absoluteFill as object}
          />
          <View style={styles.headerInner}>
            <View style={styles.headerAvatar}>
              <SoftGlow
                color={C.glow}
                opacity={0.22}
                fade={0.65}
                style={StyleSheet.absoluteFill as object}
              />
              <View style={styles.headerAvatarSprite}>
                <SkinLuna size={64} skinId={avatar} animate mood={headerMood} />
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {editingName ? (
                <TextInput
                  value={draftName}
                  onChangeText={setDraftName}
                  onBlur={commitName}
                  onSubmitEditing={commitName}
                  autoFocus
                  selectTextOnFocus
                  maxLength={30}
                  returnKeyType="done"
                  style={styles.nameInput}
                />
              ) : (
                <Pressable
                  onPress={() => setEditingName(true)}
                  style={styles.nameRow}
                >
                  <Text style={styles.nameText} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.nameEdit}>✎</Text>
                </Pressable>
              )}
              <Text style={styles.memberSince}>
                {memberSinceLabel(onboardedAt)}
              </Text>
              {isPremium && (
                <View style={styles.premiumTag}>
                  <Text style={styles.premiumTagSpark}>✦</Text>
                  <Text style={styles.premiumTagText}>
                    {trialActive ? 'Trial' : 'Premium'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── 2 · LIFETIME SNAPSHOT ───────────────────────────────── */}
        <View style={styles.sectionWrap}>
          <SectionLabel>How far you've come</SectionLabel>
          <View style={styles.statsGrid}>
            {stats.map((s) => (
              <View
                key={s.label}
                style={[
                  styles.statCard,
                  {
                    backgroundColor: hexA(s.color, 0.07),
                    borderColor: hexA(s.color, 0.22),
                  },
                ]}
              >
                <View style={styles.statValueRow}>
                  <Text style={[styles.statValue, { color: s.color }]}>
                    {s.value}
                  </Text>
                  {s.suffix && (
                    <Text style={[styles.statSuffix, { color: s.color }]}>
                      {s.suffix}
                    </Text>
                  )}
                </View>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── 3 · WHAT LUMI KNOWS — the heart ─────────────────────── */}
        {/* Per lumi-knows.jsx — each insight shows its evidence
            (energy curve / mini day-ribbon / tags) plus a 3-dot
            confidence meter. Dusk-tinted (Lumi's intelligence). */}
        <View style={styles.sectionWrap}>
          <View style={styles.knowsWrap}>
            <View style={styles.knowsTopBar} />
            <View style={styles.knowsHeader}>
              <View style={styles.knowsEyebrowRow}>
                <Text style={styles.knowsSpark}>✦</Text>
                <Text style={styles.knowsEyebrow}>
                  What Lumi knows about you
                </Text>
              </View>
              <Text style={styles.knowsTitle}>
                The more we go,{'\n'}the better I know you.
              </Text>
              {/* Learning meter — dusk progress bar showing how much
                 of Lumi's picture is filled in. Grows as the user
                 seeds more (sharpWindow / struggles / patterns). */}
              <View style={styles.learningMeterRow}>
                <View style={styles.learningMeterTrack}>
                  <View
                    style={[
                      styles.learningMeterFill,
                      { width: `${learningPct}%` },
                    ]}
                  />
                </View>
                <Text style={styles.learningMeterLabel}>
                  {learningPct >= 100
                    ? 'I know you well'
                    : 'Getting to know you'}
                </Text>
              </View>
            </View>

            <View style={styles.knowsList}>
              {knowsItems.length === 0 ? (
                <View style={styles.knowsEmpty}>
                  <Text style={styles.knowsEmptyText}>
                    I&apos;m still getting to know you. The more you use
                    Lumi, the more this fills in.
                  </Text>
                </View>
              ) : (
                knowsItems.map((k, i) => {
                  const open = knowOpen === k.key;
                  return (
                    <View
                      key={k.key}
                      style={[
                        styles.knowsRow,
                        i > 0 && styles.knowsRowDivider,
                      ]}
                    >
                      <Pressable
                        onPress={() => toggleKnow(k.key)}
                        style={styles.knowsHead}
                      >
                        {/* Dusk-tinted icon box (30×30) */}
                        <View style={styles.knowsIconBox}>
                          <Text style={styles.knowsIconBoxGlyph}>
                            {k.glyph}
                          </Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          {/* Label + confidence dots */}
                          <View style={styles.knowsLabelRow}>
                            <Text style={styles.knowsRowLabel}>
                              {k.title}
                            </Text>
                            <ConfidenceDots level={k.confidence} />
                          </View>
                          {/* Value text */}
                          <Text
                            style={styles.knowsRowValue}
                            numberOfLines={2}
                          >
                            {k.line}
                          </Text>
                          {/* Visualization — varies per insight */}
                          {k.viz === 'curve' && (
                            <View style={styles.knowsVizWrap}>
                              <RhythmCurve sharp={sharpWindow} />
                            </View>
                          )}
                          {k.viz === 'ribbon' && (
                            <View style={styles.knowsVizWrap}>
                              <MiniRibbon
                                wakeMin={anchors.wake}
                                sleepMin={anchors.sleep}
                                middayHour={windowOverrides.midday}
                                afternoonHour={windowOverrides.afternoon}
                                eveningHour={windowOverrides.evening}
                              />
                            </View>
                          )}
                          {k.viz === 'tags' && k.tags && (
                            <View style={styles.knowsTagsRow}>
                              {k.tags.map((t) => (
                                <View key={t} style={styles.knowsTag}>
                                  <Text style={styles.knowsTagText}>{t}</Text>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.knowsChev,
                            open && { transform: [{ rotate: '90deg' }] },
                          ]}
                        >
                          ›
                        </Text>
                      </Pressable>
                      {open && (
                        <View style={styles.knowsDetailWrap}>
                          <Text style={styles.knowsDetail}>{k.detail}</Text>
                          {k.action && (
                            <Pressable
                              onPress={() => handleInsightAction(k.action)}
                              style={styles.knowsAction}
                            >
                              <Text
                                style={[
                                  styles.knowsActionText,
                                  { color: accent.fg },
                                ]}
                              >
                                Adjust this →
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>

            {/* Footer reassurance — dusk-tinted, calm */}
            <View style={styles.knowsFooterWrap}>
              <View style={styles.knowsFooterCard}>
                <Text style={styles.knowsFooterGlyph}>✦</Text>
                <Text style={styles.knowsFooterText}>
                  This stays yours. Lumi learns only to lighten your
                  load — never to judge it.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── 4 · PERSONALIZE ─────────────────────────────────────── */}
        <View style={styles.sectionWrap}>
          <SectionLabel>Personalize</SectionLabel>
          <Card>
            {/* Rhythm — 2-col grid of icon-chip cards (mockup §1).
                Each chip has an accent-tinted icon box + label;
                selected = ember border + tinted background + bone label.
                Lumi leans hardest quests into the sharp window. */}
            <View style={styles.personalCell}>
              <Text style={styles.personalLabel}>When you’re sharpest</Text>
              <Text style={styles.personalHint}>
                Lumi leans your hardest quests into this window.
              </Text>
              <View style={styles.chronoGrid}>
                {RHYTHMS.map((r) => {
                  const on = rhythm === r.key;
                  return (
                    <Pressable
                      key={r.key}
                      onPress={() => pickRhythm(r.key)}
                      style={[
                        styles.chronoChip,
                        on && {
                          backgroundColor: hexA(accent.fg, 0.12),
                          borderColor: accent.fg,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.chronoChipIconBox,
                          on
                            ? {
                                backgroundColor: hexA(accent.fg, 0.16),
                                borderColor: hexA(accent.fg, 0.4),
                              }
                            : {
                                backgroundColor: C.surface,
                                borderColor: C.hair,
                              },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chronoChipIcon,
                            { color: on ? accent.fg : C.boneDim },
                          ]}
                        >
                          {r.icon}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.chronoChipLabel,
                          {
                            color: on ? C.bone : C.boneDim,
                            fontFamily: on ? fonts.interSemi : fonts.inter,
                          },
                        ]}
                      >
                        {r.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Anchors (expandable) */}
            {/* Wrapping View so measureLayout has a real host
                component to target. Pressable forwards refs as a
                logical wrapper, not a native view — calling
                measureLayout on it crashes ("must be called with a
                ref to a native component"). collapsable=false keeps
                the View from being optimized out on Android. */}
            <View ref={anchorsTriggerRef} collapsable={false}>
            <Pressable
              onPress={toggleAnchors}
              style={styles.anchorsHead}
            >
              <View
                style={[
                  styles.personalIconBox,
                  {
                    backgroundColor: hexA(C.honey, 0.1),
                    borderColor: hexA(C.honey, 0.28),
                  },
                ]}
              >
                <Text
                  style={[
                    styles.personalIconBoxGlyph,
                    { color: C.honey },
                  ]}
                >
                  ❖
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.personalRowLabel}>Daily anchors</Text>
                <Text style={styles.personalRowSub}>
                  Wake {fmtTime(anchors.wake)} · Sleep {fmtTime(anchors.sleep)}
                </Text>
              </View>
              <Text
                style={[
                  styles.anchorsChev,
                  anchorsOpen && { transform: [{ rotate: '90deg' }] },
                ]}
              >
                ›
              </Text>
            </Pressable>
            </View>
            {anchorsOpen && (
              <View style={styles.anchorsList}>
                {/* Live "shape of your day" ribbon — colored part-of-
                   day bands with anchor markers on top. Reflows the
                   instant the user nudges any anchor, so the
                   abstract numbers become a tangible day. */}
                <View style={styles.dayRibbonWrap}>
                  <DayRibbon
                    wakeMin={anchors.wake}
                    sleepMin={anchors.sleep}
                    middayHour={windowOverrides.midday}
                    afternoonHour={windowOverrides.afternoon}
                    eveningHour={windowOverrides.evening}
                    anchors={ANCHOR_DEFS.map((a) => ({
                      key: a.key,
                      minutes: anchors[a.key],
                    }))}
                  />
                </View>

                {ANCHOR_DEFS.map((a) => {
                  const v = anchors[a.key];
                  return (
                    <View key={a.key} style={styles.anchorRow}>
                      <Text style={styles.anchorRowGlyph}>{a.glyph}</Text>
                      <Text style={styles.anchorRowLabel}>{a.label}</Text>
                      <Pressable
                        onPress={() => nudgeAnchor(a.key, -15)}
                        style={styles.anchorStepBtn}
                      >
                        <Text style={styles.anchorStepText}>−</Text>
                      </Pressable>
                      <Text
                        style={[
                          styles.anchorTime,
                          { color: accent.fg },
                        ]}
                      >
                        {fmtTime(v)}
                      </Text>
                      <Pressable
                        onPress={() => nudgeAnchor(a.key, 15)}
                        style={styles.anchorStepBtn}
                      >
                        <Text style={styles.anchorStepText}>+</Text>
                      </Pressable>
                    </View>
                  );
                })}
                <Pressable
                  onPress={() => setWindowsOpen(true)}
                  style={styles.anchorsWindowsLink}
                >
                  <Text
                    style={[
                      styles.anchorsWindowsLinkText,
                      { color: accent.fg },
                    ]}
                  >
                    Edit part-of-day windows →
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Companion Mode — collapsible dropdown.
                Collapsed: shows current pick + chevron, same
                visual pattern as Daily anchors.
                Expanded: reveals the three preset cards. */}
            {(() => {
              const modeOptions = [
                {
                  k: 'full' as const,
                  title: 'Full',
                  sub: `${petName} + the room + XP — a cozy companion that organizes you`,
                },
                {
                  k: 'minimal' as const,
                  title: 'Minimal',
                  sub: `Small quiet ${petName}, streak kept, XP & unlocks hidden — a warm clean organizer`,
                },
                {
                  k: 'focused' as const,
                  title: 'Focused',
                  sub: 'No cat, no game — a pure calm AI organizer',
                },
              ];
              const current = modeOptions.find((o) => o.k === companionMode);
              return (
                <>
                  <Pressable
                    onPress={toggleCompanion}
                    style={styles.anchorsHead}
                  >
                    <View
                      style={[
                        styles.personalIconBox,
                        {
                          backgroundColor: hexA(C.ember, 0.1),
                          borderColor: hexA(C.ember, 0.28),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.personalIconBoxGlyph,
                          { color: C.ember },
                        ]}
                      >
                        ✦
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personalRowLabel}>
                        How playful is Lumi?
                      </Text>
                      <Text style={styles.personalRowSub}>
                        {current?.title ?? 'Full'} ·{' '}
                        {companionMode === 'full'
                          ? 'cozy companion'
                          : companionMode === 'minimal'
                            ? 'warm clean organizer'
                            : 'pure calm AI organizer'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.anchorsChev,
                        companionOpen && {
                          transform: [{ rotate: '90deg' }],
                        },
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>
                  {companionOpen && (
                    <View style={[styles.companionModeRow, { marginTop: 12 }]}>
                      <Text style={styles.personalHint}>
                        Dial the companion up or down anytime. Your
                        level, streak, and progress keep accruing in
                        every mode — switching back later changes
                        nothing.
                      </Text>
                      {(
                        [
                          {
                            k: 'full' as const,
                            title: 'Full',
                            tag: 'cozy companion',
                            desc: `${petName} + the room + XP — a companion that organizes you.`,
                            feats: { Luna: true, Room: true, Streak: true, XP: true },
                          },
                          {
                            k: 'minimal' as const,
                            title: 'Minimal',
                            tag: 'warm & clean',
                            desc: `A small, quiet ${petName}. Streak kept; XP & unlocks tucked away.`,
                            feats: { Luna: true, Room: false, Streak: true, XP: false },
                          },
                          {
                            k: 'focused' as const,
                            title: 'Focused',
                            tag: 'pure calm',
                            desc: 'No cat, no game — a clean AI organizer, nothing else.',
                            feats: { Luna: false, Room: false, Streak: false, XP: false },
                          },
                        ] as const
                      ).map((opt) => {
                        const on = companionMode === opt.k;
                        return (
                          <Pressable
                            key={opt.k}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setCompanionMode(opt.k);
                            }}
                            style={[
                              styles.playfulCard,
                              on && styles.playfulCardOn,
                            ]}
                          >
                            <ModePreview mode={opt.k} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <View style={styles.playfulHeader}>
                                <Text
                                  style={[
                                    styles.playfulTitle,
                                    on && { color: accent.fg },
                                  ]}
                                >
                                  {opt.title}
                                </Text>
                                <View
                                  style={[
                                    styles.playfulRadio,
                                    on
                                      ? {
                                          borderColor: accent.fg,
                                          backgroundColor: accent.fg,
                                        }
                                      : { borderColor: '#5A5650' },
                                  ]}
                                >
                                  {on && (
                                    <Text style={styles.playfulRadioCheck}>
                                      ✓
                                    </Text>
                                  )}
                                </View>
                              </View>
                              <Text
                                style={[
                                  styles.playfulTag,
                                  on && { color: hexA(accent.fg, 0.85) },
                                ]}
                              >
                                {opt.tag.toUpperCase()}
                              </Text>
                              <Text style={styles.playfulDesc}>
                                {opt.desc}
                              </Text>
                              <View style={styles.playfulPillsRow}>
                                {(['Luna', 'Room', 'Streak', 'XP'] as const).map(
                                  (f) => {
                                    const lit = opt.feats[f];
                                    return (
                                      <View
                                        key={f}
                                        style={[
                                          styles.playfulPill,
                                          lit
                                            ? on
                                              ? {
                                                  backgroundColor: hexA(
                                                    accent.fg,
                                                    0.14,
                                                  ),
                                                  borderColor: hexA(
                                                    accent.fg,
                                                    0.4,
                                                  ),
                                                }
                                              : {
                                                  backgroundColor: '#1F1813',
                                                  borderColor: '#2A2420',
                                                }
                                            : {
                                                backgroundColor: 'transparent',
                                                borderColor: hexA('#2A2420', 0.5),
                                              },
                                        ]}
                                      >
                                        <Text
                                          style={[
                                            styles.playfulPillText,
                                            lit
                                              ? on
                                                ? { color: '#E0A488' }
                                                : { color: '#B0A38B' }
                                              : {
                                                  color: '#5A5650',
                                                  textDecorationLine:
                                                    'line-through',
                                                },
                                          ]}
                                        >
                                          {f}
                                        </Text>
                                      </View>
                                    );
                                  },
                                )}
                              </View>
                            </View>
                          </Pressable>
                        );
                      })}

                      {/* Reassurance footer */}
                      <View style={styles.playfulReassure}>
                        <Svg width={16} height={16} viewBox="0 0 24 24">
                          <Path
                            d="M3.5 9a9 9 0 1 1-1 5"
                            stroke="#869072"
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                          <Path
                            d="M3 4v5h5"
                            stroke="#869072"
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </Svg>
                        <Text style={styles.playfulReassureText}>
                          Switching is always reversible — nothing you’ve
                          earned is ever lost.
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              );
            })()}

            {/* ── Calendar — enhanced "connection" card ──────────────
                Ported from lumi-calendar-settings.jsx. Three visual
                tiers depending on state:
                  - Not connected → row-style trigger + connect CTA
                  - Connected     → live status header (collapsible),
                                    auto-add card w/ what-syncs chips,
                                    multi-select calendar picker,
                                    weekly sync stat, calm disconnect
            */}
            {(() => {
              const LICHEN = '#869072';
              const DUSK = '#8EA0B4';
              const connectedCals = calendarList.filter((c) =>
                calendarIds.includes(c.id),
              );
              // Week stat — count quests whose calendarEventIds map is
              // populated AND that were created in the last 7 days.
              // Cheap O(n) walk; quests list is bounded.
              const weekSynced = (() => {
                const now = Date.now();
                const week = 7 * 86400000;
                return quests.filter(
                  (q) =>
                    q.calendarEventIds &&
                    Object.keys(q.calendarEventIds).length > 0 &&
                    new Date(q.createdAt).getTime() > now - week,
                ).length;
              })();
              return (
                <>
                  {/* Trigger row — same shape as Anchors / Companion
                      so it sits visually consistent in the Personalize
                      group when collapsed. */}
                  <Pressable
                    onPress={toggleCalendar}
                    style={styles.anchorsHead}
                  >
                    <View
                      style={[
                        styles.personalIconBox,
                        {
                          backgroundColor: hexA(C.dusk, 0.1),
                          borderColor: hexA(C.dusk, 0.28),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.personalIconBoxGlyph,
                          { color: C.dusk },
                        ]}
                      >
                        ◷
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personalRowLabel}>Calendar</Text>
                      <Text style={styles.personalRowSub}>
                        {calendarEnabled
                          ? autoSyncTasksWithTimes
                            ? connectedCals.length === 1
                              ? `Syncing to ${connectedCals[0].title}`
                              : connectedCals.length > 1
                                ? `Syncing to ${connectedCals.length} calendars`
                                : 'Connected · pick a calendar'
                            : 'Connected · auto-sync off'
                          : 'Not connected'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.anchorsChev,
                        calendarOpen && { transform: [{ rotate: '90deg' }] },
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>

                  {calendarOpen && (
                    <View style={[styles.companionModeRow, { marginTop: 12 }]}>
                      {!calendarEnabled ? (
                        // ── Not connected: gentle intro + CTA ──
                        <>
                          <Text style={styles.personalHint}>
                            Lumi can add tasks with a time to whichever
                            calendar you already use — Apple, Google,
                            Outlook. Off until you turn it on.
                          </Text>
                          <Pressable
                            onPress={connectCalendar}
                            disabled={calendarBusy}
                            style={[
                              styles.companionModeCard,
                              {
                                backgroundColor: hexA(accent.fg, 0.08),
                                borderColor: accent.fg,
                                alignItems: 'center',
                                opacity: calendarBusy ? 0.6 : 1,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.companionModeTitle,
                                { color: accent.fg },
                              ]}
                            >
                              {calendarBusy ? 'Connecting…' : 'Connect calendar'}
                            </Text>
                          </Pressable>
                          {calendarError && (
                            <Text
                              style={[
                                styles.personalHint,
                                { color: '#C97A6E' },
                              ]}
                            >
                              {calendarError}
                            </Text>
                          )}
                        </>
                      ) : (
                        // ── Connected: rich design per mockup ──
                        <>
                          {/* Status header — live "Connected" pill +
                              pulsing dot + "Synced just now" line. */}
                          <View
                            style={[
                              styles.calStatusCard,
                              { borderColor: hexA(LICHEN, 0.35) },
                            ]}
                          >
                            <View style={styles.calStatusGlyphBox}>
                              <Text style={styles.calStatusGlyph}>📅</Text>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <View style={styles.calStatusRow}>
                                <Text style={styles.calStatusTitle}>
                                  Your calendar
                                </Text>
                                <View
                                  style={[
                                    styles.calConnectedPill,
                                    {
                                      borderColor: hexA(LICHEN, 0.4),
                                      backgroundColor: hexA(LICHEN, 0.14),
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.calConnectedPillText,
                                      { color: LICHEN },
                                    ]}
                                  >
                                    Connected
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.calStatusSubRow}>
                                <PulseDot color={LICHEN} />
                                <Text style={styles.calStatusSub}>
                                  {connectedCals.length > 0
                                    ? 'In sync'
                                    : 'Pick a calendar below'}
                                </Text>
                              </View>
                            </View>
                          </View>

                          {/* Auto-add card */}
                          <View
                            style={[
                              styles.calAutoCard,
                              autoSyncTasksWithTimes && {
                                borderColor: hexA(accent.fg, 0.35),
                                backgroundColor: hexA(accent.fg, 0.06),
                              },
                            ]}
                          >
                            <View style={styles.calAutoHead}>
                              <View style={{ flex: 1, paddingRight: 12 }}>
                                <Text style={styles.calAutoTitle}>
                                  Auto-add timed tasks
                                </Text>
                                <Text style={styles.calAutoBody}>
                                  Tasks with a time flow to your
                                  calendars automatically — and stay in
                                  step when you reschedule or delete.
                                </Text>
                              </View>
                              <Switch
                                value={autoSyncTasksWithTimes}
                                onValueChange={(v) => {
                                  Haptics.selectionAsync();
                                  setAutoSyncTasksWithTimes(v);
                                }}
                                trackColor={{
                                  false: '#3A322B',
                                  true: accent.fg,
                                }}
                                thumbColor="#F4EBDB"
                              />
                            </View>
                            {/* What syncs — three chips */}
                            <View
                              style={[
                                styles.calChipsRow,
                                {
                                  opacity: autoSyncTasksWithTimes ? 1 : 0.4,
                                },
                              ]}
                            >
                              {[
                                { icon: '＋', label: 'Added' },
                                { icon: '⟳', label: 'Rescheduled' },
                                { icon: '✕', label: 'Deleted' },
                              ].map((s) => (
                                <View key={s.label} style={styles.calChip}>
                                  <Text
                                    style={[
                                      styles.calChipIcon,
                                      { color: accent.fg },
                                    ]}
                                  >
                                    {s.icon}
                                  </Text>
                                  <Text style={styles.calChipLabel}>
                                    {s.label}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>

                          {/* Multi-select calendar picker */}
                          <Text style={styles.calSectionLabel}>
                            Lumi writes to
                          </Text>
                          {calendarList.length === 0 ? (
                            <Text style={styles.personalHint}>
                              Looking for calendars…
                            </Text>
                          ) : (
                            calendarList.map((c) => {
                              const on = calendarIds.includes(c.id);
                              return (
                                <Pressable
                                  key={c.id}
                                  onPress={() => {
                                    Haptics.selectionAsync();
                                    toggleCalendarId(c.id);
                                  }}
                                  style={[
                                    styles.calPickRow,
                                    on && {
                                      borderColor: accent.fg,
                                      backgroundColor: hexA(accent.fg, 0.07),
                                    },
                                  ]}
                                >
                                  <View
                                    style={{
                                      width: 12,
                                      height: 12,
                                      borderRadius: 6,
                                      backgroundColor: c.color || accent.fg,
                                    }}
                                  />
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text
                                      style={[
                                        styles.calPickTitle,
                                        on && { color: '#ECE0CB' },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {c.title}
                                    </Text>
                                    {c.source ? (
                                      <Text
                                        style={styles.calPickSub}
                                        numberOfLines={1}
                                      >
                                        {c.source}
                                      </Text>
                                    ) : null}
                                  </View>
                                  <View
                                    style={[
                                      styles.calPickCheck,
                                      {
                                        borderColor: on
                                          ? accent.fg
                                          : '#5A5650',
                                        backgroundColor: on
                                          ? accent.fg
                                          : 'transparent',
                                      },
                                    ]}
                                  >
                                    {on && (
                                      <Text
                                        style={{
                                          color: '#120E0C',
                                          fontFamily: fonts.interSemi,
                                          fontSize: 12,
                                        }}
                                      >
                                        ✓
                                      </Text>
                                    )}
                                  </View>
                                </Pressable>
                              );
                            })
                          )}

                          {/* Weekly stat — dusk-lit, gentle */}
                          {weekSynced > 0 && (
                            <View
                              style={[
                                styles.calWeekStat,
                                {
                                  borderColor: hexA(DUSK, 0.25),
                                  backgroundColor: hexA(DUSK, 0.07),
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.calWeekStatGlyph,
                                  { color: DUSK },
                                ]}
                              >
                                ✦
                              </Text>
                              <Text style={styles.calWeekStatText}>
                                <Text style={styles.calWeekStatNum}>
                                  {weekSynced}{' '}
                                  {weekSynced === 1 ? 'task' : 'tasks'}
                                </Text>
                                {' '}kept in sync this week.
                              </Text>
                            </View>
                          )}

                          {/* Disconnect — calm centered link */}
                          <Pressable
                            onPress={disconnectCalendar}
                            style={styles.anchorsWindowsLink}
                          >
                            <Text
                              style={[
                                styles.anchorsWindowsLinkText,
                                { color: hexA(accent.fg, 0.85) },
                              ]}
                            >
                              Disconnect calendar
                            </Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                </>
              );
            })()}

            {/* Theme accent */}
            <View style={styles.personalCell}>
              <View style={styles.personalLabelRow}>
                <Text style={styles.personalLabel}>App accent</Text>
                {!isPremium && (
                  <Text style={styles.premiumChipText}>Premium</Text>
                )}
              </View>
              <View style={styles.themeRow}>
                {THEMES.map((t) => {
                  const on = theme === t.k;
                  const locked = !isPremium && t.k !== 'ember';
                  return (
                    <Pressable
                      key={t.k}
                      onPress={() => pickTheme(t.k)}
                      style={[
                        styles.themeSwatch,
                        {
                          backgroundColor: t.color,
                          borderColor: on ? C.bone : 'transparent',
                          opacity: locked ? 0.45 : 1,
                        },
                      ]}
                    >
                      {on && <Text style={styles.themeSwatchCheck}>✓</Text>}
                    </Pressable>
                  );
                })}
                <Text style={styles.duskNote}>dusk stays Lumi's</Text>
              </View>
            </View>

            {/* Pet skin picker */}
            <View style={[styles.personalCell, { borderBottomWidth: 0 }]}>
              <Text style={styles.personalLabel}>{petName}&apos;s look</Text>
              <View style={styles.skinRow}>
                {skinChoices.map((s) => {
                  const on = avatar === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        useUserStore.getState().setAvatar(s.id);
                      }}
                      style={[
                        styles.skinCell,
                        {
                          backgroundColor: on
                            ? hexA(accent.fg, 0.12)
                            : C.surface,
                          borderColor: on ? accent.fg : C.hair,
                        },
                      ]}
                    >
                      <View style={styles.skinSprite}>
                        <SkinLuna size={42} skinId={s.id} />
                      </View>
                      <Text
                        style={[
                          styles.skinLabel,
                          {
                            color: on ? C.bone : C.mute,
                            fontFamily: on ? fonts.interSemi : fonts.inter,
                          },
                        ]}
                      >
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={() => setEditOpen(true)}
                style={{ marginTop: 12 }}
              >
                <Text style={[styles.moreSkinsLink, { color: accent.fg }]}>
                  More skins →
                </Text>
              </Pressable>
            </View>
          </Card>
        </View>

        {/* ── 5 · YOUR WEEKS ──────────────────────────────────────── */}
        {weeks.length > 0 && (
          <View style={styles.sectionWrap}>
            <SectionLabel>Your weeks</SectionLabel>
            <View style={{ gap: 9 }}>
              {weeks.map((w) => (
                <Pressable
                  key={w.start.toISOString()}
                  onPress={() => router.push('/recap')}
                  style={styles.weekCard}
                >
                  <View
                    style={[styles.weekStripe, { backgroundColor: w.mood }]}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.weekRange}>{w.range}</Text>
                    <Text style={styles.weekNote}>{w.note}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.weekDone, { color: w.mood }]}>
                      {w.done}
                    </Text>
                    <Text style={styles.weekDoneLabel}>done</Text>
                  </View>
                </Pressable>
              ))}
            </View>
            {totalWeeks > 4 && (
              <Pressable
                onPress={() => router.push('/recap')}
                style={{ marginTop: 12, alignSelf: 'center' }}
              >
                <Text style={styles.weeksMoreLink}>
                  see all {totalWeeks} weeks →
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── 6 · MEMBERSHIP ──────────────────────────────────────── */}
        <View style={styles.sectionWrap}>
          <SectionLabel>Membership</SectionLabel>
          {isPremium ? (
            <Card style={{ padding: 18 }}>
              <View style={styles.premiumHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.premiumTitle}>
                    {trialActive ? 'Free trial' : 'Premium · active'}
                  </Text>
                  <Text style={styles.premiumSub}>{planLabel}</Text>
                </View>
                <View style={styles.premiumStatusPill}>
                  <Text style={styles.premiumStatusText}>
                    {trialActive ? 'Trial' : 'Active'}
                  </Text>
                </View>
              </View>
              <View style={styles.premiumBtnRow}>
                <Pressable onPress={manageSubscription} style={styles.subBtn}>
                  <Text style={styles.subBtnText}>Manage plan</Text>
                </Pressable>
                <Pressable onPress={manageSubscription} style={styles.subBtn}>
                  <Text style={styles.subBtnText}>Billing</Text>
                </Pressable>
              </View>
            </Card>
          ) : (
            <View
              style={[
                styles.upgradeCard,
                {
                  backgroundColor: hexA(accent.fg, 0.1),
                  borderColor: accent.fg,
                },
              ]}
            >
              <SoftGlow
                color={accent.fg}
                opacity={0.18}
                fade={0.7}
                cx={0.9}
                cy={0.1}
                style={StyleSheet.absoluteFill as object}
              />
              <Text style={styles.upgradeTitle}>Unlock the full Lumi</Text>
              <Text style={styles.upgradeBody}>
                Unlimited AI sorting, your full weekly reflection, and every
                world &amp; companion.
              </Text>
              <Pressable
                onPress={() => router.push('/paywall')}
                style={[styles.upgradeBtn, { backgroundColor: accent.fg }]}
              >
                <Text style={styles.upgradeBtnText}>
                  See Premium · 7-day free trial
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── 7a · NUDGES & REMINDERS ─────────────────────────────── */}
        <Group title="Nudges & reminders">
          <NotifRow
            icon="✦"
            label="Gentle nudges"
            sub="a soft tap for what's next"
            prefKey="nudges"
            value={notifPrefs.nudges}
            onChange={(v) => setNotifPref('nudges', v)}
          />
          <NotifRow
            icon="◷"
            label="Weekly reflection"
            sub="your Sunday recap is ready"
            prefKey="recap"
            value={notifPrefs.recap}
            onChange={(v) => setNotifPref('recap', v)}
          />
          <NotifRow
            icon="🔁"
            label="Recurring reminders"
            sub="for quests you've set to repeat"
            prefKey="recurring"
            value={notifPrefs.recurring}
            onChange={(v) => setNotifPref('recurring', v)}
          />
          <NotifRow
            icon="☾"
            label="Quiet hours"
            sub={`nothing after ${fmtTime(anchors.sleep)}`}
            prefKey="quiet"
            value={notifPrefs.quiet}
            onChange={(v) => setNotifPref('quiet', v)}
            last
          />
        </Group>

        {/* ── 7b · INPUT & PRIVACY ────────────────────────────────── */}
        <Group title="Input & privacy">
          <Row
            icon="🎙"
            label="Voice input"
            sub="talk out your brain-dumps"
            right={
              <Switch
                value={voiceEnabled}
                onValueChange={(v) => {
                  Haptics.selectionAsync();
                  setVoiceEnabled(v);
                }}
                trackColor={{ false: C.surface, true: accent.fg }}
                thumbColor={voiceEnabled ? C.void : C.boneDim}
                ios_backgroundColor={C.surface}
              />
            }
          />
          <Row
            icon="⌨"
            label="Capture language"
            sub={languageLabel(captureLang)}
            onPress={() => setLangOpen(true)}
          />
          <Row
            icon="⬇"
            label="Export everything"
            sub="your tasks, weeks & notes"
            onPress={handleExport}
          />
          <Row
            icon="◐"
            label="Privacy & data"
            sub="what's stored, and where"
            onPress={() =>
              Alert.alert(
                'Privacy',
                'Your pattern data lives on your device first. When signed in it syncs to Supabase under row-level security so only you can read it. AI calls send the minimum needed and never train on your data.',
              )
            }
            last
          />
        </Group>

        {/* ── 7c · ACCOUNT ────────────────────────────────────────── */}
        <Group title="Account">
          <Row
            icon="✦"
            label="Subscription"
            sub={
              access.hasActiveSubscription
                ? `Pro · ${subscriptionTier === 'annual' ? 'Annual' : 'Monthly'}`
                : access.inTrial
                  ? `Trial · ${access.trialDaysLeft} day${access.trialDaysLeft === 1 ? '' : 's'} left`
                  : 'Free · upgrade any time'
            }
            onPress={() => router.push('/manage-subscription')}
          />
          <Row
            icon="✉"
            label="Email"
            sub={email}
            onPress={handleChangeEmail}
            last
          />
        </Group>

        {/* ── DEV — only in __DEV__ builds ────────────────────────── */}
        {__DEV__ && (
          <Group title="Dev">
            <Row
              icon="◐"
              label="LLM benchmark"
              sub="run the prompt suite vs the real model"
              onPress={() => router.push('/dev-benchmark')}
              last
            />
          </Group>
        )}

        {/* ── 8 · DATA REASSURANCE + SIGN OUT + DELETE ────────────── */}
        <View style={styles.reassureWrap}>
          <View style={styles.reassureInner}>
            <Text style={styles.reassureSpark}>♡</Text>
            <Text style={styles.reassureText}>
              Your thoughts stay yours. Everything's encrypted, never sold,
              and you can take it with you or erase it for good — anytime.
            </Text>
          </View>
        </View>

        <Pressable onPress={handleSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Pressable
          onPress={handleDelete}
          style={{ alignItems: 'center', paddingVertical: 8, marginTop: 4 }}
        >
          <Text style={styles.deleteLink}>Delete account</Text>
        </Pressable>

        <Text style={styles.footerVersion}>Lumi · v1.0 · made gently</Text>
      </ScrollView>

      <EditProfileSheet visible={editOpen} onClose={() => setEditOpen(false)} />
      <LanguagePickerSheet
        visible={langOpen}
        onClose={() => setLangOpen(false)}
      />
      <WindowEditorSheet
        visible={windowsOpen}
        onClose={() => setWindowsOpen(false)}
      />
    </SafeAreaView>
  );
}

// ── Notif toggle row — uses the platform Switch for the right control ──
const NotifRow = ({
  icon,
  label,
  sub,
  value,
  onChange,
  last,
}: {
  icon: string;
  label: string;
  sub: string;
  prefKey: keyof NotificationPrefs;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) => {
  const accent = useAccent();
  return (
    <Row
      icon={icon}
      label={label}
      sub={sub}
      right={
        <Switch
          value={value}
          onValueChange={(v) => {
            Haptics.selectionAsync();
            onChange(v);
          }}
          trackColor={{ false: C.surface, true: accent.fg }}
          thumbColor={value ? C.void : C.boneDim}
          ios_backgroundColor={C.surface}
        />
      }
      last={last}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────
// Styles — factory so the screen retints when the user picks a theme.
// ─────────────────────────────────────────────────────────────────────
const makeStyles = (accent: Accent) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.void },

    topBar: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    backCircle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: C.hair,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backGlyph: { fontSize: 18, color: C.boneDim, marginTop: -2 },
    topEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2.4,
      color: C.mute,
      textTransform: 'uppercase',
    },

    // ── 1 · Warm header ──
    headerWrap: {
      position: 'relative',
      borderRadius: 22,
      overflow: 'hidden',
      marginTop: 8,
      marginBottom: 22,
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: C.hair,
    },
    headerInner: {
      padding: 22,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    headerAvatar: {
      width: 84,
      height: 84,
      borderRadius: 22,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: hexA(C.honey, 0.3),
      backgroundColor: C.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerAvatarSprite: {
      // The cat GIF auto-centers via the parent's `alignItems` /
      // `justifyContent` — no absolute positioning needed. (Old SVG
      // sprite needed manual offset.)
      alignItems: 'center',
      justifyContent: 'center',
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    nameText: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 24,
      color: C.bone,
      letterSpacing: -0.4,
    },
    nameEdit: { fontSize: 12, color: C.mute },
    nameInput: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 24,
      color: C.bone,
      letterSpacing: -0.4,
      paddingBottom: 3,
      borderBottomWidth: 1.5,
      borderBottomColor: accent.fg,
    },
    memberSince: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.boneDim,
      marginTop: 5,
    },
    premiumTag: {
      alignSelf: 'flex-start',
      marginTop: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
      backgroundColor: hexA(C.glow, 0.12),
      borderWidth: 1,
      borderColor: hexA(C.glow, 0.35),
    },
    premiumTagSpark: { fontSize: 10, color: C.glow },
    premiumTagText: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: C.glow,
    },

    // ── 2 · Lifetime snapshot ──
    sectionWrap: { marginBottom: 26 },
    sectionLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2,
      color: C.mute,
      textTransform: 'uppercase',
      marginBottom: 12,
      paddingLeft: 2,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      // No `gap` here — instead each card has marginBottom and uses a
      // safe % width so two cards + the row's natural spacing fit
      // within 100% on every device. `gap` + percentage widths is a
      // common RN footgun: 48.7% × 2 + 9px overflows the viewport.
      justifyContent: 'space-between',
      rowGap: 10,
    },
    statCard: {
      width: '48.5%',
      borderRadius: 15,
      borderWidth: 1,
      padding: 15,
    },
    statValueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 2,
      // Italic Fraunces digit hooks extend above cap-height AND
      // outside the right edge — `paddingTop` clears the top, and the
      // text style's own `paddingRight` clears the trailing edge.
      paddingTop: 10,
    },
    statValue: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 30,
      letterSpacing: -1,
      // 1.6× font-size line-height so iOS's tight default text box
      // doesn't clip italic ascenders. Was 42 — still chopped tops
      // on iPhone 15+ at this size.
      lineHeight: 48,
      // Italic digits ({0, 3, 7, 9}) lean right and overhang their
      // measured box. Reserve a few pts so the trailing curve isn't
      // cut by the next view edge.
      paddingRight: 6,
    },
    statSuffix: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 16,
    },
    statLabel: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.boneDim,
      marginTop: 7,
    },

    // ── 3 · What Lumi knows (dusk) ──
    knowsWrap: {
      position: 'relative',
      borderRadius: 20,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.32),
      backgroundColor: hexA(C.dusk, 0.06),
    },
    knowsTopBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: hexA(C.dusk, 0.55),
    },
    knowsHeader: { padding: 18, paddingBottom: 8 },
    knowsEyebrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    knowsSpark: { fontSize: 13, color: C.dusk },
    knowsEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2,
      color: C.dusk,
      textTransform: 'uppercase',
    },
    knowsTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 18,
      color: C.bone,
      letterSpacing: -0.3,
      lineHeight: 24,
    },
    knowsList: { padding: 18, paddingTop: 0 },
    knowsEmpty: {
      padding: 8,
    },
    knowsEmptyText: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 13,
      color: C.boneDim,
      lineHeight: 19,
    },
    knowsRow: {},
    knowsRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.dusk, 0.16),
    },
    knowsHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
    },
    knowsGlyph: { fontSize: 14, width: 20, textAlign: 'center', color: C.dusk },
    knowsRowTitle: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.dusk,
      letterSpacing: 0.2,
      marginBottom: 2,
    },
    knowsRowLine: {
      fontFamily: fonts.interMed,
      fontSize: 14,
      color: C.bone,
      letterSpacing: -0.1,
    },
    knowsChev: {
      fontSize: 13,
      color: hexA(C.dusk, 0.7),
    },
    knowsDetailWrap: { paddingLeft: 32, paddingBottom: 14, paddingRight: 4 },
    knowsDetail: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.boneDim,
      lineHeight: 20,
    },
    knowsAction: { marginTop: 11 },
    knowsActionText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
    },

    // Mockup additions: learning meter, icon box, viz wrap, tags,
    // footer reassurance card. All dusk-tinted per the color law.
    learningMeterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      marginTop: 14,
    },
    learningMeterTrack: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: hexA(C.dusk, 0.16),
      overflow: 'hidden',
    },
    learningMeterFill: {
      height: '100%',
      backgroundColor: C.dusk,
      borderRadius: 2,
    },
    learningMeterLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 10.5,
      color: C.dusk,
      letterSpacing: 0.2,
    },
    knowsIconBox: {
      width: 30,
      height: 30,
      borderRadius: 9,
      backgroundColor: hexA(C.dusk, 0.1),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.25),
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    knowsIconBoxGlyph: {
      fontSize: 15,
      color: C.dusk,
    },
    knowsLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 3,
    },
    knowsRowLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 11.5,
      color: C.dusk,
      letterSpacing: 0.1,
    },
    knowsRowValue: {
      fontFamily: fonts.inter,
      fontSize: 14.5,
      color: C.bone,
      letterSpacing: -0.15,
      lineHeight: 18,
    },
    knowsVizWrap: {
      marginTop: 9,
    },
    knowsTagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      marginTop: 9,
    },
    knowsTag: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 100,
      backgroundColor: hexA(C.dusk, 0.12),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.3),
    },
    knowsTagText: {
      fontFamily: fonts.interSemi,
      fontSize: 10.5,
      color: '#A8B8C8',
      fontWeight: '600',
    },
    knowsFooterWrap: {
      padding: 18,
      paddingTop: 4,
    },
    knowsFooterCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 13,
      backgroundColor: hexA(C.dusk, 0.07),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.2),
    },
    knowsFooterGlyph: {
      fontSize: 13,
      color: C.dusk,
    },
    knowsFooterText: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.boneDim,
      lineHeight: 17,
    },

    // ── 4 · Personalize ──
    card: {
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 16,
      paddingHorizontal: 16,
    },
    personalCell: {
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.7),
    },
    personalLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 11,
    },
    personalLabel: {
      fontFamily: fonts.inter,
      fontSize: 13.5,
      color: C.bone,
      marginBottom: 10,
    },
    personalHint: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.mute,
      lineHeight: 17,
      marginTop: -4,
      marginBottom: 12,
    },
    companionModeRow: {
      gap: 8,
    },

    // ── Playful-setting cards (companion mode picker) ─────────────
    // Per lumi-playful-setting.jsx — each card shows a mini Home
    // preview on the left + title/tag/desc/feature-pills on the right.
    playfulCard: {
      flexDirection: 'row',
      gap: 14,
      padding: 14,
      borderRadius: 18,
      backgroundColor: C.void2,
      borderWidth: 1.5,
      borderColor: C.hair,
    },
    playfulCardOn: {
      borderColor: C.ember,
      backgroundColor: hexA(C.ember, 0.08),
      // Soft ember glow when selected
      shadowColor: C.ember,
      shadowOpacity: 0.18,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
    },
    playfulHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 2,
    },
    playfulTitle: {
      flex: 1,
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 20,
      color: C.bone,
      letterSpacing: -0.3,
    },
    playfulRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playfulRadioCheck: {
      color: C.void,
      fontSize: 12,
      fontFamily: fonts.interSemi,
    },
    playfulTag: {
      fontFamily: fonts.interSemi,
      fontSize: 9.5,
      letterSpacing: 1,
      color: C.mute,
      fontWeight: '700',
      marginBottom: 7,
    },
    playfulDesc: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.boneDim,
      lineHeight: 17,
      marginBottom: 10,
    },
    playfulPillsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    playfulPill: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 100,
      borderWidth: 1,
    },
    playfulPillText: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: -0.1,
    },
    playfulReassure: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      padding: 13,
      borderRadius: 13,
      backgroundColor: hexA('#869072', 0.06),
      borderWidth: 1,
      borderColor: hexA('#869072', 0.22),
      marginTop: 8,
    },
    playfulReassureText: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.boneDim,
      lineHeight: 17,
    },

    // ── Calendar (enhanced) ─────────────────────────────────────
    calStatusCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      backgroundColor: C.void2,
      marginBottom: 12,
    },
    calStatusGlyphBox: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.hair,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calStatusGlyph: {
      fontSize: 20,
    },
    calStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    calStatusTitle: {
      fontFamily: fonts.interSemi,
      fontSize: 15,
      color: C.bone,
      letterSpacing: -0.2,
    },
    calConnectedPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 100,
      borderWidth: 1,
    },
    calConnectedPillText: {
      fontFamily: fonts.interSemi,
      fontSize: 9.5,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    calStatusSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 3,
    },
    calStatusSub: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.mute,
    },
    calAutoCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: C.void2,
      padding: 14,
      marginBottom: 12,
    },
    calAutoHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    calAutoTitle: {
      fontFamily: fonts.interSemi,
      fontSize: 14.5,
      color: C.bone,
      marginBottom: 4,
      letterSpacing: -0.2,
    },
    calAutoBody: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.boneDim,
      lineHeight: 17,
    },
    calChipsRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    calChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: C.surface,
    },
    calChipIcon: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
    },
    calChipLabel: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.boneDim,
    },
    calSectionLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 9.5,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: C.mute,
      marginTop: 4,
      marginBottom: 8,
    },
    calPickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 13,
      borderRadius: 13,
      borderWidth: 1.5,
      borderColor: C.hair,
      backgroundColor: C.void2,
      marginBottom: 8,
    },
    calPickTitle: {
      fontFamily: fonts.interSemi,
      fontSize: 14,
      color: C.boneDim,
      letterSpacing: -0.1,
    },
    calPickSub: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.mute,
      marginTop: 1,
    },
    calPickCheck: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calWeekStat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      marginTop: 6,
      marginBottom: 12,
    },
    calWeekStatGlyph: {
      fontSize: 14,
    },
    calWeekStatText: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.boneDim,
      lineHeight: 17,
    },
    calWeekStatNum: {
      fontFamily: fonts.interSemi,
      color: C.bone,
    },
    companionModeCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.hair,
      paddingHorizontal: 13,
      paddingVertical: 11,
      backgroundColor: C.void2,
    },
    companionModeHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    companionModeTitle: {
      fontFamily: fonts.interSemi,
      fontSize: 14,
      color: C.bone,
      letterSpacing: -0.1,
    },
    companionModeCheck: {
      fontFamily: fonts.interSemi,
      fontSize: 14,
    },
    companionModeSub: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.boneDim,
      lineHeight: 17,
    },
    personalRowLabel: {
      fontFamily: fonts.inter,
      fontSize: 14.5,
      color: C.bone,
      letterSpacing: -0.1,
    },
    personalRowSub: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.mute,
      marginTop: 2,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },

    // ── Chronotype grid (mockup §1) ──
    chronoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 9,
      marginTop: 8,
    },
    chronoChip: {
      // 2-up grid via flex-basis ~half minus gap
      flexBasis: '47.5%',
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: C.hair,
      backgroundColor: C.void2,
    },
    chronoChipIconBox: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chronoChipIcon: {
      fontSize: 13,
      lineHeight: 15,
    },
    chronoChipLabel: {
      flex: 1,
      fontSize: 13,
      letterSpacing: -0.2,
      lineHeight: 16,
    },
    chip: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 100,
      borderWidth: 1,
    },
    chipText: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
    },

    anchorsHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.7),
    },
    anchorsGlyph: {
      fontSize: 15,
      width: 22,
      textAlign: 'center',
      color: C.boneDim,
    },
    // Mockup-style accent-icon box wrapping each trigger glyph.
    // 38×38 rounded square tinted with the row's accent color so
    // each setting reads as its own destination, not a generic row.
    personalIconBox: {
      width: 38,
      height: 38,
      borderRadius: 11,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    personalIconBoxGlyph: {
      fontSize: 16,
      lineHeight: 18,
    },
    anchorsChev: { fontSize: 18, color: C.ash },
    anchorsList: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.7),
    },
    dayRibbonWrap: {
      paddingHorizontal: 4,
      paddingTop: 8,
      paddingBottom: 14,
    },
    anchorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 7,
    },
    anchorRowGlyph: {
      fontSize: 14,
      width: 22,
      textAlign: 'center',
      color: C.honey,
    },
    anchorRowLabel: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 13.5,
      color: C.boneDim,
    },
    anchorStepBtn: {
      width: 30,
      height: 30,
      borderRadius: 8,
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.hair,
      alignItems: 'center',
      justifyContent: 'center',
    },
    anchorStepText: { color: C.boneDim, fontSize: 16, lineHeight: 18 },
    anchorTime: {
      minWidth: 74,
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 15,
    },
    anchorsWindowsLink: { marginTop: 8, paddingVertical: 4, paddingLeft: 34 },
    anchorsWindowsLinkText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
    },

    themeRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    themeSwatch: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeSwatchCheck: {
      color: C.void,
      fontSize: 13,
      fontFamily: fonts.interSemi,
    },
    duskNote: {
      marginLeft: 4,
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11,
      color: C.dusk,
    },
    premiumChipText: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      color: C.glow,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },

    skinRow: { flexDirection: 'row', gap: 8 },
    skinCell: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
    },
    skinSprite: {
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skinLabel: {
      fontSize: 10.5,
      marginTop: 2,
    },
    moreSkinsLink: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
      textAlign: 'center',
    },

    // ── 5 · Your weeks ──
    weekCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      padding: 14,
      paddingHorizontal: 15,
      borderRadius: 14,
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: C.hair,
    },
    weekStripe: {
      width: 4,
      alignSelf: 'stretch',
      borderRadius: 2,
    },
    weekRange: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 15,
      color: C.bone,
      letterSpacing: -0.2,
    },
    weekNote: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.boneDim,
      marginTop: 3,
      lineHeight: 17,
    },
    weekDone: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 18,
    },
    weekDoneLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 9,
      color: C.mute,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    weeksMoreLink: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.mute,
    },

    // ── 6 · Membership ──
    premiumHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 14,
    },
    premiumTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 18,
      color: C.bone,
    },
    premiumSub: {
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.boneDim,
      marginTop: 3,
    },
    premiumStatusPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
      backgroundColor: hexA(C.lichen, 0.12),
      borderWidth: 1,
      borderColor: hexA(C.lichen, 0.35),
    },
    premiumStatusText: {
      fontFamily: fonts.interSemi,
      fontSize: 10.5,
      color: C.lichen,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    premiumBtnRow: { flexDirection: 'row', gap: 9 },
    subBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 11,
      paddingVertical: 11,
      alignItems: 'center',
    },
    subBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
      color: C.boneDim,
    },
    upgradeCard: {
      position: 'relative',
      borderWidth: 1,
      borderRadius: 16,
      padding: 20,
      overflow: 'hidden',
    },
    upgradeTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 20,
      color: C.bone,
      marginBottom: 6,
    },
    upgradeBody: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.boneDim,
      lineHeight: 20,
      marginBottom: 16,
    },
    upgradeBtn: {
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
    },
    upgradeBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 13.5,
      color: C.void,
    },

    // ── 7 · Settings groups ──
    groupWrap: { marginBottom: 22 },
    groupCard: {
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 16,
      overflow: 'hidden',
      paddingHorizontal: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    rowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.7),
    },
    rowIcon: {
      fontSize: 15,
      width: 22,
      textAlign: 'center',
    },
    rowLabel: {
      fontFamily: fonts.inter,
      fontSize: 14.5,
      letterSpacing: -0.1,
      color: C.bone,
    },
    rowSub: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.mute,
      lineHeight: 17,
    },
    rowChev: { fontSize: 14, color: C.mute },

    // ── 8 · Data reassurance + sign out + delete ──
    reassureWrap: {
      borderRadius: 16,
      backgroundColor: hexA(C.dusk, 0.06),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.2),
      padding: 16,
      marginBottom: 18,
    },
    reassureInner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
    },
    reassureSpark: { fontSize: 14, color: C.dusk, marginTop: 1 },
    reassureText: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.boneDim,
      lineHeight: 20,
    },
    signOutBtn: {
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: 'center',
      marginBottom: 10,
    },
    signOutText: {
      fontFamily: fonts.interSemi,
      fontSize: 14,
      color: C.boneDim,
    },
    deleteLink: {
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.mute,
    },
    footerVersion: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.ash,
      marginTop: 18,
      textAlign: 'center',
    },
  });

// Default ember stylesheet for module-level sub-components (NotifRow,
// Row, Group, Card, SectionLabel). AccountScreen itself shadows this
// with a themed stylesheet via useMemo so its render reflects the
// active theme.
const styles = makeStyles(accentFor('ember'));
