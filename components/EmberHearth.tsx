// EmberHearth — the Focus tab's signature timer visual.
//
// Not a generic clock ring; a warm glowing core surrounded by a
// depleting ember arc, minute tick marks (lit ticks recede as time
// runs down), and a leading dot at the arc head. Slow breathing
// pulse on the core so the flame reads as "alive but calm" — not a
// strobe.
//
// Progress fraction (frac) drives BOTH the arc angle AND the core
// gradient hot-color (glow → ember → emberDk as the block cools).
// Callers pass `frac = remain / total`, so the hearth burns down.
//
// Sparks are intentionally omitted from this iteration — the design
// mockup uses a rAF-driven particle system on Canvas. Layering that
// on top of an already-animated Svg + breathing halo turns into a
// visible perf tax on iOS. If we add them later, likely as a small
// Animated.View pool with pooled positions.

import { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Line,
} from 'react-native-svg';

const C = {
  bone: '#ECE0CB',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  glow: '#F4C98A',
} as const;

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface EmberHearthProps {
  /** remain / total — 1 at start, 0 at end. Drives arc + core heat. */
  frac: number;
  /** Session running (breathing pulse ON) vs paused (calmer, dimmer). */
  running: boolean;
  /** Canvas size in px. Defaults to the mockup's 272. */
  size?: number;
}

export function EmberHearth({ frac, running, size = 272 }: EmberHearthProps) {
  const cx = size / 2;
  const cy = size / 2;
  const clampedFrac = Math.max(0, Math.min(1, frac));

  // Ring geometry — 60 tick marks around the outer edge, main
  // progress ring inset from ticks.
  const tickR = size * 0.455;
  const R = size * 0.375;
  const CIRC = 2 * Math.PI * R;

  // Hot color darkens as the block cools — glow (fresh) → ember
  // (mid) → emberDk (nearly out). Reads as a real hearth burning
  // down instead of a solid ring depleting.
  const hotColor =
    clampedFrac > 0.6 ? C.glow : clampedFrac > 0.3 ? C.ember : C.emberDk;

  // Breathing pulse — Animated.Value looped between 0 and 1. Slower
  // when paused so the visual matches the state.
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const dur = running ? 3200 : 5000;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: dur / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: dur / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [running, breath]);

  // Leading dot position on the arc head — polar → cartesian.
  const arcEndAngle = -Math.PI / 2 + clampedFrac * Math.PI * 2;
  const dotX = cx + Math.cos(arcEndAngle) * R;
  const dotY = cy + Math.sin(arcEndAngle) * R;

  // Core alpha + size get a small breath multiplier. The Animated
  // scale on the wrapping View gives us the breath without needing
  // to re-render the SVG on every frame (SVG updates via React state
  // would tank the framerate).
  const coreBreath = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });
  const coreOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [running ? 0.85 : 0.55, running ? 1 : 0.7],
  });

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Base SVG — well + ticks + track + progress arc + leading dot */}
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id="hearthRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#9C4E2E" />
            <Stop offset="0.55" stopColor={C.ember} />
            <Stop offset="1" stopColor={C.glow} />
          </LinearGradient>
          <RadialGradient
            id="hearthDot"
            cx="50%"
            cy="50%"
            r="50%"
            fx="50%"
            fy="50%"
          >
            <Stop offset="0" stopColor={C.glow} stopOpacity={0.95} />
            <Stop offset="1" stopColor={C.glow} stopOpacity={0} />
          </RadialGradient>
          {/* Deep warm well — gives the inside of the ring real
             depth vs the flat/transparent look. Reads as a hearth
             sunken into the card, not a decal painted on top. */}
          <RadialGradient
            id="hearthWell"
            cx="50%"
            cy="50%"
            r="50%"
            fx="50%"
            fy="50%"
          >
            <Stop offset="0" stopColor="#2B2019" stopOpacity={1} />
            <Stop offset="0.6" stopColor="#1C1512" stopOpacity={1} />
            <Stop offset="1" stopColor="#120E0C" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* Well — sits under everything, gives depth. */}
        <Circle cx={cx} cy={cy} r={size * 0.415} fill="url(#hearthWell)" />

        {/* Minute ticks — lit as long as the fraction hasn't crossed
           them yet. Major ticks every 5. */}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const major = i % 5 === 0;
          const lit = i / 60 <= clampedFrac;
          const inner = tickR - (major ? 10 : 6);
          const strokeColor = lit
            ? hexA(C.ember, major ? 0.55 : 0.34)
            : hexA(C.bone, 0.06);
          return (
            <Line
              key={i}
              x1={cx + Math.cos(a) * tickR}
              y1={cy + Math.sin(a) * tickR}
              x2={cx + Math.cos(a) * inner}
              y2={cy + Math.sin(a) * inner}
              stroke={strokeColor}
              strokeWidth={major ? 2 : 1.3}
              strokeLinecap="round"
            />
          );
        })}

        {/* Track */}
        <Circle
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke={hexA(C.bone, 0.07)}
          strokeWidth={9}
        />

        {/* Depleting progress arc. Stroke-dasharray trick with the
           full circumference and offset by (1-frac)*CIRC gives us a
           clean arc without needing a Path with polar math. */}
        <Circle
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke="url(#hearthRing)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${CIRC}`}
          strokeDashoffset={CIRC * (1 - clampedFrac)}
          transform={`rotate(-90 ${cx} ${cy})`}
        />

        {/* Comet head — soft halo + bright core, riding the arc
           head. Halo is larger + brighter than a plain dot per the
           mockup ("comet head" not "pin"). */}
        <Circle cx={dotX} cy={dotY} r={17} fill="url(#hearthDot)" />
        <Circle cx={dotX} cy={dotY} r={3.4} fill="#FFF6E4" />
      </Svg>

      {/* Central hearth — layered on top via absolute so we can
         animate scale + opacity independently of the SVG (which
         doesn't play well with cheap Animated updates). Uses View
         with radial-ish gradient via nested SVG so we get the same
         glow/ember/emberDk transitions the mock has. */}
      <Animated.View
        style={{
          position: 'absolute',
          width: size * 0.54,
          height: size * 0.54,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: coreBreath }],
          opacity: coreOpacity,
        }}
        pointerEvents="none"
      >
        <Svg
          width={size * 0.54}
          height={size * 0.54}
          viewBox={`0 0 ${size * 0.54} ${size * 0.54}`}
        >
          <Defs>
            <RadialGradient
              id="hearthCore"
              cx="50%"
              cy="50%"
              r="50%"
              fx="50%"
              fy="50%"
            >
              <Stop
                offset="0"
                stopColor="#FFF3D6"
                stopOpacity={lerp(0.32, 0.82, clampedFrac)}
              />
              <Stop
                offset="0.35"
                stopColor={hotColor}
                stopOpacity={lerp(0.28, 0.66, clampedFrac)}
              />
              <Stop
                offset="0.75"
                stopColor={C.ember}
                stopOpacity={lerp(0.09, 0.26, clampedFrac)}
              />
              <Stop offset="1" stopColor={C.ember} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle
            cx={(size * 0.54) / 2}
            cy={(size * 0.54) / 2}
            r={(size * 0.54) / 2}
            fill="url(#hearthCore)"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
