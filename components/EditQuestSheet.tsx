// EditQuestSheet — inline editor for a quest's title + description.
//
// Opens from the Edit pill on a "Then, when you're ready" row. The
// sheet ALWAYS lets the user add a description, even if one didn't
// exist before (the user explicitly asked for this — "if there's no
// description inside the edit should still allow you to add a note").
//
// Layout matches lumi-home-v2.jsx:
//   - "✎ EDIT QUEST" eyebrow + window pill on the right
//   - TITLE input (italic Fraunces, ember-bordered when focused)
//   - DESCRIPTION (optional) label
//   - Multiline description textarea
//   - "🎙 Speak it" voice-append button + N/280 char counter
//   - Cancel / Save changes
//
// On Save we call updateTitle + setNote. Save is disabled when
// nothing changed.

import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { fonts } from '../constants/fonts';
import type { Quest } from '../store/questStore';
import { WINDOWS } from '../constants/windows';
import { useAccent } from '../lib/theme';
import { useVoice } from '../lib/voice';
import { MicIcon } from './MicIcon';
import Svg, { Path } from 'react-native-svg';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  hair: '#2A2420',
  mute: '#6E655A',
  dusk: '#8EA0B4',
};

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const MAX_COMMENT = 280;
// Description has no spec'd cap — it's freeform context the LLM may
// have extracted ("the clinic on 4th takes evening walk-ins until
// 8"). Capping at 500 keeps it bounded without feeling tight.
const MAX_NOTE = 500;

interface Props {
  visible: boolean;
  onClose: () => void;
  quest: Quest | null;
  onSave: (next: { title: string; note: string; comment: string }) => void;
}

