// TwinkleMotes — the tiny ambient "fireflies" from
// lumi-home-capture-4.jsx. A handful of 2–3px radial-gradient dots
// scattered around the header, each pulsing opacity 0.3→1 and scale
// 0.8→1.1 on a slow ~3.2s loop with staggered delays. Pure ambience:
// pointerEvents none, native-driver only, nothing re-renders.
//
// Positions are passed in (not random) so each screen can art-direct
// where its motes sit — the mockup places them deliberately around
// the greeting, not in the content column.

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

export interface Mote {
  /** Absolute position within the parent, px. */
  x: number;
  y: number;
  /** Dot radius, px (the soft gradient extends to 2r). */
  r: number;
  /** Glow color (hex). */
  color: string;
  /** Loop stagger, seconds — mirrors the mockup's animation-delay. */
  delay: number;
}

let moteIdCounter = 0;

const TwinkleMote = ({ mote }: { mote: Mote }) => {
  // Unique gradient id per instance — react-native-svg gets confused
  // when two Defs on one screen share an id (same fix as SoftGlow).
  const idRef = useRef<string | null>(null);
  if (!idRef.current) {
    moteIdCounter += 1;
    idRef.current = `twinkleMote${moteIdCounter}`;
  }
  const id = idRef.current;

  const tw = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(mote.delay * 1000),
        Animated.timing(tw, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(tw, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tw, mote.delay]);

  const opacity = tw.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1],
  });
  const scale = tw.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1.1],
  });

  const d = mote.r * 4; // canvas is 2× the visible glow so the fade breathes
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: mote.x - d / 2,
        top: mote.y - d / 2,
        width: d,
        height: d,
        opacity,
        transform: [{ scale }],
      }}
    >
      <Svg width={d} height={d} viewBox={`0 0 ${d} ${d}`}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={mote.color} stopOpacity={0.55} />
            <Stop offset="0.68" stopColor={mote.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={d / 2} cy={d / 2} r={d / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
};

export const TwinkleMotes = ({ motes }: { motes: Mote[] }) => (
  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {motes.map((m, i) => (
      <TwinkleMote key={i} mote={m} />
    ))}
  </View>
);
