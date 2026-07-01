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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { timeColors as C } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { lunaSource } from '../../lib/luna-source';
import { useAmbientLunaMood } from '../../lib/luna-mood';
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
  difficultyFromImportance,
  pickWindowForDemand,
  type CaptureContext,
  type SmartTask,
} from '../../lib/capture';
import { useVoice } from '../../lib/voice';
import { todayKey } from '../../lib/gamification';
import { SoftGlow } from '../../components/SoftGlow';
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
  isAnthropicConfigured,
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
import { useFocusSession } from '../../lib/focusSession';

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
                    Edit quest
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
                    Delete quest
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

// (Legacy wrapper retained for the very few callers that still want
// a standalone × — kept as no-op alias in case future hero variants
// need just the delete. New code should use HeroOverflowMenu.)
const HeroDeleteBtn = ({ id, title }: { id: string; title: string }) => {
  const confirm = useDeleteConfirm(id, title);
  return (
    <Pressable
      onPress={confirm}
      hitSlop={12}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderWidth: 1,
        borderColor: 'rgba(176,163,139,0.28)',
        zIndex: 5,
      }}
    >
      <Text
        style={{
          color: '#B0A38B',
          fontSize: 14,
          lineHeight: 16,
          marginTop: -1,
        }}
      >
        ×
      </Text>
    </Pressable>
  );
};

/** Legacy floating × button (used by the hero card + history rows).
 *  In the "Then, when you're ready" list this was replaced by the
 *  pill-style RestDeletePill below so the row's right-side actions
 *  read as a consistent row of affordances. */
const RestDeleteBtn = ({ id, title }: { id: string; title: string }) => {
  const confirm = useDeleteConfirm(id, title);
  return (
    <Pressable
      onPress={(e) => {
        // Don't let the outer row's "complete this" press fire too.
        e.stopPropagation();
        confirm();
      }}
      hitSlop={10}
      style={{
        marginLeft: 6,
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: 'rgba(176,163,139,0.22)',
      }}
    >
      <Text
        style={{
          color: '#6E655A',
          fontSize: 12,
          lineHeight: 14,
          marginTop: -1,
        }}
      >
        ×
      </Text>
    </Pressable>
  );
};

/** Delete pill — used in the rest row's meta line. Styled to match
 *  the Edit pill (same border / padding / typography) so the two
 *  right-side actions read as a single consistent group. */
const RestDeletePill = ({ id, title }: { id: string; title: string }) => {
  const confirm = useDeleteConfirm(id, title);
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        confirm();
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Delete task"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderWidth: 1,
        borderColor: 'rgba(176,163,139,0.22)',
        borderRadius: 100,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginLeft: 6,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.inter,
          fontSize: 12,
          color: '#B0A38B',
          lineHeight: 14,
          marginTop: -1,
        }}
      >
        ×
      </Text>
      <Text
        style={{
          fontFamily: fonts.interSemi,
          fontSize: 11,
          color: '#B0A38B',
          letterSpacing: -0.1,
        }}
      >
        Delete
      </Text>
    </Pressable>
  );
};

/**
 * RestNote — note row in the "Then, when you're ready" list.
 *
 * Renders the note clamped to 2 lines and shows a `more` / `less`
 * toggle ONLY when the underlying text actually overflows. Detection
 * is via onTextLayout: first render is unclamped, the layout reports
 * how many lines the full text needs; if > 2, we flip an overflow
 * flag, the next render clamps, and the toggle appears. The user
 * doesn't perceive the pre-clamp frame because React Native paints
 * after both render passes settle.
 */
