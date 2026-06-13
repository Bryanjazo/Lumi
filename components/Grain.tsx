import { memo, useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors } from '../constants/colors';

/**
 * A static, low-opacity SVG noise field. Renders ~600 1-px specks scattered
 * across a 320x320 canvas, then tiles by stretching. Cheap to render
 * (one SVG, no animation) and reads as warm tape grain at ~2.5% opacity.
 */

const TILE = 320;
const SPECKS = 380;

// Deterministic pseudo-random so the pattern is stable across renders.
const seed = (n: number) => {
  // Mulberry32
  let t = n + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

interface Props {
  style?: ViewStyle;
  intensity?: number; // 0..1 multiplier on the base opacity
}

export const Grain = memo(function Grain({ style, intensity = 1 }: Props) {
  const specks = useMemo(() => {
    const out: { x: number; y: number; o: number; w: number }[] = [];
    for (let i = 0; i < SPECKS; i++) {
      const x = seed(i * 3 + 1) * TILE;
      const y = seed(i * 3 + 2) * TILE;
      const o = 0.05 + seed(i * 3 + 3) * 0.35;
      const w = seed(i * 3 + 5) < 0.92 ? 1 : 2;
      out.push({ x, y, o, w });
    }
    return out;
  }, []);

  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${TILE} ${TILE}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {specks.map((s, i) => (
          <Rect
            key={i}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.w}
            fill={colors.cream}
            opacity={s.o * intensity * 0.18}
          />
        ))}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
