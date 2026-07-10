// Lumi · "Let the day set" — the evening close ritual.
//
// Before this sheet, unfinished tasks silently VANISHED from Home at
// midnight (strict date filter) — no carry, no goodbye, nothing. One
// slipped task got zero acknowledgment, ever. This is the never-guilt
// promise made mechanical: tonight's leftovers, one card each —
// carry it / let it go / actually did it — then Luna curls up.
//
// Opened by tapping the wind-down notification ("Soft close…") when
// leftovers exist; Home owns the state and the mutations.

import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { timeColors as C } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { lunaSource, useLunaSkin } from '../lib/luna-source';
import type { Quest } from '../store/questStore';

interface Props {
  visible: boolean;
  leftovers: Quest[];
  onCarry: (q: Quest) => void;
  onLetGo: (q: Quest) => void;
  onDidIt: (q: Quest) => void;
  onClose: () => void;
}

export const DaySetSheet = ({
  visible,
  leftovers,
  onCarry,
  onLetGo,
  onDidIt,
  onClose,
}: Props) => {
  const skin = useLunaSkin();
  if (!visible) return null;
  const allSet = leftovers.length === 0;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        {allSet ? (
          <View style={styles.doneWrap}>
            <Image
              source={lunaSource('sleep', skin)}
              style={styles.doneCat}
              resizeMode="contain"
            />
            <Text style={styles.doneTitle}>The day is set.</Text>
            <Text style={styles.doneSub}>
              Nothing chasing you into tomorrow. Rest well.
            </Text>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>Good night</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Let the day set.</Text>
            <Text style={styles.sub}>
              {leftovers.length} thing{leftovers.length === 1 ? '' : 's'}{' '}
              didn&apos;t happen today — that&apos;s allowed. Tell me where
              each one goes.
            </Text>
            {leftovers.slice(0, 6).map((q) => (
              <View key={q.id} style={styles.row}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {q.title}
                </Text>
                <View style={styles.rowBtns}>
                  <Pressable
                    style={[styles.rowBtn, styles.rowBtnPrimary]}
                    onPress={() => onCarry(q)}
                    hitSlop={4}
                  >
                    <Text style={styles.rowBtnPrimaryText}>carry</Text>
                  </Pressable>
                  <Pressable
                    style={styles.rowBtn}
                    onPress={() => onLetGo(q)}
                    hitSlop={4}
                  >
                    <Text style={styles.rowBtnText}>let go</Text>
                  </Pressable>
                  <Pressable
                    style={styles.rowBtn}
                    onPress={() => onDidIt(q)}
                    hitSlop={4}
                  >
                    <Text style={styles.rowBtnText}>did it ✓</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {leftovers.length > 6 && (
              <Text style={styles.more}>
                +{leftovers.length - 6} more after these
              </Text>
            )}
            <Pressable style={styles.laterBtn} onPress={onClose} hitSlop={6}>
              <Text style={styles.laterText}>not tonight</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(18,14,12,0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.void2,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: C.hair,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 42,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.hair,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontSize: 24,
    color: C.bone,
    paddingRight: 6,
  },
  sub: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 19,
  },
  row: {
    backgroundColor: C.void,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
  },
  rowTitle: {
    fontFamily: fonts.interMed,
    fontSize: 14,
    color: C.bone,
  },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 9 },
  rowBtn: {
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  rowBtnText: { fontFamily: fonts.inter, fontSize: 12, color: C.boneDim },
  rowBtnPrimary: { backgroundColor: C.ember, borderColor: C.ember },
  rowBtnPrimaryText: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    color: C.void,
  },
  more: {
    fontFamily: fonts.fraunces,
    fontSize: 12,
    color: C.mute,
    textAlign: 'center',
    marginTop: 2,
  },
  laterBtn: { alignSelf: 'center', marginTop: 12 },
  laterText: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.mute,
    textDecorationLine: 'underline',
  },
  doneWrap: { alignItems: 'center', paddingVertical: 10 },
  doneCat: { width: 96, height: 96 },
  doneTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 24,
    color: C.bone,
    marginTop: 10,
    paddingRight: 6,
  },
  doneSub: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    marginTop: 6,
    textAlign: 'center',
  },
  closeBtn: {
    marginTop: 18,
    backgroundColor: C.ember,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 34,
  },
  closeBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.void,
  },
});
