// Lumi · Home v2 — "Right Now"
//
// Spec: lumi-home-v2-spec-2.md (and the mockup at lumi-home-v2.jsx).
// Thesis: fight task paralysis. Show ONE next thing, big and calm.
// Bring Luna onto the daily surface (she reacts to your wins). Demote
// the game layer to one quiet line. Everything else collapses below.
//
// What carried over from v1 (per spec §3):
//   - Single tasks table (questStore) as source of truth
//   - Full completion fan-out: XP + lifetime XP + shards + streak +
//     vitality (computed elsewhere) + Luna cheer + XP float
//   - Hero ranking: current window first, then importance/XP
//   - "show me another" anti-paralysis swap
//   - Capture-to-task (writes someday by default)
//   - Recurrence engine (suggestionsStore + detector); accept writes
//     `recur`, dismiss suppresses the title
//   - Spotlight tour on first launch after onboarding
//   - Refresh-recurring on mount
//
// What was intentionally dropped from v1:
//   - Full composer (mode pickers, recur sheet) → minimal inline capture
//   - Loot toasts, combo chain, rank-up toast → game layer is one line
//   - Wall-of-tasks → collapsed "Then, when you're ready"
//   - Multi-card Lumi-noticed carousel → ONE calm card
//   - Level/rank display → moved to Me tab (per spec §2)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams, router as globalRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { timeColors as C } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { lunaSource, useLunaSkin } from '../../lib/luna-source';
import { useAmbientLunaMood, textReadsOverwhelmed } from '../../lib/luna-mood';
import { useCompanionMode } from '../../lib/companion-mode';
import { IMPORTANCE, Importance } from '../../constants/importance';
import {
  WINDOWS,
  WIN_ORDER,
  WindowKey,
  useEffectiveWindows,
  currentWindowFor,
} from '../../constants/windows';
import { useUserStore } from '../../store/userStore';
import { useQuestStore, selectTodayQuests, Quest } from '../../store/questStore';
import {
  useSuggestionsStore,
  type Suggestion,
} from '../../store/suggestionsStore';
import {
  detectRecurrencePatterns,
  normalizeForSuppression,
  useLearningDigest,
} from '../../lib/learning';
import { useTour, useTourTarget } from '../../components/SpotlightTour';
import { useAccent, accentFor, type Accent } from '../../lib/theme';
import {
  parseSmartCapture,
  routeCapture,
  tidyTranscript,
  countUnknownWords,
  difficultyFromImportance,
  pickWindowForDemand,
  type CaptureContext,
  type SmartTask,
} from '../../lib/capture';
import { personalizeTasks } from '../../lib/personalize';
import { useAiMetricsStore } from '../../store/aiMetricsStore';
import {
  syncParseMetrics,
  markMetricEdited,
  logCaptureRaw,
} from '../../lib/telemetry';
import { awayStateFor, lastSeenDate, type AwayState } from '../../lib/away';
import { classifyKind } from '../../constants/taskKinds';
import {
  findStale,
  dominantStaleCluster,
} from '../../lib/learning/avoidance';
import { useRescueStore } from '../../store/rescueStore';
import { useNotifIntentStore } from '../../store/notifIntentStore';
import { useHomeFocusStore } from '../../store/homeFocusStore';
import { useAccessStatus } from '../../lib/subscription';
import { RescueCard } from '../../components/RescueCard';
import { WelcomeBackCard } from '../../components/WelcomeBackCard';
import {
  useVoice,
  isVoiceConfigured,
  isForeignVoiceSession,
} from '../../lib/voice';
import { useHeyLumi, requestHeyLumiPermission } from '../../lib/heyLumi';
import { HeyLumiSheet } from '../../components/HeyLumiSheet';
import { DaySetSheet } from '../../components/DaySetSheet';
import { todayKey } from '../../lib/gamification';
import { SoftGlow } from '../../components/SoftGlow';
import { TwinkleMotes } from '../../components/TwinkleMotes';
import { DayThread } from '../../components/DayThread';
import {
  findWindowSlot,
  resolveSlot,
  windowIsFull,
} from '../../lib/slotting';
import { useKeyboardHeight } from '../../lib/useKeyboard';
import { useDeleteConfirm } from '../../components/TaskDeleteWrap';
import { HabitScheduleSheet } from '../../components/HabitScheduleSheet';
import { MoveBackToDateSheet } from '../../components/MoveBackToDateSheet';
import { EditQuestSheet } from '../../components/EditQuestSheet';
import { MicIcon } from '../../components/MicIcon';
import {
  useCorrectionsStore,
  summarizeCorrections,
  type Correction,
} from '../../store/correctionsStore';
import {
  llmUnderstand,
  isLlmAvailable,
  llmClarify,
  type UnderstandContext,
  type UnderstoodTask,
} from '../../lib/anthropic';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';
import {
  LumiSuggestCard,
  type SuggestAcceptOptions,
} from '../../components/LumiSuggestCard';
import { LumiFocusCard } from '../../components/LumiFocusCard';
import { FocusTaskPickerModal } from '../../components/FocusTaskPickerModal';
import { HomeCaptureModal } from '../../components/HomeCaptureModal';
import {
  useFocusSession,
  selectRemainingSeconds,
} from '../../lib/focusSession';