// Inline style constants for the rest-note since the makeStyles
// factory lives inside the screen component closure. Mirrors the
// values in `restNote` / `restNoteToggle` / `restNoteToggleHit`.
const REST_NOTE_TEXT = {
  fontFamily: fonts.fraunces,
  fontStyle: 'italic' as const,
  fontSize: 12.5,
  color: C.mute,
  marginTop: 3,
  lineHeight: 18,
};
const REST_NOTE_TOGGLE_HIT = {
  alignSelf: 'flex-start' as const,
  paddingTop: 2,
  paddingBottom: 2,
  marginTop: 2,
};
const REST_NOTE_TOGGLE_TEXT = {
  fontFamily: fonts.interSemi,
  fontSize: 11.5,
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

const RestNote = ({
  note,
  open,
  onToggle,
  accentColor,
}: {
  note: string;
  open: boolean;
  onToggle: () => void;
  accentColor: string;
}) => {
  const [overflowing, setOverflowing] = useState(false);
  return (
    <>
      <Text
        style={REST_NOTE_TEXT}
        onTextLayout={(e) => {
          if (!overflowing && e.nativeEvent.lines.length > 2) {
            setOverflowing(true);
          }
        }}
        numberOfLines={overflowing && !open ? 2 : undefined}
      >
        {note}
      </Text>
      {overflowing && (
        <Pressable
          onPress={onToggle}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={REST_NOTE_TOGGLE_HIT}
        >
          <Text style={[REST_NOTE_TOGGLE_TEXT, { color: accentColor }]}>
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
  // Companion-mode flags — gate the playful chrome (Luna, XP, cheer).
  const companion = useCompanionMode();
  // Ambient mood — reflects sleep window, overdue pile, streak.
  // The nook cat updates as the user's state changes.
  const ambientMood = useAmbientLunaMood();

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

  // Cleanup on unmount so a stale timeout can't try to setState
  // after the screen's torn down.
  useEffect(
    () => () => {
      if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current);
      if (lickTimerRef.current) clearTimeout(lickTimerRef.current);
    },
    [],
  );
  const nookMood = licking
    ? 'lick'
    : celebrating
      ? 'happy'
      : ambientMood;

  // ── Store ────────────────────────────────────────────────────────
  const xp = useUserStore((s) => s.xp);
  const streak = useUserStore((s) => s.streak);
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
  const todayQuests = useMemo(() => selectTodayQuests(quests), [quests]);

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
  const [moreOpen, setMoreOpen] = useState(false);
  // Someday → real-date sheet target. When set, the MoveBackToDateSheet
  // opens for this task.
  const [movingBack, setMovingBack] = useState<Quest | null>(null);
  // Which row in "Then, when you're ready" has its note expanded.
  // Inline "more / less" toggle (per lumi-home-v2 mock) so long notes
  // are reachable without leaving the list.
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
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
  useEffect(() => {
    refreshRecurring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!onboardedAt || tourSeen) return;
    const t = setTimeout(() => tour.start(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardedAt, tourSeen]);

  // ── Recurrence detector → suggestions (math layer, no LLM) ───────
  useEffect(() => {
    const suppressedSet = new Set(suppressed);
    const existingTitles = new Set(
      quests
        .filter((q) => q.recur)
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
    const open = todayQuests.filter((q) => !q.completed);
    return [...open].sort((a, b) => {
      const wa = order.indexOf(a.window);
      const wb = order.indexOf(b.window);
      if (wa !== wb) return wa - wb;
      return (
        IMPORTANCE[b.importance].rank - IMPORTANCE[a.importance].rank
      );
    });
  }, [todayQuests, order]);
  const allDone = candidates.length === 0 && todayQuests.length > 0;
  const totallyEmpty = todayQuests.length === 0;
  const hero = candidates.length
    ? candidates[swap % candidates.length]
    : null;
  const rest = hero ? candidates.filter((q) => q.id !== hero.id) : [];
  const visibleRest = moreOpen ? rest : rest.slice(0, 3);

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
  }, [todayQuests]);
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

  // ── Actions ──────────────────────────────────────────────────────
  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2400);
  };

  const completeQuest = (q: Quest) => {
    const wasDone = q.completed;
    if (wasDone) return;
    const next = toggle(q.id);
    if (!next) return;

    const gain = q.xpReward;
    addXp(gain);
    registerActivity();
    addShard();

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

    // Surface an Undo so accidental taps can be reversed within 6s.
    // The XP guardrail in questStore means an undo doesn't subtract
    // XP — you keep the small win for trying.
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ id: q.id, title: q.title });
    undoTimerRef.current = setTimeout(() => {
      setUndoState((cur) => (cur?.id === q.id ? null : cur));
    }, 6000);
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
      toastLine = `Brought back · still on today (missed earlier)`;
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

    // When the user captures a windowed task on TODAY and the chosen
    // window is already in progress (e.g. "meditate sometime today"
    // captured at 12:30 PM, midday = 11–14), anchor it to a stable
    // clock time NOW + 5 min so the Time tab renders it at one fixed
    // spot — not dynamically against the live `nowMin`, which made it
    // shift every minute ("in 5 min", "in 4 min", "in 3 min"…). For
    // tasks captured before the window opens or after it ends, leave
    // windowed — Time tab renders at the window start and tags it
    // "missed" if past.
    let derivedAt: number | null = null;
    if (
      !hasTime &&
      t.timeMode === 'windowed' &&
      t.window !== 'someday' &&
      (!t.date || t.date === todayKey())
    ) {
      const winStart = effectiveWindows[t.window].start;
      const winEnd = effectiveWindows[t.window].end;
      if (winStart != null && winEnd != null) {
        const startMin = winStart * 60;
        const endMin = winEnd * 60;
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        if (nowMin >= startMin && nowMin < endMin) {
          derivedAt = Math.min(nowMin + 5, endMin - 5);
        }
      }
    }
    const effectiveAt = hasTime ? (t.at as number) : derivedAt;
    const writeAnchor = effectiveAt != null;

    // Length: prefer what the LLM extracted / the user picked. If
    // still unknown (LLM didn't infer, user didn't override), fall
    // back to a sane importance-keyed default — never the old
    // hardcoded 30, which over-booked Trials and under-budgeted
    // Whims.
    const defaultDurationForImportance: Record<Importance, number> = {
      high: 60,
      medium: 30,
      low: 15,
    };
    const effectiveDuration =
      t.durationMinutes ?? defaultDurationForImportance[t.importance];

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
      ...(t.date && { date: t.date }),
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
  const upgradeWithUnderstand = async (rawText: string): Promise<void> => {
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
    const ctx: UnderstandContext = {
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
    const result = await llmUnderstand(rawText, ctx);
    if (!result) return;

    setPreviewTasks((cur) => {
      if (!cur) return cur;
      // The LLM is the source of truth for splitting a dump into
      // individual tasks — the deterministic parser (splitFragments
      // in lib/capture.ts) is conservative and only splits on
      // "and"/"then"/"." patterns. If the user's dump is a
      // comma-list ("finish deck, reply to Sam, book dentist…"),
      // parseSmartCapture may return 2 tasks while the LLM returns
      // 13. Previously we only patched min(deterministic, llm)
      // slots and silently dropped the extras — regression that
      // squashed long brain-dumps into 1 giant title. Fix: rebuild
      // previewTasks from the LLM's output. For each LLM task,
      // reuse the deterministic slot at the same index if one
      // exists (preserves timeOptions / raw / etc. from the local
      // parser); otherwise mint a fresh stub and patch onto it.
      const stub = (t: UnderstoodTask): SmartTask => ({
        title: t.title,
        importance: 'medium',
        energyDemand: 'medium',
        timeMode: 'windowed',
        at: null,
        date: null,
        window: 'midday',
        recur: null,
        raw: t.title,
        needsFollowup: false,
      });
      return result.tasks.map((llmTask, i) => {
        const base = cur[i] ?? stub(llmTask);
        return patchWithUnderstood(base, llmTask);
      });
    });
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

  const sendCapture = () => {
    const text = capText.trim();
    if (!text) return;

    const ctx: CaptureContext = {
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
    };

    const tasks = parseSmartCapture(text, ctx);
    if (tasks.length === 0) return;

    // Preview-then-confirm — surface Lumi's best guess instead of
    // auto-committing. User approves with one tap, or tweaks
    // title/date/window inline. Cancel discards.
    setPreviewTasks(tasks);
    setEditingIdx(null);
    setCapText('');
    setCapOpen(false);

    // Background LLM upgrade — ONE structured comprehension call.
    // While in flight, the previewed tasks show a "Lumi is reading…"
    // indicator INSTEAD of their (possibly wrong) deterministic
    // date/window meta — so the user never reads "tomorrow" only
    // to watch it switch to "Aug 1" two seconds later.
    if (isAnthropicConfigured && tasks.length > 0) {
      setAiPending(true);
      // Hard timeout — if the LLM doesn't respond within 5s, settle
      // back to the deterministic preview rather than leaving the
      // Accept button disabled and the title spinning forever.
      // Whichever resolves first wins; .finally fires either way.
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, 5000),
      );
      void Promise.race([upgradeWithUnderstand(text), timeout]).finally(() =>
        setAiPending(false),
      );
    }
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

  const approvePreview = () => {
    if (!previewTasks) return;
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
    commitTask(t);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const remaining = previewTasks.filter((_, i) => i !== idx);
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

  /** Tap a "When's it due?" chip on a deadline-type previewed task.
   *  Locks the date (today / tomorrow / this Saturday) on the task and
   *  flips needsFollowup off so the row collapses. The user can always
   *  Tweak to refine further. */
  const pickFollowupDate = (
    idx: number,
    date: string,
    window?: 'morning' | 'midday' | 'afternoon' | 'evening',
  ) => {
    if (!previewTasks) return;
    Haptics.selectionAsync();
    const updated = [...previewTasks];
    updated[idx] = {
      ...updated[idx],
      date,
      window: window ?? updated[idx].window,
      needsFollowup: false,
    };
    setPreviewTasks(updated);
  };

  /** Pick one of the AM/PM options for an ambiguous bare-hour capture
   *  ("today at 9" → 9 AM or 9 PM). Locks the chosen time on the
   *  previewed task and clears the chip picker. */
  const pickTimeOption = (idx: number, minutes: number) => {
    if (!previewTasks) return;
    Haptics.selectionAsync();
    const updated = [...previewTasks];
    updated[idx] = {
      ...updated[idx],
      at: minutes,
      timeMode: 'anchored',
      // Clearing the options collapses the chip row — the user has
      // made the call.
      timeOptions: undefined,
    };
    setPreviewTasks(updated);
  };

  /** Set the length on a previewed task — driven by the inline
   *  "How long?" chips so the user picks before Accept commits. */
  const pickDuration = (idx: number, minutes: number) => {
    if (!previewTasks) return;
    Haptics.selectionAsync();
    const updated = [...previewTasks];
    updated[idx] = { ...updated[idx], durationMinutes: minutes };
    setPreviewTasks(updated);
  };

  /** Set the part-of-day window on a previewed task — driven by the
   *  inline chips so a user who didn't specify a time still picks a
   *  rough slot before Accept commits. Skip the anchored time case
   *  (the user already gave an exact clock time, no need to ask). */
  const pickWindow = (idx: number, window: WindowKey) => {
    if (!previewTasks) return;
    Haptics.selectionAsync();
    const updated = [...previewTasks];
    updated[idx] = {
      ...updated[idx],
      window,
      timeMode: 'windowed',
      at: null,
    };
    setPreviewTasks(updated);
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
   * Post-transcribe processing — shared by the two mic entry points:
   * the standalone MicButton on the floating capture pill AND the old
   * inline `handleMic` path that lives inside the expanded capture.
   * Same behavior in both places: transcript → parseSmartCapture →
   * previewTasks (user reviews before commit). Text is stashed in
   * capText briefly so any UI that reads it while the parse is
   * happening still shows what Lumi heard.
   */
  const handleTranscribed = (text: string) => {
    const final = text.trim();
    if (!final) return;
    setCapText(final);
    const ctx: CaptureContext = {
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
    };
    const tasks = parseSmartCapture(final, ctx);
    if (tasks.length === 0) {
      // Deterministic parser couldn't extract anything — surface the
      // transcript in the expanded capture so the user can edit and
      // resubmit. Beats swallowing the voice input silently.
      setCapOpen(true);
      return;
    }
    setPreviewTasks(tasks);
    setEditingIdx(null);
    setCapText('');
    setCapOpen(false);
    Haptics.selectionAsync();
    // Same LLM upgrade the text path does — kicks a background call
    // so previewed tasks pick up structured comprehension when it
    // returns.
    if (isAnthropicConfigured) {
      setAiPending(true);
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, 5000),
      );
      void Promise.race([upgradeWithUnderstand(final), timeout]).finally(() =>
        setAiPending(false),
      );
    }
  };

  const handleMic = async () => {
    if (voice.state === 'idle') {
      if (!capOpen) setCapOpen(true);
      await voice.start();
    } else if (voice.state === 'recording') {
      const text = await voice.stopAndTranscribe();
      if (text && text.trim()) {
        // Surface the transcript so the user can see what Lumi heard,
        // then auto-submit through the smart-capture pipeline.
        setCapText(text);
        // Defer one tick so React commits the text before parsing.
        setTimeout(() => {
          // Re-read latest text via state by using a fresh closure.
          const final = text.trim();
          if (!final) return;
          // Inline send: same logic as sendCapture but uses the
          // transcribed value directly (state may not have flushed).
          const ctx: CaptureContext = {
            sharpWindow,
            foggyWindow,
            peakStart: digest.curve.peakStart,
            peakEnd: digest.curve.peakEnd,
            effectiveWindows,
            now,
            nowMin: now.getHours() * 60 + now.getMinutes(),
            wakeMin: anchors.wake,
            sleepMin: anchors.sleep,
          };
          const tasks = parseSmartCapture(final, ctx);
          if (tasks.length === 0) return;
          // Voice → preview (same as text path). User taps Looks
          // good to commit, or Tweak to edit before saving.
          setPreviewTasks(tasks);
          setEditingIdx(null);
          setCapText('');
          setCapOpen(false);
          Haptics.selectionAsync();
        }, 30);
      }
    }
  };

  // Surface voice errors as a calm toast.
  useEffect(() => {
    if (voice.error) showToast(voice.error);
  }, [voice.error]);

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
    const recurAt =
      opts.exactMinute != null ? opts.exactMinute : (s.guess.at ?? undefined);
    // The card only exposes the four part-of-day windows (no
    // 'someday'), so this cast is safe — the constraint is enforced
    // by the WINDOWS array in LumiSuggestCard.
    const recurPart = opts.window as import('../../constants/recur').RecurPart;
    const rule = {
      ...s.guess,
      part: recurPart,
      ...(recurAt != null ? { at: recurAt } : {}),
    };
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
      recur: rule,
    });
    consumeSuggestion(s.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast('Added to your day 💛');
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
  const acceptPreviewTaskFromCard = (
    sugInput: import('../../components/LumiSuggestCard').SuggestInput,
    opts: SuggestAcceptOptions,
  ) => {
    if (!previewTasks) return;
    // SuggestInput id for preview tasks is "preview_<index>"
    const idx = Number(sugInput.id.replace('preview_', ''));
    const t = previewTasks[idx];
    if (!t) return;
    addQuest({
      title: t.title,
      difficulty: 'medium',
      importance: t.importance,
      window: opts.window,
      durationMinutes: opts.durationMin,
      ...(opts.exactMinute != null && {
        scheduledHour: Math.floor(opts.exactMinute / 60),
        scheduledMinute: opts.exactMinute % 60,
      }),
      ...(t.date && { date: t.date }),
      ...(t.recur && { recur: t.recur }),
    });
    // Remove this task from the queue; if it was the last, close
    // the preview card entirely.
    const remaining = previewTasks.filter((_, i) => i !== idx);
    setPreviewTasks(remaining.length > 0 ? remaining : null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(remaining.length > 0 ? 'Added 💛' : 'All added 💛');
  };

  const dismissPreviewTaskFromCard = (
    sugInput: import('../../components/LumiSuggestCard').SuggestInput,
  ) => {
    if (!previewTasks) return;
    const idx = Number(sugInput.id.replace('preview_', ''));
    const remaining = previewTasks.filter((_, i) => i !== idx);
    setPreviewTasks(remaining.length > 0 ? remaining : null);
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
          <Pressable onPress={undoComplete} hitSlop={10}>
            <Text style={[styles.undoBtnText, { color: accent.fg }]}>Undo</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header: date + greeting + Luna nook ── */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, paddingTop: 4 }}>
            <Text style={styles.dateLine}>{formatDate(now)}</Text>
            <Text style={styles.greeting}>
              {greeting(now.getHours() + now.getMinutes() / 60)}.
            </Text>
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
            {/* When the day is cleared, the DAY CLEARED card below
               already features Luna front-and-center, so the nook
               here would just duplicate the cat. Swap to the same
               person glyph the ProfileIcon uses elsewhere so this
               corner still reads as the profile entry. When the
               day still has work, keep the GIF cat.
               In Focused companion mode (no cat anywhere) we ALSO
               fall back to the person glyph so the user still has
               a tappable profile-entry corner. */}
            {allDone || !companion.showLuna ? (
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
                   whenever a quest gets completed.
                   32×32 native asset rendered at 64×64 = clean 2×
                   for sharp pixels. */}
                <Image
                  source={lunaSource(nookMood)}
                  style={{ width: 64, height: 64 }}
                  resizeMode="contain"
                  accessibilityLabel="Luna"
                />
              </>
            )}
          </Pressable>
        </View>

        {/* ── Quiet "today" line — streak · progress · done/total · +xp ──
            Companion-mode gates:
              showStreak → streak chip (kept in Minimal, off in Focused)
              showXp     → "+N xp" tint (kept in Full only) */}
        <View style={styles.todayLine}>
          {companion.showStreak && (
            <View style={styles.streakChip}>
              <Text style={styles.streakFlame}>🔥</Text>
              <Text style={styles.streakNum}>{streak}</Text>
            </View>
          )}
          <View style={styles.progressRow}>
            {Array.from({ length: Math.max(totalToday, 1) }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressSeg,
                  i < doneToday && { backgroundColor: accent.fg },
                ]}
              />
            ))}
          </View>
          <Text style={styles.todayCount}>
            {doneToday}/{totalToday}
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

        {/* ═══ THE ONE THING ═══ */}
        {allDone ? (
          <View style={styles.doneCard}>
            <SoftGlow
              color={C.glow}
              opacity={0.22}
              fade={0.7}
              cx={0.5}
              cy={0.42}
              style={styles.doneGlow}
            />
            {/* Luna in the DAY CLEARED card — reads from the same
               ambient mood hook as the nook. When the user clears
               the day, the hook returns 'happy' (that's the second
               priority); past bedtime it returns 'sleep' (which is
               actually right — the card's body copy already nudges
               rest). 96×96 = clean 3× scale of the 32×32 source. */}
            <View style={styles.doneLuna}>
              <Image
                source={lunaSource(ambientMood)}
                style={{ width: 96, height: 96 }}
                resizeMode="contain"
                accessibilityLabel="Luna"
              />
            </View>
            <Text style={styles.doneEyebrow}>Day cleared</Text>
            <Text style={styles.doneTitle}>
              That&apos;s everything. Luna&apos;s content.
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
              quest={hero}
              petName={focusPetName}
              ambientMood={ambientMood}
              xpReward={hero.xpReward}
              onMarkItDone={() => completeQuest(hero)}
              onOpenPicker={() => setFocusPickerOpen(true)}
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
                  <Text style={styles.heroXp}>
                    <Text style={styles.heroXpNum}>+{hero.xpReward}</Text> xp
                  </Text>
                </View>
              }
            />
            {floater && (
              <View style={styles.floaterMount}>
                <XpFloater amount={floater.amount} color={floater.color} />
              </View>
            )}
          </View>
        ) : null}

        {/* The expanded brain-dump surface no longer renders inline
            in the scroll — it was popping up somewhere mid-page
            depending on scroll position and reading as buggy. It's
            now a proper slide-from-bottom sheet (HomeCaptureModal),
            rendered at the end of the SafeAreaView so it composes
            with the other modals. The pill's expand button still
            just toggles capOpen; the modal takes over from there. */}


        {/* ── Lumi suggests — preview after brain-dump. Sequential
            LumiSuggestCard rendering: shows the first task with a
            "1 of N" badge, user accepts/dismisses → next task slides
            in. Bulk "Accept all remaining" button below for users
            who don't want to step through one-by-one. */}
        {previewTasks && previewTasks[0] && (
          <View style={{ marginBottom: 16 }}>
            <LumiSuggestCard
              input={{
                id: 'preview_0',
                title: aiPending ? 'Lumi is sorting…' : previewTasks[0].title,
                subtitle: aiPending ? 'reading what you said' : undefined,
                // LLM-extracted context line ("about doctor appointment",
                // "she needs it before Friday"). Falls back to undefined
                // while aiPending so it doesn't flash a stale note.
                note: aiPending ? undefined : previewTasks[0].note ?? undefined,
                defaultWindow:
                  previewTasks[0].window === 'someday'
                    ? 'evening'
                    : previewTasks[0].window,
                defaultExactMinute: previewTasks[0].at ?? null,
              }}
              total={previewTasks.length}
              index={0}
              onAccept={acceptPreviewTaskFromCard}
              onDismiss={dismissPreviewTaskFromCard}
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


        {/* ── Lumi suggests — richer scheduling card per
            lumi-suggest-card.jsx mockup. Each suggestion gets its
            own controls (duration / window / optional exact time)
            before the user accepts. Bulk-aware: when multiple
            suggestions are pending, the "1 of N" badge shows up
            and each accept/dismiss reveals the next. */}
        {heroSuggestion && !allDone && (
          <View style={{ marginBottom: 16 }}>
            <LumiSuggestCard
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
              }}
              total={suggestions.length}
              index={0}
              onAccept={acceptSuggestionFromCard}
              onDismiss={dismissSuggestionFromCard}
            />
          </View>
        )}

        {/* ── "Then, when you're ready" — collapsed rest ── */}
        {rest.length > 0 && (
          <View style={styles.restSection}>
            <Text style={styles.restEyebrow}>Then, when you&apos;re ready</Text>
            {visibleRest.map((q) => {
              const noteOpen = openNoteId === q.id;
              return (
              <View key={q.id} style={styles.restRow}>
                {/* Checkbox — own tap target. Marks done. */}
                <Pressable
                  onPress={() => completeQuest(q)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark done: ${q.title}`}
                  style={styles.restCheckbox}
                />
                {/* Middle column — title wraps, note clamps + expand,
                   meta row underneath. Per lumi-home-v2.jsx: text
                   gets full row width and never competes with the
                   trailing icons. */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.restTitle} numberOfLines={2}>
                    {q.title}
                  </Text>
                  {q.note && (
                    <RestNote
                      note={q.note}
                      open={noteOpen}
                      onToggle={() => setOpenNoteId(noteOpen ? null : q.id)}
                      accentColor={accent.fg}
                    />
                  )}
                  {/* Meta row — time · window/move-back · tier. Moved
                     under the title so it never squeezes the text. */}
                  <View style={styles.restMetaRow}>
                    {fmtScheduled(q) && (
                      <Text
                        style={[styles.restTime, { color: accent.fg }]}
                      >
                        {fmtScheduled(q)}
                      </Text>
                    )}
                    {q.window === 'someday' ? (
                      <Pressable
                        onPress={() => {
                          Haptics.selectionAsync();
                          setMovingBack(q);
                        }}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="Move back to a real day"
                        style={styles.restMoveBackBtn}
                      >
                        <Text style={styles.restMoveBackGlyph}>↺</Text>
                      </Pressable>
                    ) : (
                      <Text
                        style={[
                          styles.restWindow,
                          { color: WINDOWS[q.window].color },
                        ]}
                      >
                        {WINDOWS[q.window].glyph}{' '}
                        {effectiveWindows[q.window].label}
                      </Text>
                    )}
                    <Text
                      style={[
                        styles.restTier,
                        { color: IMPORTANCE[q.importance].color },
                      ]}
                    >
                      {IMPORTANCE[q.importance].sigil}
                    </Text>
                    {/* Edit pill — opens EditQuestSheet so the user
                       can update the title and add / edit the
                       description. Sits at the END of the meta
                       row so it's always reachable regardless of
                       how wide the time / window labels are. */}
                    <View style={{ flex: 1 }} />
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setEditingQuest(q);
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Edit task"
                      style={styles.restEditPill}
                    >
                      <Text style={styles.restEditGlyph}>✎</Text>
                      <Text style={styles.restEditText}>Edit</Text>
                    </Pressable>
                    {/* Delete pill — matches the Edit pill's style so
                       the row's right-side actions read as a single
                       row of affordances instead of one inline pill +
                       one floating circle in the corner. */}
                    <RestDeletePill id={q.id} title={q.title} />
                  </View>
                </View>
              </View>
              );
            })}
            {rest.length > 3 && (
              <Pressable
                onPress={() => setMoreOpen((o) => !o)}
                style={styles.moreToggle}
              >
                <Text style={styles.moreText}>
                  {moreOpen ? 'show less' : `+ ${rest.length - 3} more`}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── Done today — quiet history with one-tap undo. ───────── */}
        {doneTodayList.length > 0 && (
          <View style={styles.historySection}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setHistoryOpen((o) => !o);
              }}
              style={styles.historyEyebrowRow}
              hitSlop={6}
            >
              <Text style={styles.historyEyebrow}>Done today</Text>
              <Text style={styles.historyCount}>{doneTodayList.length}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.historyChev}>
                {historyOpen ? '▾' : '▸'}
              </Text>
            </Pressable>
            {historyOpen &&
              (moreDoneOpen ? doneTodayList : doneTodayList.slice(0, 3)).map(
              (q) => {
                const ago = fmtAgo(q.completedAt, now);
                return (
                  <View key={q.id} style={styles.historyRow}>
                    <View style={styles.historyCheck}>
                      <Text style={styles.historyCheckGlyph}>✓</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.historyTitle} numberOfLines={1}>
                        {q.title}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {ago ? ago : 'today'}
                        {q.window !== 'someday' && q.window
                          ? ` · ${effectiveWindows[q.window].label}`
                          : ''}
                      </Text>
                    </View>
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
              },
            )}
            {historyOpen && doneTodayList.length > 3 && (
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
      {!capOpen && !previewTasks && (
        <View style={styles.capturePill} pointerEvents="box-none">
          <View style={styles.capturePillInner}>
            <Text
              style={[styles.capturePillSpark, { color: accent.fg }]}
            >
              ✦
            </Text>
            <TextInput
              value={capText}
              onChangeText={setCapText}
              placeholder="Dump a thought…"
              placeholderTextColor={C.mute}
              style={styles.capturePillInput}
              multiline
              scrollEnabled
              returnKeyType="send"
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
          setCapText('');
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
    ambientGlow: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 360,
      height: 360,
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
      // Above the floating glass nav, with a small gap so the toast
      // doesn't kiss the pill.
      bottom: FLOATING_NAV_CLEARANCE + 8,
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
    },
    lunaNook: {
      width: 78,
      height: 78,
      borderRadius: 20,
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
      top: -10,
      left: '50%',
      marginLeft: -55,
      width: 110,
      height: 90,
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
    progressRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    progressSeg: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      backgroundColor: C.hair,
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

    // ── Done state ──
    doneCard: {
      borderRadius: 24,
      paddingHorizontal: 24,
      paddingTop: 34,
      paddingBottom: 30,
      alignItems: 'center',
      backgroundColor: C.void2,
      borderWidth: 1,
      borderColor: hexA(C.glow, 0.4),
      marginBottom: 26,
      overflow: 'hidden',
    },
    // Container the bloom paints inside. Spans the full width of the
    // card so cx=0.5 lands center; height covers Luna's nook so
    // cy=0.42 puts the brightest spot just above her head.
    doneGlow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 220,
    },
    doneLuna: { marginBottom: 6 },
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
    },
    doneBody: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.boneDim,
      lineHeight: 20,
      textAlign: 'center',
      maxWidth: 270,
    },

    // ── Empty state ──
    emptyCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: C.hair,
      backgroundColor: C.void2,
      padding: 22,
      marginBottom: 26,
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
    },
    emptyBody: {
      fontFamily: fonts.inter,
      fontSize: 13,
      color: C.boneDim,
      lineHeight: 20,
    },

    // ── Hero card ──
    heroWrap: { marginBottom: 26 },
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
      // Reverted to the previous simple pattern per user — min +
      // maxHeight caps growth to ~5 lines. iOS won't do true
      // internal scrolling with maxHeight alone (that needed the
      // tracked-height pattern we removed), but the visual cap
      // + long-dump-expand path via the fullscreen brain-dump
      // modal is what the user asked for.
      minHeight: 36,
      maxHeight: 130,
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
    timeOptionsWrap: { marginBottom: 8 },
    timeOptionsAsk: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.dusk,
      marginBottom: 6,
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

    // ── Rest list ──
    restSection: {},
    restEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: C.mute,
      marginBottom: 8,
    },
    restRow: {
      flexDirection: 'row',
      // flex-start so the checkbox + × button sit at the top
      // of the title row instead of jumping to the middle as the
      // content grows (long title wraps, note expands, etc.).
      alignItems: 'flex-start',
      gap: 13,
      paddingVertical: 14,
      paddingHorizontal: 2,
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.7),
    },
    restCheckbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: C.ash,
      marginTop: 1,
    },
    restTitle: {
      fontFamily: fonts.inter,
      fontSize: 14.5,
      color: C.boneDim,
      letterSpacing: -0.15,
      lineHeight: 19,
    },
    restNote: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.mute,
      marginTop: 3,
      lineHeight: 18,
    },
    restNoteToggleHit: {
      alignSelf: 'flex-start',
      paddingTop: 2,
      paddingBottom: 2,
      marginTop: 2,
    },
    restNoteToggle: {
      fontFamily: fonts.interSemi,
      fontSize: 11.5,
    },
    previewNote: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 12.5,
      color: C.boneDim,
      marginTop: 4,
      lineHeight: 17,
    },
    // ── Meta row under the title (time · window · tier). Moved
    //    below per lumi-home-v2 so titles never get squeezed. ──
    restMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 7,
      flexWrap: 'wrap',
    },
    restTime: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 11,
      letterSpacing: -0.2,
    },
    restWindow: {
      fontFamily: fonts.inter,
      fontSize: 10.5,
    },
    // ── Move-back icon button (Someday rows only) — sized to match
    //    the delete × button so the row stays compact.
    restMoveBackBtn: {
      marginRight: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderWidth: 1,
      borderColor: 'rgba(176,163,139,0.22)',
    },
    restMoveBackGlyph: {
      color: '#B0A38B',
      fontSize: 13,
      lineHeight: 15,
      marginTop: -1,
    },
    restTier: {
      width: 24,
      textAlign: 'right',
      fontSize: 8,
      letterSpacing: -1,
    },
    // ── Edit pill (in meta row) ──
    restEditPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderWidth: 1,
      borderColor: 'rgba(176,163,139,0.22)',
      borderRadius: 100,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    restEditGlyph: {
      fontFamily: fonts.inter,
      fontSize: 10.5,
      color: C.boneDim,
      marginTop: -1,
    },
    restEditText: {
      fontFamily: fonts.interSemi,
      fontSize: 11,
      color: C.boneDim,
      letterSpacing: -0.1,
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

    // ── "Done today" — quiet history with one-tap undo. ────────────
    // Lichen accent on the check (the only place "done" lives in the
    // palette). Title is dim + line-through so the row reads as past.
    // Undo pill uses the user accent (ember by default) — the user's
    // action color, since reactivating is THEIR move.
    historySection: {
      marginTop: 28,
      paddingTop: 18,
      borderTopWidth: 1,
      borderTopColor: hexA(C.lichen, 0.18),
    },
    historyEyebrowRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      marginBottom: 10,
      paddingLeft: 2,
    },
    historyEyebrow: {
      fontFamily: fonts.interSemi,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: C.lichen,
    },
    historyCount: {
      fontFamily: fonts.fraunces,
      fontStyle: 'italic',
      fontSize: 13,
      color: C.lichen,
    },
    historyChev: {
      fontSize: 13,
      color: hexA(C.lichen, 0.7),
      marginLeft: 'auto',
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 11,
      paddingHorizontal: 2,
      borderBottomWidth: 1,
      borderBottomColor: hexA(C.hair, 0.55),
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
