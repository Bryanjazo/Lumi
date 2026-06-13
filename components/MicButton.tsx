import { useEffect, useRef } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { useVoice } from '../lib/voice';

interface Props {
  /** Called with the final transcribed text. */
  onTranscribed: (text: string) => void;
  /** Show inline error messages below the button. */
  showError?: boolean;
  /** Size variant. Default is "medium". */
  size?: 'small' | 'medium';
}

/**
 * Tap to start recording; tap again to stop + transcribe via Whisper.
 * Long-press to cancel without transcribing. Surface a small dot that
 * pulses red while recording, a spinner while transcribing.
 */
export const MicButton = ({
  onTranscribed,
  showError = true,
  size = 'medium',
}: Props) => {
  const { state, error, start, stopAndTranscribe, cancel } = useVoice();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'recording') {
      pulse.setValue(1);
      return;
    }
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.18,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [state, pulse]);

  const handlePress = async () => {
    if (state === 'transcribing') return;
    Haptics.selectionAsync();
    if (state === 'idle') {
      await start();
      return;
    }
    if (state === 'recording') {
      const text = await stopAndTranscribe();
      if (text) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onTranscribed(text);
      }
    }
  };

  const handleLongPress = async () => {
    if (state === 'recording') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await cancel();
    }
  };

  const btnSize = size === 'small' ? 36 : 44;

  return (
    <View>
      <Pressable
        onPress={handlePress}
        onLongPress={handleLongPress}
        disabled={state === 'transcribing'}
        style={[
          styles.btn,
          { width: btnSize, height: btnSize, borderRadius: btnSize / 2 },
          state === 'recording' && styles.btnRecording,
          state === 'transcribing' && styles.btnTranscribing,
        ]}
      >
        {state === 'transcribing' ? (
          <ActivityIndicator size="small" color={colors.terra} />
        ) : state === 'recording' ? (
          <Animated.View
            style={[
              styles.recordDot,
              { transform: [{ scale: pulse }] },
            ]}
          />
        ) : (
          <Text style={[styles.glyph, size === 'small' && { fontSize: 14 }]}>
            🎙
          </Text>
        )}
      </Pressable>
      {showError && error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnRecording: {
    backgroundColor: 'rgba(216,136,120,0.12)',
    borderColor: colors.rose,
  },
  btnTranscribing: {
    backgroundColor: colors.terraBg,
    borderColor: colors.terra,
  },
  glyph: { fontSize: 16 },
  recordDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.rose,
  },
  errorText: {
    fontFamily: fonts.sansItalic,
    fontSize: 10,
    color: colors.rose,
    marginTop: 6,
    maxWidth: 200,
    textAlign: 'center',
  },
});
