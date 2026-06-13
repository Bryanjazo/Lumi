import { View, StyleSheet } from 'react-native';
import Svg, { Rect, G, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '../constants/colors';

/**
 * A small pixel-art "lit window at night" — used as a cozy header on the
 * auth screen. Same visual language as LunaCanvas so the brand carries.
 * Optional sleeping cat silhouette on the sill.
 */

interface Props {
  size?: number;
  cat?: boolean;
}

export const CozyWindow = ({ size = 140, cat = true }: Props) => {
  const cell = size / 14; // 14 cols wide
  const rows = 11;

  return (
    <View style={[styles.wrap, { width: size, height: cell * rows }]}>
      <Svg width={size} height={cell * rows}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1A1612" />
            <Stop offset="1" stopColor="#221C16" />
          </LinearGradient>
          <LinearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.caramel} stopOpacity="0.55" />
            <Stop offset="1" stopColor={colors.terra} stopOpacity="0.25" />
          </LinearGradient>
        </Defs>

        {/* outer warm halo */}
        <Rect x={0} y={0} width={size} height={cell * rows} fill="url(#sky)" />

        {/* window frame */}
        <G>
          {/* sill */}
          <Rect x={cell * 1} y={cell * 8} width={cell * 12} height={cell * 0.7} fill={colors.cream3} />
          <Rect x={cell * 0.5} y={cell * 8.7} width={cell * 13} height={cell * 0.4} fill="#4A3826" />

          {/* outer frame */}
          <Rect x={cell * 2} y={cell * 1} width={cell * 10} height={cell * 7} fill={colors.cream3} />
          {/* inner panes */}
          <Rect x={cell * 2.7} y={cell * 1.7} width={cell * 8.6} height={cell * 5.6} fill="url(#glow)" />
          {/* mullion */}
          <Rect x={cell * 6.8} y={cell * 1.7} width={cell * 0.4} height={cell * 5.6} fill={colors.cream3} />
          <Rect x={cell * 2.7} y={cell * 4.3} width={cell * 8.6} height={cell * 0.4} fill={colors.cream3} />

          {/* warm light cast */}
          <Rect x={cell * 3.2} y={cell * 2.2} width={cell * 2.5} height={cell * 0.4} fill={colors.cream} opacity="0.5" />
          <Rect x={cell * 7.4} y={cell * 2.2} width={cell * 1.8} height={cell * 0.4} fill={colors.cream} opacity="0.4" />
        </G>

        {/* stars in the void around the window */}
        <G>
          <Rect x={cell * 0.6} y={cell * 0.6} width={cell * 0.25} height={cell * 0.25} fill={colors.cream} opacity="0.7" />
          <Rect x={cell * 13} y={cell * 1.4} width={cell * 0.25} height={cell * 0.25} fill={colors.cream} opacity="0.5" />
          <Rect x={cell * 12.5} y={cell * 0.3} width={cell * 0.2} height={cell * 0.2} fill={colors.cream} opacity="0.4" />
          <Rect x={cell * 0.3} y={cell * 5.2} width={cell * 0.2} height={cell * 0.2} fill={colors.cream} opacity="0.4" />
        </G>

        {/* sleeping cat on the sill (silhouette) */}
        {cat && (
          <G>
            <Rect x={cell * 5} y={cell * 7.2} width={cell * 3.4} height={cell * 0.9} fill={colors.text} opacity="0.85" />
            <Rect x={cell * 5} y={cell * 6.8} width={cell * 0.9} height={cell * 0.5} fill={colors.text} opacity="0.85" />
            <Rect x={cell * 7.7} y={cell * 6.7} width={cell * 0.7} height={cell * 0.6} fill={colors.text} opacity="0.85" />
            {/* ear */}
            <Rect x={cell * 5.0} y={cell * 6.5} width={cell * 0.35} height={cell * 0.35} fill={colors.text} opacity="0.85" />
            <Rect x={cell * 5.5} y={cell * 6.5} width={cell * 0.35} height={cell * 0.35} fill={colors.text} opacity="0.85" />
            {/* tail curl */}
            <Rect x={cell * 8.1} y={cell * 7.4} width={cell * 0.4} height={cell * 0.6} fill={colors.text} opacity="0.85" />
          </G>
        )}

        {/* floor below sill (a hint of room interior) */}
        <Rect x={0} y={cell * 9.1} width={size} height={cell * 1.9} fill="#1F1812" />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    borderRadius: 14,
    overflow: 'hidden',
  },
});
