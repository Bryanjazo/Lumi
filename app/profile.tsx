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
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  Alert,
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
import Svg, { Circle, Rect } from 'react-native-svg';

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

const RHYTHMS: { key: RhythmKey; label: string }[] = [
  { key: 'morning', label: 'Morning person' },
  { key: 'afternoon', label: 'Afternoon peak' },
  { key: 'night', label: 'Night owl' },
  { key: 'varies', label: 'It varies' },
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
  const subscriptionStatus = useUserStore((s) => s.subscriptionStatus);
  const subscriptionTier = useUserStore((s) => s.subscriptionTier);
  const subscriptionEnd = useUserStore((s) => s.subscriptionCurrentPeriodEnd);
  const sharpWindow = useUserStore((s) => s.sharpWindow);
  const struggles = useUserStore((s) => s.struggles);
  const anchors = useUserStore((s) => s.anchors);
  const setAnchor = useUserStore((s) => s.setAnchor);

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
  const knowsItems = useMemo(() => {
    const items: {
      key: string;
      glyph: string;
      title: string;
      line: string;
      detail: string;
      action?: 'anchors' | 'windows';
    }[] = [];

    // Rhythm
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
        action: 'windows',
      });
    }

    // A pattern Lumi noticed (recurring titles the user keeps doing)
    if (digest.recurrence[0]) {
      const p = digest.recurrence[0];
      items.push({
        key: 'pattern',
        glyph: '🔁',
        title: 'A pattern I noticed',
        line: p.title,
        detail: `You've done "${p.title}" — ${p.span.toLowerCase()}. Want me to surface it on its rhythm so it never sneaks up on you?`,
      });
    }

    // Daily anchors
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
      action: 'anchors',
    });

    // What you find hard (top struggles)
    if (struggles.length > 0) {
      const list = struggles
        .slice(0, 2)
        .map((s) => STRUGGLE_LABELS[s])
        .join(' · ');
      items.push({
        key: 'hard',
        glyph: '❍',
        title: 'What you find hard',
        line: list,
        detail: `${list} — so I hand you one small first step, and keep your plate to a doable few.`,
      });
    }

    // Focus pattern from follow-through stats
    if (digest.pattern) {
      items.push({
        key: 'focus',
        glyph: '◈',
        title: 'How you focus best',
        line: digest.pattern.headline,
        detail: digest.pattern.body,
      });
    }

    return items;
  }, [sharpWindow, anchors, struggles, digest]);

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

  const nudgeAnchor = (k: keyof DailyAnchors, delta: number) => {
    Haptics.selectionAsync();
    const cur = useUserStore.getState().anchors[k];
    setAnchor(k, cur + delta);
  };

  const handleInsightAction = (action?: 'anchors' | 'windows') => {
    if (action === 'anchors') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAnchorsOpen(true);
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
        <View style={styles.sectionWrap}>
          <View style={styles.knowsWrap}>
            <View style={styles.knowsTopBar} />
            <View style={styles.knowsHeader}>
              <View style={styles.knowsEyebrowRow}>
                <Text style={styles.knowsSpark}>✦</Text>
                <Text style={styles.knowsEyebrow}>What Lumi knows about you</Text>
              </View>
              <Text style={styles.knowsTitle}>
                The more we go, the better I know you.
              </Text>
            </View>
            <View style={styles.knowsList}>
              {knowsItems.length === 0 ? (
                <View style={styles.knowsEmpty}>
                  <Text style={styles.knowsEmptyText}>
                    I'm still getting to know you. The more you use Lumi, the
                    more this fills in.
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
                        i < knowsItems.length - 1 && styles.knowsRowDivider,
                      ]}
                    >
                      <Pressable
                        onPress={() => toggleKnow(k.key)}
                        style={styles.knowsHead}
                      >
                        <Text style={styles.knowsGlyph}>{k.glyph}</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.knowsRowTitle}>{k.title}</Text>
                          <Text style={styles.knowsRowLine} numberOfLines={2}>
                            {k.line}
                          </Text>
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
          </View>
        </View>

        {/* ── 4 · PERSONALIZE ─────────────────────────────────────── */}
        <View style={styles.sectionWrap}>
          <SectionLabel>Personalize</SectionLabel>
          <Card>
            {/* Rhythm */}
            <View style={styles.personalCell}>
              <Text style={styles.personalLabel}>When you're sharpest</Text>
              <View style={styles.chipRow}>
                {RHYTHMS.map((r) => {
                  const on = rhythm === r.key;
                  return (
                    <Pressable
                      key={r.key}
                      onPress={() => pickRhythm(r.key)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: on ? accent.fg : 'transparent',
                          borderColor: on ? accent.fg : C.hair,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: on ? C.void : C.boneDim },
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
            <Pressable onPress={toggleAnchors} style={styles.anchorsHead}>
              <Text style={styles.anchorsGlyph}>❖</Text>
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
            {anchorsOpen && (
              <View style={styles.anchorsList}>
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
      gap: 12,
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
    anchorsChev: { fontSize: 14, color: C.mute },
    anchorsList: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.7),
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