// ═════════════════════════════════════════════════════════════════════
// LunaPeek — small cozy pixel cat that lives in the header. Reacts to
// wins via the `cheer` counter (a happy bounce + little hearts).
// Same SVG-sprite pattern used in profile/checkin. Swap for Ayu's
// commissioned art later — keep the interface identical.
// ═════════════════════════════════════════════════════════════════════
const LunaPeek = ({
  size = 70,
  cheer = 0,
}: {
  size?: number;
  cheer?: number;
}) => {
  const [, force] = useState(0);
  const tickRef = useRef({ t: 0, blink: 80, blinking: false, joy: 0 }).current;
  const lastCheerRef = useRef(cheer);

  // Cheer trigger — every increment kicks joy to 1.
  useEffect(() => {
    if (cheer !== lastCheerRef.current) {
      tickRef.joy = 1;
      lastCheerRef.current = cheer;
    }
  }, [cheer, tickRef]);

  useEffect(() => {
    let raf: number;
    const loop = () => {
      tickRef.t += 1;
      tickRef.blink -= 1;
      if (tickRef.blink <= 0) {
        tickRef.blinking = !tickRef.blinking;
        tickRef.blink = tickRef.blinking
          ? 3
          : 70 + Math.floor(Math.random() * 60);
      }
      tickRef.joy = Math.max(0, tickRef.joy - 0.012);
      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tickRef]);

  const joy = tickRef.joy;
  const bounce = Math.sin(tickRef.t * (0.05 + joy * 0.12)) * (1.2 + joy * 4);
  const V = 64;
  const cx = 32;
  const cyBody = 40 + bounce;
  const FUR = '#E8DAC0';
  const FUR2 = '#F5EAD0';
  const EAR = '#D88878';
  const OL = '#0E0A08';
  const hy = cyBody - 9;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${V} ${V}`}>
      {/* body */}
      <Circle cx={cx} cy={cyBody + 2} r={11} fill={FUR} />
      <Circle cx={cx} cy={cyBody + 4} r={7} fill={FUR2} />
      {/* feet */}
      <Circle cx={cx - 6} cy={cyBody + 11} r={3} fill={FUR} />
      <Circle cx={cx + 6} cy={cyBody + 11} r={3} fill={FUR} />
      {/* tail */}
      <Circle cx={cx + 10} cy={cyBody + 6} r={3} fill={FUR} />
      <Circle
        cx={cx + 13}
        cy={cyBody + 6 + Math.round(Math.sin(tickRef.t * 0.07) * 3)}
        r={2}
        fill={FUR2}
      />
      {/* head */}
      <Circle cx={cx} cy={hy} r={10} fill={OL} />
      <Circle cx={cx} cy={hy} r={9} fill={FUR} />
      {/* ears */}
      <Circle cx={cx - 7} cy={hy - 7} r={4} fill={FUR} />
      <Circle cx={cx + 7} cy={hy - 7} r={4} fill={FUR} />
      <Circle cx={cx - 7} cy={hy - 7} r={1.5} fill="rgba(216,136,120,0.6)" />
      <Circle cx={cx + 7} cy={hy - 7} r={1.5} fill="rgba(216,136,120,0.6)" />
      {/* cheek blush on joy */}
      {joy > 0.15 && (
        <>
          <Circle cx={cx - 6} cy={hy + 2} r={2} fill="rgba(216,136,120,0.3)" />
          <Circle cx={cx + 6} cy={hy + 2} r={2} fill="rgba(216,136,120,0.3)" />
        </>
      )}
      {/* eyes — blink or open */}
      {tickRef.blinking ? (
        <>
          <Rect x={cx - 5} y={hy - 1} width={3} height={2} fill={OL} />
          <Rect x={cx + 2} y={hy - 1} width={3} height={2} fill={OL} />
        </>
      ) : (
        <>
          <Circle cx={cx - 3.5} cy={hy} r={2.5} fill="#9AB4C4" />
          <Circle cx={cx + 3.5} cy={hy} r={2.5} fill="#9AB4C4" />
          <Circle cx={cx - 3.5} cy={hy} r={1.2} fill={OL} />
          <Circle cx={cx + 3.5} cy={hy} r={1.2} fill={OL} />
        </>
      )}
      {/* nose */}
      <Rect x={cx - 1} y={hy + 3} width={2} height={2} fill={EAR} />
      {/* mouth — happy smile when joyful, neutral else */}
      {joy > 0.2 ? (
        <Rect x={cx - 2} y={hy + 5} width={4} height={2} fill={OL} />
      ) : (
        <>
          <Rect x={cx} y={hy + 5} width={1} height={2} fill={OL} />
          <Rect x={cx - 2} y={hy + 6} width={2} height={1} fill={OL} />
          <Rect x={cx + 1} y={hy + 6} width={2} height={1} fill={OL} />
        </>
      )}
      {/* hearts on big cheer */}
      {joy > 0.4 && (
        <>
          <Rect
            x={cx + 9}
            y={hy - 12 - (1 - joy) * 8}
            width={2}
            height={2}
            fill={`rgba(224,160,180,${joy})`}
          />
          <Rect
            x={cx + 8}
            y={hy - 11 - (1 - joy) * 8}
            width={4}
            height={1}
            fill={`rgba(224,160,180,${joy})`}
          />
        </>
      )}
    </Svg>
  );
};

// ═════════════════════════════════════════════════════════════════════
// XpFloater — small "+N" that floats up from the Mark-it-done button.
// ═════════════════════════════════════════════════════════════════════
const XpFloater = ({ amount, color }: { amount: number; color: string }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.delay(420),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(ty, {
        toValue: -38,
        duration: 1100,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 1.15,
          friction: 5,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [opacity, ty, scale]);

  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        styles.floaterText,
        {
          color,
          opacity,
          transform: [{ translateY: ty }, { scale }],
        },
      ]}
    >
      +{amount}
    </Animated.Text>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════
const greeting = (h: number): string => {
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Winding down';
};

const formatDate = (d: Date): string => {
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const months = [
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
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
};

const whyLine = (
  q: Quest,
  inWindow: boolean,
  windowLabel: string,
): string => {
  if (inWindow && q.importance === 'high')
    return "The heavy one — easier now, while you're sharp.";
  if (inWindow) return `A good fit for your ${windowLabel.toLowerCase()}.`;
  if (q.importance === 'low') return 'A quick win to get moving.';
  if (q.importance === 'high')
    return "Big one, whenever you're ready — no rush.";
  return 'Next up when you want it.';
};

// ═════════════════════════════════════════════════════════════════════
// FollowupChip — tappable answer in the guided follow-up card.
// "Suggested" chips have a soft accent fill (Lumi pre-picked it).
// ═════════════════════════════════════════════════════════════════════
const FollowupChip = ({
  label,
  onPress,
  accentColor,
  suggested,
}: {
  label: string;
  onPress: () => void;
  accentColor: string;
  suggested?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.followupChip,
      suggested && {
        backgroundColor: `${accentColor}1F`,
        borderColor: accentColor,
      },
      pressed && { opacity: 0.7 },
    ]}
    hitSlop={4}
  >
    <Text
      style={[
        styles.followupChipText,
        suggested && {
          color: accentColor,
          fontFamily: fonts.interSemi,
        },
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

/** One-line "what Lumi guessed" caption for a previewed SmartTask:
 *  e.g. "11 pm today · evening", "tomorrow morning", "set to repeat 🔁",
 *  "someday list". Used inside the preview card. */
const previewMetaLine = (
  t: SmartTask,
  effective: ReturnType<typeof useEffectiveWindows>,
): string => {
  const winLabel = effective[t.window]?.label.toLowerCase() ?? t.window;
  const local = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const todayISO = local(new Date());
  const tomorrowISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return local(d);
  })();
  const dayWord =
    t.date === tomorrowISO ? 'tomorrow' : t.date === todayISO ? 'today' : t.date;
  if (t.recur) return 'set to repeat 🔁';
  if (t.window === 'someday') return 'someday list';
  if (t.timeMode === 'anchored' && t.at != null) {
    const h = Math.floor(t.at / 60);
    const m = t.at % 60;
    const hr = h % 12 || 12;
    const suf = h < 12 ? 'am' : 'pm';
    const timeStr =
      m === 0 ? `${hr} ${suf}` : `${hr}:${String(m).padStart(2, '0')} ${suf}`;
    return `${timeStr}${dayWord ? ` ${dayWord}` : ''} · ${winLabel}`;
  }
  return `${dayWord ? `${dayWord} ` : ''}${winLabel}`;
};

/** Render a quest's scheduled time as a short stamp ("8 pm", "2:30 pm").
 *  Returns null for windowed/someday quests so callers can skip the
 *  stamp entirely. */
const fmtScheduled = (q: Quest): string | null => {
  if (q.scheduledHour == null) return null;
  const h = q.scheduledHour;
  const m = q.scheduledMinute ?? 0;
  const hr = h % 12 || 12;
  const suf = h < 12 ? 'am' : 'pm';
  return m === 0
    ? `${hr} ${suf}`
    : `${hr}:${String(m).padStart(2, '0')} ${suf}`;
};

/** Always-visible × button at the top-right of the hero card so the
 *  user can dismiss a task they don't want to do. First-time users
 *  can SEE the affordance instead of needing to learn long-press.
 *  Hair-thin border + slight surface tint so it reads as a button
 *  on top of the card without competing for attention with the
 *  ember "Mark it done" CTA. */
/**
 * HeroOverflowMenu — ⋯ button at the top-right of the hero card with
 * a small popover (Edit / Delete). Replaces the previous floating ×
 * because the hero card now supports inline editing of title +
 * description, and putting both behind one menu keeps the calm
 * "one decision" feel of the card (single ember CTA stays the focal
 * point).
 *
 * Layout matches the second screenshot the user shared: rounded
 * pencil row on top in bone, trash row below in terra/destructive.
 */
const HeroOverflowMenu = ({
  quest,
  onEdit,
}: {
  quest: Quest;
  onEdit: (q: Quest) => void;
}) => {
  const [open, setOpen] = useState(false);
  // Screen-absolute anchor for the popover, captured the moment the
  // button is tapped. Without this the popover used a hard-coded top
  // that drifted above the dots on tall devices.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null,
  );
  const btnRef = useRef<View>(null);
  const screenW = Dimensions.get('window').width;
  const confirm = useDeleteConfirm(quest.id, quest.title);
  const openMenu = () => {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({
        // Sit just below the dots with a 6pt breathing gap.
        top: y + h + 6,
        // Right-align to the button's right edge.
        right: Math.max(8, screenW - (x + w)),
      });
      setOpen(true);
    });
  };
  return (
    <View
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 5,
      }}
    >
      <Pressable
        ref={btnRef}
        onPress={() => {
          Haptics.selectionAsync();
          if (open) setOpen(false);
          else openMenu();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="More actions"
        style={{
          width: 28,
          height: 28,
          // Rounded square (not a circle) per the user's reference
          // — softer corners, darker fill, dots ride the optical
          // middle.
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: open
            ? 'rgba(176,163,139,0.18)'
            : 'rgba(255,255,255,0.06)',
          borderWidth: 1,
          borderColor: 'rgba(176,163,139,0.22)',
          flexDirection: 'row',
          gap: 3,
        }}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 3,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: '#B0A38B',
            }}
          />
        ))}
      </Pressable>

      {open && anchor && (
        <>
          {/* Tap-outside scrim to dismiss. Mounted absolutely
              filling the whole viewport so a tap anywhere outside
              the popover closes it. */}
          <Modal
            visible
            transparent
            animationType="none"
            onRequestClose={() => setOpen(false)}
          >
            <Pressable
              onPress={() => setOpen(false)}
              style={{ flex: 1 }}
            >
              <View
                style={{
                  position: 'absolute',
                  // Anchored to the dots button's actual screen position
                  // (measured on open) so the popover always lands just
                  // below it on every device.
                  top: anchor.top,
                  right: anchor.right,
                  minWidth: 180,
                  borderRadius: 14,
                  backgroundColor: '#1A1512',
                  borderWidth: 1,
                  borderColor: 'rgba(176,163,139,0.25)',
                  paddingVertical: 6,
                  shadowColor: '#000',
                  shadowOpacity: 0.45,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 8 },
                  elevation: 12,
                }}
              >
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setOpen(false);
                    onEdit(quest);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.inter,
                      fontSize: 14,
                      color: '#ECE0CB',
                    }}
                  >
                    ✎
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.interSemi,
                      fontSize: 14,
                      color: '#ECE0CB',
                      letterSpacing: -0.1,
                    }}
                  >
                    Edit task
                  </Text>
                </Pressable>
                <View
                  style={{
                    height: 1,
                    backgroundColor: 'rgba(176,163,139,0.12)',
                    marginHorizontal: 12,
                  }}
                />
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setOpen(false);
                    confirm();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.inter,
                      fontSize: 14,
                      color: '#E07A4F',
                    }}
                  >
                    🗑
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.interSemi,
                      fontSize: 14,
                      color: '#E07A4F',
                      letterSpacing: -0.1,
                    }}
                  >
                    Delete task
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
        </>
      )}
    </View>
  );
};

/**
 * HeroComment — boxed "YOUR COMMENT" section on the hero card.
 *
 * Layout per lumi-home-v2 spec:
 *   ┌─────────────────────────────────────────────┐
 *   │ 💬  YOUR COMMENT                            │
 *   │ Front desk said to bring my insurance card  │
 *   │ AND Dr. Lee's referral from last week —     │
 *   │ the one about the left foot. They can't…    │
 *   │ more                                        │
 *   └─────────────────────────────────────────────┘
 *
 * Ember accent border + tint, italic Fraunces body, clamps to 3
 * lines with a `more` / `less` toggle when the comment overflows.
 * Overflow is auto-detected via onTextLayout, identical pattern to
 * the rest-row RestNote.
 */
/** SVG speech-bubble glyph for the YOUR COMMENT box. Matches the
 *  mock's stroke-only style instead of the emoji 💬 (which renders
 *  differently across iOS/Android and can't take the ember tint). */
const SpeechBubbleIcon = ({ color }: { color: string }) => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Path
      d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16H9l-4 3.5V6.5A1.5 1.5 0 0 1 6.5 5"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const HeroComment = ({
  comment,
  accentColor,
}: {
  comment: string;
  accentColor: string;
}) => {
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 9,
        paddingVertical: 11,
        paddingHorizontal: 13,
        borderRadius: 13,
        backgroundColor: hexA(accentColor, 0.1),
        borderWidth: 1,
        borderColor: hexA(accentColor, 0.32),
        marginBottom: 12,
      }}
    >
      <View style={{ marginTop: 1, flexShrink: 0 }}>
        <SpeechBubbleIcon color={accentColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: fonts.interSemi,
            fontSize: 9,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: accentColor,
            marginBottom: 3,
          }}
        >
          YOUR COMMENT
        </Text>
        <Text
          onTextLayout={(e) => {
            if (!overflowing && e.nativeEvent.lines.length > 3) {
              setOverflowing(true);
            }
          }}
          numberOfLines={overflowing && !open ? 3 : undefined}
          style={{
            fontFamily: fonts.inter,
            fontSize: 13,
            color: '#ECE0CB',
            lineHeight: 19,
            letterSpacing: -0.1,
          }}
        >
          {comment}
        </Text>
        {overflowing && (
          <Pressable
            onPress={() => setOpen((o) => !o)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            style={{
              alignSelf: 'flex-start',
              paddingTop: 5,
              paddingBottom: 2,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.interSemi,
                fontSize: 11.5,
                color: accentColor,
              }}
            >
              {open ? 'less' : 'more'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

/**
 * HeroDescription — plain text under the hero title. Same look as
 * the inline `styles.heroWhy` (boneDim Inter, 13/19) but clamps to
 * 3 lines with a `more` / `less` toggle when the text overflows.
 *
 * Self-measuring via onTextLayout: first render is unclamped so we
 * count lines, then we flip an overflow flag and clamp the next
 * render. Without this, a 4+ line note like "Front desk said to
 * bring my insurance card AND Dr. Lee's referral from last week —
 * the one about the left foot. They can't process the X-ray
 * without both…" would blow out the hero card's vertical rhythm
 * (the Mark it done CTA gets pushed off the visible area).
 */
const HERO_DESC_TEXT = {
  fontFamily: fonts.inter,
  fontSize: 13,
  color: '#8EA0B4', // C.dusk
  lineHeight: 20,
  marginBottom: 16,
  letterSpacing: -0.05,
};
const HERO_DESC_TOGGLE = {
  fontFamily: fonts.interSemi,
  fontSize: 12,
};
const HERO_DESC_TOGGLE_HIT = {
  alignSelf: 'flex-start' as const,
  marginTop: -10, // pull toggle closer to the clamped text
  marginBottom: 14,
  paddingTop: 2,
  paddingBottom: 2,
};

const HeroDescription = ({
  text,
  accentColor,
}: {
  text: string;
  accentColor: string;
}) => {
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  return (
    <>
      <Text
        style={HERO_DESC_TEXT}
        onTextLayout={(e) => {
          if (!overflowing && e.nativeEvent.lines.length > 3) {
            setOverflowing(true);
          }
        }}
        numberOfLines={overflowing && !open ? 3 : undefined}
      >
        {text}
      </Text>
      {overflowing && (
        <Pressable
          onPress={() => setOpen((o) => !o)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={HERO_DESC_TOGGLE_HIT}
        >
          <Text style={[HERO_DESC_TOGGLE, { color: accentColor }]}>
            {open ? 'less' : 'more'}
          </Text>
        </Pressable>
      )}
    </>
  );
};

/** ISO completedAt → "just now" / "12 min ago" / "1 hr ago". Used in
 *  the "Done today" history list so the user sees how recently they
 *  finished each thing. Returns null if we can't read the timestamp. */
const fmtAgo = (iso: string | null, now: Date): string | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const ms = Math.max(0, now.getTime() - then);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return 'earlier';
};

/** Minutes-since-midnight → "9 am" / "9:30 pm". Used for the AM/PM
 *  chip labels on previewed tasks where the user said a bare hour. */
const fmtMin = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hr = h % 12 || 12;
  const suf = h < 12 ? 'am' : 'pm';
  return m === 0
    ? `${hr} ${suf}`
    : `${hr}:${String(m).padStart(2, '0')} ${suf}`;
};

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// ═════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════
export default function Home() {
  const router = useRouter();
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  const effectiveWindows = useEffectiveWindows();
  // Keyboard height — the capture pill rides ABOVE the keyboard when
  // it opens (it used to vanish underneath), and the scroll gains the
  // same clearance so the hero / Lumi-suggests card can always scroll
  // clear of the pill while typing.
  const keyboardHeight = useKeyboardHeight();
  // Companion-mode flags — gate the playful chrome (Luna, XP, cheer).
  const companion = useCompanionMode();
  // Ambient mood — reflects sleep window, overdue pile, streak.
  // The nook cat updates as the user's state changes.
  const ambientMood = useAmbientLunaMood();
  const lunaSkin = useLunaSkin();

  // Focus session — the LumiFocusCard component owns the full
  // lifecycle (start / pause / resume / end) via useFocusSession
  // internally. Home only needs the pet name for the Live Activity
  // label, which it passes down to the card.
  const focusPetName = useUserStore((s) => s.petName);
  // Transient "celebration" override — when the user completes a
  // quest, the nook cat flips to 'happy' for ~30s then springs back
  // to ambient. A small, earned moment of feedback that doesn't
  // require any cheap toaster animation.
  const [celebrating, setCelebrating] = useState(false);
  const celebrateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerCelebrate = () => {
    if (celebrateTimerRef.current) {
      clearTimeout(celebrateTimerRef.current);
    }
    setCelebrating(true);
    celebrateTimerRef.current = setTimeout(() => {
      setCelebrating(false);
      celebrateTimerRef.current = null;
    }, 30_000);
  };

  // Brief grooming beat. Plays for ~1.8s on focus-start and on
  // task-completion before falling back to whatever the cat would
  // normally be showing (celebration → happy, otherwise ambient).
  // Reads as: the cat licks itself like it's busy / settling in,
  // then goes back to its mood. Takes precedence over celebrating
  // so the lick lands first on completion and the 30-second happy
  // window picks up after.
  const [licking, setLicking] = useState(false);
  const lickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerLick = (durationMs = 1800) => {
    if (lickTimerRef.current) clearTimeout(lickTimerRef.current);
    setLicking(true);
    lickTimerRef.current = setTimeout(() => {
      setLicking(false);
      lickTimerRef.current = null;
    }, durationMs);
  };

  // ── Empathize moment (emotional-model spec §1) ───────────────────
  // The ONE sanctioned use of the sad pose: the user just told us
  // they're overwhelmed. Luna sits WITH them for a few seconds —
  // "let's carry it together" — then returns to ambient. Never fired
  // by missed tasks / inactivity / streaks.
  const [empathizing, setEmpathizing] = useState(false);
  const empathizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const triggerEmpathize = () => {
    if (empathizeTimerRef.current) clearTimeout(empathizeTimerRef.current);
    setEmpathizing(true);
    empathizeTimerRef.current = setTimeout(() => {
      setEmpathizing(false);
      empathizeTimerRef.current = null;
    }, 7_000);
  };

  // Cleanup on unmount so a stale timeout can't try to setState
  // after the screen's torn down.
  useEffect(
    () => () => {
      if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current);
      if (lickTimerRef.current) clearTimeout(lickTimerRef.current);
      if (empathizeTimerRef.current) {
        clearTimeout(empathizeTimerRef.current);
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (notifBannerTimer.current) clearTimeout(notifBannerTimer.current);
    },
    [],
  );
  // Priority: the lick beat is a transient action; empathize beats
  // celebration (sitting with the user matters more than confetti);
  // then the 30s happy window; then ambient.
  const nookMood = licking
    ? 'lick'
    : empathizing
      ? 'sad'
      : celebrating
        ? 'happy'
        : ambientMood;

  // ── Store ────────────────────────────────────────────────────────
  const xp = useUserStore((s) => s.xp);
  const streak = useUserStore((s) => s.streak);
  const activeDaysThisMonth = useUserStore((s) => s.activeDaysThisMonth);
  const addXp = useUserStore((s) => s.addXp);
  const addShard = useUserStore((s) => s.addShard);
  const registerActivity = useUserStore((s) => s.registerActivity);
  // Smart-capture context (learned rhythms → smart Layer-2 placement).
  const sharpWindow = useUserStore((s) => s.sharpWindow);
  const foggyWindow = useUserStore((s) => s.foggyWindow);
  const struggles = useUserStore((s) => s.struggles);
  const userName = useUserStore((s) => s.name);
  // Anchors give the real day-boundaries (wake / sleep) so smart
  // capture honors the user's actual bedtime, not the nominal 22:00
  // evening-window end. Captured at 10:15 PM with a 11:45 PM bedtime
  // and saying "before bed" → land tonight, not tomorrow morning.
  const anchors = useUserStore((s) => s.anchors);
  const captureLang = useUserStore((s) => s.captureLang);
  // The deterministic grammar, spell dictionary, and did-you-mean
  // heuristics are ENGLISH. For any other capture language they must
  // stand down: the LLM understands ~every language natively, so
  // non-English routes there (Pro); free falls back to a raw-title
  // task — a floor, never a garbled parse.
  const isEnglishCapture = (captureLang || 'en-US').startsWith('en');
  const heyLumiEnabled = useUserStore((s) => s.heyLumiEnabled);
  const setHeyLumiEnabled = useUserStore((s) => s.setHeyLumiEnabled);
  const hintsSeen = useUserStore((s) => s.hintsSeen);
  const tasksEverCompleted = useUserStore((s) => s.tasksEverCompleted);
  const markHintSeen = useUserStore((s) => s.markHintSeen);

  const quests = useQuestStore((s) => s.quests);
  const toggle = useQuestStore((s) => s.toggle);
  const addQuest = useQuestStore((s) => s.addQuest);
  const refreshRecurring = useQuestStore((s) => s.refreshRecurring);
  const setQuestDate = useQuestStore((s) => s.setDate);
  const moveQuestWindow = useQuestStore((s) => s.moveWindow);
  const updateQuestTitle = useQuestStore((s) => s.updateTitle);
  const setQuestNote = useQuestStore((s) => s.setNote);
  const setQuestComment = useQuestStore((s) => s.setComment);
  const recordCorrection = useCorrectionsStore((s) => s.record);
  const recentCorrections = useCorrectionsStore((s) => s.recent);
  // §2.5 metrics — route decisions + edit flags for the current preview.
  // Pro gate for the LLM clarify pass — free users keep the
  // deterministic tidy; AI-powered "did you mean" is an upgrade.
  const access = useAccessStatus(null);
  const recordAiMetric = useAiMetricsStore((s) => s.record);
  const updateAiMetric = useAiMetricsStore((s) => s.update);
  const lastMetricIdRef = useRef<string | null>(null);
  // Day key on its own minute heartbeat — "today" memos used to bake
  // todayKey() in with only [quests] deps, so an app left open across
  // midnight kept showing yesterday as today until a store write.
  // (setState with the same string bails, so this re-renders exactly
  // once per day.)
  const [dayKeyNow, setDayKeyNow] = useState(() => todayKey());
  useEffect(() => {
    const id = setInterval(() => {
      setDayKeyNow((k) => {
        const t = todayKey();
        return t === k ? k : t;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todayQuests = useMemo(
    () => selectTodayQuests(quests),
    [quests, dayKeyNow],
  );

  // ── Suggestions ──────────────────────────────────────────────────
  const suggestions = useSuggestionsStore((s) => s.suggestions);
  const dismissSuggestion = useSuggestionsStore((s) => s.dismiss);
  const consumeSuggestion = useSuggestionsStore((s) => s.consume);
  const setAllSuggestions = useSuggestionsStore((s) => s.setAll);
  const suppressed = useSuggestionsStore((s) => s.suppressed);

  // ── Local state ──────────────────────────────────────────────────
  const [now, setNow] = useState(() => new Date());
  const [swap, setSwap] = useState(0);
  const [cheer, setCheer] = useState(0);
  // Focus-picker modal — opens from the LumiFocusCard's "Focus on
  // another task →" link and shows a full-height sheet of today's
  // incomplete quests. Tapping a quest starts a focus session on it
  // (the timer then renders inside the modal via a nested
  // LumiFocusCard bound to the picked quest).
  const [focusPickerOpen, setFocusPickerOpen] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [capText, setCapText] = useState('');
  // "Did you mean?" — persists over the capture pill after a
  // suspicious voice transcript until the user edits or sends
  // (a vanishing toast was too easy to miss).
  const pillInputRef = useRef<TextInput>(null);
  // Vent acknowledgment (deep-dive green #2): a capture that parses
  // to ZERO tasks and reads emotional used to do NOTHING — the most
  // loaded input got the most silent output. Holds the vent text for
  // the "untangle it together" hand-off.
  const [ventText, setVentText] = useState<string | null>(null);
  // "Let the day set" — evening close ritual (fresh-eyes #1).
  const [daySetOpen, setDaySetOpen] = useState(false);
  const [dymHint, setDymHint] = useState(false);
  // The clarify LLM's whole-sentence repair, shown IN the card with
  // a "use this" action — it must be visible and explicit, never a
  // silent swap of what the user typed (they couldn't tell what
  // changed).
  const [dymSuggestion, setDymSuggestion] = useState<string | null>(null);
  // Send-time soft stop bookkeeping: if we already held a suspicious
  // text once and the user sends it again unchanged, we respect the
  // intent and let it through.
  const dymHeldRef = useRef<Set<string>>(new Set());
  // Measured content height of the pill input — iOS multiline
  // TextInputs don't auto-grow from min/maxHeight alone; we track
  // contentSize and set an explicit height (clamped to ~5 lines,
  // scrolls internally beyond).
  // The waiting card ("N more waiting — Lumi's holding them") —
  // collapsed by default, same calm-first default as Done today.
  const [waitingOpen, setWaitingOpen] = useState(false);
  // Someday → real-date sheet target. When set, the MoveBackToDateSheet
  // opens for this task.
  const [movingBack, setMovingBack] = useState<Quest | null>(null);
  // The quest currently being edited via EditQuestSheet. When set,
  // the sheet opens with the title + description fields pre-filled.
  const [editingQuest, setEditingQuest] = useState<Quest | null>(null);

  /** Pull a Someday task back onto a real day with a sensible default
   *  window (morning). User can drag/edit time later. Shared with the
   *  same flow in Untangle. */
  const moveQuestBack = (q: Quest, dateISO: string) => {
    setQuestDate(q.id, dateISO);
    moveQuestWindow(q.id, 'morning');
  };
  const [toast, setToast] = useState<string | null>(null);
  // Undo state for accidental "Mark it done" taps. Lives a hair longer
  // than the regular toast so a user has time to read + react.
  const [undoState, setUndoState] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Notification-origin banner ──────────────────────────────────
  // A tapped notification used to fire its action and vanish behind a
  // 2.4s toast, so the change felt like it came from nowhere. This
  // persistent (dismissible) banner names WHICH notification and what
  // Lumi did, sitting above the capture pill until dismissed.
  const [notifBanner, setNotifBanner] = useState<{
    origin: string;
    label: string;
    undo?: () => void;
  } | null>(null);
  const notifBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotifBanner = (
    origin: string,
    label: string,
    undo?: () => void,
  ) => {
    setNotifBanner({ origin, label, undo });
    AccessibilityInfo.announceForAccessibility(`${origin}. ${label}`);
    if (notifBannerTimer.current) clearTimeout(notifBannerTimer.current);
    // Long enough to read + act on undo without being sticky forever.
    notifBannerTimer.current = setTimeout(() => setNotifBanner(null), 9000);
  };
  // Soft highlight pulse on the hero card so a notification-driven swap
  // is perceivable (setSwap changes the card silently otherwise).
  const heroFlash = useRef(new Animated.Value(0)).current;
  const flashHero = () => {
    heroFlash.stopAnimation();
    heroFlash.setValue(0);
    Animated.sequence([
      Animated.timing(heroFlash, {
        toValue: 1,
        duration: 90,
        useNativeDriver: false,
      }),
      Animated.delay(520),
      Animated.timing(heroFlash, {
        toValue: 0,
        duration: 260,
        useNativeDriver: false,
      }),
    ]).start();
  };

  // ── Voice (Whisper) ──────────────────────────────────────────────
  const voice = useVoice();

  // ── Preview-then-confirm state ───────────────────────────────────
  // After capture, instead of auto-committing the parsed tasks, we
  // show a "Lumi suggests" preview card. The user can:
  //   - Approve all → commits to the tasks table
  //   - Tweak one → edit title / date / window inline
  //   - Cancel → discard, return to capture input
  // Pull forward (the suggestion's pre-filled with Lumi's best guess),
  // never force.
  const [previewTasks, setPreviewTasks] = useState<SmartTask[] | null>(null);
  // True while llmUnderstand is in flight for the current preview.
  // Render swaps the placement meta line for a "Lumi is reading…"
  // indicator on each task so the user doesn't fixate on a
  // placeholder date/window that's about to change.
  const [aiPending, setAiPending] = useState(false);
  // Raw text being sorted by the LLM. When non-null, the sorting
  // card renders above the (still-null) preview. Cleared when the
  // LLM returns (or the 5s timeout fires and we fall back to the
  // deterministic result). Point is to NEVER show the wrong
  // deterministic preview and then re-render into the correct LLM
  // one — one clean sorting → done transition instead.
  const [sortingRaw, setSortingRaw] = useState<string | null>(null);
  // Generation counter for in-flight sorts. "never mind" bumps it, so
  // an LLM promise that resolves later finds its gen stale and drops
  // the result — hiding the card alone let the preview appear seconds
  // after the user cancelled.
  const sortGenRef = useRef(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDate, setEditingDate] = useState<'today' | 'tomorrow'>('today');
  const [editingWindow, setEditingWindow] = useState<WindowKey>('midday');
  // Length chips — null until the user picks one (or it was already
  // inferred by the LLM / set by the deterministic default).
  const [editingDurationMin, setEditingDurationMin] = useState<number | null>(
    null,
  );
  const [floater, setFloater] = useState<{
    id: string;
    amount: number;
    color: string;
  } | null>(null);

  // Tick the clock every minute so greeting + current window stay fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Tour + recurring refresh (carried over from v1) ──────────────
  const tour = useTour();
  const heroRef = useTourTarget('tour-quest');
  const captureRef = useTourTarget('tour-oracle');
  const tourSeen = useUserStore((s) => s.tourSeen);
  const onboardedAt = useUserStore((s) => s.onboardedAt);
  // Recurring respawn: on hydration (mount-only used to race the async
  // secureStorage load and run against an empty list), on each new day
  // while the app stays open, and on tab focus.
  const questsHydrated = useQuestStore((s) => s.hasHydrated);
  useEffect(() => {
    if (!questsHydrated) return;
    refreshRecurring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questsHydrated, dayKeyNow]);
  useFocusEffect(
    useCallback(() => {
      if (useQuestStore.getState().hasHydrated) refreshRecurring();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  useEffect(() => {
    if (!onboardedAt || tourSeen) return;
    const t = setTimeout(() => tour.start(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardedAt, tourSeen]);

  // ── Recurrence detector → suggestions (math layer, no LLM) ───────
  useEffect(() => {
    const suppressedSet = new Set(suppressed);
    // Recurring quests AND open one-offs both suppress re-detection —
    // accepting a suggestion as one-time used to resurrect the card
    // instantly (completions unchanged → identical pattern re-found).
    const existingTitles = new Set(
      quests
        .filter((q) => q.recur || !q.completed)
        .map((q) => normalizeForSuppression(q.title)),
    );
    const detected = detectRecurrencePatterns(quests, {
      suppressed: suppressedSet,
      existingRecurringTitles: existingTitles,
    });
    setAllSuggestions(detected);
  }, [quests, suppressed, setAllSuggestions]);

  // ── Learning digest — drives smart-capture window inference ─────
  const digest = useLearningDigest();

  // ── Derived ──────────────────────────────────────────────────────
  const cw = currentWindowFor(effectiveWindows, now);
  const order = useMemo(
    () => [cw, ...WIN_ORDER.filter((w) => w !== cw)],
    [cw],
  );
  const candidates = useMemo(() => {
    // 'someday' is parked on purpose — a high-importance someday
    // capture must not outrank the day's REAL tasks as hero (and
    // DaySet's "let go" must actually let go).
    const open = todayQuests.filter(
      (q) => !q.completed && q.window !== 'someday',
    );
    return [...open].sort((a, b) => {
      // IMPORTANCE first — a Trial (high) always trumps a Task
      // (medium) or a Whim (low) regardless of window. This is what
      // "Lumi suggests" is FOR: surfacing the biggest thing so the
      // user doesn't waste their sharpest attention on a whim.
      // (Previously window won; a medium task in the current window
      // hid a high-tier task waiting in the next one — hence a
      // dentist appointment surfacing over the overdue invoice.)
      const rankDiff =
        IMPORTANCE[b.importance].rank - IMPORTANCE[a.importance].rank;
      if (rankDiff !== 0) return rankDiff;
      // Same tier → prefer the current window (still doable now),
      // then the sooner windows via the ordered list.
      const wa = order.indexOf(a.window);
      const wb = order.indexOf(b.window);
      return wa - wb;
    });
  }, [todayQuests, order]);
  const allDone = candidates.length === 0 && todayQuests.length > 0;
  const totallyEmpty = todayQuests.length === 0;
  // While a focus session runs, its quest IS the hero — a fresh
  // high-importance capture used to reorder candidates and yank the
  // timer surface off Home mid-session.
  const focusQuestId = useFocusSession((s) => s.current?.questId ?? null);
  const hero = candidates.length
    ? (focusQuestId && candidates.find((q) => q.id === focusQuestId)) ||
      candidates[swap % candidates.length]
    : null;
  const rest = hero ? candidates.filter((q) => q.id !== hero.id) : [];

  const totalToday = todayQuests.filter((q) => q.window !== 'someday').length;
  // Today's completed quests, freshest first — drives both the progress
  // dot row at the top AND the "Done today" history section near the
  // bottom (the user can tap any row to un-complete after the 6-second
  // undo toast has timed out).
  const doneTodayList = useMemo(() => {
    const dayKey = todayKey();
    return todayQuests
      .filter((q) => {
        if (!q.completed || q.window === 'someday' || !q.completedAt) {
          return false;
        }
        // Compare LOCAL Y-M-D both sides. Slicing the ISO string gave
        // UTC, which silently hid evening-completed tasks (a quest
        // done at 8 PM PT has completedAt = "tomorrow" in UTC, so
        // slice(0,10) didn't match today's local key — the user
        // never saw their own history).
        const d = new Date(q.completedAt);
        const ck = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          '0',
        )}-${String(d.getDate()).padStart(2, '0')}`;
        return ck === dayKey;
      })
      .sort((a, b) => {
        const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return tb - ta;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayQuests, dayKeyNow]);
  const doneToday = doneTodayList.length;
  const [moreDoneOpen, setMoreDoneOpen] = useState(false);
  // Whole "Done today" section collapses so it doesn't clutter Home
  // when the user isn't undoing. Default CLOSED — keeps Home calm by
  // default; the count in the header still shows what's there.
  const [historyOpen, setHistoryOpen] = useState(false);

  // Today's XP — sum of completed-today quests' xpReward. The store
  // tracks lifetime XP only; we derive today's separately for the
  // quiet game-layer line. Compares LOCAL Y-M-D both sides so an
  // evening completion in PT doesn't roll to tomorrow UTC and zero
  // out the today XP.
  const xpToday = useMemo(() => {
    const todayLocal = todayKey();
    return todayQuests
      .filter((q) => {
        if (!q.completed || !q.completedAt) return false;
        const d = new Date(q.completedAt);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}` === todayLocal;
      })
      .reduce((sum, q) => sum + (q.xpReward ?? 0), 0);
  }, [todayQuests, now]);

  const heroSuggestion: Suggestion | null = suggestions[0] ?? null;

  // ── Pull-forward — when today's clear, offer the NEXT upcoming
  // task (per lumi-home-oneember): soonest future date wins, biggest
  // task first within it. Tomorrow, Friday, next week — whatever
  // comes next. Recurring templates and someday are excluded (a
  // template isn't an instance; someday has its own flow).
  const [pullOfferClosed, setPullOfferClosed] = useState(false);
  const nextUpcoming = useMemo(() => {
    if (!(allDone || totallyEmpty)) return null;
    const today = todayKey();
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const future = quests.filter(
      (q) =>
        !q.completed &&
        !q.recur &&
        q.window !== 'someday' &&
        !!q.date &&
        q.date > today,
    );
    if (future.length === 0) return null;
    future.sort(
      (a, b) =>
        a.date!.localeCompare(b.date!) ||
        rank[a.importance] - rank[b.importance] ||
        ((a.scheduledHour ?? 99) * 60 + (a.scheduledMinute ?? 0)) -
          ((b.scheduledHour ?? 99) * 60 + (b.scheduledMinute ?? 0)),
    );
    return future[0];
  }, [quests, allDone, totallyEmpty]);

  // "tomorrow" / "friday" / "Jul 9" — however far out it lives.
  const pullLabel = useMemo(() => {
    if (!nextUpcoming?.date) return '';
    const [y, m, d] = nextUpcoming.date.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const off = Math.round((target.getTime() - start.getTime()) / 86400000);
    if (off === 1) return 'tomorrow';
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    if (off > 1 && off <= 6) return days[target.getDay()];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[target.getMonth()]} ${target.getDate()}`;
  }, [nextUpcoming, now]);

  /** Borrow it: land the task on today (setDate un-anchors — its old
   *  clock time belonged to another day) and let the hero machinery
   *  surface it. */
  const pullForward = () => {
    if (!nextUpcoming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQuestDate(nextUpcoming.id, todayKey());
    setSwap(0);
    showToast(`Borrowed from ${pullLabel} — you're ahead.`);
  };

  // ── Header readout — one italic dusk line that frames the day ────
  // Per the lumi-home-capture-4 mock, but with honest numbers (the
  // mock hardcoded "nothing urgent"; we don't claim that). Hidden in
  // the all-done / empty states — those cards already speak.
  const windowPhrase =
    cw === sharpWindow
      ? 'your peak window is open now'
      : `your ${effectiveWindows[cw].label.toLowerCase()} window is open now`;
  const readout =
    allDone || totallyEmpty
      ? null
      : doneToday > 0
        ? `${doneToday === 1 ? 'One' : doneToday} down already — ${candidates.length} to go, and ${windowPhrase}.`
        : `${candidates.length} thing${candidates.length === 1 ? '' : 's'} on today — ${windowPhrase}.`;

  // ── Day-thread data — the whole day as one quiet line ────────────
  // Done dots use REAL completion stamps (the mockup faked spacing);
  // upcoming dots sit at their anchored time, or their window's start
  // when the task is windowed.
  const threadDone = useMemo(
    () =>
      doneTodayList
        .filter((q) => q.completedAt)
        .map((q) => {
          const d = new Date(q.completedAt as string);
          return { min: d.getHours() * 60 + d.getMinutes(), color: C.lichen };
        }),
    [doneTodayList],
  );
  const threadUpcoming = useMemo(
    () =>
      todayQuests
        .filter((q) => !q.completed && q.window !== 'someday')
        .map((q) => {
          const min =
            q.scheduledHour != null
              ? q.scheduledHour * 60 + (q.scheduledMinute ?? 0)
              : effectiveWindows[q.window].start != null
                ? (effectiveWindows[q.window].start as number) * 60
                : null;
          return min != null
            ? { min, color: WINDOWS[q.window].color }
            : null;
        })
        .filter((d): d is { min: number; color: string } => d != null),
    [todayQuests, effectiveWindows],
  );

  // ── Actions ──────────────────────────────────────────────────────
  const showToast = (text: string) => {
    setToast(text);
    // VoiceOver hears what sighted users glimpse — toasts were silent.
    AccessibilityInfo.announceForAccessibility(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    // 4.5s — 2.4s was below a comfortable read time; a glance away
    // and the only trace of what happened was already gone.
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  };

  const completeQuest = (q: Quest) => {
    // Fresh-store read — the render-closure quest goes stale between
    // taps. A double-tap used to see completed=false twice: the 2nd
    // toggle flipped the quest BACK open while stale xpPaid paid the
    // economy a second time.
    const fresh = useQuestStore.getState().quests.find((x) => x.id === q.id);
    if (!fresh || fresh.completed) return;
    const next = toggle(q.id);
    if (!next || !next.completed) return;

    // ECONOMY GUARD (audit C1): XP/shards pay exactly ONCE per quest,
    // ever — undo→re-complete used to farm them indefinitely.
    const gain = fresh.xpReward;
    const firstAward = !fresh.xpPaid;
    if (firstAward) {
      addXp(gain);
      addShard();
      useQuestStore.getState().markXpPaid(q.id);
    }
    registerActivity();

    // If a focus session is running ON THIS quest, end it cleanly
    // so the Dynamic Island pill clears immediately (otherwise it
    // lingers until its full duration ticks out, which feels broken
    // after the user already marked the task done). Reason is
    // 'cancelled' — the user gets their celebration from the manual
    // completion path, not from the focus-card's done screen.
    const fs = useFocusSession.getState();
    if (fs.current?.questId === q.id) {
      void fs.end({ reason: 'cancelled' });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSwap(0);

    // Celebratory chrome — only fires in Full mode. In Minimal /
    // Focused the completion stays a quiet check (calmer surface).
    // The fan-out above (XP, shard, streak, registerActivity) ALWAYS
    // fires so data accrues consistently — this only gates VISUAL
    // feedback (companion-mode-spec §2).
    if (companion.showCheer) {
      setCheer((c) => c + 1);
      // Lick first, then the 30s happy window takes over. The
      // licking nookMood overrides 'happy' for the first 1.8s so
      // the cat reads as "busy grooming, satisfied" instead of
      // jumping straight to a static smile.
      triggerLick();
      triggerCelebrate();
      if (firstAward) {
        // Only float XP the store actually paid — a re-complete after
        // undo used to SHOW +N the economy guard refused.
        const fId = q.id + '-' + Date.now();
        setFloater({
          id: fId,
          amount: gain,
          color: IMPORTANCE[q.importance].color,
        });
        setTimeout(() => {
          setFloater((cur) => (cur?.id === fId ? null : cur));
        }, 1200);
      }
    }

    // Meaningful-win moments (emotional-model spec §4): the BIG
    // emotional peak lands on "you did the avoided/hard thing", not
    // on checkbox volume. A task carried 5+ days = avoidance finally
    // broken — that gets NAMED. A Trial gets a nod. Routine
    // completions keep the quiet warm beat above.
    // Recurring habits are SUPPOSED to come back — createdAt age says
    // nothing about avoidance for them (a 47-day-old daily habit is
    // not "finally faced").
    const daysCarried = q.createdAt && !q.recur
      ? Math.floor(
          (Date.now() - new Date(q.createdAt).getTime()) / 86_400_000,
        )
      : 0;
    if (daysCarried >= 5) {
      showToast(
        `That one followed you for ${daysCarried} days — and you just did it ✨`,
      );
    } else if (q.importance === 'high') {
      showToast('The big one. That took real fuel — well done.');
    }

    // Surface an Undo so accidental taps can be reversed within 6s.
    // The XP guardrail in questStore means an undo doesn't subtract
    // XP — you keep the small win for trying.
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ id: q.id, title: q.title });
    undoTimerRef.current = setTimeout(() => {
      setUndoState((cur) => (cur?.id === q.id ? null : cur));
    }, 6000);
  };

  /** "now" on a waiting row — surface that task as the hero
   *  immediately. hero = candidates[swap % length], so pointing swap
   *  at the task's index in candidates does it in one state write. */
  const surfaceNow = (q: Quest) => {
    const idx = candidates.findIndex((c) => c.id === q.id);
    if (idx < 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSwap(idx);
  };

  // ── Away/return + Rescue Mode (emotional-model spec §2/§3) ───────
  // Snapshot how long the user was away BEFORE stamping today as an
  // open day — the stamp would otherwise erase the signal we're
  // about to welcome them back with.
  const registerOpen = useUserStore((s) => s.registerOpen);
  const rescueDismissedDate = useUserStore((s) => s.rescueDismissedDate);
  const dismissRescueForToday = useUserStore((s) => s.dismissRescue);
  const setRescueExplain = useRescueStore((s) => s.setPendingExplain);
  const [awaySnap, setAwaySnap] = useState<AwayState | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  useEffect(() => {
    const prevOpen = registerOpen();
    const prevActive = useUserStore.getState().lastActiveDate;
    const snap = awayStateFor(lastSeenDate(prevActive, prevOpen));
    if (snap.stage) setAwaySnap(snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open tasks that have slipped past their date (someday excluded —
  // those are parked on purpose). Drives Rescue Mode + the proactive
  // backlog card; NEVER rendered as a wall of red.
  const overdueOpen = useMemo(() => {
    const t = todayKey();
    return quests.filter(
      (q) => !q.completed && q.window !== 'someday' && q.date && q.date < t,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests, dayKeyNow]);

  // A tapped recovery notification ("want me to shrink today?") must
  // open Rescue Mode even when the automatic triggers wouldn't fire.
  // Dismissing rescue stamps rescueDismissedDate=today, which also
  // clears the forced state.
  const [forceRescue, setForceRescue] = useState(false);
  const rescueActive =
    (forceRescue ||
      (awaySnap?.daysAway ?? 0) >= 3 ||
      overdueOpen.length >= 8) &&
    rescueDismissedDate !== todayKey() &&
    !totallyEmpty;

  // 🌱 Just one thing — the smallest, most doable open task. Whims
  // before Trials, shortest first: the point is a WIN, not the
  // biggest rock. If today is empty, gently borrow the easiest
  // thing that slipped.
  const pendingSurfaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingSurfaceRef.current) return;
    const q = candidates.find((c) => c.id === pendingSurfaceRef.current);
    if (q) {
      pendingSurfaceRef.current = null;
      surfaceNow(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const rescueOneThing = () => {
    const openToday = todayQuests.filter(
      (q) => !q.completed && q.window !== 'someday',
    );
    const pool = openToday.length > 0 ? openToday : overdueOpen;
    dismissRescueForToday();
    if (pool.length === 0) return;
    const pick = [...pool].sort(
      (a, b) =>
        IMPORTANCE[a.importance].rank - IMPORTANCE[b.importance].rank ||
        (a.durationMinutes ?? 30) - (b.durationMinutes ?? 30),
    )[0];
    if (pick.date !== todayKey()) {
      setQuestDate(pick.id, todayKey());
      pendingSurfaceRef.current = pick.id;
    } else {
      surfaceNow(pick);
    }
    showToast('Just this one — everything else can wait.');
  };

  // 🧹 Clean up my tasks — deterministic triage, nothing deleted:
  //   · the 3 most important slipped tasks come to today
  //   · anything stale for 2+ weeks tucks into someday (recoverable)
  //   · the rest move to tomorrow
  const rescueCleanUp = () => {
    const t = todayKey();
    const sorted = [...overdueOpen].sort(
      (a, b) =>
        IMPORTANCE[b.importance].rank - IMPORTANCE[a.importance].rank,
    );
    const keep = sorted.slice(0, 3);
    let kept = 0;
    let moved = 0;
    let tucked = 0;
    for (const q of keep) {
      setQuestDate(q.id, t);
      kept++;
    }
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 14);
    const cutoffISO = `${staleCutoff.getFullYear()}-${String(staleCutoff.getMonth() + 1).padStart(2, '0')}-${String(staleCutoff.getDate()).padStart(2, '0')}`;
    for (const q of sorted.slice(3)) {
      if (q.date && q.date < cutoffISO) {
        moveQuestWindow(q.id, 'someday');
        tucked++;
      } else {
        setQuestDate(q.id, offsetDate(1));
        moved++;
      }
    }
    dismissRescueForToday();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const bits: string[] = [];
    if (kept > 0) bits.push(`kept ${kept} for today`);
    if (moved > 0) bits.push(`moved ${moved} to tomorrow`);
    if (tucked > 0) bits.push(`tucked ${tucked} into someday`);
    showToast(
      bits.length > 0
        ? `All sorted — ${bits.join(', ')}.`
        : 'All sorted — your plate is clear.',
    );
  };

  // 🎙 Let me explain — hand off to Untangle primed for "life
  // happened". The user talks; the engine reschedules/keeps/drops.
  const rescueExplain = () => {
    dismissRescueForToday();
    setRescueExplain(true);
    router.push('/(tabs)/checkin');
  };

  // ── Proactive backlog (emotional-model spec §7) ──────────────────
  // A couple of tasks slipped but it's not rescue-level: never a
  // wall of red — one observation + an offer, once a day at most.
  // Pattern-based (§5): if the slipped tasks cluster ("mostly phone
  // calls"), say THAT, not a count of failures.
  const backlogNudgeDismissedDate = useUserStore(
    (s) => s.backlogNudgeDismissedDate,
  );
  const dismissBacklogNudge = useUserStore((s) => s.dismissBacklogNudge);
  const backlogNudge = useMemo(() => {
    if (rescueActive) return null;
    if (backlogNudgeDismissedDate === todayKey()) return null;
    if (overdueOpen.length < 2) return null;
    const stale = findStale(quests, { minDays: 2 });
    const cluster = dominantStaleCluster(stale);
    const line = cluster
      ? `A few things have followed you for a couple of days — mostly ${cluster.label}. They might not all be urgent anymore.`
      : 'A few things have followed you for a couple of days. They might not all be urgent anymore.';
    return { line };
  }, [rescueActive, backlogNudgeDismissedDate, overdueOpen, quests]);

  const backlogSnooze = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    for (const q of overdueOpen) setQuestDate(q.id, offsetDate(1));
    dismissBacklogNudge();
    showToast(
      `Snoozed ${overdueOpen.length} to tomorrow — today just got lighter.`,
    );
  };
  const backlogTuck = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    for (const q of overdueOpen) moveQuestWindow(q.id, 'someday');
    dismissBacklogNudge();
    showToast(
      `Tucked ${overdueOpen.length} into someday — they'll wait quietly.`,
    );
  };

  /** Tap the Undo chip on the post-complete toast. Flips the task
   *  back to not-done; XP stays banked (see XP guardrail). */
  const undoComplete = () => {
    if (!undoState) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggle(undoState.id);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState(null);
  };

  /** Un-complete a task from the "Done today" history list. One tap
   *  (no confirm) — un-completing is non-destructive (the task simply
   *  comes back to your day). The task ALWAYS stays on today:
   *    - if the original slot is still future → no change
   *    - if it's already passed → keep on today, no reschedule —
   *      the Time tab will show it past + tagged "missed" so the
   *      user can do it now or move it explicitly. We don't silently
   *      push to tomorrow because it hides the fact that they missed
   *      it, which is information they need.
   *  A toast reports what happened so the user isn't surprised. */
  const undoFromHistory = (q: Quest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayISO = todayKey();

    let toastLine = `Brought back · ${q.title}`;

    // Was the original slot past now? If so, signal that in the
    // toast so the user isn't surprised to see it tagged "missed".
    const wasOnToday = q.date === todayISO;
    let isMissed = false;
    if (wasOnToday) {
      if (q.scheduledHour != null) {
        const taskMin = q.scheduledHour * 60 + (q.scheduledMinute ?? 0);
        if (taskMin <= nowMin) isMissed = true;
      } else if (q.window !== 'someday') {
        const winEnd =
          (effectiveWindows[q.window].end ?? 24) * 60;
        if (nowMin >= winEnd) isMissed = true;
      }
    }
    if (isMissed) {
      // "from earlier", not "missed earlier" — same fact, no blame
      // (emotional-model spec §0).
      toastLine = `Brought back · still on today (from earlier)`;
    }

    toggle(q.id);
    showToast(toastLine);
  };

  // ── Capture helpers ──────────────────────────────────────────────

  /** Write one SmartTask to the shared tasks table. Fires a silent
   *  LLM title-cleanup pass in the background if Anthropic is wired —
   *  the deterministic title shows instantly, and Claude polishes it
   *  to a tidy imperative ~1s later. Quietly noop on failure.
   */
  const commitTask = (t: SmartTask) => {
    const hasTime = t.at != null;

    // Length: prefer what the LLM extracted / the user picked. If
    // still unknown (LLM didn't infer, user didn't override), fall
    // back to a sane importance-keyed default — never the old
    // hardcoded 30, which over-booked Trials and under-budgeted
    // Whims. (Computed BEFORE the slot search — the slot needs to
    // know how long the task is.)
    const defaultDurationForImportance: Record<Importance, number> = {
      high: 60,
      medium: 30,
      low: 15,
    };
    const effectiveDuration =
      t.durationMinutes ?? defaultDurationForImportance[t.importance];

    // AUTO-SLOT — a windowed task with no explicit time gets the next
    // open :15 slot in its window (after anchors + everything already
    // scheduled), decided ONCE here at commit. Five "morning" tasks
    // cascade 8:15 → 8:30 → … instead of piling up at the window
    // start. Quests are read FRESH from the store (not the render
    // closure) so batch captures see each other's slots. Overflow is
    // honest now: a full window crams later the same day, a full DAY
    // moves the task to the next day with room (with a toast saying
    // so) — never N tasks stacked on the same phantom minute.
    let derivedAt: number | null = null;
    let derivedDate: string | null = null;
    if (
      !hasTime &&
      t.timeMode === 'windowed' &&
      t.window !== 'someday' &&
      !t.recur
    ) {
      const targetISO = t.date ?? todayKey();
      const res = resolveSlot({
        window: t.window,
        dateISO: targetISO,
        durationMin: effectiveDuration,
        quests: useQuestStore.getState().quests,
        anchors,
        effectiveWindows,
        nowMin:
          targetISO === todayKey()
            ? new Date().getHours() * 60 + new Date().getMinutes()
            : null,
      });
      if (res) {
        derivedAt = res.min;
        if (res.how === 'moved') {
          derivedDate = res.dateISO;
          const d = new Date(res.dateISO + 'T12:00');
          const short =
            t.title.length > 22 ? `${t.title.slice(0, 20)}…` : t.title;
          const dayLabel =
            res.dateISO === offsetDate(1)
              ? 'tomorrow'
              : d.toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                });
          showToast(
            `That day’s full — “${short}” landed ${dayLabel} ${fmtMin(res.min)}.`,
          );
        }
      }
    }
    const effectiveAt = hasTime ? (t.at as number) : derivedAt;
    const writeAnchor = effectiveAt != null;

    const quest = addQuest({
      title: t.title,
      difficulty: difficultyFromImportance(t.importance),
      importance: t.importance,
      window: t.window,
      // Duration is always written — even on windowed tasks (no
      // anchored time) — so the Time tab can render the right
      // height for everything, not just clock-anchored items.
      // Previously durationMinutes was bundled with the anchor
      // spread, so a "morning" task with no specific time fell back
      // to Time's 30-min default regardless of what the user picked.
      durationMinutes: effectiveDuration,
      ...(writeAnchor && {
        scheduledHour: Math.floor(effectiveAt / 60),
        scheduledMinute: effectiveAt % 60,
      }),
      ...(t.recur
        ? { date: firstDueDateFor(t.recur) }
        : derivedDate
          ? { date: derivedDate } // overflow moved it to a day with room
          : t.date
            ? { date: t.date }
            : {}),
      ...(t.recur && { recur: t.recur }),
      ...(t.note ? { note: t.note } : {}),
    });
    // Note: we no longer do a post-commit llmCleanTitle pass. The
    // upstream preview already shows the LLM-cleaned title (held
    // back via aiPending until llmUnderstand resolves), so by the
    // time we get here the title the user approved IS the LLM's
    // version. Doing a second post-commit swap would just risk the
    // task title flickering AGAIN after they've already approved it
    // — exactly the "text changes a couple seconds later" complaint.
  };

  /**
   * Single structured-extraction LLM call (per smarter-ai spec §2).
   * Builds the context block, sends the raw text, then patches the
   * preview tasks in place using the math layer for placement.
   * No-op on any failure — deterministic preview stays.
   */
  /**
   * Run the LLM understand pass for a capture. Returns the LLM's
   * result (or null on timeout / error). Callers use this to build
   * the previewTasks list AUTHORITATIVELY from the LLM's output
   * instead of showing the deterministic parse first and rebuilding
   * later (which caused a visible wrong→right re-render flash).
   */
  const runLlmUnderstand = async (
    rawText: string,
  ): Promise<UnderstoodTask[] | null> => {
    const todayISO = todayKey();
    const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      now.getDay()
    ];
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const fmtAnchor = (m: number) => {
      const h = Math.floor(m / 60);
      const mn = m % 60;
      return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
    };
    const understandCtx: UnderstandContext = {
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
      todayTasks: todayQuests
        .filter((q) => !q.completed)
        .slice(0, 12)
        .map((q) => `${q.title} (${q.window})`),
      recentCorrections: summarizeCorrections(recentCorrections(6)),
      userName: userName.trim() || undefined,
    };
    // Race the LLM against a timeout so a hung request doesn't leave
    // the sorting card up forever — but SCALE it with the dump size.
    // A flat 5s killed every big dump: a 12-task comma-run generates
    // ~1,500+ tokens of JSON, which simply takes longer than 5s, so
    // the one input that most needs the LLM always fell back to the
    // deterministic parser. The "Lumi is sorting…" card carries the
    // wait. ~6s floor + 25ms/char, capped at 25s.
    const timeoutMs = Math.min(25_000, 6_000 + rawText.length * 25);
    const llm = llmUnderstand(rawText, understandCtx).then((r) => r ?? null);
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    );
    const result = await Promise.race([llm, timeout]);
    return result?.tasks ?? null;
  };

  /**
   * Build a SmartTask[] from the LLM's understood tasks. Reuses each
   * matching deterministic slot as the base (preserves timeOptions /
   * raw / needsFollowup) and stubs when the LLM found more.
   */
  const smartTasksFromLlm = (
    llmTasks: UnderstoodTask[],
    detTasks: SmartTask[],
  ): SmartTask[] => {
    const stub = (t: UnderstoodTask): SmartTask => ({
      title: t.title,
      importance: t.importance ?? 'medium',
      energyDemand: t.energyDemand ?? 'medium',
      timeMode: 'windowed',
      at: null,
      date: null,
      window: 'midday',
      recur: null,
      raw: t.title,
      needsFollowup: false,
    });
    return llmTasks.map((llmTask, i) =>
      patchWithUnderstood(detTasks[i] ?? stub(llmTask), llmTask),
    );
  };

  /** Merge an UnderstoodTask onto a deterministic SmartTask. The
   *  LLM's understanding wins for title/importance/energyDemand/note,
   *  and for date/time when it's MORE specific than what the
   *  deterministic parser found. Existing explicit user choices
   *  (timeOptions) are preserved. */
  const patchWithUnderstood = (
    t: SmartTask,
    u: UnderstoodTask,
  ): SmartTask => {
    // Convert LLM "when" into our shape.
    let atFromLLM: number | null = null;
    if (u.when?.time) {
      const [h, m] = u.when.time.split(':').map((n) => parseInt(n, 10));
      if (Number.isFinite(h) && Number.isFinite(m)) atFromLLM = h * 60 + m;
    }
    const dateFromLLM = u.when?.date ?? null;
    const partFromLLM = u.when?.part ?? null;
    const recurFromLLM = u.when?.recur ?? null;

    // Window:
    //   1. Explicit clock time wins (derived from `at`).
    //   2. Else explicit LLM part-of-day wins.
    //   3. Else if energyDemand disagrees with importance, re-route
    //      through the energy-aware placer so a high-demand task
    //      hidden inside a "low importance" wrapper lands in peak
    //      instead of slump. This is the only way the LLM's
    //      energyDemand signal actually moves the task.
    //   4. Else keep the deterministic window.
    const newAt = atFromLLM ?? t.at;
    let newDate = dateFromLLM ?? t.date;
    let newWindow = t.window;
    let rolledByPlacement = false;
    if (partFromLLM) {
      newWindow = partFromLLM;
    } else if (
      newAt == null &&
      !recurFromLLM &&
      u.energyDemand !== u.importance
    ) {
      const ctxForPlacement: CaptureContext = {
        sharpWindow,
        foggyWindow,
        peakStart: digest.curve.peakStart,
        peakEnd: digest.curve.peakEnd,
        slumpStart: digest.curve.slumpStart,
        slumpEnd: digest.curve.slumpEnd,
        effectiveWindows,
        now,
        nowMin: now.getHours() * 60 + now.getMinutes(),
        wakeMin: anchors.wake,
        sleepMin: anchors.sleep,
        anchors,
      };
      const pick = pickWindowForDemand(
        u.importance,
        u.energyDemand,
        ctxForPlacement,
      );
      newWindow = pick.window;
      // When the placer rolled to tomorrow (e.g. late-night dump,
      // wind-down zone) honor the date roll so the task doesn't
      // land on today's already-passed window.
      if (pick.rolledToTomorrow) {
        const rolled = new Date(now);
        rolled.setDate(rolled.getDate() + 1);
        newDate = `${rolled.getFullYear()}-${String(rolled.getMonth() + 1).padStart(2, '0')}-${String(rolled.getDate()).padStart(2, '0')}`;
        rolledByPlacement = true;
      }
    }

    // Recur: pass through the LLM's cadence/day/interval. Honor the
    // LLM's time if present.
    const recur = recurFromLLM
      ? {
          every: recurFromLLM.every,
          part:
            partFromLLM ??
            (newWindow === 'someday' ? 'morning' : (newWindow as 'morning' | 'midday' | 'afternoon' | 'evening')),
          ...(recurFromLLM.day ? { day: recurFromLLM.day } : {}),
          ...(recurFromLLM.interval != null
            ? { interval: recurFromLLM.interval }
            : {}),
          ...(newAt != null ? { at: newAt } : {}),
        }
      : t.recur;

    return {
      ...t,
      title: u.title || t.title,
      importance: u.importance,
      energyDemand: u.energyDemand,
      at: newAt,
      date: newDate,
      timeMode: newAt != null ? 'anchored' : t.timeMode,
      window: newWindow,
      recur: recur as SmartTask['recur'],
      needsFollowup: u.hasDeadline && newAt == null && newDate == null,
      // LLM's inferred duration wins over the deterministic guess
      // (it understands phrasing like "hour long meeting" where
      // the regex parser can't). User can still override via the
      // length chips in the preview.
      durationMinutes: u.when?.durationMin ?? t.durationMinutes,
      ...(rolledByPlacement ? { rolledToTomorrow: true } : {}),
      // Persist the LLM's freeform note ("bring the charger") so
      // the detail surfaces under the title on Home / Time / lists.
      ...(u.note ? { note: u.note } : {}),
    };
  };

  /** Toast that confirms what landed where (single task). */
  const placementToast = (t: SmartTask): string => {
    const winLabel = effectiveWindows[t.window].label.toLowerCase();
    const titlePreview =
      t.title.length > 24 ? t.title.slice(0, 22) + '…' : t.title;
    // 3am anxiety dump — close the loop out loud (fresh-eyes #2):
    // the capture already rolled to tomorrow; SAY so, so the night
    // brain can put it down.
    if (t.rolledToTomorrow) {
      return `Caught it — “${titlePreview}” is on tomorrow. Nothing to do tonight.`;
    }
    if (t.timeMode === 'anchored' && t.at != null) {
      const h = Math.floor(t.at / 60);
      const m = t.at % 60;
      const hr = h % 12 || 12;
      const suf = h < 12 ? 'am' : 'pm';
      const timeStr =
        m === 0
          ? `${hr} ${suf}`
          : `${hr}:${String(m).padStart(2, '0')} ${suf}`;
      return `“${titlePreview}” — pinned to ${timeStr}. See it on Time.`;
    }
    if (t.recur) return `“${titlePreview}” — set to repeat 🔁`;
    if (t.window === 'someday') return `“${titlePreview}” — tucked into someday.`;
    return `“${titlePreview}” — tucked into your ${winLabel}.`;
  };

  /**
   * Parse + preview — shared by the direct send and the spell-format
   * pass. `spellFixed` means the text already went through the tiny
   * Haiku format pass (spelling/caps fixed), so a plain multi-
   * fragment gate result parses LOCALLY — the deterministic splitter
   * is corpus-proven on clean lists, and that swap is the token win
   * (one ~0.03¢ format call instead of a ~1¢ understand).
   * Returns false when nothing task-shaped came out (caller keeps
   * the pill text).
   */
  const buildCaptureCtx = (): CaptureContext => ({
    sharpWindow,
    foggyWindow,
    peakStart: digest.curve.peakStart,
    peakEnd: digest.curve.peakEnd,
    slumpStart: digest.curve.slumpStart,
    slumpEnd: digest.curve.slumpEnd,
    effectiveWindows,
    now,
    nowMin: now.getHours() * 60 + now.getMinutes(),
    wakeMin: anchors.wake,
    sleepMin: anchors.sleep,
    anchors,
  });

  const parseAndPreview = (text: string, spellFixed = false): boolean => {
    const ctx: CaptureContext = buildCaptureCtx();

    const detTasks = parseSmartCapture(text, ctx);
    if (detTasks.length === 0) return false;

    // The user just said they're overwhelmed — Luna sits with them
    // (the ONE sanctioned sad pose, emotional-model spec §1).
    if (textReadsOverwhelmed(text)) {
      triggerEmpathize();
      showToast("That sounds like a lot. Let's carry it together.");
    }

    // The routing gate (goal §2.1) — a clean single-task capture ships
    // the deterministic result instantly: zero tokens, zero spinner.
    // Multi-task / long / emotional captures earn the LLM — EXCEPT a
    // spell-fixed multi (see doc above).
    const gate = isEnglishCapture
      ? routeCapture(text, detTasks)
      : ({ route: 'llm', reason: 'non-english' } as const);
    const skipLlm = spellFixed && gate.reason === 'multi';
    if (isLlmAvailable() && (gate.route === 'llm' || !isEnglishCapture) && !skipLlm) {
      // Sorting flow — don't show the deterministic preview at all.
      // sortingRaw drives the "Lumi is sorting…" card up top; we
      // only set previewTasks once the LLM has returned (or the
      // timeout forces a fallback). This eliminates the wrong→
      // right re-render flash — the user sees "sorting" then the
      // correct "1 of N" list, never the deterministic 1-task guess
      // for a comma dump.
      const metricId = recordAiMetric({
        route: 'llm',
        reason: gate.reason,
        latencyMs: 0,
        edited: false,
      });
      lastMetricIdRef.current = metricId;
      const startedAt = Date.now();
      setSortingRaw(text);
      setAiPending(true);
      const gen = ++sortGenRef.current;
      void runLlmUnderstand(text).then((llmTasks) => {
        if (sortGenRef.current !== gen) return; // "never mind" won
        setSortingRaw(null);
        setAiPending(false);
        if (llmTasks && llmTasks.length > 0) {
          updateAiMetric(metricId, { latencyMs: Date.now() - startedAt });
          const merged = smartTasksFromLlm(llmTasks, detTasks);
          setPreviewTasks(merged);
          logCaptureRaw(text, merged, 'llm', gate.reason);
        } else {
          // LLM failed or timed out — fall back to deterministic
          // so the user still gets SOMETHING (better than nothing).
          updateAiMetric(metricId, {
            route: 'llm_fallback',
            latencyMs: Date.now() - startedAt,
          });
          setPreviewTasks(personalizeTasks(detTasks, recentCorrections(20), {
        strongWindow: digest.pattern?.strong ?? null,
      }));
        }
      });
    } else {
      // Local path — gate said simple, LLM unavailable, or the text
      // is spell-fixed and just needs the splitter.
      lastMetricIdRef.current = recordAiMetric({
        route: 'local',
        reason: skipLlm ? 'multi-spellfixed' : gate.reason,
        latencyMs: 0,
        edited: false,
      });
      const localTasks = personalizeTasks(detTasks, recentCorrections(20), {
        strongWindow: digest.pattern?.strong ?? null,
      });
      setPreviewTasks(localTasks);
      logCaptureRaw(
        text,
        localTasks,
        'local',
        skipLlm ? 'multi-spellfixed' : gate.reason,
      );
    }
    return true;
  };

  /**
   * Zero tasks came out of a send. If the text reads emotional, Luna
   * acknowledges it (empathize pose + the vent card with an Untangle
   * hand-off) — "vents are never tasks" deserves a visible moment,
   * not a no-op. Non-emotional zero-parses keep the old behavior
   * (text stays in the pill for editing).
   */
  const handleNoTasks = (text: string) => {
    const ventish =
      textReadsOverwhelmed(text) ||
      /\b(ugh+|tired|exhausted|overwhelm\w*|stress\w*|drowning|anxious|screwed|hate (?:this|everything|myself)|can'?t (?:do this|even)|falling apart|done with)\b/i.test(
        text,
      );
    if (!ventish) {
      // Not a vent, nothing parsed — the send used to be a silent
      // no-op that just ate the text.
      showToast('couldn’t find a task in that — try “call mom tomorrow”');
      return;
    }
    triggerEmpathize();
    setVentText(text);
    setCapText('');
    // The vent card renders in the pill block — if the brain-dump
    // modal is open it would acknowledge into the void behind it.
    setCapOpen(false);
    recordAiMetric({
      route: 'dym',
      reason: 'vent-shown',
      latencyMs: 0,
      edited: false,
    });
  };

  const sendCapture = () => {
    const text = capText.trim();
    if (!text) return;
    // Typed mistakes get the same net as voice (goal: any mistake →
    // Lumi suggests): a suspicious text is held ONCE with the
    // did-you-mean card + background clarify. Sending the same text
    // again means "I meant it" — it goes through.
    const typedTidy = tidyTranscript(text);
    if (isEnglishCapture && typedTidy.suspicious && !dymHeldRef.current.has(text)) {
      const parked = typedTidy.changed ? typedTidy.tidied : text;
      dymHeldRef.current.add(parked);
      // Deterministic fixes (date-word near-misses) apply directly —
      // they're surgical and safe. The LLM's whole-sentence repair
      // shows in the card instead, so the user SEES the suggestion
      // and chooses it ("use this") rather than discovering their
      // text quietly rewritten.
      if (typedTidy.changed) setCapText(parked);
      setDymHint(true);
      setDymSuggestion(null);
      recordAiMetric({ route: 'dym', reason: 'shown', latencyMs: 0, edited: false });
      // The dym card lives in the pill block — a hold triggered from
      // the open capture modal was invisible (looked like a dead
      // send button).
      setCapOpen(false);
      if (isLlmAvailable() && access.hasPremium) {
        void llmClarify(parked).then((fixed) => {
          if (!fixed || fixed === parked) return;
          dymHeldRef.current.add(fixed); // both texts now pass send
          setDymSuggestion(fixed);
        });
      }
      return;
    }
    setDymHint(false);
    setDymSuggestion(null);

    // Parse the TIDIED text — "ok ok ok dishes" was reaching the
    // parser with the stutter intact because tidy only gated the
    // did-you-mean card.
    const parseText =
      isEnglishCapture && typedTidy.changed ? typedTidy.tidied : text;

    // ── Spell-format pass (Pro, goal: "LLM formats it, our smart
    // parser picks it up"). Text isn't suspicious, but it contains
    // words the ~10k common-word list doesn't know ("lanch",
    // "tomorow", lowercase "danny") → one tiny Haiku call fixes
    // spelling + capitalization, then the DETERMINISTIC engine
    // builds the tasks from the clean string. Free tier skips this
    // (their captures parse exactly as before).
    // Would this capture route to the understand LLM anyway? Then
    // Sonnet normalizes the typos itself — chaining the Haiku spell
    // pass first DOUBLED latency and burned two capture-bucket units
    // for one send (token audit #5). Spell-fix only pays when the
    // cleaned text will parse LOCALLY (or split locally via 'multi').
    const spellProbe = () => {
      const det = parseSmartCapture(parseText, buildCaptureCtx());
      const g = routeCapture(parseText, det);
      return g.route === 'local' || g.reason === 'multi';
    };
    if (
      isEnglishCapture &&
      isLlmAvailable() &&
      access.hasPremium &&
      parseText.length <= 300 &&
      countUnknownWords(parseText) > 0 &&
      spellProbe()
    ) {
      setEditingIdx(null);
      setCapText('');
      setCapOpen(false);
      Haptics.selectionAsync();
      setSortingRaw(parseText);
      setAiPending(true);
      const spellGen = ++sortGenRef.current;
      const spellStarted = Date.now();
      void llmClarify(parseText).then((fixed) => {
        if (sortGenRef.current !== spellGen) return; // "never mind" won
        setSortingRaw(null);
        setAiPending(false);
        recordAiMetric({
          route: 'llm',
          reason: 'spell-format',
          latencyMs: Date.now() - spellStarted,
          edited: false,
        });
        const finalText = fixed && fixed.trim() ? fixed.trim() : parseText;
        if (!parseAndPreview(finalText, true)) {
          // Nothing task-shaped — put their words back, lose nothing.
          setCapText(text);
          handleNoTasks(finalText);
        } else if (finalText !== text) {
          logCaptureRaw(text, null, 'llm', 'spell-format', {
            fixed: finalText,
          });
        }
      });
      return;
    }

    if (!parseAndPreview(parseText)) {
      handleNoTasks(parseText);
      return;
    }

    setEditingIdx(null);
    setCapText('');
    setCapOpen(false);
    Haptics.selectionAsync();
  };

  // ── Preview confirmation handlers ────────────────────────────────
  const offsetDate = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days); // LOCAL, matches todayKey()
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Double-tap guard (audit: the "two Gym rows" bug). Accept buttons
  // had no latch, so two taps in one frame — before previewTasks
  // re-rendered — committed every task TWICE. The latch resets each
  // time previewTasks changes, so stepping through the queue still
  // works; only a synchronous double-fire is swallowed.
  const previewCommitLatch = useRef(false);
  useEffect(() => {
    previewCommitLatch.current = false;
  }, [previewTasks]);

  const approvePreview = () => {
    if (!previewTasks) return;
    if (previewCommitLatch.current) return;
    previewCommitLatch.current = true;
    for (const t of previewTasks) commitTask(t);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast(
      previewTasks.length > 1
        ? `Saved ${previewTasks.length} tasks — sorted into your day.`
        : placementToast(previewTasks[0]),
    );
    setPreviewTasks(null);
    setEditingIdx(null);
  };

  const cancelPreview = () => {
    setPreviewTasks(null);
    setEditingIdx(null);
    Haptics.selectionAsync();
  };

  /** Per-task accept — commits ONE task and removes it from the
   *  preview. When the last one's accepted, the card closes. */
  // When a previewed task is recurring, the user MUST confirm cadence
  // + interval + time through HabitScheduleSheet before committing —
  // never silently commit a recur the user hasn't verified. The
  // schedule sheet pre-fills with what we know (LLM extract or
  // deterministic guess), so the user is always one tap from accepting
  // the suggestion, but never blind. Per the spec: "everything that's
  // suggested to repeat should allow users to set an interval."
  const [pendingScheduleTask, setPendingScheduleTask] = useState<{
    task: SmartTask;
    idx: number;
  } | null>(null);

  const approveTask = (idx: number) => {
    if (!previewTasks) return;
    const t = previewTasks[idx];
    if (!t) return;
    if (t.recur) {
      Haptics.selectionAsync();
      setPendingScheduleTask({ task: t, idx });
      return;
    }
    // Same double-tap latch as approvePreview — a fast double-tap on
    // one task's accept used to commit it twice before the splice.
    if (previewCommitLatch.current) return;
    previewCommitLatch.current = true;
    commitTask(t);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const remaining = previewTasks.filter((_, i) => i !== idx);
    // Explicitly release the latch alongside the state change so a
    // future refactor that decouples the [previewTasks] effect can't
    // leave accept wedged off (the effect still resets it too).
    previewCommitLatch.current = false;
    if (remaining.length === 0) {
      setPreviewTasks(null);
      setEditingIdx(null);
      showToast(placementToast(t));
    } else {
      setPreviewTasks(remaining);
      // If the user was editing a later task, its index just shifted.
      setEditingIdx(null);
    }
  };

  /** Called when the user confirms the recurrence in the schedule
   *  sheet. Patches the pending task with the user's rule + commits. */
  const commitPendingSchedule = (
    rule: import('../../constants/recur').RecurRule,
  ) => {
    if (!pendingScheduleTask || !previewTasks) return;
    const { task, idx } = pendingScheduleTask;
    const patched: SmartTask = {
      ...task,
      recur: rule,
      window: rule.part as WindowKey,
      ...(rule.at != null
        ? { at: rule.at, timeMode: 'anchored' as const }
        : {}),
    };
    commitTask(patched);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPendingScheduleTask(null);
    const remaining = previewTasks.filter((_, i) => i !== idx);
    if (remaining.length === 0) {
      setPreviewTasks(null);
      setEditingIdx(null);
      showToast(placementToast(patched));
    } else {
      setPreviewTasks(remaining);
      setEditingIdx(null);
    }
  };

  /** Per-task dismiss — drops ONE task from the preview without
   *  saving it. Useful when Lumi misread something the user typed. */
  const dismissTask = (idx: number) => {
    if (!previewTasks) return;
    Haptics.selectionAsync();
    const remaining = previewTasks.filter((_, i) => i !== idx);
    if (remaining.length === 0) {
      setPreviewTasks(null);
      setEditingIdx(null);
    } else {
      setPreviewTasks(remaining);
      setEditingIdx(null);
    }
  };

  const startEditing = (idx: number) => {
    const t = previewTasks?.[idx];
    if (!t) return;
    Haptics.selectionAsync();
    setEditingIdx(idx);
    setEditingTitle(t.title);
    setEditingDate(t.date === offsetDate(1) ? 'tomorrow' : 'today');
    setEditingWindow(t.window === 'someday' ? 'midday' : t.window);
    setEditingDurationMin(t.durationMinutes ?? null);
  };

  const saveEdit = () => {
    if (editingIdx == null || !previewTasks) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const orig = previewTasks[editingIdx];
    // When the task already has an explicit clock time, only title +
    // day are editable — the part-of-day chips are hidden, so we
    // preserve the anchored time and derive the window from it.
    const hasAnchoredTime = orig.at != null;
    const newTitle = editingTitle.trim() || orig.title;
    const newDate = editingDate === 'tomorrow' ? offsetDate(1) : todayKey();
    const next: SmartTask = {
      ...orig,
      title: newTitle,
      date: newDate,
      ...(editingDurationMin != null
        ? { durationMinutes: editingDurationMin }
        : {}),
      ...(hasAnchoredTime
        ? {} // keep window/at/timeMode untouched
        : {
            window: editingWindow,
            timeMode: 'windowed',
            at: null,
          }),
    };
    const updated = [...previewTasks];
    updated[editingIdx] = next;
    setPreviewTasks(updated);
    setEditingIdx(null);

    // Persist the delta as a correction so future LLM calls see how
    // this user actually wants tasks placed. Only record fields the
    // user actually changed — empty-delta records are skipped by the
    // store. Per lumi-smarter-ai-spec.md §6.
    const delta: Correction['delta'] = {};
    if (newTitle !== orig.title) {
      delta.title = { from: orig.title, to: newTitle };
    }
    if (!hasAnchoredTime && editingWindow !== orig.window) {
      delta.window = { from: orig.window, to: editingWindow };
    }
    if (editingDurationMin != null && editingDurationMin !== orig.durationMinutes) {
      delta.durationMinutes = {
        from: orig.durationMinutes,
        to: editingDurationMin,
      };
    }
    if (newDate !== orig.date) {
      delta.date = { from: orig.date ?? todayKey(), to: newDate };
    }
    recordCorrection({
      date: todayKey(),
      raw: orig.raw ?? orig.title,
      delta,
    });
    // Edit-rate is the quality dial for the routing gate (§2.5) —
    // only meaningful edits count (empty deltas are skipped above).
    if (Object.keys(delta).length > 0 && lastMetricIdRef.current) {
      markMetricEdited(lastMetricIdRef.current);
    }
  };

  const cancelEdit = () => {
    Haptics.selectionAsync();
    setEditingIdx(null);
  };

  // ── Voice (Whisper) ──────────────────────────────────────────────
  // Tap to start, tap again to stop + transcribe. The transcribed text
  // flows straight through the smart-capture pipeline so the user's
  // just speaking their tasks into existence.

  /**
   * Post-transcribe handling — shared by every mic entry point (the
   * capture-pill mic and the dump modal's MicButton). Voice FILLS
   * the capture field; the user presses send to parse. Runs the
   * deterministic tidy first and nudges "did you mean" when the
   * transcript looks off.
   */
  const handleTranscribed = (text: string) => {
    const final = text.trim();
    if (!final) return;
    // Voice FILLS, the user FIRES: the transcript parks in the
    // capture field — appended if they'd typed — and nothing parses
    // until they press send. Deterministic tidy runs first; a
    // suspicious transcript raises the "did you mean" card AND kicks
    // off the tiny LLM clarify pass (~100 tokens) in the background.
    // If the model recovers a better reading before the user edits,
    // the parked text upgrades in place — then the user's send still
    // routes through the deterministic engine (usually local), so
    // the expensive understand pass never runs for garble.
    const tidy = tidyTranscript(final);
    const spoken = isEnglishCapture
      ? tidy.changed || tidy.suspicious
        ? tidy.tidied || final
        : final
      : final;
    const prevText = capText.trim();
    const parked = prevText ? `${prevText} ${spoken}` : spoken;
    setCapText(parked);
    if (isEnglishCapture && tidy.suspicious) {
      setDymHint(true);
      setDymSuggestion(null);
      if (isLlmAvailable() && access.hasPremium) {
        void llmClarify(spoken).then((fixed) => {
          if (!fixed || fixed === spoken) return;
          const upgraded = prevText ? `${prevText} ${fixed}` : fixed;
          // Visible suggestion in the card — never a silent rewrite.
          setDymSuggestion(upgraded);
        });
      }
    }
  };


  const handleMic = async () => {
    if (voice.state === 'idle') {
      // Hand the recognizer over: the Hey-Lumi wake loop (if armed)
      // aborts first, and a short beat lets its terminal `end` land
      // before the pill claims the singleton mic.
      if (heyLumiArmed) {
        heyLumi.cancel();
        // Wait for the drained session's terminal event to actually
        // land (not a fixed beat) — otherwise the pill's cold-start
        // events get swallowed by the foreign-session guard.
        for (let i = 0; i < 10 && isForeignVoiceSession(); i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      // Stays IN the pill — the brain-dump modal is its own room
      // (the expand button); the mic just talks into the input.
      await voice.start();
    } else if (voice.state === 'recording') {
      const text = await voice.stopAndTranscribe();
      if (text && text.trim()) {
        // Park it — the user reviews and presses send themselves.
        handleTranscribed(text);
      }
    }
  };

  // Surface voice errors as a calm toast.
  useEffect(() => {
    if (voice.error) showToast(voice.error);
  }, [voice.error]);

  // ── "Hey Lumi" wake word (Pro) ───────────────────────────────────
  // Foreground hands-free capture: say "hey Lumi" and the voice
  // layer (components/HeyLumiSheet) streams what follows through the
  // SAME pipeline as the pill — tidy → routing gate → deterministic
  // or LLM understand — then reads it back and auto-keeps in 5s.
  // Armed only when: pref ON + Pro + this tab focused + the pill mic
  // idle + no capture flow already in progress. The recognizer is a
  // global singleton, so the wake loop stands down the moment any
  // other mic (or the preview flow) needs the stage.
  const [isFocused, setIsFocused] = useState(true);
  const heyLumiRef = useRef<{ cancel: () => void } | null>(null);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => {
        setIsFocused(false);
        // A live wake/command session must not follow the user to
        // another tab — Untangle's mic shares the same recognizer.
        heyLumiRef.current?.cancel();
      };
    }, []),
  );
  const heyLumiArmed =
    heyLumiEnabled &&
    access.hasPremium &&
    isVoiceConfigured &&
    isFocused &&
    voice.state === 'idle' &&
    !capOpen &&
    !sortingRaw &&
    !previewTasks;

  /** Same pipeline as sendCapture, promise-shaped for the sheet. */
  const heyLumiParse = async (raw: string): Promise<SmartTask[]> => {
    const tidy = tidyTranscript(raw);
    const text = ((tidy.changed ? tidy.tidied : raw) || raw).trim();
    if (!text) return [];
    const d = new Date();
    const ctx: CaptureContext = {
      sharpWindow,
      foggyWindow,
      peakStart: digest.curve.peakStart,
      peakEnd: digest.curve.peakEnd,
      slumpStart: digest.curve.slumpStart,
      slumpEnd: digest.curve.slumpEnd,
      effectiveWindows,
      now: d,
      nowMin: d.getHours() * 60 + d.getMinutes(),
      wakeMin: anchors.wake,
      sleepMin: anchors.sleep,
      anchors,
    };
    const detTasks = parseSmartCapture(text, ctx);
    if (detTasks.length === 0) return [];
    if (textReadsOverwhelmed(text)) triggerEmpathize();
    const gate = isEnglishCapture
      ? routeCapture(text, detTasks)
      : ({ route: 'llm', reason: 'non-english' } as const);
    if (isLlmAvailable() && gate.route === 'llm') {
      const metricId = recordAiMetric({
        route: 'llm',
        reason: gate.reason,
        latencyMs: 0,
        edited: false,
      });
      lastMetricIdRef.current = metricId;
      const startedAt = Date.now();
      const llmTasks = await runLlmUnderstand(text);
      if (llmTasks && llmTasks.length > 0) {
        updateAiMetric(metricId, { latencyMs: Date.now() - startedAt });
        return smartTasksFromLlm(llmTasks, detTasks);
      }
      updateAiMetric(metricId, {
        route: 'llm_fallback',
        latencyMs: Date.now() - startedAt,
      });
    } else {
      lastMetricIdRef.current = recordAiMetric({
        route: 'local',
        reason: gate.reason,
        latencyMs: 0,
        edited: false,
      });
    }
    return personalizeTasks(detTasks, recentCorrections(20), {
        strongWindow: digest.pattern?.strong ?? null,
      });
  };

  const heyLumi = useHeyLumi({
    enabled: heyLumiArmed,
    parse: heyLumiParse,
    onCommit: (kept) => {
      for (const t of kept) commitTask(t);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showToast(
        kept.length > 1
          ? `Saved ${kept.length} tasks — sorted into your day.`
          : placementToast(kept[0]),
      );
    },
    onFixUp: (raw, parsed) => {
      if (parsed.length > 0) {
        // "Fix up" lands in the normal preview cards — same editing
        // surface as a pill capture.
        setPreviewTasks(parsed);
      } else {
        setCapText(raw);
        showToast('Put it in the pill — tweak it and send.');
      }
    },
    onMicProblem: () => {
      setHeyLumiEnabled(false);
      showToast(
        'Mic access is off — “Hey Lumi” paused. Enable it in Settings → Lumi.',
      );
    },
  });
  heyLumiRef.current = heyLumi;

  // ── "While you slept" — narrate overnight captures once ─────────
  const overnightToldRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFocused) return;
    const dayKey = todayKey();
    if (overnightToldRef.current === dayKey) return;
    const nowMin2 = now.getHours() * 60 + now.getMinutes();
    // Only in the first ~3 waking hours.
    if (nowMin2 < anchors.wake || nowMin2 > anchors.wake + 180) return;
    const wakeToday = new Date();
    wakeToday.setHours(Math.floor(anchors.wake / 60), anchors.wake % 60, 0, 0);
    const lastNightSleep = new Date(wakeToday);
    const sleepMin = anchors.sleep % 1440;
    if (anchors.sleep > 1439 || anchors.sleep < anchors.wake) {
      // After-midnight bedtime — sleep happened TODAY, early hours.
      // Anchoring it to yesterday opened a ~30h "overnight" window
      // that swallowed all of yesterday's daytime captures.
      lastNightSleep.setHours(Math.floor(sleepMin / 60), sleepMin % 60, 0, 0);
    } else {
      lastNightSleep.setDate(lastNightSleep.getDate() - 1);
      lastNightSleep.setHours(Math.floor(sleepMin / 60), sleepMin % 60, 0, 0);
    }
    if (quests.length === 0) return; // store may not be hydrated yet
    const overnight = quests.filter(
      (q) =>
        q.date === dayKey &&
        !q.completed &&
        q.createdAt > lastNightSleep.toISOString() &&
        q.createdAt < wakeToday.toISOString(),
    );
    overnightToldRef.current = dayKey;
    if (overnight.length > 0) {
      showToast(
        `You handed me ${overnight.length} thing${
          overnight.length === 1 ? '' : 's'
        } overnight — already sorted into today.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  // ── Notification tap → the promised action ──────────────────────
  const notifIntent = useNotifIntentStore((s) => s.intent);
  const consumeNotifIntent = useNotifIntentStore((s) => s.consume);
  useEffect(() => {
    // Wait for the real quest list — consuming against the empty
    // pre-hydration store made every intent lie ("Nothing on the
    // plate" to a rescue-notification tap) and destroyed the intent.
    if (!isFocused || !notifIntent || !questsHydrated) return;
    const intent = consumeNotifIntent();
    if (!intent) return;
    // A physical "something happened" cue the instant they arrive —
    // the action no longer feels like it already vanished.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Which notification this came from — prefer its own words, so the
    // banner closes the loop between the tap and the result on screen.
    const ORIGIN: Record<string, string> = {
      hero: 'From your morning nudge',
      meds: 'From your meds reminder',
      smallest: 'From your midday check-in',
      tomorrow: 'From your wind-down',
      rescue: 'From your check-in',
      quest: 'From your reminder',
      focusdone: 'Your focus block',
    };
    // Short phrase for the uppercase eyebrow (a full bodySnippet
    // sentence would read badly in caps; it stays plumbed for a11y).
    const origin = ORIGIN[intent.action] ?? 'From your notification';
    switch (intent.action) {
      case 'hero': {
        if (candidates.length === 0) {
          showNotifBanner(origin, 'Nothing on the plate — rest counts. 💛');
          break;
        }
        const already = swap % candidates.length === 0;
        if (!already) setSwap(0);
        flashHero();
        showNotifBanner(
          origin,
          already
            ? `Your top task is already up — “${candidates[0].title}”.`
            : `Brought your top task up — “${candidates[0].title}”.`,
        );
        break;
      }
      case 'meds':
        showNotifBanner(origin, 'Meds + a bite — that’s the whole job. 💛');
        break;
      case 'smallest': {
        if (candidates.length === 0) {
          showNotifBanner(origin, 'Nothing waiting — that’s a win, not a stall.');
          break;
        }
        // Smallest = lowest tier, then shortest. Momentum first.
        let idx = 0;
        for (let i = 1; i < candidates.length; i++) {
          const a2 = candidates[idx];
          const b2 = candidates[i];
          const rank =
            IMPORTANCE[a2.importance].rank - IMPORTANCE[b2.importance].rank;
          if (
            rank > 0 ||
            (rank === 0 &&
              (b2.durationMinutes ?? 30) < (a2.durationMinutes ?? 30))
          ) {
            idx = i;
          }
        }
        const already = idx === swap % candidates.length;
        if (!already) setSwap(idx);
        flashHero();
        showNotifBanner(
          origin,
          already
            ? `“${candidates[idx].title}” is your smallest — momentum starts here.`
            : `Switched to your smallest — “${candidates[idx].title}”.`,
        );
        break;
      }
      case 'tomorrow': {
        const leftovers = todayQuests.filter(
          (q) => !q.completed && q.window !== 'someday',
        );
        if (leftovers.length > 0) {
          // The soft close the notification promised: triage the
          // day's leftovers, then Lumi curls up.
          setDaySetOpen(true);
          showNotifBanner(origin, 'Let’s line up tomorrow’s first thread.');
        } else {
          pillInputRef.current?.focus();
          showNotifBanner(origin, 'Tuck tomorrow’s first thing below — it’ll wait.');
        }
        break;
      }
      case 'rescue':
        if (totallyEmpty) {
          showNotifBanner(origin, 'Nothing on the plate — that IS today’s win.');
        } else {
          setForceRescue(true);
          showNotifBanner(
            origin,
            'Opened Rescue Mode — let’s lighten today.',
            () => setForceRescue(false),
          );
        }
        break;
      case 'quest': {
        const norm = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const idx = candidates.findIndex(
          (q) =>
            q.id === intent.questId ||
            (intent.questTitle && norm(q.title) === norm(intent.questTitle)),
        );
        if (idx >= 0) {
          const already = idx === swap % candidates.length;
          if (!already) setSwap(idx);
          flashHero();
          showNotifBanner(
            origin,
            already
              ? `“${candidates[idx].title}” is already your card.`
              : `Here it is — “${candidates[idx].title}”.`,
          );
        } else {
          // Honest: it isn't in today's list — could be done, moved, or
          // reparked. Don't assert "already handled".
          showNotifBanner(origin, 'That one’s off today’s list — done or moved. 💛');
        }
        break;
      }
      case 'focusdone': {
        // The tap usually lands while the session still reads as
        // "running" — backgrounded JS never got to auto-end it. Settle
        // it so the done screen is up immediately, and ALWAYS confirm
        // (every path used to be able to end silently).
        const fs = useFocusSession.getState();
        if (fs.current && selectRemainingSeconds(fs.current) <= 0) {
          void fs.end({ reason: 'completed' });
        }
        showNotifBanner(origin, 'That focus block counted. 💛');
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, notifIntent, questsHydrated]);

  // ── Untangle → Home "focus this" handoff ────────────────────────
  // When a conversation in Untangle switched the user onto a task
  // (surfaced an easier one, arranged a first move), its main card
  // here mirrors that pick the moment they come back to Home.
  const homeFocusPick = useHomeFocusStore((s) => s.pick);
  const consumeHomeFocus = useHomeFocusStore((s) => s.consume);
  useEffect(() => {
    if (!isFocused || !homeFocusPick || !questsHydrated) return;
    const id = consumeHomeFocus();
    if (!id) return;
    const q = candidates.find((c) => c.id === id);
    if (q) {
      // Point swap at the pick. If a focus session is running the
      // hero is locked to that task (focusQuestId override) — swap
      // still updates, so the pick takes the card the moment the
      // session ends, but we stay quiet rather than announce a card
      // the user can't see change yet.
      surfaceNow(q);
      if (!focusQuestId && hero?.id !== id) {
        showToast(`Starting with “${q.title}” — Lumi’s pick. 💛`);
      }
    } else {
      // Not a candidate yet (the store mutation hasn't reflowed into
      // candidates) — the pendingSurface effect promotes it once it
      // appears. A completed/parked task simply never surfaces.
      pendingSurfaceRef.current = id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, homeFocusPick, questsHydrated]);

  // Suggestion → schedule sheet → commit. The user picks cadence
  // (daily/weekly/monthly/etc.), an optional day, and an exact time
  // before we write the recurring quest. No more silent one-tap
  // accept with whatever Lumi guessed.
  const [scheduleSuggestion, setScheduleSuggestion] =
    useState<Suggestion | null>(null);

  const acceptSuggestion = (s: Suggestion) => {
    Haptics.selectionAsync();
    setScheduleSuggestion(s);
  };

  // Patterns' recurrence door — "/(tabs)?suggest=<id>" opens the
  // schedule sheet for that suggestion directly. The door must
  // DELIVER the setup it promises, not just switch tabs.
  const { suggest: suggestParam } = useLocalSearchParams<{
    suggest?: string;
  }>();
  useEffect(() => {
    // Don't consume the param until the quest store hydrated AND the
    // detector populated — the cold-start path used to clear it
    // against an empty list and silently no-op. If the detector has
    // run and the suggestion's gone, it was already handled.
    if (!suggestParam || !questsHydrated) return;
    const s = suggestions.find((x) => x.id === suggestParam);
    if (s) {
      globalRouter.setParams({ suggest: undefined });
      setScheduleSuggestion(s);
    } else if (suggestions.length > 0) {
      globalRouter.setParams({ suggest: undefined });
      showToast('That one’s already set up 💛');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestParam, suggestions, questsHydrated]);

  // Direct-accept from LumiSuggestCard for the recurrence-suggestion
  // surface (the "heroSuggestion" card). Maps the SuggestInput back
  // to the original Suggestion via id, then creates a recurring
  // quest with the user's overrides for window/duration/exact-time.
  const acceptSuggestionFromCard = (
    sugInput: import('../../components/LumiSuggestCard').SuggestInput,
    opts: SuggestAcceptOptions,
  ) => {
    const s = suggestions.find((x) => x.id === sugInput.id);
    if (!s) return;
    // Honest toast when overflow moved the task off today.
    let movedNote: string | null = null;
    // The card's "Make it repeat" section owns the rule now — it was
    // prefilled from s.guess, so opts.recur IS the user-confirmed
    // version of Lumi's guess. Toggled off → they want it once.
    if (opts.recur) {
      addQuest({
        title: s.title,
        difficulty: 'medium',
        importance: s.importance,
        window: opts.window,
        durationMinutes: opts.durationMin,
        ...(opts.exactMinute != null && {
          scheduledHour: Math.floor(opts.exactMinute / 60),
          scheduledMinute: opts.exactMinute % 60,
        }),
        date: firstDueDateFor(opts.recur),
        recur: opts.recur,
      });
    } else {
      // One-time accept → same auto-slot cascade as capture: no
      // pinned time means "next open :15 in the window", not "pile
      // up at the window start". Overflow-aware: full window crams
      // later today, full day lands on the next day with room.
      const sugRes =
        opts.exactMinute == null
          ? resolveSlot({
              window: opts.window,
              dateISO: todayKey(),
              durationMin: opts.durationMin,
              quests: useQuestStore.getState().quests,
              anchors,
              effectiveWindows,
              nowMin: now.getHours() * 60 + now.getMinutes(),
            })
          : null;
      const sugSlot = opts.exactMinute ?? sugRes?.min ?? null;
      addQuest({
        title: s.title,
        difficulty: 'medium',
        importance: s.importance,
        window: opts.window,
        durationMinutes: opts.durationMin,
        ...(sugSlot != null && {
          scheduledHour: Math.floor(sugSlot / 60),
          scheduledMinute: sugSlot % 60,
        }),
        ...(sugRes?.how === 'moved' && { date: sugRes.dateISO }),
      });
      if (sugRes?.how === 'moved') {
        const d = new Date(sugRes.dateISO + 'T12:00');
        movedNote = `Today’s full — it landed ${
          sugRes.dateISO === offsetDate(1)
            ? 'tomorrow'
            : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
        } ${fmtMin(sugRes.min)}.`;
      }
    }
    consumeSuggestion(s.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(
      opts.recur ? 'Set to repeat 🔁' : movedNote ?? 'Added to your day 💛',
    );
  };

  const dismissSuggestionFromCard = (
    sugInput: import('../../components/LumiSuggestCard').SuggestInput,
  ) => {
    dismissSuggestion(sugInput.id);
    Haptics.selectionAsync();
  };

  // Same accept/dismiss shape, but for the brain-dump previewTask
  // surface. Each preview task already has its own window/at/recur
  // from the LLM; the user's choices in the card take precedence.
  // First day a fresh recur rule is actually due — accepting
  // "Sundays" on a Wednesday used to mint an open task dated
  // Wednesday (and lastSpawnedDate locked it in for the week).
  const firstDueDateFor = (rule: import('../../constants/recur').RecurRule): string => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const DOW_IDX: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    if ((rule.every === 'week' || rule.every === '2week') && rule.day) {
      const target = DOW_IDX[rule.day] ?? d.getDay();
      while (d.getDay() !== target) d.setDate(d.getDate() + 1);
    } else if (rule.every === 'weekday') {
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const acceptPreviewTaskFromCard = (
    sugInput: import('../../components/LumiSuggestCard').SuggestInput,
    opts: SuggestAcceptOptions,
  ) => {
    if (!previewTasks) return;
    // SuggestInput id for preview tasks is "preview_<index>"
    const idx = Number(sugInput.id.replace('preview_', ''));
    const t = previewTasks[idx];
    if (!t) return;
    // Recurrence: the card's "Make it repeat" section is the source
    // of truth now — the user SAW and could edit it there (it used
    // to pass through invisibly from the LLM parse). opts.recur is
    // null when the toggle is off, even if the LLM guessed a cadence.
    const recur = opts.recur;
    // No pinned time → auto-slot into the chosen window (next open
    // :15 after anchors + everything scheduled). Same cascade as
    // commitTask; fresh store read so back-to-back accepts stack.
    // Recurring tasks skip slotting — they're templates.
    const targetISO = t.date ?? todayKey();
    const autoRes =
      opts.exactMinute == null && !recur
        ? resolveSlot({
            window: opts.window,
            dateISO: targetISO,
            durationMin: opts.durationMin,
            quests: useQuestStore.getState().quests,
            anchors,
            effectiveWindows,
            nowMin:
              targetISO === todayKey()
                ? now.getHours() * 60 + now.getMinutes()
                : null,
          })
        : null;
    const anchorMinute = opts.exactMinute ?? autoRes?.min ?? null;
    const movedISO = autoRes?.how === 'moved' ? autoRes.dateISO : null;
    addQuest({
      title: t.title,
      // Parity with "Accept all" (commitTask) — this path used to
      // hardcode medium (different xpReward for the same task) and
      // drop the parsed note.
      difficulty: difficultyFromImportance(t.importance),
      importance: t.importance,
      window: opts.window,
      durationMinutes: opts.durationMin,
      ...(t.note && { note: t.note }),
      ...(anchorMinute != null && {
        scheduledHour: Math.floor(anchorMinute / 60),
        scheduledMinute: anchorMinute % 60,
      }),
      ...(recur
        ? { date: firstDueDateFor(recur) }
        : movedISO
          ? { date: movedISO } // overflow moved it to a day with room
          : t.date
            ? { date: t.date }
            : {}),
      ...(recur && { recur }),
    });
    // Remove this task from the queue; if it was the last, close
    // the preview card entirely.
    const remaining = previewTasks.filter((_, i) => i !== idx);
    setPreviewTasks(remaining.length > 0 ? remaining : null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    let movedToast: string | null = null;
    if (movedISO) {
      const dayLabel =
        movedISO === offsetDate(1)
          ? 'tomorrow'
          : new Date(movedISO + 'T12:00').toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
            });
      // anchorMinute is always set when movedISO is (a 'moved'
      // resolution carries its landing minute) — guard anyway so a
      // future refactor can't produce "landed tomorrow ." with a hole.
      movedToast =
        anchorMinute != null
          ? `That day’s full — it landed ${dayLabel} at ${fmtMin(anchorMinute)}.`
          : `That day’s full — it landed ${dayLabel}.`;
    }
    showToast(
      movedToast ?? (remaining.length > 0 ? 'Added 💛' : 'All added 💛'),
    );
  };

  // One mis-tapped × used to silently delete a parsed task — hold the
  // dropped one for a few seconds so it can come back.
  const [previewDismissUndo, setPreviewDismissUndo] = useState<{
    task: SmartTask;
    idx: number;
  } | null>(null);
  const previewDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const dismissPreviewTaskFromCard = (
    sugInput: import('../../components/LumiSuggestCard').SuggestInput,
  ) => {
    if (!previewTasks) return;
    const idx = Number(sugInput.id.replace('preview_', ''));
    const dropped = previewTasks[idx];
    const remaining = previewTasks.filter((_, i) => i !== idx);
    setPreviewTasks(remaining.length > 0 ? remaining : null);
    if (dropped) {
      setPreviewDismissUndo({ task: dropped, idx });
      if (previewDismissTimer.current)
        clearTimeout(previewDismissTimer.current);
      previewDismissTimer.current = setTimeout(
        () => setPreviewDismissUndo(null),
        6000,
      );
    }
    Haptics.selectionAsync();
  };
  const restoreDismissedPreview = () => {
    if (!previewDismissUndo) return;
    const { task, idx } = previewDismissUndo;
    setPreviewTasks((cur) => {
      const list = cur ? [...cur] : [];
      list.splice(Math.min(idx, list.length), 0, task);
      return list;
    });
    setPreviewDismissUndo(null);
    Haptics.selectionAsync();
  };

  const commitScheduledSuggestion = (rule: import('../../constants/recur').RecurRule) => {
    if (!scheduleSuggestion) return;
    const s = scheduleSuggestion;
    addQuest({
      title: s.title,
      difficulty: 'medium',
      importance: s.importance,
      window: rule.part as WindowKey,
      date: firstDueDateFor(rule),
      recur: rule,
    });
    consumeSuggestion(s.id);
    setScheduleSuggestion(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast('Set to repeat 🔁');
  };

  const dismissSuggestion_ = (s: Suggestion) => {
    dismissSuggestion(s.id);
    Haptics.selectionAsync();
  };

  // CTA button label — e.g. "Repeat Sundays", "Repeat weekdays".
  const suggestionCTA = (s: Suggestion): string => {
    const r = s.guess;
    if (r.every === 'week' && r.day) {
      const plural: Record<string, string> = {
        Sun: 'Sundays',
        Mon: 'Mondays',
        Tue: 'Tuesdays',
        Wed: 'Wednesdays',
        Thu: 'Thursdays',
        Fri: 'Fridays',
        Sat: 'Saturdays',
      };
      return `Repeat ${plural[r.day] ?? 'weekly'}`;
    }
    if (r.every === 'weekday') return 'Repeat weekdays';
    if (r.every === 'day') return 'Repeat daily';
    if (r.every === 'month') return 'Repeat monthly';
    if (r.every === '2week') return 'Repeat every 2 weeks';
    return 'Repeat';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Soft ember radial glow top-right (warm room-at-dusk) */}
      <SoftGlow
        color={accent.fg}
        opacity={0.18}
        fade={0.6}
        cx={0.78}
        cy={0.05}
        style={styles.ambientGlow}
      />
      {/* Twinkling motes — four tiny fireflies around the header,
         staggered so they never pulse in unison. Positions + delays
         from lumi-home-capture-4.jsx. Pure ambience (no touches). */}
      <TwinkleMotes
        motes={[
          { x: 66, y: 96, r: 3, color: C.glow, delay: 0 },
          { x: 318, y: 156, r: 2.5, color: C.dusk, delay: 0.7 },
          { x: 236, y: 64, r: 2, color: C.ember, delay: 1.3 },
          { x: 38, y: 220, r: 2, color: C.dusk, delay: 1.9 },
        ]}
      />

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
      {undoState && (
        <View style={styles.undoToast}>
          <Text style={styles.undoCheckGlyph}>✓</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.undoToastText} numberOfLines={1}>
              Marked done · {undoState.title}
            </Text>
          </View>
          <Pressable
            onPress={undoComplete}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Undo — put ${undoState.title} back`}
          >
            <Text style={[styles.undoBtnText, { color: accent.fg }]}>Undo</Text>
          </Pressable>
        </View>
      )}

      {notifBanner && (
        <View style={styles.notifBanner}>
          <Text style={[styles.notifBannerSpark, { color: accent.fg }]}>✦</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.notifBannerOrigin} numberOfLines={1}>
              {notifBanner.origin}
            </Text>
            <Text style={styles.notifBannerLabel}>{notifBanner.label}</Text>
          </View>
          {notifBanner.undo && (
            <Pressable
              onPress={() => {
                notifBanner.undo?.();
                if (notifBannerTimer.current) {
                  clearTimeout(notifBannerTimer.current);
                }
                setNotifBanner(null);
                Haptics.selectionAsync();
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Undo this"
            >
              <Text style={[styles.undoBtnText, { color: accent.fg }]}>
                Undo
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              if (notifBannerTimer.current) {
                clearTimeout(notifBannerTimer.current);
              }
              setNotifBanner(null);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={styles.notifBannerClose}>×</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          keyboardHeight > 0 && {
            paddingBottom: keyboardHeight + 96,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header: date + greeting + Luna nook ── */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, paddingTop: 4 }}>
            <Text style={styles.dateLine}>{formatDate(now)}</Text>
            <Text style={styles.greeting}>
              {greeting(now.getHours() + now.getMinutes() / 60)}.
            </Text>
            {readout && (
              <Text style={styles.headerReadout}>{readout}</Text>
            )}
          </View>
          {/* The Luna nook IS the profile entry on Home — tap to
              open profile/settings. No separate profile icon up here
              (it'd duplicate the nook). */}
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push('/profile');
            }}
            style={styles.lunaNook}
            hitSlop={6}
          >
            {/* Luna ALWAYS keeps her nook — even when the day is
               cleared (she used to swap out for a person glyph
               there, which read as her leaving; the DAY CLEARED
               card's sleeping Luna is a scene, this is her home).
               Only Focused companion mode (no cat anywhere) falls
               back to the person glyph so the corner still reads
               as the profile entry. */}
            {!companion.showLuna ? (
              <Svg
                width={36}
                height={36}
                viewBox="0 0 24 24"
                fill="none"
              >
                <Circle
                  cx={12}
                  cy={9}
                  r={3.6}
                  stroke={C.boneDim}
                  strokeWidth={1.6}
                />
                <Path
                  d="M5 19c1.6-3.3 4.2-4.9 7-4.9s5.4 1.6 7 4.9"
                  stroke={C.boneDim}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              </Svg>
            ) : (
              <>
                <SoftGlow
                  color={C.glow}
                  opacity={0.22}
                  fade={0.7}
                  cx={0.5}
                  cy={0.18}
                  style={styles.lunaNookGlow}
                />
                {/* Luna in the nook — reflects the user's ambient
                   state (sleeping past bedtime, sad if overdue
                   piles, happy on a long streak, idle by default),
                   PLUS a 30-second 'happy' celebration window
                   whenever a quest gets completed. 52pt in the
                   shrunken 62pt tile (1.625× of the 32px source —
                   soft, but the tile reads cleaner small). */}
                <Image
                  source={lunaSource(nookMood, lunaSkin)}
                  style={{ width: 52, height: 52 }}
                  resizeMode="contain"
                  accessibilityLabel={focusPetName}
                />
              </>
            )}
          </Pressable>
        </View>

        {/* ── The day, as one thread — streak · DayThread · done · +xp ──
            (Replaces the old progress-segment row per the
            lumi-home-capture-4 mock.) Companion-mode gates:
              showStreak → streak chip (kept in Minimal, off in Focused)
              showXp     → "+N xp" tint (kept in Full only) */}
        <View style={styles.todayLine}>
          {companion.showStreak && (
            <View style={styles.streakChip}>
              <Text style={styles.streakFlame}>🔥</Text>
              {streak <= 1 && activeDaysThisMonth > 1 ? (
                // Streak just broke — never show a shaming "1". The
                // number that persists is cumulative: coming back is
                // the whole win.
                <Text style={styles.streakNum}>
                  back
                  <Text style={styles.streakBackSub}>
                    {' '}· {activeDaysThisMonth}d this month
                  </Text>
                </Text>
              ) : (
                <Text style={styles.streakNum}>{streak}</Text>
              )}
            </View>
          )}
          <DayThread
            nowMin={now.getHours() * 60 + now.getMinutes()}
            wakeMin={anchors.wake}
            sleepMin={anchors.sleep}
            done={threadDone}
            upcoming={threadUpcoming}
          />
          <Text style={styles.todayCount}>
            {doneToday} done
            {companion.showXp && (
              <>
                {' · '}
                <Text style={[styles.xpInline, { color: accent.fg }]}>
                  +{xpToday}
                </Text>
              </>
            )}
          </Text>
        </View>

        {/* ── Welcome back (emotional-model spec §2) — after time
            away, Lumi kept your spot warm. Never "you missed X". */}
        {awaySnap?.stage && !rescueActive && !welcomeDismissed && (
          <WelcomeBackCard
            stage={awaySnap.stage}
            line={awaySnap.line ?? ''}
            scene={awaySnap.scene ?? ''}
            lunaSkin={lunaSkin}
            onDismiss={() => setWelcomeDismissed(true)}
          />
        )}

        {/* ═══ THE ONE THING ═══ */}
        {rescueActive ? (
          /* Rescue Mode (spec §3) — life happened; instead of a wall
             of overdue, a warm reset with three doors. */
          <RescueCard
            lunaSkin={lunaSkin}
            onOneThing={rescueOneThing}
            onCleanUp={rescueCleanUp}
            onExplain={rescueExplain}
            onDismiss={() => {
              Haptics.selectionAsync();
              dismissRescueForToday();
            }}
          />
        ) : allDone ? (
          /* Compact text card — Luna lives in her nook now (she used
             to be duplicated here at 96px, which made this card tall
             and put two cats on screen). The nook's mood already
             reads content/sleepy when the day is cleared. */
          <View style={styles.doneCard}>
            <SoftGlow
              color={C.glow}
              opacity={0.18}
              fade={0.7}
              cx={0.5}
              cy={0.3}
              style={styles.doneGlow}
            />
            <Text style={styles.doneEyebrow}>Day cleared</Text>
            <Text style={styles.doneTitle}>
              {companion.showLuna
                ? `That's everything. ${focusPetName}'s content.`
                : 'That’s everything.'}
            </Text>
            <Text style={styles.doneBody}>
              You don&apos;t owe today anything more. Rest, or dump a thought
              below for tomorrow.
            </Text>
          </View>
        ) : totallyEmpty ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEyebrow}>Open canvas</Text>
            <Text style={styles.emptyTitle}>Nothing on the day yet.</Text>
            <Text style={styles.emptyBody}>
              Tuck a thought below — Lumi will surface the next right thing
              when there&apos;s something to surface.
            </Text>
          </View>
        ) : hero ? (
          <View ref={heroRef as never} style={styles.heroWrap}>
            <LumiFocusCard
            showXp={companion.showXp}
              quest={hero}
              petName={focusPetName}
              ambientMood={ambientMood}
              xpReward={hero.xpReward}
              onMarkItDone={() => completeQuest(hero)}
              onOpenPicker={
                // "Focus on another task →" only makes sense when
                // there IS another task to switch to. If the hero
                // is the day's only incomplete quest, drop the
                // link entirely so it doesn't dangle.
                candidates.length > 1
                  ? () => setFocusPickerOpen(true)
                  : undefined
              }
              onSwap={
                candidates.length > 1
                  ? () => setSwap((s) => s + 1)
                  : undefined
              }
              swapAvailable={candidates.length > 1}
              onFocusStart={triggerLick}
              headerRight={
                <HeroOverflowMenu quest={hero} onEdit={setEditingQuest} />
              }
              aboveTitleSlot={
                hero.comment ? (
                  <HeroComment
                    comment={hero.comment}
                    accentColor={accent.fg}
                  />
                ) : null
              }
              descriptionSlot={
                <HeroDescription
                  text={
                    hero.note ??
                    whyLine(
                      hero,
                      hero.window === cw,
                      effectiveWindows[hero.window].label,
                    )
                  }
                  accentColor={accent.fg}
                />
              }
              metaSlot={
                <View style={styles.heroMeta}>
                  <Text
                    style={[
                      styles.heroTierLabel,
                      { color: IMPORTANCE[hero.importance].color },
                    ]}
                  >
                    <Text style={styles.heroTierSigil}>
                      {IMPORTANCE[hero.importance].sigil}
                    </Text>{' '}
                    {IMPORTANCE[hero.importance].label}
                  </Text>
                  <View style={styles.metaDot} />
                  <Text
                    style={[
                      styles.heroWindowMeta,
                      { color: WINDOWS[hero.window].color },
                    ]}
                  >
                    {WINDOWS[hero.window].glyph}{' '}
                    {effectiveWindows[hero.window].label}
                  </Text>
                  <View style={styles.metaDot} />
                  <Text
                    style={[
                      styles.heroKind,
                      { color: classifyKind(hero.title).color },
                    ]}
                  >
                    {classifyKind(hero.title).label}
                  </Text>
                  {companion.showXp && (
                    <>
                      <View style={styles.metaDot} />
                      <Text style={styles.heroXp}>
                        <Text style={styles.heroXpNum}>
                          +{hero.xpReward}
                        </Text>{' '}
                        xp
                      </Text>
                    </>
                  )}
                </View>
              }
            />
            {floater && (
              <View style={styles.floaterMount}>
                <XpFloater amount={floater.amount} color={floater.color} />
              </View>
            )}
            {/* Notification-driven swap flash — a soft ember outline
                that ramps in and fades, so a silent setSwap is
                perceivable as "this card just changed". */}
            <Animated.View
              pointerEvents="none"
              style={[styles.heroFlashOverlay, { opacity: heroFlash }]}
            />
          </View>
        ) : null}

        {/* ── Pull-forward — "feeling it? the next thread —" ─────────
            Only when today's clear and something waits on a future
            date. One task at a time, never the whole pile; dismiss
            folds it into a quiet dashed chip. */}
        {(allDone || totallyEmpty) && nextUpcoming && !pullOfferClosed && (
          <View style={styles.pullCard}>
            <View style={styles.pullHead}>
              <Text style={styles.pullSpark}>✦</Text>
              <Text style={styles.pullEyebrow}>
                Feeling it? {pullLabel}&apos;s first thread —
              </Text>
            </View>
            <Text style={styles.pullTitle}>{nextUpcoming.title}</Text>
            <Text style={styles.pullWhy}>
              {nextUpcoming.note ??
                `a head start now makes ${pullLabel} lighter.`}
            </Text>
            <View style={styles.pullBtnRow}>
              <Pressable onPress={pullForward} style={styles.pullBtn}>
                <Text style={styles.pullBtnText}>Pull it into today</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setPullOfferClosed(true);
                  showToast('Good call. Rest counts.');
                }}
                style={styles.pullDismissBtn}
              >
                <Text style={styles.pullDismissText}>
                  I&apos;m done for today
                </Text>
              </Pressable>
            </View>
            <Text style={styles.pullFootnote}>
              one at a time — {pullLabel} never lands on you all at once
            </Text>
          </View>
        )}
        {(allDone || totallyEmpty) && nextUpcoming && pullOfferClosed && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setPullOfferClosed(false);
            }}
            style={styles.pullReopenChip}
          >
            <Text style={styles.pullSpark}>✦</Text>
            <Text style={styles.pullReopenText}>
              changed your mind? {pullLabel}&apos;s thread is still here
            </Text>
          </Pressable>
        )}

        {/* The expanded brain-dump surface no longer renders inline
            in the scroll — it was popping up somewhere mid-page
            depending on scroll position and reading as buggy. It's
            now a proper slide-from-bottom sheet (HomeCaptureModal),
            rendered at the end of the SafeAreaView so it composes
            with the other modals. The pill's expand button still
            just toggles capOpen; the modal takes over from there. */}


        {/* Sorting card — shown while the LLM is processing a fresh
            capture. Renders in place of the LumiSuggestCard so the
            user never sees the wrong deterministic guess first.
            Cleared as soon as sortingRaw is null (LLM returned or
            5s timeout fired). */}
        {sortingRaw && (
          <View style={styles.sortingCard}>
            <View style={styles.sortingHeaderRow}>
              <Text style={[styles.sortingSpark, { color: accent.fg }]}>
                ✦
              </Text>
              <Text style={styles.sortingEyebrow}>Lumi is sorting…</Text>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  // REAL cancel — invalidate the in-flight LLM call so
                  // its result can't plant a preview seconds after the
                  // user said never mind. Their words go back to the
                  // pill: cancelled ≠ eaten.
                  sortGenRef.current += 1;
                  const raw = sortingRaw;
                  setSortingRaw(null);
                  setAiPending(false);
                  if (raw) setCapText(raw);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Cancel sorting"
                style={styles.sortingCancelBtn}
              >
                <Text style={styles.dymHintClear}>never mind</Text>
              </Pressable>
            </View>
            <Text style={styles.sortingTitle}>reading what you said</Text>
            <View style={styles.sortingDotsRow}>
              <View
                style={[styles.sortingDot, { backgroundColor: accent.fg }]}
              />
              <View
                style={[styles.sortingDot, { backgroundColor: accent.fg }]}
              />
              <View
                style={[styles.sortingDot, { backgroundColor: accent.fg }]}
              />
            </View>
          </View>
        )}

        {/* ── Lumi suggests — preview after brain-dump. Sequential
            LumiSuggestCard rendering: shows the first task with a
            "1 of N" badge, user accepts/dismisses → next task slides
            in. Bulk "Accept all remaining" button below for users
            who don't want to step through one-by-one. Hidden while
            sortingRaw is set so we never render the (possibly
            deterministic) preview before the LLM has spoken. */}
        {!sortingRaw && previewTasks && previewTasks[0] && (
          <View style={{ marginTop: 14 }}>
            <LumiSuggestCard
              // Remount per task — the card seeds duration / window /
              // pin / repeat from the input ONCE on mount, so without
              // a key the first task's choices leaked onto every
              // later task in the queue (all "30m · Afternoon", and
              // the walk's detected daily-morning repeat showed OFF).
              key={`preview-${previewTasks.length}-${previewTasks[0].title}`}
              input={{
                id: 'preview_0',
                title: previewTasks[0].title,
                // Never move a task to tomorrow silently (emotional-
                // model rule): when placement rolled it, the card
                // says so and points at the fix.
                subtitle: previewTasks[0].rolledToTomorrow
                  ? 'moved to tomorrow — your best hours for it are done today.'
                  : undefined,
                note: previewTasks[0].note ?? undefined,
                defaultWindow:
                  previewTasks[0].window === 'someday'
                    ? 'evening'
                    : previewTasks[0].window,
                defaultExactMinute: previewTasks[0].at ?? null,
                // LLM-extracted duration seeds the card — it used to
                // reset to the 30m default on this path while
                // "Accept all" kept it.
                defaultDurationMin:
                  previewTasks[0].durationMinutes ?? undefined,
                // LLM-detected cadence prefills the repeat section —
                // visible + editable instead of silently committed.
                defaultRecur: previewTasks[0].recur ?? null,
              }}
              total={previewTasks.length}
              index={0}
              onAccept={acceptPreviewTaskFromCard}
              onDismiss={dismissPreviewTaskFromCard}
              isWindowFull={(w, d) => {
                const targetISO = previewTasks[0].date ?? todayKey();
                return windowIsFull({
                  window: w,
                  dateISO: targetISO,
                  durationMin: d,
                  quests,
                  anchors,
                  effectiveWindows,
                  nowMin:
                    targetISO === todayKey()
                      ? now.getHours() * 60 + now.getMinutes()
                      : null,
                });
              }}
            />
            {previewTasks.length > 1 && (
              <View style={styles.bulkActionsRow}>
                <Pressable onPress={cancelPreview} style={styles.skipBtn}>
                  <Text style={styles.skipText}>cancel all</Text>
                </Pressable>
                <Pressable
                  onPress={approvePreview}
                  style={[
                    styles.previewApproveBtn,
                    { backgroundColor: accent.fg },
                  ]}
                >
                  <Text style={styles.previewApproveText}>
                    Accept all {previewTasks.length}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
        {previewDismissUndo && (
          <Pressable
            onPress={restoreDismissedPreview}
            style={styles.dymHint}
            accessibilityRole="button"
            accessibilityLabel={`Put ${previewDismissUndo.task.title} back`}
          >
            <Text style={[styles.dymHintText, { flex: 1 }]} numberOfLines={1}>
              dropped “{previewDismissUndo.task.title}”
            </Text>
            <Text style={styles.dymHintClear}>put it back</Text>
          </Pressable>
        )}


        {/* ── Lumi suggests — richer scheduling card per
            lumi-suggest-card.jsx mockup. Each suggestion gets its
            own controls (duration / window / optional exact time)
            before the user accepts. Bulk-aware: when multiple
            suggestions are pending, the "1 of N" badge shows up
            and each accept/dismiss reveals the next. */}
        {heroSuggestion &&
          !allDone &&
          !rescueActive &&
          !previewTasks &&
          !sortingRaw && (
          <View style={{ marginTop: 14 }}>
            <LumiSuggestCard
              // Same remount-per-suggestion reasoning as the preview
              // card above.
              key={heroSuggestion.id}
              input={{
                id: heroSuggestion.id,
                title: heroSuggestion.title,
                // For recurrence suggestions the "note" is the span
                // copy ("4 Sundays in a row") — the evidence that
                // made Lumi spot the pattern in the first place.
                note: heroSuggestion.span
                  ? `You've done this ${heroSuggestion.span.toLowerCase()}`
                  : undefined,
                defaultWindow:
                  (heroSuggestion.guess?.part as WindowKey) ?? 'evening',
                defaultExactMinute: heroSuggestion.guess?.at ?? null,
                // Recurrence suggestions ARE about repeating — the
                // repeat section starts on, prefilled with the
                // detector's guess for the user to confirm or adjust.
                defaultRecur: heroSuggestion.guess ?? null,
              }}
              total={suggestions.length}
              index={0}
              onAccept={acceptSuggestionFromCard}
              onDismiss={dismissSuggestionFromCard}
            />
          </View>
        )}

        {/* ── "N more waiting — Lumi's holding them" ─────────────────
            The rest of the day lives INSIDE Lumi, not on a wall list
            (per the lumi-holding mock). Collapsed pill by default;
            expanding shows each waiting task with a complete-checkbox
            (tier-colored), its window, and a "now" pill that surfaces
            it as the hero immediately. Long-press a row to edit;
            tapping "someday" on a someday row opens the move-back
            sheet. Delete intentionally lives on the hero card only. */}
        {rest.length > 0 && !rescueActive && (
          <View style={styles.waitingCard}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setWaitingOpen((o) => !o);
              }}
              style={styles.waitingHead}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ expanded: waitingOpen }}
            >
              <Text style={styles.waitingSpark}>✦</Text>
              <Text style={styles.waitingHeadTitle}>
                {rest.length} more waiting — Lumi&apos;s holding{' '}
                {rest.length === 1 ? 'it' : 'them'}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.waitingChev}>
                {waitingOpen ? '▴' : '▾'}
              </Text>
            </Pressable>
            {/* Backlog whisper lives INSIDE the pile card now — two
                cards two inches apart described the same pile
                (simplification audit #6). */}
            {backlogNudge && (
              <View style={styles.backlogInline}>
                <Text style={styles.backlogLine}>{backlogNudge.line}</Text>
                <View style={styles.backlogRow}>
                  <Pressable onPress={backlogSnooze} style={styles.backlogBtn}>
                    <Text style={styles.backlogBtnText}>Snooze to tomorrow</Text>
                  </Pressable>
                  <Pressable onPress={backlogTuck} style={styles.backlogBtn}>
                    <Text style={styles.backlogBtnText}>Tuck into someday</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      dismissBacklogNudge();
                    }}
                    style={styles.backlogKeep}
                  >
                    <Text style={styles.backlogKeepText}>keep them</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {waitingOpen && (
              <>
                {rest.map((q) => (
                  <Pressable
                    key={q.id}
                    // TAP opens the edit sheet — long-press-only was
                    // undiscoverable for new users. The checkbox and
                    // "now" pill are their own targets, so a plain
                    // row tap has no competing meaning.
                    onPress={() => {
                      Haptics.selectionAsync();
                      setEditingQuest(q);
                    }}
                    onLongPress={() => {
                      Haptics.selectionAsync();
                      setEditingQuest(q);
                    }}
                    delayLongPress={350}
                    style={styles.waitingRow}
                  >
                    <Pressable
                      onPress={() => completeQuest(q)}
                      hitSlop={10}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: false }}
                      accessibilityLabel={`Mark done: ${q.title}`}
                      style={[
                        styles.waitingCheck,
                        { borderColor: IMPORTANCE[q.importance].color },
                      ]}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.waitingRowTitle}>
                        {q.title}
                      </Text>
                      {q.note && (
                        <Text style={styles.waitingNote}>
                          {q.note}
                        </Text>
                      )}
                    </View>
                    {q.window === 'someday' ? (
                      <Pressable
                        onPress={() => {
                          Haptics.selectionAsync();
                          setMovingBack(q);
                        }}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="Move back to a real day"
                      >
                        <Text style={[styles.waitingWindow, { color: C.mute }]}>
                          someday
                        </Text>
                      </Pressable>
                    ) : (
                      <Text
                        style={[
                          styles.waitingWindow,
                          { color: WINDOWS[q.window].color },
                        ]}
                      >
                        {fmtScheduled(q) ??
                          effectiveWindows[q.window].label.toLowerCase()}
                      </Text>
                    )}
                    <Pressable
                      onPress={() => surfaceNow(q)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Surface now: ${q.title}`}
                      style={[
                        styles.kindPillRow,
                        {
                          backgroundColor: `${classifyKind(q.title).color}1F`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.kindPillRowText,
                          { color: classifyKind(q.title).color },
                        ]}
                      >
                        {classifyKind(q.title).label}
                      </Text>
                    </Pressable>
                  </Pressable>
                ))}
                <Text style={styles.waitingFooter}>
                  tap a task to edit it — tap its tag to bring it up now
                </Text>
              </>
            )}
          </View>
        )}

        {/* Evening door to the close ritual — DaySet was reachable
            ONLY through the wind-down notification tap; users who
            miss the notification never met it. */}
        {!daySetOpen &&
          now.getHours() >= 20 &&
          todayQuests.some((q) => !q.completed && q.window !== 'someday') && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setDaySetOpen(true);
              }}
              style={styles.dymHint}
              accessibilityRole="button"
              accessibilityLabel="Let the day set — close out today"
            >
              <Text style={[styles.dymHintText, { flex: 1 }]}>
                the day’s winding down — want to tuck the rest in? ✦
              </Text>
              <Text style={styles.dymHintClear}>let the day set</Text>
            </Pressable>
          )}

        {/* ── DONE TODAY — the waiting card's sibling, but lichen-lit
            and celebratory: the day's collected wins, not another
            list. Check badge instead of the ✦ spark, a warm tally
            headline, quiet +xp per row, and its own promise line
            (undo, no judgment). Collapsed by default, same calm. */}
        {/* ── Backlog, offered not shamed (spec §5/§7) — an
            observation and two one-tap outs, never a red wall. */}
        {doneTodayList.length > 0 && (
          <View style={styles.doneTodayCard}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setHistoryOpen((o) => !o);
              }}
              style={styles.doneTodayHead}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ expanded: historyOpen }}
            >
              <View style={styles.doneTodayBadge}>
                <Text style={styles.doneTodayBadgeGlyph}>✓</Text>
              </View>
              <Text style={styles.doneTodayHeadTitle}>
                {doneTodayList.length} done today —{' '}
                {doneTodayList.length >= 5
                  ? 'a genuinely full day'
                  : doneTodayList.length === 1
                    ? 'the first one counts double'
                    : 'quietly stacking up'}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.doneTodayChev}>
                {historyOpen ? '▴' : '▾'}
              </Text>
            </Pressable>
            {historyOpen && (
              <>
                {(moreDoneOpen
                  ? doneTodayList
                  : doneTodayList.slice(0, 3)
                ).map((q) => {
                  const ago = fmtAgo(q.completedAt, now);
                  return (
                    <View key={q.id} style={styles.doneTodayRow}>
                      <View style={styles.historyCheck}>
                        <Text style={styles.historyCheckGlyph}>✓</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.historyTitle}>
                          {q.title}
                        </Text>
                        <Text style={styles.historyMeta}>
                          {ago ? ago : 'today'}
                          {q.window !== 'someday' && q.window
                            ? ` · ${effectiveWindows[q.window].label}`
                            : ''}
                        </Text>
                      </View>
                      {companion.showXp && (
                        <Text style={styles.doneTodayXp}>
                          +{q.xpReward}
                        </Text>
                      )}
                      <Pressable
                        onPress={() => undoFromHistory(q)}
                        hitSlop={6}
                        style={styles.undoPill}
                      >
                        <Text style={styles.undoPillGlyph}>↺</Text>
                        <Text
                          style={[styles.undoPillText, { color: accent.fg }]}
                        >
                          Undo
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
                {doneTodayList.length > 3 && (
                  <Pressable
                    onPress={() => setMoreDoneOpen((o) => !o)}
                    style={styles.moreToggle}
                  >
                    <Text style={styles.moreText}>
                      {moreDoneOpen
                        ? 'show less'
                        : `+ ${doneTodayList.length - 3} more`}
                    </Text>
                  </Pressable>
                )}
                <Text style={styles.doneTodayFooter}>
                  changed your mind? undo brings it right back — no
                  judgment
                </Text>
              </>
            )}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ── Floating capture pill ──────────────────────────────────
          Anchored above the LumiFloatingNav, always visible on Home
          (hides only while the expanded brain-dump is showing to
          avoid stacking two capture surfaces).

          Composition:
            ✦ sparkle       — Lumi's voice, matches the hero eyebrow
            editable input  — one-line quick capture; Return submits
            MicButton       — real component (not the raw MicIcon);
                              onTranscribed → same LLM-parse pipeline
            expand icon     — SVG "corners outward" glyph; opens the
                              inline expanded capture for messy dumps

          When capText has content: the mic + expand collapse into a
          single ember-filled ↑ submit button that runs sendCapture,
          matching the mockup's quick-fire capture pattern. */}
      {!capOpen && !previewTasks && !sortingRaw && (
        <View
          // Tour target — the capture-pill rewrite dropped this ref,
          // which left the tour's first step spotlighting nothing.
          ref={captureRef as never}
          style={[
            styles.capturePill,
            // Keyboard open → sit right on top of it (the nav below
            // is buried anyway). Closed → back to the nav clearance.
            keyboardHeight > 0 && { bottom: keyboardHeight + 8 },
          ]}
          pointerEvents="box-none"
        >
          {/* One-time widget intro — replaces the cut onboarding step:
              offer it AFTER the app has proven useful (3 things
              done), not before. */}
          {!dymHint &&
            !ventText &&
            tasksEverCompleted >= 3 &&
            !hintsSeen.includes('widgetIntro') && (
              <View style={styles.dymHint}>
                <Text style={[styles.dymHintText, { flex: 1 }]}>
                  Lumi can live on your Home Screen — long-press it →
                  ＋ → search “Lumi” ✧
                </Text>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    markHintSeen('widgetIntro');
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.dymHintClear}>got it</Text>
                </Pressable>
              </View>
            )}
          {/* One-time "Hey Lumi" intro — Pro users who haven't turned
              the wake word on. Same calm dusk surface as the
              did-you-mean card; two taps and it's live. */}
          {!dymHint &&
            access.hasPremium &&
            isVoiceConfigured &&
            !heyLumiEnabled &&
            !hintsSeen.includes('heyLumiIntro') &&
            // One hint at a time — this used to stack on top of the
            // widget card the moment both conditions held.
            !(
              tasksEverCompleted >= 3 && !hintsSeen.includes('widgetIntro')
            ) && (
              <View style={styles.dymHint}>
                <Text style={styles.dymHintText}>
                  new: say “hey Lumi” to capture hands-free ✧
                </Text>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    void requestHeyLumiPermission().then((ok) => {
                      markHintSeen('heyLumiIntro');
                      if (ok) {
                        setHeyLumiEnabled(true);
                        void Haptics.notificationAsync(
                          Haptics.NotificationFeedbackType.Success,
                        ).catch(() => {});
                        showToast('“Hey Lumi” is on — just say it.');
                      } else {
                        showToast(
                          'Mic access is off — enable it in Settings → Lumi.',
                        );
                      }
                    });
                  }}
                  hitSlop={8}
                >
                  <Text style={[styles.dymHintClear, { color: accent.fg }]}>
                    turn it on
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    markHintSeen('heyLumiIntro');
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.dymHintClear}>not now</Text>
                </Pressable>
              </View>
            )}
          {/* Vent acknowledgment — the capture was a feeling, not a
              task list. Luna says so and offers the Untangle door. */}
          {ventText && (
            <View style={styles.dymHint}>
              <Text style={[styles.dymHintText, { flex: 1 }]}>
                that sounds heavy. I didn’t turn it into tasks — it isn’t
                one. 💛
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  recordAiMetric({
                    route: 'dym',
                    reason: 'vent-untangle',
                    latencyMs: 0,
                    edited: false,
                  });
                  setVentText(null);
                  setRescueExplain(true);
                  router.push('/(tabs)/checkin');
                }}
                hitSlop={8}
              >
                <Text style={[styles.dymHintClear, { color: accent.fg }]}>
                  untangle it
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  recordAiMetric({
                    route: 'dym',
                    reason: 'vent-dismissed',
                    latencyMs: 0,
                    edited: false,
                  });
                  setVentText(null);
                  showToast('Said and held. 💛');
                }}
                hitSlop={8}
              >
                <Text style={styles.dymHintClear}>just needed to say it</Text>
              </Pressable>
            </View>
          )}
          {dymHint && (
            <View style={styles.dymHint}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dymHintText}>
                  {dymSuggestion
                    ? 'did you mean —'
                    : 'did you mean this? check it, then send ✦'}
                </Text>
                {dymSuggestion && (
                  <Text style={styles.dymSuggestionText}>
                    “{dymSuggestion}”
                  </Text>
                )}
              </View>
              {dymSuggestion && (
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setCapText(dymSuggestion);
                    dymHeldRef.current.add(dymSuggestion);
                    setDymSuggestion(null);
                    recordAiMetric({
                      route: 'dym',
                      reason: 'used',
                      latencyMs: 0,
                      edited: false,
                    });
                    // Card stays up so the copy still reads "check
                    // it, then send" — one tap left.
                  }}
                  hitSlop={8}
                >
                  <Text style={[styles.dymHintClear, { color: accent.fg }]}>
                    use this
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setDymHint(false);
                  setDymSuggestion(null);
                  recordAiMetric({
                    route: 'dym',
                    reason: 'scrapped',
                    latencyMs: 0,
                    edited: false,
                  });
                  setCapText('');
                }}
                hitSlop={8}
              >
                <Text style={styles.dymHintClear}>scrap it</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.capturePillInner}>
            <Text
              style={[styles.capturePillSpark, { color: accent.fg }]}
            >
              ✦
            </Text>
            <TextInput
              ref={pillInputRef}
              // While recording, the live partial transcript streams
              // into the pill (dusk-dimmed) so speaking never feels
              // blind — the words appear as they're heard, then the
              // final transcript submits through the same pipeline.
              value={
                voice.state === 'recording' && voice.partial
                  ? voice.partial
                  : capText
              }
              editable={voice.state !== 'recording'}
              onChangeText={(t) => {
                setCapText(t);
                if (dymHint) {
                  setDymHint(false);
                  setDymSuggestion(null);
                }
              }}
              placeholder={
                voice.state === 'recording'
                  ? 'listening…'
                  : 'Dump a thought…'
              }
              placeholderTextColor={C.mute}
              style={[
                styles.capturePillInput,
                {
                  // Native auto-grow: no explicit height, so the
                  // multiline input sizes itself to its content —
                  // flat single line at minHeight, growing to five
                  // 20px lines at maxHeight, scrolling inside past
                  // that. (The old measured-height approach hinged
                  // on iOS contentSize events that don't fire
                  // reliably with a controlled value — pasted or
                  // dictated text stayed clipped to one line.)
                  minHeight: 36,
                  maxHeight: 5 * 20 + 16,
                  lineHeight: 20,
                },
                voice.state === 'recording' && { color: C.dusk },
              ]}
              multiline
              scrollEnabled
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={sendCapture}
              blurOnSubmit={false}
            />
            {/* Mic is ALWAYS visible — the pill's primary purpose is
               speak-instead-of-type. Recording state pulses a dot,
               transcribing state shows an ellipsis, idle shows the
               icon. */}
            <Pressable
              onPress={handleMic}
              hitSlop={10}
              style={styles.capturePillMic}
              accessibilityLabel="Voice capture"
            >
              {voice.state === 'transcribing' ? (
                <Text style={styles.capturePillMicTranscribing}>…</Text>
              ) : voice.state === 'recording' ? (
                <View
                  style={[
                    styles.capturePillMicDot,
                    { backgroundColor: accent.fg },
                  ]}
                />
              ) : (
                <MicIcon size={20} color={C.boneDim} />
              )}
            </Pressable>
            {/* Right-most slot flips between EXPAND (empty → opens
               the brain-dump modal for messier dumps) and SEND
               (text present → runs sendCapture through the LLM
               parse + preview pipeline). Same footprint so the
               swap doesn't shift the mic's position. */}
            {capText.trim() ? (
              <Pressable
                onPress={sendCapture}
                style={[
                  styles.capturePillExpand,
                  {
                    borderColor: accent.fg,
                    backgroundColor: accent.fg,
                  },
                ]}
                hitSlop={6}
                accessibilityLabel="Send"
              >
                <Text
                  style={[
                    styles.capturePillSendGlyph,
                    { color: C.void },
                  ]}
                >
                  ↑
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setCapOpen(true);
                }}
                style={[
                  styles.capturePillExpand,
                  {
                    borderColor: hexA(accent.fg, 0.4),
                    backgroundColor: hexA(accent.fg, 0.14),
                  },
                ]}
                hitSlop={6}
                accessibilityLabel="Open full brain-dump"
              >
                <Svg width={18} height={18} viewBox="0 0 24 24">
                  <Path
                    d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5"
                    stroke={accent.fg}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </Svg>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* "Schedule habit" sheet — opens when the user taps the
          "Lumi noticed" suggestion. Pre-filled with Lumi's guess as
          the starting point; the user adjusts cadence/day/time and
          saves. Cancel closes without committing the suggestion. */}
      <HabitScheduleSheet
        visible={scheduleSuggestion != null}
        onClose={() => setScheduleSuggestion(null)}
        title={scheduleSuggestion?.title ?? ''}
        initial={
          scheduleSuggestion?.guess ?? {
            every: 'day',
            part: 'morning',
            at: 8 * 60,
          }
        }
        onSave={commitScheduledSuggestion}
      />

      {/* Same sheet, mounted for the preview-flow recurring task.
          Opens when the user taps Accept on a previewed task whose
          recur is set; gives them the cadence / interval / time
          confirmation per lumi-monetization spec and the user's
          explicit "always ask for an interval" rule. */}
      <HabitScheduleSheet
        visible={pendingScheduleTask != null}
        onClose={() => setPendingScheduleTask(null)}
        title={pendingScheduleTask?.task.title ?? ''}
        initial={
          pendingScheduleTask?.task.recur ?? {
            every: 'day',
            part: 'morning',
            at: 8 * 60,
          }
        }
        onSave={commitPendingSchedule}
      />

      {/* Someday → any-date sheet (shared with Untangle). Opens
          from the Move-back pill on Then-when-ready rows whose
          window === 'someday'. */}
      <MoveBackToDateSheet
        visible={movingBack != null}
        onClose={() => setMovingBack(null)}
        taskTitle={movingBack?.title ?? ''}
        onPick={(iso) => movingBack && moveQuestBack(movingBack, iso)}
      />

      {/* Edit quest sheet — title + description (optional). Opens
          from the Edit pill in the rest-row meta. Allows adding a
          note where none existed before. */}
      <EditQuestSheet
        visible={editingQuest != null}
        onClose={() => setEditingQuest(null)}
        quest={editingQuest}
        // Delete lives in the edit sheet (two-tap confirm inside) —
        // the waiting rows themselves stay clean.
        onDelete={() => {
          if (!editingQuest) return;
          // A live focus session on this quest would orphan its
          // Dynamic Island pill — end it before the quest vanishes.
          const fs0 = useFocusSession.getState();
          if (fs0.current?.questId === editingQuest.id) {
            void fs0.end({ reason: 'cancelled' });
          }
          useQuestStore.getState().remove(editingQuest.id);
          setEditingQuest(null);
          showToast('Deleted — gone for good.');
        }}
        onSave={({ title, note, comment }) => {
          if (!editingQuest) return;
          if (title !== editingQuest.title) {
            updateQuestTitle(editingQuest.id, title);
          }
          if (note !== (editingQuest.note ?? '')) {
            setQuestNote(editingQuest.id, note);
          }
          if (comment !== (editingQuest.comment ?? '')) {
            setQuestComment(editingQuest.id, comment);
          }
        }}
      />

      {/* Focus task-picker modal — opens from the LumiFocusCard's
          "Focus on another task →" link. Shows today's incomplete
          quests; picking one starts a session on it and the modal
          swaps its body to the same LumiFocusCard bound to the
          chosen quest. Closing the modal doesn't cancel the session
          (the timer keeps ticking in the Dynamic Island). */}
      <FocusTaskPickerModal
        visible={focusPickerOpen}
        onClose={() => setFocusPickerOpen(false)}
        quests={todayQuests.filter((q) => !q.completed)}
        petName={focusPetName}
        ambientMood={ambientMood}
        onCompleteQuest={(q) => completeQuest(q)}
        onFocusStart={triggerLick}
      />

      {/* Brain-dump sheet — slides up from the bottom, taking over
          the screen with a big Fraunces prompt + a proper multiline
          textarea + the real MicButton + a "Make sense of it →"
          submit. Opens when the user taps the floating pill's
          expand button, or when handleTranscribed can't parse a
          voice transcript deterministically and defers to review. */}
      <HomeCaptureModal
        visible={capOpen}
        onClose={() => {
          setCapOpen(false);
          // NEVER destroy the dump (audit R1) — an accidental × on a
          // 200-word spill kept the words; they're waiting in the
          // pill. Only the dym card clears (it referenced the modal
          // context).
          if (capText.trim()) {
            showToast('Held it — your words are in the pill below.');
          }
          setDymHint(false);
          setDymSuggestion(null);
          if (voice.state === 'recording') {
            void voice.cancel();
          }
        }}
        capText={capText}
        setCapText={setCapText}
        onSubmit={sendCapture}
        onTranscribed={handleTranscribed}
        submitting={aiPending}
      />
      {/* "Let the day set" — evening close ritual. */}
      <DaySetSheet
        visible={daySetOpen}
        leftovers={todayQuests.filter(
          (q) => !q.completed && q.window !== 'someday',
        )}
        onCarry={(q) => {
          Haptics.selectionAsync();
          const fs1 = useFocusSession.getState();
          if (fs1.current?.questId === q.id) {
            void fs1.end({ reason: 'cancelled' });
          }
          setQuestDate(q.id, offsetDate(1));
          showToast(`“${q.title.slice(0, 22)}” — carried to tomorrow.`);
        }}
        onLetGo={(q) => {
          Haptics.selectionAsync();
          const fs2 = useFocusSession.getState();
          if (fs2.current?.questId === q.id) {
            void fs2.end({ reason: 'cancelled' });
          }
          moveQuestWindow(q.id, 'someday');
          showToast('Let go — it’ll wait in someday, no weight.');
        }}
        onDidIt={(q) => {
          completeQuest(q);
        }}
        onClose={() => setDaySetOpen(false)}
      />

      {/* "Hey Lumi" voice layer — phrase-triggered only, Pro. */}
      <HeyLumiSheet
        phase={heyLumi.phase}
        transcript={heyLumi.transcript}
        tasks={heyLumi.tasks}
        countdown={heyLumi.countdown}
        autoKeep={heyLumi.autoKeep}
        onKeep={heyLumi.keep}
        onFixUp={heyLumi.fixUp}
        onCancel={heyLumi.cancel}
      />
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles — factory so the screen retints when the user picks a theme.
// ═════════════════════════════════════════════════════════════════════
const makeStyles = (accent: Accent) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.void },
    // SoftGlow handles the fade — this style is just the position+size.
    // Sized to the mockup's wash (radial 135%×52% at 82% 2%): wide
    // enough to bleed past mid-screen so the page reads "lit from the
    // corner", not "sticker in the corner".
    ambientGlow: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 460,
      height: 420,
    },
    scroll: {
      paddingHorizontal: 22,
      paddingTop: 26,
      // Clearance for the floating glass nav + the pill that hovers
      // above it. Nav owns FLOATING_NAV_CLEARANCE from the bottom;
      // the pill sits at bottom: FLOATING_NAV_CLEARANCE + 8 and is
      // ~56 tall, so the last card shouldn't be able to scroll into
      // the pill zone either (total reserved = ~184).
      paddingBottom: FLOATING_NAV_CLEARANCE + 72,
    },

    // ── Sorting card (shown while LLM is processing a capture) ──
    sortingCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: hexA(accent.fg, 0.32),
      backgroundColor: hexA(C.void2, 0.6),
      paddingHorizontal: 20,
      paddingVertical: 22,
      marginTop: 14,
      alignItems: 'flex-start',
    },
    sortingHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      // Card is alignItems flex-start; stretch so the cancel link's
      // marginLeft:'auto' can reach the far edge.
      alignSelf: 'stretch',
    },
    sortingCancelBtn: {
      marginLeft: 'auto',
      paddingLeft: 12,
    },
    sortingSpark: {
      fontFamily: fonts.inter,
      fontSize: 12,
    },
    sortingEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10.5,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: C.boneDim,
    },
    sortingTitle: {
      fontFamily: fonts.fraunces,
      fontSize: 22,
      color: C.bone,
      letterSpacing: -0.3,
      marginBottom: 14,
      paddingRight: 6,
    },
    sortingDotsRow: {
      flexDirection: 'row',
      gap: 6,
    },
    sortingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      opacity: 0.6,
    },

    // ── Toast ──
    toast: {
      position: 'absolute',
      top: 86,
      alignSelf: 'center',
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 100,
      paddingHorizontal: 16,
      paddingVertical: 9,
      zIndex: 60,
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
    },
    toastText: {
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.boneDim,
    },
    undoToast: {
      position: 'absolute',
      // Above the CAPTURE PILL, not on it — the pill lives at
      // FLOATING_NAV_CLEARANCE + 4 and is ~56pt tall; parking the
      // toast at the same altitude buried the text/mic input for the
      // whole 6-second undo window. +72 clears the pill with a gap.
      bottom: FLOATING_NAV_CLEARANCE + 72,
      left: 22,
      right: 22,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 13,
      zIndex: 70,
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
    },
    undoCheckGlyph: {
      fontFamily: fonts.interSemi,
      color: C.lichen,
      fontSize: 16,
    },
    undoToastText: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.bone,
      letterSpacing: -0.1,
    },
    undoBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 13.5,
      letterSpacing: 0.2,
      textTransform: 'uppercase',
    },
    // ── Notification-origin banner ──
    notifBanner: {
      position: 'absolute',
      bottom: FLOATING_NAV_CLEARANCE + 72,
      left: 22,
      right: 22,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: hexA(C.ember, 0.35),
      borderRadius: 16,
      paddingLeft: 15,
      paddingRight: 12,
      paddingVertical: 12,
      zIndex: 70,
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
    },
    notifBannerSpark: {
      fontFamily: fonts.inter,
      fontSize: 13,
    },
    notifBannerOrigin: {
      fontFamily: fonts.interSemi,
      fontSize: 9.5,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: C.mute,
      marginBottom: 3,
    },
    notifBannerLabel: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.bone,
      letterSpacing: -0.1,
      lineHeight: 18,
    },
    notifBannerClose: {
      fontFamily: fonts.inter,
      fontSize: 20,
      color: C.mute,
      paddingHorizontal: 2,
    },

    // ── Header ──
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 18,
    },
    dateLine: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2.4,
      textTransform: 'uppercase',
      color: C.mute,
      marginBottom: 7,
    },
    greeting: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 29,
      color: C.bone,
      letterSpacing: -0.7,
      lineHeight: 32,
      paddingRight: 8,
    },
    headerReadout: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 14,
      color: C.dusk,
      marginTop: 7,
      lineHeight: 21,
      letterSpacing: -0.1,
      maxWidth: 250,
    },
    // Shrunk 78 → 62 (mock proportions) — the nook is a home, not a
    // billboard; smaller reads cleaner beside the greeting.
    lunaNook: {
      width: 62,
      height: 62,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: C.surface,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Container only — SoftGlow paints the radial fade inside.
    lunaNookGlow: {
      position: 'absolute',
      top: -8,
      left: '50%',
      marginLeft: -44,
      width: 88,
      height: 72,
    },

    // ── Quiet today line ──
    todayLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 22,
    },
    streakChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    streakFlame: { fontSize: 13, color: C.honey },
    streakNum: {
      fontFamily: fonts.interMed,
      fontSize: 12.5,
      color: C.boneDim,
    },
    streakBackSub: {
      fontFamily: fonts.inter,
      fontSize: 10,
      color: C.mute,
    },
    todayCount: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.mute,
    },
    xpInline: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
    },

    // ── Done state — compact text card (Luna stays in her nook) ──
    doneCard: {
      borderRadius: 22,
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 22,
      alignItems: 'center',
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: hexA(C.glow, 0.4),
      // Followers (pull-forward card, Done today) own their own
      // marginTop: 14 — a big bottom margin here doubled up with
      // them into a ~40px chasm while everything below sat ~18 apart.
      marginBottom: 2,
      overflow: 'hidden',
    },
    // Container the bloom paints inside — full card width, warm
    // center just above the title.
    doneGlow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 140,
    },
    doneEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2.4,
      textTransform: 'uppercase',
      color: C.glow,
      marginBottom: 8,
    },
    doneTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 24,
      color: C.bone,
      letterSpacing: -0.5,
      lineHeight: 30,
      textAlign: 'center',
      marginBottom: 10,
      paddingRight: 6,
    },
    doneBody: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.boneDim,
      lineHeight: 20,
      textAlign: 'center',
      maxWidth: 270,
    },

    // ── Pull-forward offer (lumi-home-oneember) ──
    pullCard: {
      marginTop: 14,
      marginBottom: 4,
      paddingHorizontal: 15,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: hexA(C.dusk, 0.07),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.28),
    },
    pullHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    pullSpark: {
      color: C.dusk,
      fontSize: 11,
    },
    pullEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 9.5,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
      color: C.dusk,
      flexShrink: 1,
    },
    pullTitle: {
      fontFamily: fonts.interSemi,
      fontSize: 14.5,
      color: C.bone,
      letterSpacing: -0.2,
      lineHeight: 19,
      marginTop: 9,
    },
    pullWhy: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11.5,
      color: C.dusk,
      lineHeight: 17,
      marginTop: 5,
    },
    pullBtnRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 13,
    },
    pullBtn: {
      flex: 1.4,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: hexA(C.dusk, 0.14),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.45),
      alignItems: 'center',
    },
    pullBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 13,
      color: C.dusk,
    },
    pullDismissBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: hexA(C.bone, 0.13),
      alignItems: 'center',
    },
    pullDismissText: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
      color: C.boneDim,
    },
    pullFootnote: {
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 10,
      color: C.mute,
      marginTop: 9,
    },
    pullReopenChip: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 16,
      paddingVertical: 9,
      marginTop: 14,
      marginBottom: 4,
      borderRadius: 100,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: hexA(C.dusk, 0.35),
    },
    pullReopenText: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11.5,
      color: hexA(C.dusk, 0.9),
    },

    // ── Empty state ──
    emptyCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: C.void2,
      padding: 22,
      // Same rhythm as doneCard — followers bring their own gap.
      marginBottom: 2,
    },
    emptyEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: C.mute,
      marginBottom: 8,
    },
    emptyTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 22,
      color: C.bone,
      letterSpacing: -0.5,
      lineHeight: 28,
      marginBottom: 8,
      paddingRight: 6,
    },
    emptyBody: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.boneDim,
      lineHeight: 20,
    },

    // ── Hero card ──
    // Uniform card rhythm: every top-level Home card ends ~flush and
    // the FOLLOWER brings the 14px gap. (Mixed owner margins kept
    // producing 2px-vs-30px gaps as cards conditionally appeared.)
    heroWrap: { marginBottom: 2 },
    heroFlashOverlay: {
      position: 'absolute',
      top: -2,
      left: -2,
      right: -2,
      bottom: -2,
      borderRadius: 26,
      borderWidth: 2,
      borderColor: C.ember,
      shadowColor: C.ember,
      shadowOpacity: 0.5,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
    },
    heroCard: {
      borderRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 16,
      backgroundColor: C.void2,
      borderWidth: 1,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 14 },
    },
    heroHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginBottom: 14,
      // Reserve space for the absolute-positioned ⋯ overflow menu
      // at top-right so the eyebrow doesn't sit under it.
      paddingRight: 40,
    },
    heroEyebrowGlyph: { fontSize: 12 },
    heroEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
      color: C.dusk,
    },
    heroWindow: { marginLeft: 'auto' },
    heroWindowText: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 0.3,
    },
    heroTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 28,
      color: C.bone,
      letterSpacing: -0.5,
      lineHeight: 32,
      marginBottom: 12,
      paddingRight: 6,
      includeFontPadding: false,
    },
    heroWhy: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.dusk,
      lineHeight: 19,
      marginBottom: 18,
    },
    heroMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 16,
    },
    heroTierLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 11.5,
      letterSpacing: 0.3,
    },
    heroTierSigil: { fontSize: 8 },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 2,
      backgroundColor: C.hair,
    },
    // Window label in the meta row — matches the rest of the row's
    // 11.5pt weight + spacing so it reads as one continuous line.
    heroKind: {
      fontFamily: fonts.interSemi,
      fontSize: 11,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    heroWindowMeta: {
      fontFamily: fonts.interSemi,
      fontSize: 11.5,
      letterSpacing: 0.3,
    },
    heroXp: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.mute,
    },
    heroXpNum: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 14,
      color: C.boneDim,
    },
    markDoneWrap: { position: 'relative', marginBottom: 12 },
    markDoneBtn: {
      borderRadius: 16,
      paddingVertical: 18,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 11,
      shadowColor: accent.fg,
      shadowOpacity: 0.32,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
    },
    // Bumped to match the user's reference screenshot: 24×24 check
    // ring with a 1.7px border + 14pt InterSemi glyph reads as a
    // confident "done" affordance instead of a small floating dot.
    markDoneCheck: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.7,
      borderColor: hexA(C.void, 0.6),
      alignItems: 'center',
      justifyContent: 'center',
    },
    markDoneCheckGlyph: {
      fontSize: 14,
      lineHeight: 16,
      color: C.void,
      marginTop: -1,
      fontFamily: fonts.interSemi,
    },
    markDoneText: {
      fontFamily: fonts.interSemi,
      fontSize: 16,
      color: C.void,
      letterSpacing: 0.1,
    },
    // Start / End focus pill below the Mark-it-done CTA. Outline
    // style so it reads as a secondary action; flips ember-tinted
    // when a session is running on this quest.
    focusBtn: {
      marginTop: 10,
      paddingVertical: 11,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: hexA(C.boneDim, 0.25),
      backgroundColor: 'transparent',
      alignItems: 'center',
    },
    focusBtnActive: {
      borderColor: hexA(C.ember, 0.5),
      backgroundColor: hexA(C.ember, 0.08),
    },
    focusBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 13.5,
      color: C.boneDim,
      letterSpacing: 0.1,
    },
    floaterMount: {
      position: 'absolute',
      right: 18,
      top: -6,
    },
    floaterText: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 22,
    },
    swapText: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12,
      color: C.mute,
      textAlign: 'center',
      marginTop: 4,
    },

    // ── Capture ──
    captureClosed: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 15,
      paddingVertical: 13,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: hexA(C.void2, 0.6),
      marginBottom: 26,
    },
    captureClosedText: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    captureSpark: { fontSize: 13 },
    capturePlaceholder: {
      flex: 1,
      fontFamily: fonts.inter,
      fontSize: 13.5,
      color: C.mute,
    },
    captureMic: { fontSize: 15 },
    captureMicBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },

    // ── Floating capture pill ──
    // Anchored above the floating nav via FLOATING_NAV_CLEARANCE.
    // pointerEvents on the outer wrapper is 'box-none' so taps that
    // don't hit the pill itself pass through to whatever's behind
    // (nav, scroll content). The inner styled row is what actually
    // catches touches.
    capturePill: {
      position: 'absolute',
      left: 14,
      right: 14,
      // Sits FLOATING_NAV_CLEARANCE + 4 above the screen bottom —
      // just clear of the nav's top edge (nav occupies the bottom
      // FLOATING_NAV_CLEARANCE zone). Gives a ~4px visible gap
      // between pill bottom and nav top so the two surfaces read
      // as stacked, not touching.
      bottom: FLOATING_NAV_CLEARANCE + 4,
      zIndex: 30,
    },
    dymHint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      backgroundColor: hexA(C.dusk, 0.14),
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.35),
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 9,
      marginBottom: 8,
    },
    dymSuggestionText: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.bone,
      marginTop: 3,
      lineHeight: 18,
    },
    dymHintText: {
      flex: 1,
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 13,
      color: C.dusk,
    },
    dymHintClear: {
      fontFamily: fonts.interSemi,
      fontSize: 11.5,
      color: C.boneDim,
      textDecorationLine: 'underline',
    },
    capturePillInner: {
      flexDirection: 'row',
      // alignItems: flex-end so when the input grows multiline the
      // sparkle + icon buttons stay pinned to the bottom of the
      // pill, and the text expands UPWARD. On a single-line input
      // this reads the same as center-aligned (icons and text share
      // the same baseline).
      alignItems: 'flex-end',
      gap: 12,
      paddingLeft: 16,
      paddingRight: 10,
      paddingVertical: 10,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: hexA(C.bone, 0.1),
      backgroundColor: hexA('#241C17', 0.86),
      // Match the nav's frosted-glass shadow so the two surfaces
      // feel like one floating dock.
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowRadius: 24,
      shadowOpacity: 0.5,
      elevation: 8,
    },
    capturePillSpark: {
      fontFamily: fonts.inter,
      fontSize: 16,
      flexShrink: 0,
      marginRight: 2,
      // Sparkle sits on the same baseline as the 36-tall icon
      // buttons. Padding-bottom aligns it with the vertical
      // center of the first line of text at the bottom of the
      // multi-line stack.
      paddingBottom: 8,
    },
    capturePillInput: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.inter,
      fontSize: 15,
      color: C.bone,
      letterSpacing: -0.1,
      padding: 0,
      // Height is set inline from measured contentSize (see the
      // render) — grows with the text to ~5 lines, then scrolls
      // internally. The fullscreen brain-dump modal stays the path
      // for truly long spills.
      paddingTop: 8,
      paddingBottom: 8,
      lineHeight: 20,
      textAlignVertical: 'top',
    },
    capturePillSendGlyph: {
      fontFamily: fonts.interSemi,
      fontSize: 18,
      lineHeight: 20,
    },
    capturePillSubmit: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    capturePillSubmitGlyph: {
      fontFamily: fonts.interSemi,
      fontSize: 18,
      lineHeight: 20,
    },
    capturePillExpand: {
      width: 36,
      height: 36,
      // Rounded SQUARE per the mockup — the mic beside it is a
      // bare inline icon (no button chrome), so the expand's own
      // rounded-rect shape doesn't clash with anything. Reads as
      // "here's your open-fullscreen affordance", distinct from
      // the mic tap.
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    // Bare inline mic — chromeless (matches the mockup). Same 36×36
    // hitbox as the expand button so tap targets are consistent,
    // but no border/background: it reads as a plain icon that
    // colors up when recording (pulse dot) or transcribing (…).
    capturePillMic: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    capturePillMicDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    capturePillMicTranscribing: {
      fontFamily: fonts.interSemi,
      fontSize: 18,
      color: C.boneDim,
      lineHeight: 20,
    },

    // ── Guided follow-up ──
    followupCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.32),
      backgroundColor: hexA(C.dusk, 0.06),
      padding: 16,
      marginBottom: 26,
    },
    followupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginBottom: 10,
    },
    followupGlyph: { fontSize: 11, color: C.dusk },
    followupEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: C.dusk,
    },
    followupQ: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 17,
      color: C.bone,
      letterSpacing: -0.3,
      lineHeight: 24,
      marginBottom: 14,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    followupChip: {
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 100,
      paddingHorizontal: 13,
      paddingVertical: 8,
      backgroundColor: hexA(C.void, 0.4),
    },
    followupChipText: {
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.boneDim,
    },
    skipBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    skipText: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.mute,
      letterSpacing: 0.3,
    },

    // ── Preview card (Lumi suggests) ──
    previewRow: {
      paddingBottom: 12,
    },
    previewRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.6),
      marginBottom: 12,
    },
    previewTaskActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 10,
    },
    previewTaskAccept: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 9,
    },
    previewTaskAcceptText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
      color: C.void,
      letterSpacing: 0.1,
    },
    previewTaskTweak: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: C.hair,
    },
    previewTaskTweakText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
      color: C.boneDim,
    },
    previewTaskDismiss: {
      marginLeft: 'auto',
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    previewTaskDismissGlyph: {
      fontFamily: fonts.inter,
      fontSize: 18,
      color: C.mute,
      lineHeight: 20,
    },
    previewTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 19,
      color: C.bone,
      letterSpacing: -0.3,
      lineHeight: 24,
      marginBottom: 4,
      paddingRight: 5,
    },
    previewMeta: {
      fontFamily: fonts.inter,
      fontSize: 12.5,
      color: C.boneDim,
      letterSpacing: -0.1,
    },
    // "Lumi is reading…" — shown in place of the placement meta line
    // while the structured LLM call is in flight. Dusk-tinted because
    // it's Lumi's intelligence thinking, not a user action.
    previewReadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    previewReadingSpark: {
      fontSize: 12,
    },
    previewReadingText: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.dusk,
      letterSpacing: -0.1,
    },
    previewEditLabel: {
      fontFamily: fonts.interSemi,
      fontSize: 9.5,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: C.mute,
      marginTop: 10,
      marginBottom: 8,
    },
    previewEditInput: {
      fontFamily: fonts.inter,
      fontSize: 15,
      color: C.bone,
      borderBottomWidth: 1,
      borderBottomColor: C.hair,
      paddingVertical: 6,
      marginBottom: 6,
    },
    previewActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    // Bulk-action footer for the new LumiSuggestCard preview flow.
    // Sits below a single card and lets users skip the one-by-one
    // pacing when they have several brain-dump tasks.
    bulkActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 10,
      paddingHorizontal: 4,
    },
    previewTweakBtn: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.hair,
    },
    previewTweakText: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
      color: C.boneDim,
    },
    previewApproveBtn: {
      marginLeft: 'auto',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
    },
    previewApproveText: {
      fontFamily: fonts.interSemi,
      fontSize: 13,
      color: C.void,
      letterSpacing: 0.1,
    },
    captureOpen: {
      borderRadius: 14,
      borderWidth: 1.5,
      backgroundColor: C.void2,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 26,
    },
    captureInput: {
      fontFamily: fonts.inter,
      fontSize: 14.5,
      color: C.bone,
      // Bigger line-height than fontSize so wrapped lines breathe.
      // Without this, multi-line text reads as a brick of words.
      lineHeight: 22,
      paddingTop: 6,
      paddingBottom: 6,
      marginBottom: 4,
      textAlignVertical: 'top',
      // Auto-grow bounds. min = one comfortable line; max = ~12
      // lines (12 × 22 lineHeight + 12 padding ≈ 276) so even a
      // 100+ word dump shows ~80% of itself before internal scroll
      // kicks in. Past max, RN's iOS multiline scrolls inside the
      // input on its own — no JS-driven height tracking needed.
      minHeight: 40,
      maxHeight: 280,
    },
    captureCount: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.mute,
      textAlign: 'right',
      marginBottom: 6,
      marginTop: -2,
    },
    captureActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
    },
    captureCancel: {
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 9,
      paddingHorizontal: 13,
      paddingVertical: 7,
    },
    captureCancelText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
      color: C.mute,
    },
    captureSend: {
      borderRadius: 9,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    captureSendText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
    },

    // ── Lumi noticed ──
    noticedCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.3),
      backgroundColor: hexA(C.dusk, 0.05),
      padding: 16,
      marginBottom: 26,
    },
    noticedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginBottom: 10,
    },
    noticedGlyph: { fontSize: 11, color: C.dusk },
    noticedEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: C.dusk,
    },
    noticedDismiss: {
      marginLeft: 'auto',
      fontSize: 18,
      color: C.mute,
      lineHeight: 18,
      paddingHorizontal: 4,
    },
    noticedBody: {
      fontFamily: fonts.inter,
      fontSize: 14,
      color: C.boneDim,
      lineHeight: 21,
      marginBottom: 14,
    },
    noticedAccent: {
      color: C.bone,
      fontFamily: fonts.interMed,
    },
    noticedActions: {
      flexDirection: 'row',
      gap: 8,
    },
    noticedAcceptBtn: {
      backgroundColor: hexA(C.dusk, 0.16),
      borderWidth: 1,
      borderColor: C.dusk,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    noticedAcceptText: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
      color: C.dusk,
    },
    noticedNotItBtn: {
      borderWidth: 1,
      borderColor: C.hair,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    noticedNotItText: {
      fontFamily: fonts.interSemi,
      fontSize: 12.5,
      color: C.mute,
    },

    previewNote: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.boneDim,
      marginTop: 4,
      lineHeight: 17,
    },

    // ── "N more waiting — Lumi's holding them" (lumi-holding mock) ──
    backlogInline: {
      marginTop: 12,
      paddingTop: 12,
      // Breathing room BELOW the action pills too — without it the
      // buttons sat flush on the task-list divider and read cramped.
      paddingBottom: 16,
      borderTopWidth: 1,
      borderTopColor: C.hair,
    },
    backlogCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.25),
      backgroundColor: hexA(C.void2, 0.7),
      padding: 14,
      marginTop: 14,
    },
    backlogLine: {
      fontFamily: fonts.frauncesMed,
      fontSize: 14,
      lineHeight: 20,
      color: C.bone,
    },
    backlogRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      // The two long-label pills nearly span the row; a small gap read
      // as "touching". Generous column gap + slimmer pills so they
      // breathe (and wrap cleanly to their own lines when they must).
      rowGap: 10,
      columnGap: 14,
      marginTop: 14,
    },
    backlogBtn: {
      borderWidth: 1,
      borderColor: hexA(C.dusk, 0.35),
      borderRadius: 999,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    backlogBtnText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
      color: C.dusk,
    },
    backlogKeep: { paddingHorizontal: 6, paddingVertical: 7 },
    backlogKeepText: {
      fontFamily: fonts.inter,
      fontSize: 12,
      color: C.mute,
      textDecorationLine: 'underline',
    },
    waitingCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: hexA(C.void2, 0.7),
      marginTop: 14,
      overflow: 'hidden',
    },
    waitingHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    waitingSpark: {
      color: C.dusk,
      fontSize: 12,
    },
    waitingHeadTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 15.5,
      color: C.dusk,
      letterSpacing: -0.2,
    },
    waitingChev: {
      color: C.mute,
      fontSize: 12,
    },
    waitingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: hexA(C.hair, 0.7),
    },
    waitingCheck: {
      width: 18,
      height: 18,
      borderRadius: 6,
      borderWidth: 1.5,
      backgroundColor: hexA(C.void, 0.4),
      flexShrink: 0,
    },
    kindPillRow: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    kindPillRowText: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    waitingRowTitle: {
      // flex so the title truncates INSIDE the kind-dot row instead
      // of pushing the dot / overflowing the card.
      flex: 1,
      fontFamily: fonts.interMed,
      fontSize: 14.5,
      color: C.bone,
      letterSpacing: -0.15,
    },
    waitingNote: {
      fontFamily: fonts.inter,
      fontSize: 11.5,
      color: C.mute,
      marginTop: 2,
    },
    waitingWindow: {
      fontFamily: fonts.inter,
      fontSize: 12,
      flexShrink: 0,
    },
    waitingFooter: {
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11.5,
      color: C.mute,
      paddingVertical: 11,
      borderTopWidth: 1,
      borderTopColor: hexA(C.hair, 0.7),
    },
    moreToggle: {
      paddingVertical: 14,
      alignItems: 'center',
    },
    moreText: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12,
      color: C.mute,
    },

    // ── DONE TODAY — the waiting card's lichen-lit sibling. ────────
    // Same collapsible-card bones as waitingCard, its own soul: the
    // done color throughout (border, dividers, badge), a warm tally
    // headline, quiet +xp per row (glow), and the no-judgment undo
    // promise. Undo pill keeps the user accent — reactivating is
    // THEIR move.
    doneTodayCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: hexA(C.lichen, 0.28),
      backgroundColor: hexA(C.lichen, 0.04),
      marginTop: 14,
      overflow: 'hidden',
    },
    doneTodayHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    doneTodayBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: hexA(C.lichen, 0.16),
      borderWidth: 1,
      borderColor: hexA(C.lichen, 0.5),
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneTodayBadgeGlyph: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      color: C.lichen,
      lineHeight: 12,
    },
    doneTodayHeadTitle: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 15.5,
      color: C.lichenLt,
      letterSpacing: -0.2,
      flexShrink: 1,
    },
    doneTodayChev: {
      color: hexA(C.lichen, 0.7),
      fontSize: 12,
    },
    doneTodayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: hexA(C.lichen, 0.14),
    },
    doneTodayXp: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.glow,
    },
    doneTodayFooter: {
      textAlign: 'center',
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11.5,
      color: hexA(C.lichenLt, 0.8),
      paddingVertical: 11,
      borderTopWidth: 1,
      borderTopColor: hexA(C.lichen, 0.14),
    },
    historyCheck: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: hexA(C.lichen, 0.18),
      borderWidth: 1,
      borderColor: hexA(C.lichen, 0.5),
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyCheckGlyph: {
      fontFamily: fonts.interSemi,
      fontSize: 11,
      color: C.lichen,
      lineHeight: 13,
      marginTop: -1,
    },
    historyTitle: {
      fontFamily: fonts.inter,
      fontSize: 14,
      color: C.boneDim,
      letterSpacing: -0.1,
      textDecorationLine: 'line-through',
      textDecorationColor: hexA(C.ash, 0.7),
    },
    historyMeta: {
      fontFamily: fonts.inter,
      fontSize: 11,
      color: C.mute,
      marginTop: 2,
      letterSpacing: -0.05,
    },
    undoPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 100,
      backgroundColor: hexA(accent.fg, 0.12),
      borderWidth: 1,
      borderColor: hexA(accent.fg, 0.42),
    },
    undoPillGlyph: {
      fontSize: 13,
      color: accent.fg,
      lineHeight: 14,
      marginTop: -1,
    },
    undoPillText: {
      fontFamily: fonts.interSemi,
      fontSize: 12,
      letterSpacing: 0.2,
    },
  });

// Default ember stylesheet for module-level sub-components (XpFloater
// references styles.floaterText). Home itself shadows this with a
// themed stylesheet via useMemo inside the component.
const styles = makeStyles(accentFor('ember'));
