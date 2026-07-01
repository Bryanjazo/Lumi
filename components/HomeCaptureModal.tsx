// HomeCaptureModal — the "brain-dump" surface, promoted from an
// inline card in Home's scroll into a proper bottom-sheet modal.
//
// Previously the expanded capture rendered as a View inside the
// ScrollView, so tapping the pill's expand button would pop the
// capture surface somewhere mid-scroll (whichever y the closed
// pill used to occupy). Users read that as "buggy, jumps around,
// I can't find it". Wrapping the same JSX in a slide-from-bottom
// Modal fixes both problems: the surface always animates in from
// the same edge, always fills the screen, and dismisses cleanly.
//
// Component owns none of the capture STATE (that lives on Home so
// the pill and modal share the same input). It just receives
// capText / setCapText / handleSubmit / handleTranscribed callbacks
// and wraps them in the sheet UI. Voice cancellation on dismiss is
// the caller's job — we call onClose() and expect it to unwind any
// in-flight recording.

import { useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import { MicButton } from './MicButton';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#211A15',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  dusk: '#8EA0B4',
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

export interface HomeCaptureModalProps {
  visible: boolean;
  onClose: () => void;
  capText: string;
  setCapText: (t: string) => void;
  /** Runs Home's sendCapture — LLM parse + preview. */
  onSubmit: () => void;
  /** Runs Home's handleTranscribed after voice input completes. */
  onTranscribed: (text: string) => void;
  /** Optional pending flag — while true, the composer is disabled
   *  and a soft "Lumi is reading…" indicator shows in the footer. */
  submitting?: boolean;
}

export function HomeCaptureModal({
  visible,
  onClose,
  capText,
  setCapText,
  onSubmit,
  onTranscribed,
  submitting,
}: HomeCaptureModalProps) {
  // Fresh open → don't accidentally carry text from a prior dismiss.
  // Home handles the state clear on close, but wire a guard anyway
  // so the modal always renders clean when it slides up.
  useEffect(() => {
    if (visible) {
      // no-op; kept for future preflight hooks (mic pre-warm etc.)
    }
  }, [visible]);

  const canSubmit = capText.trim().length > 0 && !submitting;

  const handleClose = () => {
    Haptics.selectionAsync();
    onClose();
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    Haptics.selectionAsync();
    onSubmit();
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kbWrap}
        >
          <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
            {/* Header — eyebrow + × */}
            <View style={styles.header}>
              <Text style={styles.eyebrow}>✦ Brain-dump</Text>
              <Pressable
                onPress={handleClose}
                style={styles.closeBtn}
                hitSlop={6}
              >
                <Text style={styles.closeGlyph}>×</Text>
              </Pressable>
            </View>

            {/* Prompt block */}
            <View style={styles.promptBlock}>
              <Text style={styles.promptTitle}>What&apos;s in your head?</Text>
              <Text style={styles.promptSub}>
                Say it all — messy is fine. I&apos;ll make sense of it for
                you.
              </Text>
            </View>

            {/* Big multiline dump surface */}
            <View style={styles.textareaWrap}>
              <TextInput
                autoFocus
                value={capText}
                onChangeText={setCapText}
                placeholder="behind on the pitch deck and stressing about thursday, need to edit the podcast, invoice is overdue, mom's birthday coming up don't forget…"
                placeholderTextColor={C.mute}
                style={styles.textarea}
                multiline
                textAlignVertical="top"
                scrollEnabled
                editable={!submitting}
              />
            </View>

            {/* Footer — mic + submit */}
            <View style={styles.footer}>
              <View style={styles.micMount}>
                <MicButton
                  size="medium"
                  showError={false}
                  onTranscribed={(text) => {
                    if (!text) return;
                    // Prepend transcribed text into the composer. User
                    // can review/edit before hitting "Make sense of it".
                    // Falls back to auto-submit if the deterministic
                    // parser in handleTranscribed can't extract a task
                    // (that path opens the modal with the transcript
                    // pre-filled from the pill — here we just append).
                    setCapText(capText ? `${capText} ${text}` : text);
                    onTranscribed(text);
                  }}
                />
              </View>
              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={[
                  styles.submitBtn,
                  canSubmit
                    ? { backgroundColor: C.ember }
                    : { backgroundColor: hexA(C.ember, 0.28) },
                ]}
              >
                {submitting ? (
                  <View style={styles.submitLoadingRow}>
                    <ActivityIndicator size="small" color={C.void} />
                    <Text style={styles.submitText}>Lumi is reading…</Text>
                  </View>
                ) : (
                  <Text
                    style={[
                      styles.submitText,
                      { color: canSubmit ? C.void : hexA(C.void, 0.4) },
                    ]}
                  >
                    Make sense of it →
                  </Text>
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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
  kbWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    backgroundColor: C.void,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    // Near-full-height sheet — same feel as the mockup's Dump
    // overlay without stealing the very top status bar.
    height: '92%',
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: C.dusk,
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    fontFamily: fonts.inter,
    fontSize: 22,
    color: C.boneDim,
    lineHeight: 24,
  },
  promptBlock: {
    marginTop: 8,
    marginBottom: 12,
  },
  promptTitle: {
    fontFamily: fonts.fraunces,
    fontSize: 30,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  promptSub: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.boneDim,
    lineHeight: 21,
    marginTop: 8,
  },
  textareaWrap: {
    flex: 1,
    marginTop: 4,
    marginBottom: 12,
    backgroundColor: hexA(C.surface, 0.6),
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 18,
    padding: 18,
  },
  textarea: {
    flex: 1,
    fontFamily: fonts.inter,
    fontSize: 17,
    color: C.bone,
    lineHeight: 25,
    padding: 0,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 6,
  },
  micMount: {
    flexShrink: 0,
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 17,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  submitText: {
    fontFamily: fonts.interSemi,
    fontSize: 15.5,
    color: C.void,
  },
});
