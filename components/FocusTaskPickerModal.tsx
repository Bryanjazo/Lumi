// FocusTaskPickerModal — bottom-sheet launcher for focus sessions on
// tasks OTHER than the currently-surfaced hero.
//
// Opens from the LumiFocusCard's "Focus on another task →" link. Two
// bodies inside the sheet:
//
//   1) Task list — a scrollable rundown of today's incomplete quests,
//      each row tappable to start a focus session on that quest.
//      Rows show the same tier + window + duration meta the hero card
//      does, so the picker feels like a peer of the suggestion card.
//
//   2) Focus card — once a session starts (either from this modal OR
//      from anywhere else), the body swaps to a full LumiFocusCard
//      bound to that quest. This means opening the modal WHILE a
//      session is already running immediately shows the timer, which
//      is what a user expects — "let me see my focus timer" is a
//      natural read of the picker.
//
// Closing the sheet does NOT cancel the running session — the Dynamic
// Island pill keeps ticking; the session stays authoritative until the
// user hits × / Finish / marks-done. Reopening the sheet brings the
// timer back.

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import { useFocusSession } from '../lib/focusSession';
import { LumiFocusCard } from './LumiFocusCard';
import type { Quest } from '../store/questStore';

// ── Palette (kept local so this file is self-contained) ──
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#211A15',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
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
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

// Reuse the same window / tier lookups Home has, but keep them local
// so this component doesn't depend on Home's IMPORTANCE / WINDOWS
// consts (which live inline in the tab file). Small maps — cheap.
const WINDOW_META: Record<
  string,
  { label: string; glyph: string; color: string }
> = {
  morning: { label: 'Morning', glyph: '◐', color: C.honey },
  afternoon: { label: 'Afternoon', glyph: '☀', color: C.ember },
  evening: { label: 'Evening', glyph: '◑', color: C.dusk },
  someday: { label: 'Someday', glyph: '◌', color: C.mute },
};

const IMPORTANCE_META: Record<
  string,
  { label: string; sigil: string; color: string }
> = {
  key: { label: 'Key', sigil: '◆◆◆', color: C.ember },
  focus: { label: 'Focus', sigil: '◆◆', color: C.honey },
  gentle: { label: 'Gentle', sigil: '◆', color: C.boneDim },
};

// ── Props ─────────────────────────────────────────────────────────────
export interface FocusTaskPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Incomplete quests eligible to focus on today. Home passes
   *  todayQuests.filter(q => !q.completed); we render them as-is. */
  quests: Quest[];
  petName: string;
  ambientMood: string;
  /** Called when the LumiFocusCard's Mark it done fires. Home wires
   *  this to its completeQuest handler (same as the hero card). */
  onCompleteQuest: (q: Quest) => void;
  /** Fires a grooming beat on the nook cat when a session starts. */
  onFocusStart?: () => void;
}