export const EditQuestSheet = ({ visible, onClose, quest, onSave }: Props) => {
  const accent = useAccent();
  const voice = useVoice();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [titleFocused, setTitleFocused] = useState(false);
  const [noteFocused, setNoteFocused] = useState(false);
  const [commentFocused, setCommentFocused] = useState(false);

  // Re-seed each time the sheet opens so a previous edit's leftovers
  // don't leak into the next quest.
  useEffect(() => {
    if (visible && quest) {
      setTitle(quest.title);
      setNote(quest.note ?? '');
      setComment(quest.comment ?? '');
      setTitleFocused(false);
      setNoteFocused(false);
      setCommentFocused(false);
    }
  }, [visible, quest]);

  if (!quest) return null;

  const winColor = WINDOWS[quest.window]?.color ?? C.mute;
  const winLabel = WINDOWS[quest.window]?.label ?? quest.window;
  const winGlyph = WINDOWS[quest.window]?.glyph ?? '';

  const dirty =
    title.trim() !== quest.title.trim() ||
    note.trim() !== (quest.note ?? '').trim() ||
    comment.trim() !== (quest.comment ?? '').trim();
  const canSave = dirty && title.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSave({
      title: title.trim(),
      note: note.trim(),
      comment: comment.trim(),
    });
    onClose();
  };

  // Voice "Speak it" — appends to the user's COMMENT (not the
  // description). The comment is the user's own annotation; the
  // description is LLM-extracted context, less likely to need voice.
  const handleSpeak = async () => {
    Haptics.selectionAsync();
    if (voice.state === 'idle') {
      await voice.start();
    } else if (voice.state === 'recording') {
      const transcript = await voice.stopAndTranscribe();
      if (transcript && transcript.trim()) {
        setComment((prev) => {
          const joined = (prev.trim() + ' ' + transcript.trim()).trim();
          return joined.slice(0, MAX_COMMENT);
        });
      }
    }
  };
  const recording = voice.state === 'recording';
  const transcribing = voice.state === 'transcribing';

  const commentCount = comment.length;
  const commentCountColor =
    commentCount > MAX_COMMENT - 20
      ? '#C97560'
      : commentCount > MAX_COMMENT - 40
        ? accent.fg
        : C.mute;

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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kbWrap}
        >
          <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
            <View style={styles.handle} />

            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.pencil}>✎</Text>
                <Text style={styles.eyebrow}>EDIT QUEST</Text>
              </View>
              <View style={styles.windowPill}>
                <Text style={[styles.windowGlyph, { color: winColor }]}>
                  {winGlyph}
                </Text>
                <Text style={[styles.windowLabel, { color: winColor }]}>
                  {winLabel}
                </Text>
              </View>
            </View>

            {/* ── Title ── */}
            <Text style={styles.fieldLabel}>TITLE</Text>
            <View
              style={[
                styles.titleWrap,
                { borderColor: titleFocused ? accent.fg : C.hair },
              ]}
            >
              <TextInput
                value={title}
                onChangeText={setTitle}
                onFocus={() => setTitleFocused(true)}
                onBlur={() => setTitleFocused(false)}
                placeholder="What's the task?"
                placeholderTextColor={C.mute}
                style={styles.titleInput}
                multiline={false}
                maxLength={120}
              />
            </View>

            {/* ── YOUR COMMENT ── pinned above the description per
                lumi-hero-comment.jsx. Voice-enabled (Speak it
                appends), 280-char cap. The user's annotation lives
                here. ── */}
            <View style={[styles.descLabelRow, { gap: 6 }]}>
              <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16H9l-4 3.5V6.5A1.5 1.5 0 0 1 6.5 5"
                  stroke={accent.fg}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={[styles.fieldLabel, { color: accent.fg, marginBottom: 0 }]}>
                YOUR COMMENT
              </Text>
              <Text style={styles.optional}> optional</Text>
            </View>
            <View
              style={[
                styles.descWrap,
                { borderColor: commentFocused ? accent.fg : C.hair },
              ]}
            >
              <TextInput
                value={comment}
                onChangeText={(v) => setComment(v.slice(0, MAX_COMMENT))}
                onFocus={() => setCommentFocused(true)}
                onBlur={() => setCommentFocused(false)}
                placeholder="What you want to remember about this"
                placeholderTextColor={C.mute}
                style={styles.descInput}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.descFooter}>
                <Pressable
                  onPress={handleSpeak}
                  disabled={transcribing}
                  style={[
                    styles.speakBtn,
                    {
                      backgroundColor: recording
                        ? accent.fg
                        : hexA(accent.fg, 0.12),
                      borderColor: recording ? accent.fg : hexA(accent.fg, 0.4),
                    },
                  ]}
                >
                  <MicIcon
                    size={14}
                    color={recording ? C.void : accent.fg}
                  />
                  <Text
                    style={[
                      styles.speakText,
                      { color: recording ? C.void : accent.fg },
                    ]}
                  >
                    {transcribing
                      ? 'Listening…'
                      : recording
                        ? 'Stop'
                        : 'Speak it'}
                  </Text>
                </Pressable>
                <Text
                  style={[styles.charCount, { color: commentCountColor }]}
                >
                  {commentCount}/{MAX_COMMENT}
                </Text>
              </View>
            </View>

            {/* ── Description — freeform context. Plain textarea,
                no voice, 500-char cap. Shown below the comment on
                the hero card. ── */}
            <View style={styles.descLabelRow}>
              <Text style={styles.fieldLabel}>DESCRIPTION</Text>
              <Text style={styles.optional}> optional</Text>
            </View>
            <View
              style={[
                styles.descWrap,
                { borderColor: noteFocused ? accent.fg : C.hair },
              ]}
            >
              <TextInput
                value={note}
                onChangeText={(v) => setNote(v.slice(0, MAX_NOTE))}
                onFocus={() => setNoteFocused(true)}
                onBlur={() => setNoteFocused(false)}
                placeholder="Anything else worth remembering?"
                placeholderTextColor={C.mute}
                style={styles.descInput}
                multiline
                textAlignVertical="top"
              />
            </View>

            {/* ── Actions ── */}
            <View style={styles.actions}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onClose();
                }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={!canSave}
                style={[
                  styles.saveBtn,
                  canSave
                    ? { backgroundColor: accent.fg, borderColor: accent.fg }
                    : { backgroundColor: 'transparent', borderColor: C.hair },
                ]}
              >
                <Text
                  style={[
                    styles.saveText,
                    { color: canSave ? C.void : C.mute },
                  ]}
                >
                  Save changes
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
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
  kbWrap: {
    width: '100%',
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

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pencil: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.dusk,
  },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.8,
    color: C.dusk,
    textTransform: 'uppercase',
  },
  windowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  windowGlyph: {
    fontSize: 11,
  },
  windowLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 11.5,
    letterSpacing: -0.1,
  },

  // ── Field label ──
  fieldLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: C.mute,
    marginBottom: 9,
  },
  descLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 9,
  },
  optional: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12,
    color: C.mute,
  },

  // ── Title input ──
  titleWrap: {
    backgroundColor: C.void2,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 22,
  },
  titleInput: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 19,
    color: C.bone,
    letterSpacing: -0.3,
    padding: 0,
  },

  // ── Description input ──
  descWrap: {
    backgroundColor: C.void2,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    marginBottom: 22,
  },
  descInput: {
    fontFamily: fonts.inter,
    fontSize: 14.5,
    color: C.bone,
    lineHeight: 21,
    letterSpacing: -0.1,
    padding: 0,
    minHeight: 90,
  },
  descFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.hair,
  },
  speakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
  },
  speakGlyph: {
    fontSize: 13,
  },
  speakText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    letterSpacing: -0.1,
  },
  charCount: {
    fontFamily: fonts.inter,
    fontSize: 12,
  },

  // ── Actions ──
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.bone,
  },
  saveBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    letterSpacing: 0.1,
  },
});
