// MoveBackToDateSheet — reusable bottom sheet for moving a Someday
// (or any) task to a specific future date. Used by both Untangle's
// "Later" rows and Home's "Then, when you're ready" rows.
//
// Design:
//   - Header: task title in Lumi's italic Fraunces (small, single line).
//   - Quick chips:  Today  ·  Tomorrow  ·  This weekend  ·  Next week.
//   - Month calendar grid: prev / next month arrows, weekday header,
//     six rows of seven day cells. Past days are disabled. Tapping any
//     future day (or quick chip) commits and closes — no "Save" step.
//
// Why a sheet + calendar (not chips alone): user said "the date picker
// needs to be a bit cleaner because it can be whenever the user wants
// to move it back to" — chips topped out at 14 days. A calendar covers
// any date and is the affordance users already know.

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import { useAccent } from '../lib/theme';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  hair: '#2A2420',
  mute: '#6E655A',
};

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const MONTHS = [
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
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const localYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const todayYmd = (): string => localYmd(new Date());

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The task being moved — shown in the sheet header. */
  taskTitle: string;
  /** Called with the chosen YYYY-MM-DD (local). */
  onPick: (dateISO: string) => void;
}

export const MoveBackToDateSheet = ({
  visible,
  onClose,
  taskTitle,
  onPick,
}: Props) => {
  const accent = useAccent();

  // Visible month — initialized to current month each open. Held in
  // its own state so prev/next arrows can browse without unmounting.
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Reset to current month each time the sheet opens.
  useEffect(() => {
    if (visible) {
      const d = new Date();
      setView({ y: d.getFullYear(), m: d.getMonth() });
    }
  }, [visible]);

  const today = todayYmd();

  // Quick chip targets — computed at render time so labels stay
  // accurate across midnight and across week boundaries.
  const quickChips = useMemo(() => {
    const todayD = new Date();
    const tomorrow = new Date(todayD);
    tomorrow.setDate(todayD.getDate() + 1);

    // Coming Saturday (or today if it IS Saturday).
    const sat = new Date(todayD);
    const dow = todayD.getDay();
    const daysUntilSat = (6 - dow + 7) % 7 || 7;
    sat.setDate(todayD.getDate() + daysUntilSat);

    // Next Monday for "next week".
    const mon = new Date(todayD);
    const daysUntilMon = ((1 - dow + 7) % 7) || 7;
    mon.setDate(todayD.getDate() + daysUntilMon + 7); // jump a full week ahead

    return [
      { label: 'Today', iso: localYmd(todayD) },
      { label: 'Tomorrow', iso: localYmd(tomorrow) },
      { label: 'This weekend', iso: localYmd(sat) },
      { label: 'Next week', iso: localYmd(mon) },
    ];
  }, [visible]);

  // Grid for the visible month. 6 rows × 7 cells, padded with nulls
  // for the leading / trailing days outside the month.
  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const startDow = first.getDay(); // 0 = Sun
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const cells: ({ d: number; iso: string } | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ d, iso });
    }
    while (cells.length < 42) cells.push(null);
    return cells;
  }, [view]);

  const stepMonth = (delta: number) => {
    Haptics.selectionAsync();
    setView((v) => {
      const y = v.m + delta < 0 ? v.y - 1 : v.m + delta > 11 ? v.y + 1 : v.y;
      const m = (((v.m + delta) % 12) + 12) % 12;
      return { y, m };
    });
  };

  const choose = (iso: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPick(iso);
    onClose();
  };

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

          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.sheetTitle}>Move back</Text>
            <View style={{ width: 50 }} />
          </View>

          <Text style={styles.subtitle} numberOfLines={1}>
            {taskTitle}
          </Text>

          {/* ── Quick chips ── */}
          <View style={styles.quickRow}>
            {quickChips.map((c) => (
              <Pressable
                key={c.label}
                onPress={() => choose(c.iso)}
                style={[styles.quickChip, { borderColor: hexA(accent.fg, 0.45) }]}
              >
                <Text style={[styles.quickChipText, { color: accent.fg }]}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ── Month calendar ── */}
          <View style={styles.monthHeader}>
            <Pressable onPress={() => stepMonth(-1)} hitSlop={10}>
              <Text style={styles.monthArrow}>‹</Text>
            </Pressable>
            <Text style={styles.monthTitle}>
              {MONTHS[view.m]} {view.y}
            </Text>
            <Pressable onPress={() => stepMonth(1)} hitSlop={10}>
              <Text style={styles.monthArrow}>›</Text>
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {DAYS.map((d, i) => (
              <Text key={i} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>

          <View style={styles.gridWrap}>
            {grid.map((cell, i) => {
              if (!cell) return <View key={i} style={styles.dayCell} />;
              const past = cell.iso < today;
              const isToday = cell.iso === today;
              return (
                <Pressable
                  key={i}
                  onPress={() => !past && choose(cell.iso)}
                  disabled={past}
                  style={[
                    styles.dayCell,
                    isToday && {
                      backgroundColor: hexA(accent.fg, 0.16),
                      borderColor: accent.fg,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayCellText,
                      past && { color: C.mute, opacity: 0.4 },
                      isToday && {
                        color: accent.fg,
                        fontFamily: fonts.interSemi,
                      },
                    ]}
                  >
                    {cell.d}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    backgroundColor: C.void,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: C.hair,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.hair,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cancelText: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.boneDim,
  },
  sheetTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 18,
    color: C.bone,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    marginBottom: 18,
    marginTop: 2,
  },

  // ── Quick chips ──
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22,
  },
  quickChip: {
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  quickChipText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    letterSpacing: -0.1,
  },

  // ── Month header ──
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  monthArrow: {
    fontFamily: fonts.inter,
    fontSize: 22,
    color: C.boneDim,
    width: 32,
    textAlign: 'center',
  },
  monthTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 17,
    color: C.bone,
    letterSpacing: -0.3,
  },

  // ── Weekday header + grid ──
  weekdayRow: {
    flexDirection: 'row',
    paddingHorizontal: 6,
    marginBottom: 6,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: C.mute,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
    paddingBottom: 18,
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  dayCellText: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.bone,
  },
});
