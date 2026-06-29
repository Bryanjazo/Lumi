// SoftGlow — an SVG radial gradient used everywhere we want the
// mockup's "soft glow halo" feel. Replaces the flat View+backgroundColor
// pattern that rendered as a hard-edged circle/box on device.
//
// Usage:
//   <SoftGlow
//     color="#F4C98A"
//     opacity={0.18}
//     fade={0.6}
//     style={{ position: 'absolute', top: 0, left: 0, ... }}
//   />

import { useRef } from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

let glowIdCounter = 0;

export interface SoftGlowProps {
  /** Glow color (hex). */
  color: string;
  /** Peak opacity at the center, 0–1. Default 0.18. */
  opacity?: number;
  /** Offset (0–1) where the glow fades to transparent. Default 0.55. */
  fade?: number;
  /** Center X as fraction (0–1). Default 0.5. */
  cx?: number;
  /** Center Y as fraction (0–1). Default 0.5. */
  cy?: number;
  /** Container style — usually position+size from the parent. */
  style?: StyleProp<ViewStyle>;
}

export const SoftGlow = ({
  color,
  opacity = 0.18,
  fade = 0.55,
  cx = 0.5,
  cy = 0.5,
  style,
}: SoftGlowProps) => {
  // Unique gradient ID per instance — react-native-svg gets confused
  // if two glows on the same screen share a Defs id.
  const idRef = useRef<string | null>(null);
  if (!idRef.current) {
    glowIdCounter += 1;
    idRef.current = `softGlow${glowIdCounter}`;
  }
  const id = idRef.current;
  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient
            id={id}
            cx={`${cx * 100}%`}
            cy={`${cy * 100}%`}
            r="80%"
          >
            <Stop offset="0" stopColor={color} stopOpacity={String(opacity)} />
            <Stop offset={String(fade)} stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill={`url(#${id})`}
        />
      </Svg>
    </View>
  );
};
