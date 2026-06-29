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
import { useUserStore } from '../store/userStore';
import { useAccent } from '../lib/theme';
import { CAPTURE_LANGUAGES } from '../lib/languages';

// Palette mirrors profile/EditProfileSheet
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

interface LanguagePickerSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const LanguagePickerSheet = ({
  visible,
  onClose,
}: LanguagePickerSheetProps) => {
  const accent = useAccent();
  const current = useUserStore((s) => s.captureLang);
  const setCaptureLang = useUserStore((s) => s.setCaptureLang);

  const pick = (tag: string) => {
    Haptics.selectionAsync();
    setCaptureLang(tag);
    onClose();
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
            <Text style={styles.title}>Capture language</Text>
            <View style={{ width: 50 }} />
          </View>
          <Text style={styles.hint}>
            Lumi listens in this language for voice brain-dumps and writes
            captured tasks the same way.
          </Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
            {CAPTURE_LANGUAGES.map((l, i) => {
              const sel = l.tag === current;
              return (
                <Pressable
                  key={l.tag}
                  onPress={() => pick(l.tag)}
                  style={[
                    styles.row,
                    i !== CAPTURE_LANGUAGES.length - 1 && styles.rowDivider,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{l.label}</Text>
                    <Text style={styles.rowNative}>{l.native}</Text>
                  </View>
                  {sel && (
                    <Text style={[styles.check, { color: accent.fg }]}>✓</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

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
    maxHeight: '80%',
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
    marginBottom: 8,
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
    lineHeight: 18,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 12,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.hair },
  rowLabel: {
    fontFamily: fonts.inter,
    fontSize: 15,
    color: C.bone,
  },
  rowNative: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
    marginTop: 2,
  },
  check: {
    fontSize: 18,
    fontFamily: fonts.interSemi,
  },
});
