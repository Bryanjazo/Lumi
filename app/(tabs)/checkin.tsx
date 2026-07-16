// Lumi · Untangle (replaces Check-in)
//
// Spec: lumi-untangle-architecture.md (mockup: lumi-untangle.jsx).
// The user's task pile, shown calmly. One-tap moves reorganize it
// instantly; talking to Lumi clusters + arranges it conversationally.
// Energy-logging is gone — capacity is inferred passively elsewhere.
//
// Status mapping over the SHARED tasks table (useQuestStore):
//   "today"  → open quest with date === today
//   "plate"  → open quest, date != today, window != 'someday'
//   "later"  → open quest, window === 'someday'
//   "done"   → completed
//
// Color law (the architecture is strict on this):
//   ember = THE USER (their message, Arrange it, completing)
//   dusk  = LUMI (the AI moves, chat bubbles, proposed plan)

import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Svg, {
  Circle,
  Rect,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { timeColors as C } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { lunaSource, useLunaSkin, type LunaMood } from '../../lib/luna-source';
import { IMPORTANCE, type Importance } from '../../constants/importance';
import {
  useEffectiveWindows,
  type WindowKey,
} from '../../constants/windows';
import { resolveSlot } from '../../lib/slotting';
import { useHomeFocusStore } from '../../store/homeFocusStore';
import {
  useQuestStore,
  type Quest,
} from '../../store/questStore';
import { todayKey } from '../../lib/gamification';
import { useVoice } from '../../lib/voice';
import { useAccent, accentFor, type Accent } from '../../lib/theme';
import { useDeleteConfirm } from '../../components/TaskDeleteWrap';
import { MoveBackToDateSheet } from '../../components/MoveBackToDateSheet';
import { useUserStore } from '../../store/userStore';
import { useFocusSession } from '../../lib/focusSession';
import { completeQuestCore } from '../../lib/completeQuest';
import { MicIcon } from '../../components/MicIcon';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';
import { useKeyboardHeight } from '../../lib/useKeyboard';
import {
  useCorrectionsStore,
  summarizeCorrections,
} from '../../store/correctionsStore';
import { useRescueStore } from '../../store/rescueStore';
import { inferMoodFromText } from '../../lib/luna-mood';
import { useLearningDigest } from '../../lib/learning';
import {
  llmUntangle,
  type UntangleContext,
  isAnthropicConfigured,
  type UntanglePileItem,
  type UntangleProposalItem,
  type UntangleThreadMsg,
} from '../../lib/anthropic';
import { useCompanionMode } from '../../lib/companion-mode';
import { useFocusEffect } from 'expo-router';

// ═════════════════════════════════════════════════════════════════════
// Types + constants
// ═════════════════════════════════════════════════════════════════════

type PileStatus = 'today' | 'plate' | 'later';
type Slot = 'now' | 'morning' | 'midday' | 'afternoon' | 'evening';

interface MoveDef {
  key: 'overwhelmed' | 'matters' | 'lighten' | 'plan';
  label: string;
  sub: string;
  glyph: string;
}

const MOVES: MoveDef[] = [
  { key: 'overwhelmed', label: "I'm overwhelmed", sub: 'pare it to a doable few', glyph: '❍' },
  { key: 'matters', label: 'What matters?', sub: 'surface the few that count', glyph: '◈' },
  { key: 'lighten', label: 'Lighten my day', sub: 'defer what can wait', glyph: '❀' },
  { key: 'plan', label: 'Plan it for me', sub: 'arrange into an order', glyph: '❖' },
];

const SLOT_LABEL: Record<Slot, string> = {
  now: 'now',
  morning: 'this morning',
  midday: 'after lunch',
  afternoon: 'this afternoon',
  evening: 'tonight',
};

// ═════════════════════════════════════════════════════════════════════
// Helpers — pure functions over the pile
// ═════════════════════════════════════════════════════════════════════

// Pile status against an arbitrary reference date (the selected day).
// "today" here = "for the selected day"; "plate" = open and dated to
// some OTHER day (or no exact day); "later" = parked.
const pileStatusFor = (q: Quest, selectedDate: string): PileStatus => {
  if (q.window === 'someday') return 'later';
  if (q.date === selectedDate) return 'today';
  return 'plate';
};

const urgencyScore = (q: Quest): number => {
  // Rank from IMPORTANCE (1–3) + urgency boost from due-by-date.
  const rank = IMPORTANCE[q.importance]?.rank ?? 2;
  let boost = 0;
  const today = todayKey();
  if (q.date && q.date <= today) boost = 1.5; // overdue / due today
  return rank + boost;
};

const byUrgency = (a: Quest, b: Quest): number =>
  urgencyScore(b) - urgencyScore(a);

const joinNames = (arr: string[]): string => {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
};

// Slot ordering for "For today" rendering — earliest first.
const SLOT_ORDER: Slot[] = ['now', 'morning', 'midday', 'afternoon', 'evening'];
const slotRank = (q: Quest): number => {
  // Anchored quests → "now" if scheduledHour matches current hour
  // window, else use their window.
  const win = q.window;
  const idx = SLOT_ORDER.indexOf(win as Slot);
  return idx === -1 ? SLOT_ORDER.length : idx;
};

// ═════════════════════════════════════════════════════════════════════
// LunaMark — small Luna avatar for the Untangle chat. Backed by the
// shared `lunaSource()` helper so changing GIFs in one place updates
// everywhere. Honors `mood` so future tone-mapping (e.g. 'sad' when
// the user vents, 'happy' on completion) can swap the expression.
// ═════════════════════════════════════════════════════════════════════
const LunaMark = ({
  size = 28,
  mood = 'idle',
}: {
  size?: number;
  mood?: LunaMood;
}) => {
  const lunaSkin = useLunaSkin();
  return (
    <Image
      source={lunaSource(mood, lunaSkin)}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
};

// ═════════════════════════════════════════════════════════════════════
// Move runner — deterministic pile operations.
// Returns the Lumi narration + list of (id → mutation) the screen
// applies to the questStore.
// ═════════════════════════════════════════════════════════════════════

interface QuestMutation {
  id: string;
  patch: {
    date?: string;
    window?: WindowKey;
  };
}

interface MoveResult {
  say: string;
  mutations: QuestMutation[];
  view: 'pile' | 'focus' | 'plan' | 'triage';
  /** Per-task highlight flags — only used by "matters". Quest IDs to
   *  keep bright; everything else is dimmed visually. */
  highlightIds?: string[];
}

const runMove = (
  key: MoveDef['key'],
  active: Quest[],
  selectedDate: string,
): MoveResult | null => {
  const sorted = [...active].sort(byUrgency);
  // The day every "pull onto the plan" mutation writes to. When the
  // user is viewing tomorrow's pile, "Plan it for me" plans tomorrow.
  const today = selectedDate;

  if (key === 'overwhelmed') {
    const keep = sorted.slice(0, 3);
    const park = sorted.slice(3);
    const muts: QuestMutation[] = [];
    for (const q of keep) muts.push({ id: q.id, patch: { date: today } });
    for (const q of park)
      muts.push({ id: q.id, patch: { window: 'someday' } });
    return {
      say:
        park.length > 0
          ? `Breathe. Nothing here is on fire. I've set ${park.length} aside for later — they'll keep, I promise. ${keep.length === 0 ? '' : 'These ' + keep.length + ' are all today needs to be.'}`
          : `Breathe. Nothing here is on fire — ${keep.length === 1 ? 'one thing' : 'these ' + keep.length} is all today needs to be.`,
      mutations: muts,
      view: 'triage',
    };
  }

  if (key === 'matters') {
    const top = sorted
      .filter(
        (q) =>
          IMPORTANCE[q.importance]?.rank === 3 ||
          (q.date && q.date <= today),
      )
      .slice(0, 3);
    if (top.length === 0) {
      return {
        say: `Nothing on your plate reads as urgent right now. You can breathe — pick whichever feels lightest.`,
        mutations: [],
        view: 'focus',
        highlightIds: [],
      };
    }
    return {
      say: `If everything else fell away, these are the ones that actually move your week: ${joinNames(top.map((t) => `"${t.title}"`))}. The rest can wait without anything breaking.`,
      mutations: [],
      view: 'focus',
      highlightIds: top.map((q) => q.id),
    };
  }

  if (key === 'lighten') {
    const defer = active.filter(
      (q) => IMPORTANCE[q.importance]?.rank === 1,
    );
    if (defer.length === 0) {
      return {
        say: `Your plate's already pretty lean — nothing obvious to defer. Want me to surface what matters most instead?`,
        mutations: [],
        view: 'pile',
      };
    }
    return {
      say: `Done. I moved ${joinNames(defer.map((t) => `"${t.title}"`))} off today — they're parked, not gone. Your plate's lighter now; what's left is the stuff that counts.`,
      mutations: defer.map((q) => ({
        id: q.id,
        patch: { window: 'someday' as WindowKey },
      })),
      view: 'pile',
    };
  }

  if (key === 'plan') {
    const order = sorted; // urgency-ordered
    // Assign part-of-day slots in sequence. First quest → morning,
    // then midday, then afternoon, then evening; the rest stay on
    // someday (overflow).
    const slotsByIdx: WindowKey[] = [
      'morning',
      'midday',
      'midday',
      'afternoon',
      'afternoon',
      'evening',
    ];
    const muts: QuestMutation[] = [];
    order.forEach((q, i) => {
      if (i < slotsByIdx.length) {
        muts.push({
          id: q.id,
          patch: { date: today, window: slotsByIdx[i] },
        });
      } else {
        muts.push({ id: q.id, patch: { window: 'someday' } });
      }
    });
    const lead = order[0];
    return {
      say: lead
        ? `Here's an order that flows with your day: start "${lead.title}" first while you're sharp, batch the middle ones after lunch, and let the small stuff fill the gaps. Nothing stacked on top of itself.${order.length > slotsByIdx.length ? ` I tucked ${order.length - slotsByIdx.length} into Later so today stays honest.` : ''}`
        : `Your plate's clear — nothing to plan right now. Capture something on Home and I'll work it in.`,
      mutations: muts,
      view: 'plan',
    };
  }

  return null;
};

// ═════════════════════════════════════════════════════════════════════
// Conversational fallback — clusters/sorts the pile from free text.
// Returns Lumi's reply + an apply function to schedule the focus set.
// ═════════════════════════════════════════════════════════════════════

interface TalkResult {
  say: string;
  focusIds: string[];
  parkIds: string[];
}

const talkToLumi = (text: string, active: Quest[]): TalkResult => {
  const lc = ' ' + text.toLowerCase() + ' ';

  // Did the user mention any existing tasks by content?
  const mentioned = active.filter((q) => {
    const lower = q.title.toLowerCase();
    return lower
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .some((w) => lc.includes(w));
  });

  // Intent detection — beyond the original "overwhelm" check. Each
  // pattern produces a tailored response so the deterministic
  // fallback isn't a one-trick "focus + park" template when the LLM
  // is unreachable. Matched in priority order; first hit wins.
  const intents = {
    drop: /\b(take off|drop|skip|remove|cancel|can wait|cut|trim|less|too many|defer|park|push)\b/.test(lc),
    // NOTE: no bare "done" — "finally got the report done!" is a win,
    // and the old match answered it with a rest lecture that parked
    // the user's heavy tasks.
    tired: /\b(tired|exhausted|wiped|drained|low energy|can'?t focus|no energy|burnt out|wrecked|fried|done in)\b/.test(lc),
    first: /\b(first|start|where do i start|begin|kick off|priority|most important|matters most)\b/.test(lc),
    plan: /\b(plan my day|arrange|schedule|order|organize|line up|line them up|sort them)\b/.test(lc),
    overwhelmed: /\b(overwhelm|drowning|too much|can'?t|stressed|panic|behind|so much|a lot|freaking|losing it)\b/.test(lc),
  };

  const sortedByUrgency = [...active].sort(byUrgency);
  const top = sortedByUrgency[0];
  const lightOnes = active.filter((q) => IMPORTANCE[q.importance]?.rank === 1);

  let say: string;
  let focusIds: string[] = [];
  let parkIds: string[] = [];

  // ── 1. "What can I take off / drop / skip" — defer the lightest ──
  if (intents.drop) {
    const toDefer = lightOnes.slice(0, 2);
    if (toDefer.length > 0) {
      say = `${joinNames(toDefer.map((t) => `"${t.title}"`))} can wait — I'll park ${toDefer.length === 1 ? 'it' : 'them'} for later so today feels lighter.`;
      focusIds = active.filter((q) => !toDefer.some((d) => d.id === q.id)).map((q) => q.id);
      parkIds = toDefer.map((q) => q.id);
    } else {
      say = `Nothing on your plate reads as quick-and-droppable — they all carry weight. What feels heaviest? Tell me and I'll move it.`;
      focusIds = active.map((q) => q.id);
    }
  }
  // ── 2. "I'm tired" — surface light tasks, park heavy ones ──
  else if (intents.tired) {
    const heavy = active.filter((q) => IMPORTANCE[q.importance]?.rank === 3);
    const light = active.filter((q) => IMPORTANCE[q.importance]?.rank <= 2);
    if (light.length > 0) {
      const pick = light.slice(0, 2);
      say = `Take it easy. Try ${joinNames(pick.map((t) => `"${t.title}"`))} — small wins help. I'll hold the heavier stuff till you've got more in the tank.`;
      focusIds = pick.map((q) => q.id);
      parkIds = heavy.map((q) => q.id);
    } else {
      say = `Your plate's all heavy right now — none of it has to happen today. I'll move everything to later so you can rest.`;
      parkIds = active.map((q) => q.id);
    }
  }
  // ── 3. "Where do I start" — pick the single most urgent ──
  else if (intents.first && top) {
    say = `Start with "${top.title}" — it's the one that'll feel best to have done. Everything else can wait its turn.`;
    focusIds = [top.id];
  }
  // ── 4. "Plan my day" — sequence the top few ──
  else if (intents.plan) {
    const planned = sortedByUrgency.slice(0, 4);
    if (planned.length > 0) {
      const lead = planned[0];
      const rest = planned.slice(1);
      say = `Here's the order: "${lead.title}" first while you're sharp${rest.length ? `, then ${joinNames(rest.map((t) => `"${t.title}"`))}` : ''}. I'll space them out so they're not stacked.`;
      focusIds = planned.map((q) => q.id);
      parkIds = active.filter((q) => !planned.some((p) => p.id === q.id)).map((q) => q.id);
    } else {
      say = `Your plate's clear — nothing to plan. Capture what's on your mind and I'll work it in.`;
    }
  }
  // ── 5. Overwhelmed (existing) — pare to a doable few ──
  else if (intents.overwhelmed && top) {
    const keep = sortedByUrgency.slice(0, 3);
    const quick = keep.find((q) => IMPORTANCE[q.importance]?.rank === 1);
    say = `That's a full plate — no wonder it feels heavy. Let's make it small. Do "${top.title}" first while you're fresh${quick && quick !== top ? `, knock out "${quick.title}" to clear your head` : ''}, and I'll hold the rest until you've got room.`;
    focusIds = keep.map((q) => q.id);
    parkIds = active.filter((q) => !keep.some((k) => k.id === q.id)).map((q) => q.id);
  }
  // ── 6. Specific task mentioned — center the response on them ──
  else if (mentioned.length > 0) {
    const ordered = [...mentioned].sort(byUrgency);
    const lead = ordered[0];
    const rest = ordered.slice(1);
    say = `Got it. "${lead.title}" first while you're sharp${rest.length ? `, then ${joinNames(rest.map((t) => `"${t.title}"`))} after` : ''}. I'll slot them so they're not all at once.`;
    focusIds = ordered.map((q) => q.id);
    parkIds = active.filter((q) => !ordered.some((m) => m.id === q.id)).map((q) => q.id);
  }
  // ── 7. Empty plate / no intent — calm acknowledgment, no shuffle ──
  else if (active.length === 0) {
    say = `Your plate's clear — nothing to wrestle with. Capture what's on your mind and I'll work it in.`;
  }
  // ── 8. Default — gentle acknowledgment, surface the top one only ──
  else if (top) {
    say = `I hear you. If you want to start somewhere, "${top.title}" looks like it'd give you the biggest sense of relief — but the moves below can sort it differently if you'd rather.`;
    focusIds = [top.id];
  }
  // ── 9. Fallthrough ──
  else {
    say = `I'm here. The moves below can pare it down, surface what matters, or arrange your day — whichever feels right.`;
  }

  return { say, focusIds, parkIds };
};

// ═════════════════════════════════════════════════════════════════════
// TaskChip — one row in the pile
// ═════════════════════════════════════════════════════════════════════
const TaskChip = ({
  quest,
  highlighted,
  dimmed,
  showSlot,
}: {
  quest: Quest;
  highlighted?: boolean;
  dimmed?: boolean;
  showSlot?: boolean;
}) => {
  const tier = IMPORTANCE[quest.importance];
  const onToday = quest.date === todayKey();
  const slotLabel = showSlot ? (SLOT_LABEL[quest.window as Slot] ?? null) : null;
  const today = todayKey();
  // "carried" not "overdue" (emotional-model spec §7): the task came
  // along with the user — the word never blames them for it. Dusk
  // tone, not alarm-red.
  // ('due' branch removed — quest.date===today && !onToday was
  // unsatisfiable since onToday IS date===today.)
  const tag = quest.date && quest.date < today ? 'carried' : '';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: onToday
            ? hexA(tier.color, 0.1)
            : C.void2,
          borderColor: onToday ? hexA(tier.color, 0.4) : C.hair,
          opacity: dimmed ? 0.4 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.chipSigil,
          { color: tier.color },
          highlighted && { textShadowColor: tier.color, textShadowRadius: 4 },
        ]}
      >
        {tier.sigil}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          styles.chipTitle,
          quest.completed && {
            color: C.mute,
            textDecorationLine: 'line-through',
          },
        ]}
      >
        {quest.title}
      </Text>
      {slotLabel && (
        <Text style={styles.chipSlot}>{slotLabel}</Text>
      )}
      {!slotLabel && tag && (
        <View
          style={[
            styles.chipTag,
            tag === 'carried' && { borderColor: hexA(C.dusk, 0.4) },
          ]}
        >
          <Text
            style={[
              styles.chipTagText,
              tag === 'carried' && { color: C.dusk },
            ]}
          >
            {tag}
          </Text>
        </View>
      )}
      <ChipDeleteBtn id={quest.id} title={quest.title} />
    </View>
  );
};

