// Windows editor — bottom sheet that lets the user shift the three
// middle boundaries (morning→midday, midday→afternoon,
// afternoon→evening). Morning starts at wakeHour and evening ends at
// the sleep anchor — both handled elsewhere — so this sheet only owns
// the three knobs in between.
//
// Persists to userStore.windowOverrides. Home/Time/Capture read these
// via `useEffectiveWindows()` from constants/windows.ts.

import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { fonts } from '../constants/fonts';
import {
  useUserStore,
  DEFAULT_WINDOW_OVERRIDES,
  type WindowOverrides,
} from '../store/userStore';
import { useAccent } from '../lib/theme';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

interface WindowEditorSheetProps {
  visible: boolean;
  onClose: () => void;
}

const formatHour = (h: number): string => {
  const hh = h % 12 || 12;
  return `${hh}:00 ${h < 12 ? 'am' : 'pm'}`;
};

export const WindowEditorSheet = ({
  visible,
  onClose,
}: WindowEditorSheetProps) => {
  const accent = useAccent();
  const overrides = useUserStore((s) => s.windowOverrides);
  const wakeHour = useUserStore((s) => Math.floor(s.anchors.wake / 60));
  const sleepHour = useUserStore((s) => Math.floor(s.anchors.sleep / 60));
  const setWindowOverrides = useUserStore((s) => s.setWindowOverrides);

  const [draft, setDraft] = useState<WindowOverrides>(overrides);

  // Re-seed the draft when the sheet opens so cancel→reopen shows the
  // current persisted values.
  useEffect(() => {
    if (visible) setDraft(overrides);
  }, [visible, overrides]);

  // Bound each boundary by its neighbors so the sequence stays
  // monotonic — morning < midday < afternoon < evening < sleep.
  const middayMin = wakeHour + 1;
  const middayMax = draft.afternoon - 1;
  const afternoonMin = draft.midday + 1;
  const afternoonMax = draft.evening - 1;
  const eveningMin = draft.afternoon + 1;
  const eveningMax = sleepHour - 1;

  const changed =
    draft.midday !== overrides.midday ||
    draft.afternoon !== overrides.afternoon ||
    draft.evening !== overrides.evening;

  const valid =
    draft.midday >= middayMin &&
    draft.midday <= middayMax &&
    draft.afternoon >= afternoonMin &&
    draft.afternoon <= afternoonMax &&
    draft.evening >= eveningMin &&
    draft.evening <= eveningMax;

  const save = () => {
    if (!valid || !changed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setWindowOverrides(draft);
    onClose();
  };

  const reset = () => {
    Haptics.selectionAsync();
    setDraft(DEFAULT_WINDOW_OVERRIDES);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.action}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>Windows</Text>
            <Pressable
              onPress={save}
              disabled={!valid || !changed}
              hitSlop={12}
            >
              <Text
                style={[
                  styles.action,
                  {
                    color: valid && changed ? accent.fg : C.mute,
                    fontFamily: fonts.interSemi,
                  },
                ]}
              >
                Save
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.hint}>
              When each part of your day begins. Morning is anchored to your
              wake time ({formatHour(wakeHour)}), evening ends at bed (
              {formatHour(sleepHour)}). Tap the steppers to shift the middle
              boundaries.
            </Text>

            <BoundaryStepper
              label="Midday begins"
              value={draft.midday}
              min={middayMin}
              max={middayMax}
              onChange={(v) => setDraft({ ...draft, midday: v })}
              accent={accent.fg}
            />
            <BoundaryStepper
              label="Afternoon begins"
              value={draft.afternoon}
              min={afternoonMin}
              max={afternoonMax}
              onChange={(v) => setDraft({ ...draft, afternoon: v })}
              accent={accent.fg}
            />
            <BoundaryStepper
              label="Evening begins"
              value={draft.evening}
              min={eveningMin}
              max={eveningMax}
              onChange={(v) => setDraft({ ...draft, evening: v })}
              accent={accent.fg}
            />

            <View style={styles.summary}>
              <SummaryRow
                label="Morning"
                range={`${formatHour(wakeHour)} – ${formatHour(draft.midday)}`}
              />
              <SummaryRow
                label="Midday"
                range={`${formatHour(draft.midday)} – ${formatHour(draft.afternoon)}`}
              />
              <SummaryRow
                label="Afternoon"
                range={`${formatHour(draft.afternoon)} – ${formatHour(draft.evening)}`}
              />
              <SummaryRow
                label="Evening"
                range={`${formatHour(draft.evening)} – ${formatHour(sleepHour)}`}
              />
            </View>

            <Pressable onPress={reset} style={styles.resetBtn}>
              <Text style={styles.resetText}>Reset to defaults</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const BoundaryStepper = ({
  label,
  value,
  min,
  max,
  onChange,
  accent,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  accent: string;
}) => {
  const dec = () => {
    if (value <= min) return;
    Haptics.selectionAsync();
    onChange(value - 1);
  };
  const inc = () => {
    if (value >= max) return;
    Haptics.selectionAsync();
    onChange(value + 1);
  };
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={dec}
          disabled={value <= min}
          style={[styles.stepperBtn, value <= min && { opacity: 0.35 }]}
        >
          <Text style={styles.stepperGlyph}>−</Text>
        </Pressable>
        <Text style={[styles.stepperValue, { color: accent }]}>
          {formatHour(value)}
        </Text>
        <Pressable
          onPress={inc}
          disabled={value >= max}
          style={[styles.stepperBtn, value >= max && { opacity: 0.35 }]}
        >
          <Text style={styles.stepperGlyph}>+</Text>
        </Pressable>
      </View>
    </View>
  );
};

const SummaryRow = ({ label, range }: { label: string; range: string }) => (
  <View style={styles.summaryRow}>
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={styles.summaryRange}>{range}</Text>
  </View>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.void2,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: C.hair,
    paddingHorizontal: 22,
    paddingTop: 8,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.hair,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingTop: 4,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 18,
    color: C.bone,
  },
  action: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.boneDim,
  },
  hint: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
    lineHeight: 19,
    marginBottom: 18,
  },
  stepperRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.hair,
  },
  stepperLabel: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    marginBottom: 8,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: C.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperGlyph: {
    fontSize: 20,
    color: C.boneDim,
    fontFamily: fonts.inter,
    lineHeight: 22,
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 20,
  },
  summary: {
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: C.void,
    overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.hair,
  },
  summaryLabel: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.boneDim,
  },
  summaryRange: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.bone,
  },
  resetBtn: {
    marginTop: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  resetText: {
    fontFamily: fonts.inter,
    fontSize: 12.5,
    color: C.mute,
    textDecorationLine: 'underline',
  },
});
