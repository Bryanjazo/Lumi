// ProfileIcon — the small circle-with-person button that lives in the
// top-right of Time, Capture, and Untangle. Taps open the profile /
// settings screen. Home doesn't need one (the Luna nook in its
// top-right serves the same role); Me doesn't either (it IS the
// account screen).
//
// Visual: 38×38 circle, hairline bone-dim border, void-2 fill, with
// a simple line-SVG person glyph inside. Theme-aware: the glyph tint
// follows the user-accent (ember by default).

import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAccent } from '../lib/theme';

const C = {
  void2: '#1A1512',
  boneDim: '#B0A38B',
  hair: '#2A2420',
};

export const ProfileIcon = ({ style }: { style?: ViewStyle }) => {
  const router = useRouter();
  const accent = useAccent();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        router.push('/profile');
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Profile and settings"
      style={[styles.btn, style]}
    >
      <View style={styles.inner}>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          {/* Head */}
          <Circle cx={12} cy={9} r={3.6} stroke={accent.fg} strokeWidth={1.6} />
          {/* Shoulders */}
          <Path
            d="M5 19c1.6-3.3 4.2-4.9 7-4.9s5.4 1.6 7 4.9"
            stroke={accent.fg}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </Svg>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
    backgroundColor: C.void2,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
