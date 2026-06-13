import { useEffect, useRef, useState } from 'react';
import { Text, View, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';

interface Props {
  totalSeconds: number;
  running: boolean;
  onComplete?: () => void;
  onCancel?: () => void;
  tone?: 'rose' | 'fog';
}

export const SOSTimer = ({
  totalSeconds,
  running,
  onComplete,
  onCancel,
  tone = 'rose',
}: Props) => {
  const [remaining, setRemaining] = useState(totalSeconds);
  const intRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setRemaining(totalSeconds);
  }, [totalSeconds]);

  useEffect(() => {
    if (!running) {
      if (intRef.current) clearInterval(intRef.current);
      return;
    }
    intRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (intRef.current) clearInterval(intRef.current);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onComplete?.();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (intRef.current) clearInterval(intRef.current);
    };
  }, [running, onComplete]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = 1 - remaining / totalSeconds;
  const ring = tone === 'rose' ? colors.rose : colors.fog;

  return (
    <View style={styles.wrap}>
      <View style={[styles.ring, { borderColor: `${ring}40` }]}>
        <View
          style={[
            styles.ringFill,
            {
              backgroundColor: ring,
              opacity: 0.12 + 0.5 * pct,
            },
          ]}
        />
        <Text style={[styles.time, { color: ring }]}>
          {mins}:{secs.toString().padStart(2, '0')}
        </Text>
        <Text style={styles.sub}>holding with you</Text>
      </View>
      {running && (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            onCancel?.();
          }}
          style={styles.cancel}
        >
          <Text style={styles.cancelText}>I'm okay now</Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginVertical: 14 },
  ring: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ringFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  time: {
    fontFamily: fonts.serif,
    fontSize: 52,
    lineHeight: 56,
  },
  sub: {
    fontFamily: fonts.sansItalic,
    color: colors.text2,
    fontSize: 12,
    marginTop: 6,
  },
  cancel: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: 100,
  },
  cancelText: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
  },
});
