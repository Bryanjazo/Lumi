import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Rect } from 'react-native-svg';
import { fonts } from '../constants/fonts';
import { useUserStore } from '../store/userStore';
import { useAccent } from '../lib/theme';
import { skins, type Skin } from '../constants/skins';
import { type LunaMood } from '../lib/luna-source';
import { skinPreview } from '../lib/skin-preview';

// ── Palette (matches profile screen) ───────────────────────────────
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  hair: '#2A2420',
  rust: '#C56A4A',
} as const;

const NAME_MAX = 30;

// ── Mini Luna avatar — colored per-skin preview PNG so the picker
// shows real color variation instead of the same tan cat with a
// different label. `skinId` picks the recolored still-frame; the
// animated GIF path only kicks in for the 'default' / 'original'
// case (which uses the base sprite anyway). primary / secondary
// stay in the signature for API compat with older callers. ──
const MiniLuna = ({
  size = 56,
  skinId,
}: {
  size?: number;
  primary?: string;
  secondary?: string;
  mood?: LunaMood;
  skinId?: string;
}) => (
  <Image
    source={skinPreview(skinId)}
    style={{ width: size, height: size }}
    resizeMode="contain"
  />
);

interface AvatarOption {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  unlocked: boolean;
  unlockHint?: string;
}

interface EditProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const EditProfileSheet = ({ visible, onClose }: EditProfileSheetProps) => {
  const accent = useAccent();
  const currentName = useUserStore((s) => s.name);
  const currentAvatar = useUserStore((s) => s.avatar);
  const xp = useUserStore((s) => s.xp);
  const setName = useUserStore((s) => s.setName);
  const setAvatar = useUserStore((s) => s.setAvatar);

  const [draftName, setDraftName] = useState(currentName);
  const [draftAvatar, setDraftAvatar] = useState(currentAvatar);

  // Re-seed drafts whenever the sheet opens so a cancel → reopen
  // shows the current persisted value, not the last unsaved edit.
  useEffect(() => {
    if (visible) {
      setDraftName(currentName);
      setDraftAvatar(currentAvatar);
    }
  }, [visible, currentName, currentAvatar]);

  const trimmed = draftName.trim();
  const nameValid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;
  const changed =
    (trimmed && trimmed !== currentName) || draftAvatar !== currentAvatar;

  const options: AvatarOption[] = [
    {
      id: 'default',
      // Renamed from 'Luna' to 'Original' — both the app and the cat
      // are 'Lumi' now, so labeling the default skin as a separate
      // pet-name was confusing.
      label: 'Original',
      primary: '#E8DAC0',
      secondary: '#F5EAD0',
      unlocked: true,
    },
    ...skins.map((s: Skin) => ({
      id: s.id,
      label: s.name,
      primary: s.primary,
      secondary: s.secondary,
      unlocked: xp >= s.xpToUnlock,
      unlockHint: xp >= s.xpToUnlock ? undefined : `${s.xpToUnlock} XP`,
    })),
  ];

  const save = () => {
    if (!nameValid || !changed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (trimmed !== currentName) setName(trimmed);
    if (draftAvatar !== currentAvatar) setAvatar(draftAvatar);
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
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Pressable onPress={onClose} hitSlop={12}>
                <Text style={styles.action}>Cancel</Text>
              </Pressable>
              <Text style={styles.title}>Edit profile</Text>
              <Pressable
                onPress={save}
                disabled={!nameValid || !changed}
                hitSlop={12}
              >
                <Text
                  style={[
                    styles.action,
                    {
                      color: nameValid && changed ? accent.fg : C.mute,
                      fontFamily: fonts.interSemi,
                    },
                  ]}
                >
                  Save
                </Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Name */}
              <Text style={styles.sectionLabel}>Display name</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  value={draftName}
                  onChangeText={(v) =>
                    setDraftName(v.length > NAME_MAX ? v.slice(0, NAME_MAX) : v)
                  }
                  placeholder="What should Lumi call you?"
                  placeholderTextColor={C.mute}
                  style={styles.input}
                  maxLength={NAME_MAX}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={save}
                />
              </View>
              <Text style={styles.charCount}>
                {trimmed.length}/{NAME_MAX}
              </Text>

              {/* Avatar */}
              <Text style={[styles.sectionLabel, { marginTop: 22 }]}>Avatar</Text>
              <Text style={styles.sectionHint}>
                Skins unlock as you level up. Tap any unlocked one to set it
                app-wide.
              </Text>
              <View style={styles.avatarGrid}>
                {options.map((opt) => {
                  const sel = draftAvatar === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => {
                        if (!opt.unlocked) return;
                        Haptics.selectionAsync();
                        setDraftAvatar(opt.id);
                      }}
                      style={[
                        styles.avatarCell,
                        {
                          borderColor: sel ? accent.fg : C.hair,
                          opacity: opt.unlocked ? 1 : 0.35,
                        },
                      ]}
                    >
                      <View style={styles.avatarSprite}>
                        <MiniLuna size={48} skinId={opt.id} />
                      </View>
                      <Text
                        style={[
                          styles.avatarLabel,
                          {
                            color: sel ? C.bone : C.boneDim,
                            fontFamily: sel ? fonts.interSemi : fonts.inter,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {opt.label}
                      </Text>
                      {opt.unlockHint && (
                        <Text style={styles.avatarLock}>{opt.unlockHint}</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
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
    marginBottom: 18,
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
  sectionLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: C.mute,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingLeft: 2,
  },
  sectionHint: {
    fontFamily: fonts.inter,
    fontSize: 12,
    color: C.mute,
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 12,
  },
  inputWrap: {
    backgroundColor: C.void,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hair,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  input: {
    fontFamily: fonts.inter,
    fontSize: 15,
    color: C.bone,
    paddingVertical: 12,
  },
  charCount: {
    fontFamily: fonts.inter,
    fontSize: 10,
    color: C.mute,
    textAlign: 'right',
    marginTop: 6,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  avatarCell: {
    width: '30.5%',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 6,
    backgroundColor: C.void,
    borderRadius: 16,
    borderWidth: 2,
    gap: 8,
  },
  avatarSprite: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLabel: {
    fontSize: 12.5,
    marginTop: 4,
  },
  avatarLock: {
    fontFamily: fonts.inter,
    fontSize: 9.5,
    color: C.mute,
    letterSpacing: 0.5,
    marginTop: 1,
  },
});