// ═════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════
export function FocusTaskPickerModal({
  visible,
  onClose,
  quests,
  petName,
  ambientMood,
  onCompleteQuest,
  onFocusStart,
}: FocusTaskPickerModalProps) {
  const currentFocus = useFocusSession((s) => s.current);

  // If there's a running session and its quest is in our list, we
  // render the LumiFocusCard for it (the timer, not the picker).
  // Otherwise, we render the picker.
  const focusedQuest = useMemo<Quest | null>(() => {
    if (!currentFocus) return null;
    return quests.find((q) => q.id === currentFocus.questId) ?? null;
  }, [currentFocus, quests]);

  // When the user taps a quest to start a session, we cache which
  // quest they picked so the LumiFocusCard has something to render
  // in the fraction of a moment BEFORE currentFocus is populated by
  // the store. Cleared when the modal is dismissed or when the
  // session's own questId matches.
  const [pickedQuest, setPickedQuest] = useState<Quest | null>(null);
  useEffect(() => {
    if (!visible) setPickedQuest(null);
  }, [visible]);
  const activeQuest = focusedQuest ?? pickedQuest;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          <View style={styles.handle} />

          {/* Sheet header */}
          <View style={styles.header}>
            <Text style={styles.headerGlyph}>✦</Text>
            <Text style={styles.headerLabel}>
              {activeQuest ? 'In focus' : 'Focus on'}
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={6}>
              <Text style={styles.closeGlyph}>×</Text>
            </Pressable>
          </View>

          {activeQuest ? (
            // ── Focus card body ──
            // Once a session is bound to a quest, swap the picker
            // out for the same LumiFocusCard the hero uses — the
            // user gets the identical ring + pause/resume/finish
            // affordance. onOpenPicker is intentionally omitted; you
            // can't open the picker from inside the picker.
            <View style={styles.focusCardMount}>
              <LumiFocusCard
                quest={activeQuest}
                petName={petName}
                ambientMood={ambientMood}
                xpReward={activeQuest.xpReward}
                onMarkItDone={() => {
                  onCompleteQuest(activeQuest);
                  // Close the sheet after the user marks it done —
                  // the celebration lives on Home, not in the modal.
                  onClose();
                }}
                onFocusStart={onFocusStart}
                headerRight={null}
              />
            </View>
          ) : (
            // ── Picker body ──
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {quests.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>
                    Nothing left on the day.
                  </Text>
                  <Text style={styles.emptyBody}>
                    You cleared it. Save focus for tomorrow.
                  </Text>
                </View>
              ) : (
                quests.map((q) => (
                  <PickerRow
                    key={q.id}
                    quest={q}
                    onPick={() => {
                      Haptics.selectionAsync();
                      setPickedQuest(q);
                    }}
                  />
                ))
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ── Picker row ────────────────────────────────────────────────────────
// One tappable row per quest. Left column: title + tier/window meta.
// Right column: default duration (what the focus session will use if
// the user taps this row directly). Tapping the row picks the quest;
// the LumiFocusCard's own picker inside the modal body then lets the
// user tweak the duration before hitting Start.
function PickerRow({
  quest,
  onPick,
}: {
  quest: Quest;
  onPick: () => void;
}) {
  const win = WINDOW_META[quest.window] ?? WINDOW_META.someday;
  const tier = IMPORTANCE_META[quest.importance] ?? IMPORTANCE_META.gentle;
  const defaultMins =
    quest.durationMinutes ?? (quest.scheduledHour != null ? 45 : 25);

  return (
    <Pressable
      onPress={onPick}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: hexA(C.bone, 0.04) },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {quest.title}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={[styles.rowMetaText, { color: tier.color }]}>
            <Text style={styles.rowMetaSigil}>{tier.sigil}</Text> {tier.label}
          </Text>
          <View style={styles.metaDot} />
          <Text style={[styles.rowMetaText, { color: win.color }]}>
            {win.glyph} {win.label}
          </Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowMins}>{defaultMins}</Text>
        <Text style={styles.rowMinsUnit}>min</Text>
      </View>
    </Pressable>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    backgroundColor: C.void,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    maxHeight: '92%',
    minHeight: 380,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: hexA(C.bone, 0.16),
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  headerGlyph: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.dusk,
  },
  headerLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.dusk,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    fontFamily: fonts.inter,
    fontSize: 22,
    color: C.mute,
    lineHeight: 24,
  },

  // ── List body ──
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 20,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    gap: 14,
  },
  rowTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 17,
    color: C.bone,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  rowMetaText: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
  },
  rowMetaSigil: {
    fontSize: 9,
    letterSpacing: -1,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.ash,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  rowMins: {
    fontFamily: fonts.fraunces,
    fontSize: 22,
    color: C.ember,
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  rowMinsUnit: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },

  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 20,
    color: C.bone,
    letterSpacing: -0.3,
  },
  emptyBody: {
    fontFamily: fonts.inter,
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 260,
  },

  // ── Focus card body ──
  focusCardMount: {
    paddingHorizontal: 2,
    paddingBottom: 16,
  },
});