// Always-visible ⌫ button at the right of each TaskChip. Single tap
// opens the same destructive confirm as the long-press path. First
// users can SEE that they can delete, which the hold-only gesture
// hid behind a learnable behavior.
const ChipDeleteBtn = ({ id, title }: { id: string; title: string }) => {
  const confirm = useDeleteConfirm(id, title);
  return (
    <Pressable
      onPress={confirm}
      hitSlop={10}
      style={styles.chipDeleteBtn}
    >
      <Text style={styles.chipDeleteGlyph}>×</Text>
    </Pressable>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Chat bubble
// ═════════════════════════════════════════════════════════════════════
interface ChatMsg {
  id: string;
  from: 'user' | 'lumi';
  text: string;
  /** Legacy one-tap-style action pair (deterministic talkToLumi
   *  fallback uses this — render Arrange-it / Adjust buttons). */
  actions?: {
    approveLabel: string;
    onApprove: () => void;
    onAdjust?: () => void;
  };
  /** LLM-shaped structured proposal — Approve runs the validated
   *  applier. Adjust posts a calm "tell me what to change" reply.
   *  Both clear themselves from the message once handled. */
  proposal?: {
    items: UntangleProposalItem[];
    onApprove: () => void;
    onAdjust: () => void;
  };
  /** Quiet trailing line ("I'd also …") — proactive suggestion
   *  from the model. Rendered in dusk italic under the bubble. */
  proactive?: string;
}

// Render a single LLM-proposed action in plain language.
// Validation against the live pile happens at apply time; this is
// just a label.
const proposalLine = (
  p: UntangleProposalItem,
  pileById: Map<string, Quest>,
): string => {
  // 'create' items don't have a pile id — they ship their title
  // directly. Surface them as "Add 'X' at 8am" so the user sees
  // what they're agreeing to.
  if (p.action === 'create') {
    const title = p.title ? `"${p.title}"` : '(new task)';
    if (p.at) return `Add ${title} at ${p.at}`;
    if (p.date) return `Add ${title} on ${formatDayLabel(p.date).toLowerCase()}`;
    return `Add ${title}`;
  }
  const q = pileById.get(p.taskId);
  const title = q ? `"${q.title}"` : '(missing task)';
  if (p.action === 'complete') {
    return `Done ✓ ${title}`;
  }
  const winLabel = (w?: string): string => {
    if (w === 'morning') return 'this morning';
    if (w === 'midday') return 'after lunch';
    if (w === 'afternoon') return 'this afternoon';
    if (w === 'evening') return 'tonight';
    if (w === 'someday') return 'later';
    return '';
  };
  if (p.action === 'schedule') {
    return `${title} → ${winLabel(p.window) || 'today'}`;
  }
  if (p.action === 'surface') {
    return `${title} → today${p.window ? ' · ' + winLabel(p.window) : ''}`;
  }
  if (p.action === 'reschedule') {
    const dateLabel = p.date ? formatDayLabel(p.date).toLowerCase() : 'a new day';
    const atLabel = p.at ? ` at ${p.at}` : '';
    return `${title} → ${dateLabel}${atLabel}`;
  }
  if (p.action === 'defer') {
    return `${title} → later`;
  }
  return title;
};

const ProposalCard = ({
  items,
  pileById,
  onApprove,
  onAdjust,
  accent,
}: {
  items: UntangleProposalItem[];
  pileById: Map<string, Quest>;
  onApprove: () => void;
  onAdjust: () => void;
  accent: Accent;
}) => {
  // 'create' items carry taskId "" by contract — they must render
  // (a create-only proposal used to show NO card at all, and mixed
  // proposals applied hidden creates the user never saw).
  const valid = items.filter(
    (p) => p.action === 'create' || pileById.has(p.taskId),
  );
  if (valid.length === 0) return null;
  return (
    <View style={styles.proposalCard}>
      <Text style={styles.proposalLabel}>Here&apos;s what I&apos;d do</Text>
      <View style={{ gap: 5, marginTop: 6 }}>
        {valid.map((p, i) => (
          <View key={`${p.taskId}-${i}`} style={styles.proposalRow}>
            <Text style={styles.proposalBullet}>·</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.proposalText}>{proposalLine(p, pileById)}</Text>
              {p.why && p.why.length > 0 && (
                <Text style={styles.proposalWhy}>{p.why}</Text>
              )}
            </View>
          </View>
        ))}
      </View>
      <View style={styles.lumiActions}>
        <Pressable
          onPress={onApprove}
          accessibilityRole="button"
          accessibilityLabel="Approve these changes"
          style={[styles.approveBtn, { backgroundColor: accent.fg }]}
        >
          <Text style={styles.approveBtnText}>Approve</Text>
        </Pressable>
        <Pressable
          onPress={onAdjust}
          accessibilityRole="button"
          accessibilityLabel="Adjust — tell Lumi what to change"
          style={styles.adjustBtn}
        >
          <Text style={styles.adjustBtnText}>Adjust</Text>
        </Pressable>
      </View>
    </View>
  );
};

const Bubble = ({
  msg,
  pileById,
  accent,
  lunaMood,
}: {
  msg: ChatMsg;
  pileById: Map<string, Quest>;
  /** Mood inferred from the user's most recent message in the
   *  thread (sad/happy/sleep/idle). Drives Luna's expression in
   *  the assistant avatar — so when the user vents, the cat looks
   *  it back. */
  lunaMood: LunaMood;
  accent: Accent;
}) => {
  if (msg.from === 'user') {
    return (
      <View style={styles.userBubbleRow}>
        <View
          style={[
            styles.userBubble,
            {
              backgroundColor: hexA(accent.fg, 0.16),
              borderColor: hexA(accent.fg, 0.35),
            },
          ]}
        >
          <Text style={styles.userBubbleText}>{msg.text}</Text>
        </View>
      </View>
    );
  }
  const { showLuna } = useCompanionMode();
  return (
    <View style={styles.lumiRow}>
      {/* Focused mode promises a calm AI organizer, no Tamagotchi —
          the cat avatar yields to a quiet spark. */}
      <View style={styles.lumiAvatar}>
        {showLuna ? (
          <LunaMark size={24} mood={lunaMood} />
        ) : (
          <Text style={{ color: C.dusk, fontSize: 12 }}>✦</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.lumiBubble}>
          <Text style={styles.lumiBubbleText}>{msg.text}</Text>
          {msg.actions && (
            <View style={styles.lumiActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={msg.actions.approveLabel}
                onPress={msg.actions.onApprove}
                style={[
                  styles.approveBtn,
                  { backgroundColor: accent.fg },
                ]}
              >
                <Text style={styles.approveBtnText}>
                  {msg.actions.approveLabel}
                </Text>
              </Pressable>
              {msg.actions.onAdjust && (
                <Pressable
                  onPress={msg.actions.onAdjust}
                  style={styles.adjustBtn}
                >
                  <Text style={styles.adjustBtnText}>Adjust</Text>
                </Pressable>
              )}
            </View>
          )}
          {msg.proposal && (
            <ProposalCard
              items={msg.proposal.items}
              pileById={pileById}
              onApprove={msg.proposal.onApprove}
              onAdjust={msg.proposal.onAdjust}
              accent={accent}
            />
          )}
        </View>
        {msg.proactive && (
          <Text style={styles.proactiveLine}>{msg.proactive}</Text>
        )}
      </View>
    </View>
  );
};

const TypingDots = ({ mood }: { mood: LunaMood }) => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 3), 280);
    return () => clearInterval(id);
  }, []);
  const { showLuna } = useCompanionMode();
  return (
    <View style={styles.lumiRow}>
      <View style={styles.lumiAvatar}>
        {showLuna ? (
          <LunaMark size={24} mood={mood} />
        ) : (
          <Text style={{ color: C.dusk, fontSize: 12 }}>✦</Text>
        )}
      </View>
      <View style={styles.typingBubble}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.typingDot,
              { opacity: step === i ? 1 : 0.35 },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════

// ── Date helpers ──
const localYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
/**
 * Parse a "YYYY-MM-DD" string as LOCAL midnight (not UTC).
 *
 * Why this isn't `new Date(iso)`: when the ISO short form has no
 * timezone, the runtime parses it as UTC. In negative-UTC zones (US),
 * the resulting Date represents the previous local evening, so
 * `getDate()` returns the wrong day and shift math gets stuck. Forcing
 * the (y, m-1, d) constructor pins midnight to local time, so
 * +1/-1 work as expected.
 */
const localDateFromISO = (iso: string): Date => {
  const [yStr, mStr, dStr] = iso.split('-');
  return new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10));
};
const offsetKey = (baseISO: string, days: number): string => {
  const d = localDateFromISO(baseISO);
  d.setDate(d.getDate() + days);
  return localYmd(d);
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const formatDayLabel = (iso: string): string => {
  const today = todayKey();
  const tomorrow = offsetKey(today, 1);
  const yesterday = offsetKey(today, -1);
  if (iso === today) return 'Today';
  if (iso === tomorrow) return 'Tomorrow';
  if (iso === yesterday) return 'Yesterday';
  const d = localDateFromISO(iso);
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
};

export default function Untangle() {
  const accent = useAccent();
  const allQuests = useQuestStore((s) => s.quests);
  const moveWindow = useQuestStore((s) => s.moveWindow);
  const setDate = useQuestStore((s) => s.setDate);
  const anchor = useQuestStore((s) => s.anchor);
  // (Completion economy — toggle/addXp/addShard/registerActivity —
  // moved into the shared completeQuestCore helper.)

  // User profile bits the LLM needs as context (sharp/foggy windows,
  // anchors, top struggles).
  const sharpWindow = useUserStore((s) => s.sharpWindow);
  const foggyWindow = useUserStore((s) => s.foggyWindow);
  const anchors = useUserStore((s) => s.anchors);
  // Window bounds for the auto-slot cascade in applyProposal.
  const effectiveWindows = useEffectiveWindows();
  const struggles = useUserStore((s) => s.struggles);
  const userName = useUserStore((s) => s.name);
  const digest = useLearningDigest();

  // Active = open quests we can act on (not completed).
  const active = useMemo(
    () => allQuests.filter((q) => !q.completed),
    [allQuests],
  );

  // ── Selected day — defaults to today; jumps to the next day with
  //    real tasks on first mount if today is empty.
  const [selectedDate, setSelectedDate] = useState<string>(() => todayKey());
  const didAutoJump = useRef(false);
  const questsHydrated = useQuestStore((s) => s.hasHydrated);
  useEffect(() => {
    if (didAutoJump.current) return;
    // Cold-starting straight into this tab used to latch against the
    // EMPTY pre-hydration store — the jump never ran with real data.
    if (!questsHydrated) return;
    didAutoJump.current = true;
    const today = todayKey();
    const todayActive = active.filter(
      (q) => q.window !== 'someday' && q.date === today,
    );
    if (todayActive.length > 0) return;
    // No tasks dated for today — look forward for the next day that has
    // something planned.
    const futureDates = Array.from(
      new Set(
        active
          .filter(
            (q) => q.window !== 'someday' && q.date && q.date > today,
          )
          .map((q) => q.date),
      ),
    ).sort();
    if (futureDates.length > 0) setSelectedDate(futureDates[0]);
  }, [active, questsHydrated]);

  const todayList = useMemo(
    () =>
      active
        .filter((q) => pileStatusFor(q, selectedDate) === 'today')
        .sort((a, b) => slotRank(a) - slotRank(b)),
    [active, selectedDate],
  );
  const plateList = useMemo(
    () =>
      active
        .filter((q) => pileStatusFor(q, selectedDate) === 'plate')
        .sort(byUrgency),
    [active, selectedDate],
  );
  const laterList = useMemo(
    () => active.filter((q) => pileStatusFor(q, selectedDate) === 'later'),
    [active, selectedDate],
  );
  // Moves operate over the selected day's tasks only — same scope the
  // UI now shows. (Previously included plateList; the pile is now
  // single-section so moves and the visible pile stay aligned.)
  const activeForMove = useMemo(() => todayList, [todayList]);

  const isToday = selectedDate === todayKey();
  const dayLabel = useMemo(() => formatDayLabel(selectedDate), [selectedDate]);

  // ── "Later" section — collapsible by default, lets the user pull
  // tasks BACK out of Someday onto today or any of the next ~14 days.
  // The pile in the main section only shows what's already dated;
  // someday tasks were previously a one-way street (moves dropped
  // them in, nothing surfaced them back). ──
  const [laterOpen, setLaterOpen] = useState(false);
  // The someday task currently being moved back, if any. When set,
  // the MoveBackToDateSheet opens with this task's title.
  const [movingBack, setMovingBack] = useState<Quest | null>(null);

  /** Move a Someday task to a real date. Default window is morning
   *  if it doesn't already have one (someday tasks usually don't). */
  const moveBackToDate = (q: Quest, dateISO: string) => {
    setDate(q.id, dateISO);
    // Undo someday → a real part-of-day. Picking "Today" at 9pm used
    // to land the task in a long-gone MORNING window; use the next
    // window that's still open today (any window for future days).
    let win: WindowKey = 'morning';
    if (dateISO === todayKey()) {
      const nowH = new Date().getHours() + new Date().getMinutes() / 60;
      const openNow = (
        ['morning', 'midday', 'afternoon', 'evening'] as WindowKey[]
      ).find((w) => {
        const end = effectiveWindows[w].end;
        return end != null && nowH < end;
      });
      win = openNow ?? 'evening';
    }
    moveWindow(q.id, win);
  };
  // App open across midnight: a stale "today" selection would write
  // moves onto YESTERDAY (instantly "carried"). Only auto-snaps when
  // the selection is in the past — a deliberately browsed future day
  // stays put.
  useFocusEffect(
    useCallback(() => {
      setSelectedDate((d) => (d < todayKey() ? todayKey() : d));
    }, []),
  );

  const shiftDay = (delta: number) => {
    Haptics.selectionAsync();
    setSelectedDate((d) => offsetKey(d, delta));
  };
  const jumpToToday = () => {
    Haptics.selectionAsync();
    setSelectedDate(todayKey());
  };

  // ── Chat state ──
  // busyRef: synchronous double-send latch. sendGenRef: generation
  // fence — reset() bumps it so an in-flight reply from the OLD
  // conversation can't land in the fresh one. msgSeqRef: id nonce
  // (two sends in one ms used to collide on Date.now() keys).
  const busyRef = useRef(false);
  const sendGenRef = useRef(0);
  const msgSeqRef = useRef(0);
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      id: 'init',
      from: 'lumi',
      text: "Hey — take a breath. I can see everything on your plate. Tap a move below, or just tell me what's weighing on you and I'll sort it.",
    },
  ]);
  // The LLM-shaped thread we send each turn (history matters; the
  // model is stateless). Capped to last 16 turns in the helper. Not
  // persisted — fresh per session.
  const [thread, setThread] = useState<UntangleThreadMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'pile' | 'focus' | 'plan' | 'triage'>(
    'pile',
  );
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // ── Rescue hand-off (emotional-model spec §3) ────────────────────
  // Home's Rescue Mode "let me explain" button lands here: open with
  // "life happened" framing instead of the normal greeting, so the
  // user can just talk and the engine sorts what can wait.
  const pendingExplain = useRescueStore((s) => s.pendingExplain);
  const setPendingExplain = useRescueStore((s) => s.setPendingExplain);
  useEffect(() => {
    if (!pendingExplain) return;
    setPendingExplain(false);
    setMsgs((m) => [
      ...m,
      {
        id: `rescue-${Date.now()}`,
        from: 'lumi',
        text: "Life happened — that's allowed. Tell me what's been going on, and I'll sort what can wait, tuck away what's stale, and keep only what really matters today.",
      },
    ]);
  }, [pendingExplain, setPendingExplain]);

  // Voice
  const voice = useVoice();
  useEffect(() => {
    if (voice.error) {
      setMsgs((m) => [
        ...m,
        { id: `err-${Date.now()}`, from: 'lumi' as const, text: voice.error! },
      ].slice(-100));
      // Clear so an identical error next attempt re-fires this
      // effect (two "no speech" in a row used to surface only once).
      voice.clearError();
    }
  }, [voice.error]);

  const handleMic = async () => {
    if (voice.state === 'idle') await voice.start();
    else if (voice.state === 'recording') {
      const transcript = await voice.stopAndTranscribe();
      if (transcript && transcript.trim()) {
        setText(transcript.trim());
        // Auto-send after a tick so the input reflects.
        setTimeout(() => send(transcript.trim()), 30);
      }
    }
  };

  // ── Apply mutations to questStore ──
  // "Put it back" (audit enhancement): every deterministic move and
  // approved proposal snapshots the pre-mutation state; the
  // confirmation message carries a one-tap restore. Moves used to be
  // irreversible at the user's most fragile moment.
  // Token-based undo bank. The old design was ONE global snapshot
  // slot behind many immortal buttons: a stale "Put it back" undid
  // the WRONG proposal, a double-tap posted a false confirmation,
  // and undoing after the user completed the task UN-completed it.
  // Now: each apply banks its own token; banking a new one expires
  // all older buttons; undo is one-shot; completed tasks are never
  // touched; created tasks are removed.
  type UndoSnap = {
    id: string;
    date: string;
    window: WindowKey;
    scheduledHour: number | null;
    scheduledMinute: number | null;
    completed: boolean;
  };
  const undoBankRef = useRef<
    Map<string, { snaps: UndoSnap[]; created: string[] }>
  >(new Map());
  const undoDraftRef = useRef<{ snaps: UndoSnap[]; created: string[] }>({
    snaps: [],
    created: [],
  });
  const beginUndoDraft = () => {
    undoDraftRef.current = { snaps: [], created: [] };
  };
  const snapshotForUndo = (id: string) => {
    if (undoDraftRef.current.snaps.some((s) => s.id === id)) return;
    const q = useQuestStore.getState().quests.find((x) => x.id === id);
    if (!q) return;
    undoDraftRef.current.snaps.push({
      id: q.id,
      date: q.date,
      window: q.window,
      scheduledHour: q.scheduledHour ?? null,
      scheduledMinute: q.scheduledMinute ?? null,
      completed: q.completed,
    });
  };
  const recordCreatedForUndo = (id: string) => {
    undoDraftRef.current.created.push(id);
  };
  /** Bank the current draft under a fresh token. Newer mutations
   *  expire every older token AND strip their buttons — one honest
   *  restore point at a time. Returns null when nothing changed. */
  const bankUndo = (): string | null => {
    const d = undoDraftRef.current;
    if (d.snaps.length === 0 && d.created.length === 0) return null;
    if (undoBankRef.current.size > 0) {
      undoBankRef.current.clear();
      setMsgs((m) =>
        m.map((x) => (x.actions ? { ...x, actions: undefined } : x)),
      );
    }
    const token = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    undoBankRef.current.set(token, d);
    undoDraftRef.current = { snaps: [], created: [] };
    return token;
  };
  const putItBack = (token: string) => {
    const bank = undoBankRef.current.get(token);
    undoBankRef.current.delete(token);
    // One-shot: strip the button(s) immediately so a second tap
    // can't post a false "put back" confirmation.
    setMsgs((m) =>
      m.map((x) => (x.actions ? { ...x, actions: undefined } : x)),
    );
    if (!bank) return;
    const st = useQuestStore.getState();
    let restored = 0;
    let keptDone = 0;
    for (const s of bank.snaps) {
      const live = st.quests.find((x) => x.id === s.id);
      if (!live) continue;
      if (live.completed !== s.completed) {
        // Never un-complete from an undo — the user finished it
        // AFTER this move; that win stands (ledger stays honest).
        keptDone += 1;
        continue;
      }
      if (live.date !== s.date) setDate(s.id, s.date);
      if (s.scheduledHour != null && s.scheduledMinute != null) {
        anchor(s.id, s.scheduledHour, s.scheduledMinute);
      } else if (live.window !== s.window || live.scheduledHour != null) {
        moveWindow(s.id, s.window); // also clears a new anchor
      }
      restored += 1;
    }
    for (const id of bank.created) {
      const live = st.quests.find((x) => x.id === id);
      if (live && !live.completed) {
        st.remove(id);
        restored += 1;
      }
    }
    pushLumi(
      restored > 0
        ? keptDone > 0
          ? 'Put back — except what you already finished. Those stand. 💛'
          : 'Put back exactly how it was. 💛'
        : 'Nothing needed putting back — it already changed shape. 💛',
    );
  };

  const applyMutations = (muts: QuestMutation[]) => {
    beginUndoDraft();
    for (const m of muts) {
      // ANCHOR SAFETY (audit C1): setDate/moveWindow wipe scheduled
      // times AND delete calendar mirrors. A no-op date patch used
      // to un-anchor "Dentist 3pm" and vanish its calendar event the
      // moment the user tapped "I'm overwhelmed".
      const live = useQuestStore.getState().quests.find((q) => q.id === m.id);
      if (!live) continue;
      snapshotForUndo(m.id);
      if (m.patch.date != null && live.date !== m.patch.date) {
        setDate(m.id, m.patch.date);
      }
      if (
        m.patch.window != null &&
        live.window !== m.patch.window &&
        // Never fuzzy-window a clock-anchored task — a fixed 3pm
        // appointment must not become "morning".
        (live.scheduledHour == null || m.patch.window === 'someday')
      ) {
        moveWindow(m.id, m.patch.window);
        // moveWindow UN-ANCHORS — without a fresh slot the task lands
        // at the window start, and a one-tap "focus these" move that
        // re-windows several tasks stacks them ALL on one minute (the
        // "five at 11a" bug). Give each a real seat, overflow-aware
        // and identical to Home capture: next open :15 in the window,
        // cram later the same day, else move to the next day with
        // room. Someday stays deliberately timeless.
        if (m.patch.window !== 'someday') {
          const dateISO = m.patch.date ?? live.date ?? todayKey();
          const res = resolveSlot({
            window: m.patch.window,
            dateISO,
            durationMin: live.durationMinutes ?? 30,
            quests: useQuestStore.getState().quests,
            anchors,
            effectiveWindows,
            nowMin:
              dateISO === todayKey()
                ? new Date().getHours() * 60 + new Date().getMinutes()
                : null,
          });
          if (res != null) {
            if (res.dateISO !== dateISO) setDate(m.id, res.dateISO);
            anchor(m.id, Math.floor(res.min / 60), res.min % 60);
          }
        }
      }
    }
  };

  // Quick lookup for proposal rendering + action validation.
  const pileById = useMemo(() => {
    const m = new Map<string, Quest>();
    for (const q of active) m.set(q.id, q);
    return m;
  }, [active]);

  // Build the compact UntangleContext for the LLM. Pile is the WHOLE
  // active pile (not just the selected day), so the model can reason
  // about deferring/surfacing across days.
  const buildLlmContext = (): UntangleContext => {
    const today = todayKey();
    const now = new Date();
    const dowFull = [
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
    const fmtAnchor = (m: number) => {
      const h = Math.floor(m / 60);
      const mn = m % 60;
      return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
    };
    // Bounded pile for the LLM. Per lumi-ai-cost-economics-v2.md §5
    // input tokens dominate per-turn cost — sending the entire active
    // pile (potentially hundreds of items) on every turn is the
    // failure mode. Send a curated, bounded set: today + overdue +
    // a slice of plate + a slice of later. The user's question almost
    // always concerns the visible day or recent items; longer-tail
    // tasks contribute noise more than signal.
    const PILE_LIMITS = {
      today: 30, // the selected day — most relevant
      overdue: 20, // anything missed — usually small
      plate: 20, // upcoming non-selected days
      later: 10, // parked
    };
    const toPileItem = (q: Quest, status: 'today' | 'plate' | 'later'): UntanglePileItem => ({
      id: q.id,
      title: q.title,
      importance: q.importance,
      window: String(q.window),
      date: q.date,
      ...(q.scheduledHour != null
        ? {
            at: `${String(q.scheduledHour).padStart(2, '0')}:${String(
              q.scheduledMinute ?? 0,
            ).padStart(2, '0')}`,
          }
        : {}),
      status,
      ...(q.date && q.date < today ? { overdue: true } : {}),
    });
    const todayItems: UntanglePileItem[] = active
      .filter((q) => q.window !== 'someday' && q.date === selectedDate)
      .slice(0, PILE_LIMITS.today)
      .map((q) => toPileItem(q, 'today'));
    const overdueItems: UntanglePileItem[] = active
      .filter(
        (q) =>
          q.window !== 'someday' &&
          q.date &&
          q.date < today &&
          q.date !== selectedDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, PILE_LIMITS.overdue)
      .map((q) => toPileItem(q, 'plate'));
    const plateItems: UntanglePileItem[] = active
      .filter(
        (q) =>
          q.window !== 'someday' &&
          q.date &&
          q.date >= today &&
          q.date !== selectedDate,
      )
      .sort(byUrgency)
      .slice(0, PILE_LIMITS.plate)
      .map((q) => toPileItem(q, 'plate'));
    // Most RECENTLY parked first (audit R1) — store order is oldest-
    // first, so the old slice(0,10) starved exactly the tasks users
    // ask about ("bring back what I parked yesterday").
    const somedayAll = active.filter((q) => q.window === 'someday');
    const laterItems: UntanglePileItem[] = somedayAll
      .slice(-PILE_LIMITS.later)
      .reverse()
      .map((q) => toPileItem(q, 'later'));
    const laterOverflow = Math.max(0, somedayAll.length - PILE_LIMITS.later);
    const pile: UntanglePileItem[] = [
      ...todayItems,
      ...overdueItems,
      ...plateItems,
      ...laterItems,
    ];
    return {
      nowLabel: `${dowFull}, ${today} ${hh}:${mm}`,
      todayISO: today,
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
      curveTrusted: allQuests.filter((q) => q.completed).length >= 14,
      anchors: {
        wake: fmtAnchor(anchors.wake),
        breakfast: fmtAnchor(anchors.breakfast),
        lunch: fmtAnchor(anchors.lunch),
        dinner: fmtAnchor(anchors.dinner),
        sleep: fmtAnchor(anchors.sleep),
      },
      struggles: struggles.slice(0, 3),
      recentCorrections: summarizeCorrections(
        useCorrectionsStore.getState().recent(6),
      ),
      userName: userName.trim() || undefined,
      pile,
      selectedDayISO: selectedDate,
      parkedOverflow: laterOverflow,
    };
  };

  // Apply a proposal returned by the LLM. Each item is re-validated
  // against the LIVE pile (the model may have stale ids) — invalid
  // items are silently dropped. 'create' items don't reference an
  // existing pile id; they mint a NEW task via addQuest instead.
  // Returns the count actually applied.
  const applyProposal = (items: UntangleProposalItem[]): number => {
    // Auto-slot cascade (same rule as Home's capture): a windowed
    // task without an explicit time gets the NEXT OPEN :15 slot in
    // its window — five evening tasks land 5:00 → 5:30 → 6:00…
    // instead of all piling up at "5p". Overflow-aware (parity with
    // Home): a full window crams later the same day, a full DAY moves
    // to the next day with room. Fresh store read per call so
    // consecutive placements in this same loop see each other.
    const resolveFor = (win: WindowKey, dateISO: string, durationMin: number) =>
      resolveSlot({
        window: win,
        dateISO,
        durationMin,
        quests: useQuestStore.getState().quests,
        anchors,
        effectiveWindows,
        nowMin:
          dateISO === todayKey()
            ? new Date().getHours() * 60 + new Date().getMinutes()
            : null,
      });
    beginUndoDraft();
    let applied = 0;
    // Home "focus this" handoff: the task Lumi steered the user onto
    // becomes Home's main card. Surfacing is the explicit signal; a
    // freshly created "start here" task, or a lone task scheduled into
    // the day, are the fallbacks. Only TODAY tasks qualify (Home's
    // hero is today-only), and a broad multi-task re-plan singles out
    // nothing unless it explicitly surfaced one.
    const untanglingToday = selectedDate === todayKey();
    let surfacedId: string | null = null;
    let createdId: string | null = null;
    let scheduledId: string | null = null;
    let actionableCount = 0;
    // The prompt says "never duplicate a task in a proposal" — this
    // is the client backstop (finding: duplicate complete ids paid
    // XP twice then un-completed the task).
    const seenIds = new Set<string>();
    for (const p of items) {
      // 'complete' — the user told Lumi it's already done. Same data
      // fan-out as Home's completeQuest (XP + shard + streak) so a
      // check-off through conversation counts exactly like a tap.
      if (p.action === 'complete') {
        // LIVE read — the closure's pileById is frozen at proposal
        // time. Stale reads let a double-tap (or a task completed on
        // Home meanwhile) UN-complete the task while paying XP again.
        const live = useQuestStore
          .getState()
          .quests.find((x) => x.id === p.taskId);
        if (!live || live.completed) continue;
        if (seenIds.has(p.taskId)) continue; // duplicate id in one proposal
        // Snapshot BEFORE the toggle (the helper flips it) so undo can
        // restore the open state.
        snapshotForUndo(p.taskId);
        seenIds.add(p.taskId);
        // THE shared completion fan-out — same XP/shard/activity/
        // focus-end as Home + Time (one definition, no drift).
        const done = completeQuestCore(live.id);
        if (done) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          applied += 1;
        }
        continue;
      }
      // 'create' is the only action that doesn't need a pile lookup —
      // it mints a brand-new task from the LLM's title + metadata.
      if (p.action === 'create') {
        if (!p.title || p.title.trim().length === 0) continue;
        // Same round-trip validation as reschedule — the sanitizer
        // regex admits "2026-02-31", which would mint an invisible
        // task matching no real day anywhere (audit B7).
        if (p.date && localYmd(localDateFromISO(p.date)) !== p.date) {
          continue;
        }
        const imp = p.importance ?? 'medium';
        const difficulty: 'easy' | 'medium' | 'hard' =
          imp === 'high' ? 'hard' : imp === 'medium' ? 'medium' : 'easy';
        const defaultDur =
          imp === 'high' ? 60 : imp === 'medium' ? 30 : 15;
        // Defense-in-depth clamp (security audit §4): llmUntangle
        // already caps durations upstream, but this is the last stop
        // before the store — a bypassed/hostile value must not write
        // a 999999-minute task.
        const safeDur =
          p.durationMin != null && Number.isFinite(p.durationMin)
            ? Math.max(5, Math.min(600, Math.round(p.durationMin)))
            : defaultDur;
        // Time landing logic. If the LLM gave a clock time, anchor to
        // it. Else fall back to a window — defaulting to morning for
        // high importance, evening for low.
        if (p.at && /^\d{1,2}:\d{2}$/.test(p.at)) {
          const [hStr, mStr] = p.at.split(':');
          const h = parseInt(hStr, 10);
          const m = parseInt(mStr, 10);
          // Bounds-check the clock (security audit §4): the regex
          // alone admits "25:99", and a hostile/hallucinated model
          // response shouldn't be able to write an impossible time
          // into the store. Out of range → windowed fallback below.
          if (
            Number.isFinite(h) &&
            Number.isFinite(m) &&
            h >= 0 &&
            h <= 23 &&
            m >= 0 &&
            m <= 59
          ) {
            const minted = useQuestStore.getState().addQuest({
              title: p.title.trim(),
              difficulty,
              importance: imp,
              scheduledHour: h,
              scheduledMinute: m,
              durationMinutes: safeDur,
              ...(p.date ? { date: p.date } : { date: selectedDate }),
            });
            recordCreatedForUndo(minted.id);
            if (!createdId && (p.date ?? selectedDate) === todayKey()) {
              createdId = minted.id;
            }
            actionableCount += 1;
            applied += 1;
            continue;
          }
        }
        const win: WindowKey =
          p.window && p.window !== 'someday'
            ? (p.window as WindowKey)
            : imp === 'high'
              ? 'morning'
              : imp === 'low'
                ? 'evening'
                : 'midday';
        const createISO = p.date ?? selectedDate;
        const createRes = resolveFor(win, createISO, safeDur);
        const minted2 = useQuestStore.getState().addQuest({
          title: p.title.trim(),
          difficulty,
          importance: imp,
          window: win,
          durationMinutes: safeDur,
          ...(createRes != null && {
            scheduledHour: Math.floor(createRes.min / 60),
            scheduledMinute: createRes.min % 60,
          }),
          // Overflow may land it on a later day than asked — honor it.
          date: createRes?.dateISO ?? createISO,
        });
        recordCreatedForUndo(minted2.id);
        if (!createdId && (createRes?.dateISO ?? createISO) === todayKey()) {
          createdId = minted2.id;
        }
        actionableCount += 1;
        applied += 1;
        continue;
      }
      // #4 honesty: validate against the LIVE store, not the frozen
      // pile snapshot — a task deleted after the proposal rendered
      // must not count as an applied move.
      const q = useQuestStore.getState().quests.find(
        (x) => x.id === p.taskId,
      );
      if (!q) continue;
      if (seenIds.has(p.taskId)) continue;
      seenIds.add(p.taskId);
      snapshotForUndo(p.taskId);
      if (p.action === 'schedule') {
        if (!p.window || p.window === 'someday') continue;
        // ANCHOR SAFETY (audit): setDate/moveWindow wipe a fixed
        // clock time + its calendar mirror. A quest the user pinned
        // to 3pm must keep 3pm — only unanchored quests get the
        // cascade slot.
        const targetWin = p.window as WindowKey;
        const hadAnchor = q.scheduledHour != null;
        const hadH = q.scheduledHour ?? 0;
        const hadM = q.scheduledMinute ?? 0;
        const dateChanged = q.date !== selectedDate;
        const windowChanged = q.window !== targetWin;
        // Snapshot the REAL before-state so we can count only genuine
        // changes (audit): scheduling an anchored 3pm task into
        // "morning" un-anchors then re-anchors 3pm, which re-derives
        // the original window — a true no-op that used to inflate the
        // applied count and yank Home's hero to a task that didn't move.
        const before = {
          date: q.date,
          window: q.window,
          sh: q.scheduledHour ?? null,
          sm: q.scheduledMinute ?? null,
        };
        if (dateChanged) setDate(p.taskId, selectedDate);
        if (windowChanged || dateChanged) {
          moveWindow(p.taskId, targetWin);
        }
        if (hadAnchor) {
          anchor(p.taskId, hadH, hadM);
        } else {
          // Cascade with overflow: a real seat in the window, cram
          // later the same day if it's full, move to the next day
          // with room if the whole day is (parity with Home capture).
          const res = resolveFor(targetWin, selectedDate, q.durationMinutes ?? 30);
          if (res != null) {
            if (res.dateISO !== selectedDate) setDate(p.taskId, res.dateISO);
            anchor(p.taskId, Math.floor(res.min / 60), res.min % 60);
          }
        }
        // FINAL-vs-initial diff — count (and hand Home the hero) only
        // when something actually changed.
        const after = useQuestStore.getState().quests.find(
          (x) => x.id === p.taskId,
        );
        const reallyChanged =
          !!after &&
          (after.date !== before.date ||
            after.window !== before.window ||
            (after.scheduledHour ?? null) !== before.sh ||
            (after.scheduledMinute ?? null) !== before.sm);
        if (reallyChanged) {
          applied += 1;
          if (
            !scheduledId &&
            (after!.date ?? todayKey()) === todayKey()
          ) {
            scheduledId = p.taskId;
          }
          actionableCount += 1;
        }
      } else if (p.action === 'reschedule') {
        if (!p.date) continue;
        // Round-trip validation — the sanitizer regex admits
        // "2026-13-45", which setDate would write verbatim.
        if (localYmd(localDateFromISO(p.date)) !== p.date) continue;
        // No-op reschedule (same day, no new time) must not strip
        // the quest's anchor + calendar event via setDate.
        if (p.date === q.date && !p.at) continue;
        const rHadAnchor = q.scheduledHour != null;
        const rHadH = q.scheduledHour ?? 0;
        const rHadM = q.scheduledMinute ?? 0;
        if (p.date !== q.date) setDate(p.taskId, p.date);
        if (!p.at && rHadAnchor && p.date !== q.date) {
          // Moving days with a fixed time and no new time from the
          // LLM — carry the anchor across (setDate wiped it).
          anchor(p.taskId, rHadH, rHadM);
        }
        if (p.at) {
          const [hStr, mStr] = p.at.split(':');
          const h = parseInt(hStr, 10);
          const m = parseInt(mStr, 10);
          // Bounds like the create branch — "25:99" must not write
          // scheduledHour 25 into the store + calendar mirror.
          if (
            Number.isFinite(h) &&
            Number.isFinite(m) &&
            h >= 0 &&
            h <= 23 &&
            m >= 0 &&
            m <= 59
          ) {
            anchor(p.taskId, h, m);
          }
        }
        // A parked task pulled onto a real day must leave 'someday'
        // or it stays invisible in "Later" (moveBackToDate rule).
        if (q.window === 'someday') moveWindow(p.taskId, 'morning');
        applied += 1;
      } else if (p.action === 'defer') {
        // Deferring a task already parked in Later is a no-op — don't
        // count it toward "N sorted" (honest data).
        if (q.window !== 'someday') {
          moveWindow(p.taskId, 'someday');
          applied += 1;
        }
      } else if (p.action === 'surface') {
        // Surfacing must not strip a fixed clock time — setDate AND
        // moveWindow both wipe anchors + calendar mirrors, so the
        // original anchor is restored LAST (anchor() also re-derives
        // a coherent window from the time).
        const sBefore = {
          date: q.date,
          window: q.window,
          sh: q.scheduledHour ?? null,
          sm: q.scheduledMinute ?? null,
        };
        const sHadAnchor = q.scheduledHour != null;
        const sHadH = q.scheduledHour ?? 0;
        const sHadM = q.scheduledMinute ?? 0;
        const dateChanged = q.date !== selectedDate;
        if (dateChanged) setDate(p.taskId, selectedDate);
        if (p.window && p.window !== 'someday') {
          moveWindow(p.taskId, p.window as WindowKey);
        } else if (q.window === 'someday') {
          moveWindow(p.taskId, 'morning'); // lift out of Later
        }
        if (sHadAnchor) {
          anchor(p.taskId, sHadH, sHadM);
        }
        // FINAL-vs-initial diff — a same-window / same-day surface (or
        // an anchored task restored to its own time) is a no-op and
        // must not count or hijack Home's hero.
        const sAfter = useQuestStore.getState().quests.find(
          (x) => x.id === p.taskId,
        );
        const sChanged =
          !!sAfter &&
          (sAfter.date !== sBefore.date ||
            sAfter.window !== sBefore.window ||
            (sAfter.scheduledHour ?? null) !== sBefore.sh ||
            (sAfter.scheduledMinute ?? null) !== sBefore.sm);
        if (sChanged) {
          applied += 1;
          // Surface is the strongest "focus this" signal — first real
          // one wins Home's card (today only).
          if (!surfacedId && untanglingToday) surfacedId = p.taskId;
          actionableCount += 1;
        }
      }
    }
    // Hand Home the task Lumi steered onto. An explicit surface always
    // wins. Otherwise ONLY a single-action proposal singles out a
    // task — a multi-task re-plan (create three things, arrange the
    // day) shouldn't yank Home's card to whichever happened to be
    // first. All candidates are already gated to today above.
    const focusForHome =
      surfacedId ??
      (actionableCount === 1 ? (createdId ?? scheduledId) : null);
    if (focusForHome) {
      useHomeFocusStore.getState().setPick(focusForHome);
    }
    return applied;
  };

  // ── Push a Lumi message after a small "thinking" delay ──
  const pushLumi = (
    say: string,
    actions?: ChatMsg['actions'],
  ) => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setMsgs((m) =>
        [
          ...m,
          { id: `l-${Date.now()}`, from: 'lumi' as const, text: say, actions },
        ].slice(-100), // marathon vents must not grow unbounded
      );
    }, 650);
  };

  // ── One-tap move ──
  const doMove = (key: MoveDef['key']) => {
    if (activeForMove.length === 0) {
      const label = MOVES.find((mv) => mv.key === key)!.label;
      setMsgs((m) => [
        ...m,
        { id: `u-${Date.now()}`, from: 'user', text: label },
      ]);
      pushLumi(
        `Your plate's empty — nothing to ${key === 'plan' ? 'plan' : 'reorganize'} right now. Capture something on Home and I'll work it in.`,
      );
      return;
    }
    Haptics.selectionAsync();
    const res = runMove(key, activeForMove, selectedDate);
    if (!res) return;
    const moveLabel = MOVES.find((mv) => mv.key === key)!.label;
    setMsgs((m) => [
      ...m,
      { id: `u-${Date.now()}`, from: 'user', text: moveLabel },
    ]);
    setView(res.view);
    setHighlightIds(res.highlightIds ?? []);
    // Hand Home the top pick whenever a move singles one out — TODAY
    // only. This must run for "What matters?" too, which HIGHLIGHTS
    // its picks but has zero mutations; the handoff used to sit inside
    // the mutations>0 branch, so "matters" never actually reached Home.
    if (res.highlightIds && res.highlightIds[0] && selectedDate === todayKey()) {
      useHomeFocusStore.getState().setPick(res.highlightIds[0]);
    }
    if (res.mutations.length > 0) {
      // Apply BEFORE the reply lands (the old 700ms delay let a
      // second move interleave against the pre-mutation pile), and
      // hand the one-tap moves the same "Put it back" every other
      // path carries — they were the only irreversible surface.
      applyMutations(res.mutations);
      const tk = bankUndo();
      pushLumi(
        res.say,
        tk
          ? { approveLabel: 'Put it back', onApprove: () => putItBack(tk) }
          : undefined,
      );
    } else {
      pushLumi(res.say);
    }
  };

  // ── Deterministic fallback turn (offline / quota / LLM error).
  //    Keeps the focus/park "Arrange it" interaction working when
  //    the network or cap isn't available.
  //
  //    Previously we prefixed the reply with "I need a connection to
  //    talk this through…" which read as contradictory — Lumi
  //    SAID she couldn't help, then handed the user a fix right
  //    underneath. The deterministic path produces a perfectly
  //    serviceable response by design (focus/park clustering); it
  //    isn't a degraded apology, it's a real answer. So we just
  //    use it silently. The Untangle one-tap moves are also still
  //    visible underneath — the user has all the affordances they
  //    need without us narrating a "broken" state. ──
  const fallbackTurn = (t: string) => {
    const res = talkToLumi(t, activeForMove);
    const arrangeOnce = { done: false };
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      busyRef.current = false;
      setMsgs((m) => [
        ...m,
        {
          id: `l-${Date.now()}-${++msgSeqRef.current}`,
          from: 'lumi' as const,
          text: res.say,
          actions: {
            approveLabel: 'Arrange it',
            onApprove: () => {
              // Latch — same double-tap hazard the LLM path fixed:
              // a second tap re-applied against mutated state and
              // corrupted the undo snapshot.
              if (arrangeOnce.done) return;
              arrangeOnce.done = true;
              const today = selectedDate;
              const muts: QuestMutation[] = [];
              const slotsByIdx: WindowKey[] = [
                'morning',
                'midday',
                'afternoon',
                'evening',
              ];
              res.focusIds.forEach((id, i) => {
                muts.push({
                  id,
                  patch: {
                    date: today,
                    window: slotsByIdx[Math.min(i, slotsByIdx.length - 1)],
                  },
                });
              });
              for (const id of res.parkIds)
                muts.push({ id, patch: { window: 'someday' } });
              applyMutations(muts);
              const tk = bankUndo();
              // Hand Home the top focus task so its main card mirrors
              // what Lumi just arranged here — today only (Home's hero
              // is today; arranging a future day shouldn't touch it).
              if (res.focusIds[0] && selectedDate === todayKey()) {
                useHomeFocusStore.getState().setPick(res.focusIds[0]);
              }
              setView('plan');
              setMsgs((m2) =>
                m2.map((x) => (x.actions ? { ...x, actions: undefined } : x)),
              );
              // Honest confirmation — with an empty/settled pile the
              // old copy claimed "it's on your day now" for zero
              // actual changes.
              pushLumi(
                tk
                  ? `Done — spaced out so nothing piles up. Open the Time tab to see the new order. 💛`
                  : `Everything's already where it should be — nothing needed moving. 💛`,
                tk
                  ? {
                      approveLabel: 'Put it back',
                      onApprove: () => putItBack(tk),
                    }
                  : undefined,
              );
            },
            onAdjust: () => {
              setMsgs((m2) =>
                m2.map((x) => (x.actions ? { ...x, actions: undefined } : x)),
              );
              pushLumi(
                `No problem — tell me what to change. More on your plate, less, or a different order?`,
              );
            },
          },
        },
      ].slice(-100));
      setThread((th) => [...th, { role: 'assistant', content: res.say }]);
    }, 600);
  };

  // ── Conversational send (LLM-first, deterministic fallback) ──
  const send = (overrideText?: string) => {
    // One turn at a time — the guard must run BEFORE the user bubble
    // echoes, or the message renders in chat but never reaches the
    // thread (audit B1: visible words, no reply, silently eaten).
    // busyRef is the SYNCHRONOUS latch: two submits in one tick both
    // saw busy=false via state.
    if (busy || busyRef.current) return;
    busyRef.current = true;
    const t = (overrideText ?? text).trim();
    if (!t) {
      busyRef.current = false;
      return;
    }
    const gen = sendGenRef.current;
    Haptics.selectionAsync();
    const userMsgId = `u-${Date.now()}-${++msgSeqRef.current}`;
    setMsgs((m) =>
      [...m, { id: userMsgId, from: 'user' as const, text: t }].slice(-100),
    );
    setText('');
    if (active.length === 0) {
      // Day-1 first-conversation state. A vent must be MET, not
      // answered with capture instructions; and when the LLM is
      // reachable it handles an empty pile fine ("I forgot I have a
      // meeting at 8" → create). Only the offline non-vent case gets
      // the capture nudge — and every turn still joins the thread so
      // later turns keep context.
      const ventish =
        /\b(ugh+|tired|exhausted|overwhelm\w*|stress\w*|drowning|anxious|awful|terrible|crying|falling apart|hate (?:this|everything|myself)|can'?t (?:do this|even))\b/i.test(
          t,
        );
      if (!isAnthropicConfigured) {
        setThread((th) => [...th, { role: 'user', content: t }]);
        pushLumi(
          ventish
            ? `That sounds heavy — I'm here. You don't have to turn it into tasks. If any of it becomes a to-do later, capture it on Home and I'll carry it with you.`
            : `Your plate's empty right now — capture what's weighing on you from Home and I'll cluster it.`,
        );
        // Release the send latch — this early return used to leave
        // busyRef stuck true, silently eating every later send for the
        // rest of the session.
        busyRef.current = false;
        return;
      }
      // fall through to the LLM with the empty pile
    }

    // Append the user turn to the LLM thread and call.
    const nextThread: UntangleThreadMsg[] = [
      ...thread,
      { role: 'user', content: t },
    ];
    setThread(nextThread);
    setBusy(true);
    const ctx = buildLlmContext();
    llmUntangle(nextThread, ctx)
      .then((res) => {
        busyRef.current = false;
        if (gen !== sendGenRef.current) return; // reset() happened
        if (!res) {
          setBusy(false);
          fallbackTurn(t);
          return;
        }
        setBusy(false);
        // Persist Lumi's reply to the thread so the next turn has it.
        setThread((th) => [...th, { role: 'assistant', content: res.say }]);
        const llmMsgId = `l-${Date.now()}-${++msgSeqRef.current}`;
        setMsgs((m) => [
          ...m.slice(-99),
          {
            id: llmMsgId,
            from: 'lumi',
            text: res.say,
            ...(res.proactive ? { proactive: res.proactive } : {}),
            ...(res.proposal.length > 0
              ? (() => {
                  // Latch: a fast double-tap on Approve ran
                  // applyProposal twice against the same items
                  // (finding #1) — the card dismissal is async.
                  let approvedOnce = false;
                  return {
                  proposal: {
                    items: res.proposal,
                    onApprove: () => {
                      if (approvedOnce) return;
                      approvedOnce = true;
                      const applied = applyProposal(res.proposal);
                      const tk = bankUndo();
                      // Tell the MODEL the proposal landed — without
                      // this, "undo that" next turn confused it.
                      setThread((th) => [
                        ...th,
                        {
                          role: 'user' as const,
                          content: `[system: user approved — ${applied} change${applied === 1 ? '' : 's'} applied]`,
                        },
                      ]);
                      // Dismiss the card on this message.
                      setMsgs((m2) =>
                        m2.map((x) =>
                          x.id === llmMsgId
                            ? { ...x, proposal: undefined }
                            : x,
                        ),
                      );
                      setView('plan');
                      pushLumi(
                        applied > 0
                          ? `Done — ${applied} sorted into your day. Open the Time tab to see the new order. 💛`
                          : `Everything's already where it should be — nothing needed moving. 💛`,
                        applied > 0 && tk
                          ? {
                              approveLabel: 'Put it back',
                              onApprove: () => putItBack(tk),
                            }
                          : undefined,
                      );
                    },
                    onAdjust: () => {
                      setMsgs((m2) =>
                        m2.map((x) =>
                          x.id === llmMsgId
                            ? { ...x, proposal: undefined }
                            : x,
                        ),
                      );
                      pushLumi(
                        `No problem — tell me what to change. Different order, different times, or pull something off?`,
                      );
                    },
                  },
                };
                })()
              : {}),
          },
        ]);
      })
      .catch(() => {
        busyRef.current = false;
        if (gen !== sendGenRef.current) return; // reset() happened
        setBusy(false);
        fallbackTurn(t);
      });
  };

  const reset = () => {
    Haptics.selectionAsync();
    // Fence any in-flight turn: its reply must not land in the fresh
    // conversation (and busy must not stay stuck under "Fresh start").
    sendGenRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setView('pile');
    setHighlightIds([]);
    setThread([]);
    setMsgs([
      {
        id: 'init',
        from: 'lumi',
        text: "Fresh start. Whatever's on your plate is here — untangle it however feels right.",
      },
    ]);
  };

  // ── Auto-scroll chat ──
  useEffect(() => {
    const id = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      80,
    );
    return () => clearTimeout(id);
  }, [msgs.length, busy]);

  // ── Luna's expression in this chat ──
  //
  //  Untangle is a calm conversational surface — the user is
  //  venting / sorting and Luna is listening. Reflecting their
  //  tone back at them (sad face when they vent, happy when they
  //  win) makes the cat feel performative and breaks the "I'm
  //  here, not reacting" presence we want. Pin to 'idle': Luna
  //  is steady while the user does the talking.
  // Mood the assistant avatar shows = tone of the most recent user
  // message, falling back to idle. This is the sanctioned "sad WITH
  // the user" channel (emotional-model spec §1): "i'm so overwhelmed"
  // → Luna's bubbles + typing dots go sad — she's sitting beside
  // them, never reacting AT them. (Was hardcoded 'idle' — the cat
  // never visibly empathized, which defeated the whole moment.)
  const chatMood: LunaMood = useMemo(() => {
    const lastUser = [...msgs].reverse().find((m) => m.from === 'user');
    if (!lastUser) return 'idle';
    return inferMoodFromText(lastUser.text) ?? 'idle';
  }, [msgs]);

  // Keyboard-aware input clearance — see the inputWrap override below.
  const keyboardHeight = useKeyboardHeight();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Soft dusk radial glow — Lumi's space. SVG radial gradient
            (not a flat-colored rounded View — that read as a hard
            circle on device). Fades out to transparent. */}
        <View pointerEvents="none" style={styles.ambientGlowWrap}>
          <Svg height="100%" width="100%" preserveAspectRatio="none">
            <Defs>
              <RadialGradient
                id="duskGlow"
                cx="50%"
                cy="0%"
                r="80%"
              >
                <Stop offset="0" stopColor={C.dusk} stopOpacity="0.18" />
                <Stop
                  offset="0.55"
                  stopColor={C.dusk}
                  stopOpacity="0"
                />
              </RadialGradient>
            </Defs>
            <Rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="url(#duskGlow)"
            />
          </Svg>
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>Untangle</Text>
            <Text style={styles.subtitle}>
              Feeling the pile? Let&apos;s sort it out together.
            </Text>
          </View>
          <Pressable
            onPress={reset}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Start a fresh conversation"
          >
            <Text style={styles.resetLink}>reset</Text>
          </Pressable>
        </View>

        {/* Day picker — default today; auto-jumps to next day-with-tasks
            on first mount when today is empty. */}
        <View style={styles.dayNav}>
          <Pressable
            onPress={() => shiftDay(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            style={styles.dayArrow}
            hitSlop={8}
          >
            <Text style={styles.dayArrowGlyph}>‹</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.dayLabel}>{dayLabel}</Text>
          </View>
          <Pressable
            onPress={() => shiftDay(1)}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            style={styles.dayArrow}
            hitSlop={8}
          >
            <Text style={styles.dayArrowGlyph}>›</Text>
          </Pressable>
          {!isToday && (
            <Pressable
              onPress={jumpToToday}
              style={[styles.todayBtn, { borderColor: hexA(accent.fg, 0.4) }]}
              hitSlop={4}
            >
              <Text style={[styles.todayBtnText, { color: accent.fg }]}>
                Today
              </Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ─── The pile — only the selected day's open tasks ─── */}
          {todayList.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Nothing on the plate for {dayLabel.toLowerCase()}.
              </Text>
              <Text style={styles.emptyBody}>
                Use the arrows to look at another day, or capture something on
                Home and Lumi will work it in.
              </Text>
            </View>
          ) : (
            <View style={{ marginBottom: 18 }}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: accent.fg }]}>
                  {view === 'plan'
                    ? `Your order for ${dayLabel.toLowerCase()}`
                    : `For ${dayLabel.toLowerCase()}`}
                </Text>
                <Text style={styles.sectionCount}>· {todayList.length}</Text>
                {view === 'focus' && highlightIds.length > 0 && (
                  <Text style={styles.dimmedHint}>
                    dimmed ones can wait
                  </Text>
                )}
              </View>
              <View style={{ gap: 7 }}>
                {todayList.map((q) => (
                  <TaskChip
                    key={q.id}
                    quest={q}
                    showSlot={view === 'plan'}
                    highlighted={highlightIds.includes(q.id)}
                    dimmed={
                      view === 'focus' &&
                      highlightIds.length > 0 &&
                      !highlightIds.includes(q.id)
                    }
                  />
                ))}
              </View>
            </View>
          )}

          {/* ─── Later (someday) — collapsible, with per-row move-
              back-to-date picker so the user can pull tasks BACK
              out of Someday whenever they're ready. ──────────── */}
          {laterList.length > 0 && (
            <View style={styles.laterSection}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setLaterOpen((o) => !o);
                }}
                style={styles.laterHeader}
                hitSlop={4}
              >
                <Text style={styles.laterEyebrow}>Later</Text>
                <Text style={styles.laterCountInline}>
                  · {laterList.length}
                </Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.laterChev}>{laterOpen ? '▾' : '▸'}</Text>
              </Pressable>
              {laterOpen && (
                <View style={{ gap: 7, marginTop: 6 }}>
                  {laterList.map((q) => {
                    const tier = IMPORTANCE[q.importance];
                    return (
                      <View key={q.id} style={styles.chip}>
                        <Text
                          style={[styles.chipSigil, { color: tier.color }]}
                        >
                          {tier.sigil}
                        </Text>
                        <Text style={styles.chipTitle} numberOfLines={1}>
                          {q.title}
                        </Text>
                        <Pressable
                          onPress={() => {
                            Haptics.selectionAsync();
                            setMovingBack(q);
                          }}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel="Move back to a real day"
                          style={styles.moveBackBtn}
                        >
                          <Text style={styles.moveBackGlyph}>↺</Text>
                        </Pressable>
                        <ChipDeleteBtn id={q.id} title={q.title} />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* ─── One-tap moves ─── */}
          <View style={styles.movesGrid}>
            {MOVES.map((mv) => (
              <Pressable
                key={mv.key}
                onPress={() => doMove(mv.key)}
                disabled={busy}
                style={[
                  styles.moveBtn,
                  busy && { opacity: 0.5 },
                ]}
              >
                <View style={styles.moveHead}>
                  <Text style={styles.moveGlyph}>{mv.glyph}</Text>
                  <Text style={styles.moveLabel}>{mv.label}</Text>
                </View>
                <Text style={styles.moveSub}>{mv.sub}</Text>
              </Pressable>
            ))}
          </View>

          {/* ─── "talk it through" divider ─── */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>talk it through</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ─── Conversation ─── */}
          {/*
           * Mood the assistant avatar shows = tone of the most recent
           * user message, falling back to ambient. So when the user
           * vents ("ugh, exhausted"), Luna's expression goes 'sad'
           * across every bubble in the thread; on a win ("finally
           * done!") she's happy. Memoized so the regex only runs on
           * thread change, not on every keystroke.
           */}
          <View style={{ gap: 14, marginBottom: 8 }}>
            {msgs.map((m) => (
              <Bubble
                key={m.id}
                msg={m}
                pileById={pileById}
                accent={accent}
                lunaMood={chatMood}
              />
            ))}
            {busy && <TypingDots mood={chatMood} />}
          </View>
          <View style={{ height: 6 }} />
        </ScrollView>

        {/* ─── Input (ember) ─── */}
        {/* While the keyboard is up, the floating nav is buried under
            it — so the input drops its nav clearance and sits snug on
            the keyboard instead of floating ~100px above it (the
            KeyboardAvoidingView already adds the keyboard's height). */}
        <View
          style={[
            styles.inputWrap,
            keyboardHeight > 0 && { paddingBottom: 14 },
          ]}
        >
          <View
            style={[
              styles.inputBar,
              {
                borderColor:
                  voice.state === 'recording' ? accent.fg : C.hair,
              },
            ]}
          >
            <TextInput
              value={
                voice.state === 'recording' && voice.partial
                  ? voice.partial
                  : text
              }
              onChangeText={setText}
              placeholder={
                voice.state === 'recording'
                  ? 'listening…'
                  : voice.state === 'transcribing'
                    ? 'sorting that out…'
                    : "Tell me what you're juggling…"
              }
              placeholderTextColor={C.mute}
              style={styles.input}
              editable={voice.state !== 'transcribing'}
              // Grows with the text up to 5 lines (maxHeight caps it,
              // then it scrolls internally) — a long vent no longer
              // hides its own start behind a single-line window. Send
              // is the ↑ button; return adds a line, which is what a
              // multi-thought brain-dump wants.
              multiline
              scrollEnabled
            />
            {!text.trim() ? (
              <Pressable
                onPress={handleMic}
                accessibilityRole="button"
                accessibilityLabel={
                  voice.state === 'recording'
                    ? 'Stop recording'
                    : 'Speak to Lumi'
                }
                style={[
                  styles.micBtn,
                  {
                    backgroundColor:
                      voice.state === 'recording'
                        ? accent.fg
                        : hexA(accent.fg, 0.14),
                    borderColor:
                      voice.state === 'recording'
                        ? accent.fg
                        : hexA(accent.fg, 0.4),
                  },
                ]}
              >
                <MicIcon
                  size={17}
                  color={voice.state === 'recording' ? C.void : accent.fg}
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => send()}
                accessibilityRole="button"
                accessibilityLabel="Send"
                style={[styles.sendBtn, { backgroundColor: accent.fg }]}
              >
                <Text style={styles.sendGlyph}>↑</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <MoveBackToDateSheet
        visible={movingBack != null}
        onClose={() => setMovingBack(null)}
        taskTitle={movingBack?.title ?? ''}
        onPick={(iso) => movingBack && moveBackToDate(movingBack, iso)}
      />
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Helpers + Styles
// ═════════════════════════════════════════════════════════════════════

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },

  // SVG container for the ambient dusk glow. Sized to a wide band at
  // the top of the screen; the gradient inside handles the actual fade.
  ambientGlowWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    zIndex: 0,
  },

  // ── Header ──
  header: {
    paddingLeft: 22,
    // Reserve room for the floating ProfileIcon (38px wide,
    // sits at right:20). 66 = 38 + 20 (right offset) + ~8 (gap).
    paddingRight: 66,
    paddingTop: 14,
    paddingBottom: 14,
    // Floor: 52px so the icon's footprint always fits inside the
    // header and never overhangs into the next element.
    minHeight: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 30,
    color: C.bone,
    letterSpacing: -0.7,
    lineHeight: 36,
    paddingRight: 6, // Fraunces italic overhang
  },
  subtitle: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    marginTop: 7,
    letterSpacing: -0.1,
  },
  resetLink: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11,
    color: C.mute,
    paddingTop: 6,
  },

  // ── Day nav ──
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingBottom: 12,
  },
  dayArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayArrowGlyph: {
    fontFamily: fonts.inter,
    fontSize: 17,
    color: C.boneDim,
    lineHeight: 20,
  },
  dayLabel: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 17,
    color: C.bone,
    letterSpacing: -0.3,
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

  // ── Pile sections ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 9,
  },
  sectionLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  sectionLabelPlate: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.boneDim,
  },
  sectionCount: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  dimmedHint: {
    marginLeft: 'auto',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 10.5,
    color: C.dusk,
  },

  // ── TaskChip ──
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipSigil: {
    fontFamily: fonts.inter,
    fontSize: 8,
    letterSpacing: -1,
    width: 22,
  },
  chipTitle: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.bone,
    letterSpacing: -0.1,
  },
  chipSlot: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 10.5,
    color: C.dusk,
  },
  chipTag: {
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipTagText: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 0.3,
    color: C.mute,
    textTransform: 'uppercase',
  },
  chipDeleteBtn: {
    marginLeft: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(176,163,139,0.22)',
  },
  chipDeleteGlyph: {
    color: C.mute,
    fontSize: 13,
    lineHeight: 15,
    marginTop: -1,
  },

  // ── "Later" footer pill ──
  // ── Later (someday) collapsible section ──
  laterSection: {
    marginBottom: 18,
  },
  laterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  laterEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.boneDim,
  },
  laterCountInline: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  laterChev: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.mute,
  },
  // Move-back icon button — sized to match the chip delete × so
  // long task titles get the row width they deserve.
  moveBackBtn: {
    marginLeft: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(176,163,139,0.22)',
  },
  moveBackGlyph: {
    color: C.boneDim,
    fontSize: 13,
    lineHeight: 15,
    marginTop: -1,
  },

  laterPill: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: hexA(C.void2, 0.6),
  },
  laterGlyph: {
    fontSize: 13,
    color: C.lichen,
  },
  laterText: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
  },
  laterCount: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 16,
    color: C.boneDim,
  },

  // ── Empty state ──
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: C.void2,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 18,
  },
  emptyTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 18,
    color: C.bone,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.boneDim,
    lineHeight: 18,
  },

  // ── Moves grid ──
  movesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22,
  },
  moveBtn: {
    width: '48%',
    backgroundColor: hexA(C.dusk, 0.07),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.3),
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  moveHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  moveGlyph: { fontSize: 14, color: C.dusk },
  moveLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
    color: C.bone,
    letterSpacing: -0.15,
  },
  moveSub: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
    lineHeight: 16,
  },

  // ── Divider ──
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.hair },
  dividerLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.mute,
  },

  // ── Chat ──
  userBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '82%',
    borderWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  userBubbleText: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.bone,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  lumiRow: {
    flexDirection: 'row',
    gap: 10,
  },
  lumiAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: hexA(C.dusk, 0.14),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  lumiBubble: {
    backgroundColor: hexA(C.dusk, 0.1),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.28),
    borderTopLeftRadius: 5,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  lumiBubbleText: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.bone,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  lumiActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 13,
  },
  approveBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approveBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    color: C.void,
  },
  adjustBtn: {
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.5),
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  adjustBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    color: C.dusk,
  },

  // ── ProposalCard — LLM's "Here's what I'd do" pre-approval list,
  //    rendered INSIDE the Lumi bubble under the reply text. Subtle
  //    inner card with hairline border + the list of moves + the
  //    Approve/Adjust row reusing the existing buttons. ──
  proposalCard: {
    marginTop: 12,
    paddingTop: 10,
    paddingHorizontal: 0,
    borderTopWidth: 1,
    borderTopColor: hexA(C.dusk, 0.22),
  },
  proposalLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: C.dusk,
  },
  proposalRow: {
    flexDirection: 'row',
    gap: 6,
  },
  proposalBullet: {
    color: C.dusk,
    fontFamily: fonts.inter,
    fontSize: 13,
    width: 8,
    textAlign: 'center',
  },
  proposalText: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.bone,
    lineHeight: 19,
    letterSpacing: -0.1,
  },
  proposalWhy: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11.5,
    color: C.boneDim,
    marginTop: 1,
  },
  proactiveLine: {
    marginTop: 6,
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12,
    color: C.dusk,
    paddingHorizontal: 4,
  },

  typingBubble: {
    backgroundColor: hexA(C.dusk, 0.1),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.28),
    borderTopLeftRadius: 5,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.dusk,
  },

  // ── Input ──
  inputWrap: {
    paddingHorizontal: 18,
    paddingTop: 12,
    // Bottom padding includes clearance for the floating glass nav
    // so the chat input bar (mic + send + textfield) doesn't sit
    // underneath the pill. Without this the input is unreachable.
    paddingBottom: 14 + FLOATING_NAV_CLEARANCE,
    borderTopWidth: 1,
    borderTopColor: C.hair,
    backgroundColor: C.void,
  },
  inputBar: {
    flexDirection: 'row',
    // Buttons hug the BOTTOM as the field grows — centering them
    // floated the mic/send to the middle of a tall multi-line input.
    alignItems: 'flex-end',
    gap: 9,
    backgroundColor: C.void2,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingLeft: 16,
    paddingRight: 7,
    paddingVertical: 7,
  },
  input: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 14.5,
    lineHeight: 20,
    color: C.bone,
    letterSpacing: -0.1,
    // paddingY 9 + one 20px line = 38 → matches the 38px mic/send
    // buttons on a single line. maxHeight caps growth at 5 lines
    // (5×20 + 18 padding); past that the field scrolls internally.
    paddingTop: 9,
    paddingBottom: 9,
    maxHeight: 5 * 20 + 18,
  },
  micBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micGlyph: {
    fontSize: 17,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    fontSize: 18,
    color: C.void,
    fontFamily: fonts.interSemi,
  },
});

// (accentFor is imported for parity with sibling tab files.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _accentFor = accentFor;
