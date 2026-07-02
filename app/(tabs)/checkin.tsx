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

import {
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
  type WindowKey,
} from '../../constants/windows';
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
import { MicIcon } from '../../components/MicIcon';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';
import {
  useCorrectionsStore,
  summarizeCorrections,
} from '../../store/correctionsStore';
import { useLearningDigest } from '../../lib/learning';
import {
  llmUntangle,
  type UntangleContext,
  type UntanglePileItem,
  type UntangleProposalItem,
  type UntangleThreadMsg,
} from '../../lib/anthropic';

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
      say: `Breathe. Nothing here is on fire. I've set ${park.length} aside for later — they'll keep, I promise. ${keep.length === 0 ? '' : 'These ' + keep.length + ' are all today needs to be.'}`,
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
        ? `Here's an order that flows with your day: start "${lead.title}" first while you're sharp, batch the middle ones after lunch, and let the small stuff fill the gaps. Nothing stacked on top of itself.`
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
    tired: /\b(tired|exhausted|wiped|drained|low energy|can'?t focus|no energy|burnt out|wrecked|fried|done)\b/.test(lc),
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
  const tag = quest.date && quest.date < today
    ? 'overdue'
    : quest.date === today && !onToday
      ? 'due'
      : '';
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
            tag === 'overdue' && { borderColor: hexA(C.ember, 0.4) },
          ]}
        >
          <Text
            style={[
              styles.chipTagText,
              tag === 'overdue' && { color: C.ember },
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
    onAdjust: () => void;
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
  const valid = items.filter((p) => pileById.has(p.taskId));
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
          style={[styles.approveBtn, { backgroundColor: accent.fg }]}
        >
          <Text style={styles.approveBtnText}>Approve</Text>
        </Pressable>
        <Pressable onPress={onAdjust} style={styles.adjustBtn}>
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
  return (
    <View style={styles.lumiRow}>
      <View style={styles.lumiAvatar}>
        <LunaMark size={24} mood={lunaMood} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.lumiBubble}>
          <Text style={styles.lumiBubbleText}>{msg.text}</Text>
          {msg.actions && (
            <View style={styles.lumiActions}>
              <Pressable
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
              <Pressable
                onPress={msg.actions.onAdjust}
                style={styles.adjustBtn}
              >
                <Text style={styles.adjustBtnText}>Adjust</Text>
              </Pressable>
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
  return (
    <View style={styles.lumiRow}>
      <View style={styles.lumiAvatar}>
        <LunaMark size={24} mood={mood} />
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

  // User profile bits the LLM needs as context (sharp/foggy windows,
  // anchors, top struggles).
  const sharpWindow = useUserStore((s) => s.sharpWindow);
  const foggyWindow = useUserStore((s) => s.foggyWindow);
  const anchors = useUserStore((s) => s.anchors);
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
  useEffect(() => {
    if (didAutoJump.current) return;
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
  }, [active]);

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
    // Always undo someday → put it in a real part-of-day. Morning
    // is the safest default; the user can drag it from Time later.
    moveWindow(q.id, 'morning');
  };
  const shiftDay = (delta: number) => {
    Haptics.selectionAsync();
    setSelectedDate((d) => offsetKey(d, delta));
  };
  const jumpToToday = () => {
    Haptics.selectionAsync();
    setSelectedDate(todayKey());
  };

  // ── Chat state ──
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

  // Voice
  const voice = useVoice();
  useEffect(() => {
    if (voice.error) {
      setMsgs((m) => [
        ...m,
        { id: `err-${Date.now()}`, from: 'lumi', text: voice.error! },
      ]);
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
  const applyMutations = (muts: QuestMutation[]) => {
    for (const m of muts) {
      if (m.patch.date != null) setDate(m.id, m.patch.date);
      if (m.patch.window != null) moveWindow(m.id, m.patch.window);
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
    const laterItems: UntanglePileItem[] = active
      .filter((q) => q.window === 'someday')
      .slice(0, PILE_LIMITS.later)
      .map((q) => toPileItem(q, 'later'));
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
    };
  };

  // Apply a proposal returned by the LLM. Each item is re-validated
  // against the LIVE pile (the model may have stale ids) — invalid
  // items are silently dropped. 'create' items don't reference an
  // existing pile id; they mint a NEW task via addQuest instead.
  // Returns the count actually applied.
  const applyProposal = (items: UntangleProposalItem[]): number => {
    let applied = 0;
    for (const p of items) {
      // 'create' is the only action that doesn't need a pile lookup —
      // it mints a brand-new task from the LLM's title + metadata.
      if (p.action === 'create') {
        if (!p.title || p.title.trim().length === 0) continue;
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
            useQuestStore.getState().addQuest({
              title: p.title.trim(),
              difficulty,
              importance: imp,
              scheduledHour: h,
              scheduledMinute: m,
              durationMinutes: safeDur,
              ...(p.date ? { date: p.date } : { date: selectedDate }),
            });
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
        useQuestStore.getState().addQuest({
          title: p.title.trim(),
          difficulty,
          importance: imp,
          window: win,
          durationMinutes: safeDur,
          ...(p.date ? { date: p.date } : { date: selectedDate }),
        });
        applied += 1;
        continue;
      }
      const q = pileById.get(p.taskId);
      if (!q) continue;
      if (p.action === 'schedule') {
        if (!p.window || p.window === 'someday') continue;
        // Schedule onto the selected day if it's not already there.
        if (q.date !== selectedDate) setDate(p.taskId, selectedDate);
        moveWindow(p.taskId, p.window as WindowKey);
        applied += 1;
      } else if (p.action === 'reschedule') {
        if (!p.date) continue;
        setDate(p.taskId, p.date);
        if (p.at) {
          const [hStr, mStr] = p.at.split(':');
          const h = parseInt(hStr, 10);
          const m = parseInt(mStr, 10);
          if (Number.isFinite(h) && Number.isFinite(m)) {
            anchor(p.taskId, h, m);
          }
        }
        applied += 1;
      } else if (p.action === 'defer') {
        moveWindow(p.taskId, 'someday');
        applied += 1;
      } else if (p.action === 'surface') {
        setDate(p.taskId, selectedDate);
        if (p.window && p.window !== 'someday') {
          moveWindow(p.taskId, p.window as WindowKey);
        }
        applied += 1;
      }
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
      setMsgs((m) => [
        ...m,
        { id: `l-${Date.now()}`, from: 'lumi', text: say, actions },
      ]);
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
    pushLumi(res.say);
    if (res.mutations.length > 0) {
      // Apply after the reply lands so the user reads what changed.
      setTimeout(() => applyMutations(res.mutations), 700);
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
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setMsgs((m) => [
        ...m,
        {
          id: `l-${Date.now()}`,
          from: 'lumi',
          text: res.say,
          actions: {
            approveLabel: 'Arrange it',
            onApprove: () => {
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
              setView('plan');
              setMsgs((m2) =>
                m2.map((x) => (x.actions ? { ...x, actions: undefined } : x)),
              );
              pushLumi(
                `Done — it's on your day now, spaced out so nothing piles up. You can see it on Home and Time too.`,
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
      ]);
      setThread((th) => [...th, { role: 'assistant', content: res.say }]);
    }, 600);
  };

  // ── Conversational send (LLM-first, deterministic fallback) ──
  const send = (overrideText?: string) => {
    const t = (overrideText ?? text).trim();
    if (!t) return;
    Haptics.selectionAsync();
    const userMsgId = `u-${Date.now()}`;
    setMsgs((m) => [...m, { id: userMsgId, from: 'user', text: t }]);
    setText('');
    if (active.length === 0) {
      pushLumi(
        `Your plate's empty right now — capture what's weighing on you from Home and I'll cluster it.`,
      );
      return;
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
        if (!res) {
          setBusy(false);
          fallbackTurn(t);
          return;
        }
        setBusy(false);
        // Persist Lumi's reply to the thread so the next turn has it.
        setThread((th) => [...th, { role: 'assistant', content: res.say }]);
        const llmMsgId = `l-${Date.now()}`;
        setMsgs((m) => [
          ...m,
          {
            id: llmMsgId,
            from: 'lumi',
            text: res.say,
            ...(res.proactive ? { proactive: res.proactive } : {}),
            ...(res.proposal.length > 0
              ? {
                  proposal: {
                    items: res.proposal,
                    onApprove: () => {
                      const applied = applyProposal(res.proposal);
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
                          ? `Done. ${applied} move${applied === 1 ? '' : 's'} applied — you can see it on Home and Time too.`
                          : `Hmm — those tasks moved or finished before I could apply. Have a fresh look and tell me what you'd like.`,
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
                }
              : {}),
          },
        ]);
      })
      .catch(() => {
        setBusy(false);
        fallbackTurn(t);
      });
  };

  const reset = () => {
    Haptics.selectionAsync();
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
  const chatMood: LunaMood = 'idle';

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
          <Pressable onPress={reset} hitSlop={10}>
            <Text style={styles.resetLink}>reset</Text>
          </Pressable>
        </View>

        {/* Day picker — default today; auto-jumps to next day-with-tasks
            on first mount when today is empty. */}
        <View style={styles.dayNav}>
          <Pressable
            onPress={() => shiftDay(-1)}
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
        <View style={styles.inputWrap}>
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
              value={text}
              onChangeText={setText}
              onSubmitEditing={() => send()}
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
              returnKeyType="send"
            />
            {!text.trim() ? (
              <Pressable
                onPress={handleMic}
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
    lineHeight: 32,
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
    alignItems: 'center',
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
    color: C.bone,
    letterSpacing: -0.1,
    paddingVertical: 4,
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
