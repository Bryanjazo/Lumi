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
// Ambient life (per lumi-home-capture-4.jsx, "life, not strobe"):
//   - a slow conic sheen sweeping the well
//   - ambient motes orbiting slowly inside the well
//   - sparks drifting up from the hearth while running
// The mockup drives these with a rAF canvas particle system; here
// they're small pools of native-driver Animated.Views (fixed per-
// mount random params, looped) so nothing re-renders per frame and
// the SVG stays static. Exactly the approach the earlier perf note
// on this file called for.

import { useEffect, useMemo, useRef } from 'react';
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

// ── Conic sheen — a soft band of light sweeping the well ─────────────
// The mockup rotates a linear gradient across the clipped well (~12.5s
// per revolution). Here: a gradient-filled disc inside a continuously
// rotating Animated.View. Alpha is whisper-quiet (0.05) so it reads as
// "the coals shift" rather than a radar sweep. Dimmer when paused.
const WellSheen = ({ size, running }: { size: number; running: boolean }) => {
  const d = size * 0.68; // well interior (r = 0.34 · size)
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 12_500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: d,
        height: d,
        opacity: running ? 1 : 0.4,
        transform: [{ rotate }],
      }}
    >
      <Svg width={d} height={d} viewBox={`0 0 ${d} ${d}`}>
        <Defs>
          <LinearGradient id="wellSheen" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#F4C98A" stopOpacity={0.05} />
            <Stop offset="0.5" stopColor="#F4C98A" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Circle cx={d / 2} cy={d / 2} r={d / 2} fill="url(#wellSheen)" />
      </Svg>
    </Animated.View>
  );
};

// ── Ambient motes — slow orbiting embers inside the well ─────────────
// Nine motes on three counter-rotating rings (60–200s per orbit in the
// mockup — glacial on purpose). Each mote twinkles on its own offset
// so the field never pulses in unison. Rotation + opacity only, all
// native driver.
const MOTE_RINGS = [
  { duration: 95_000, dir: 1 },
  { duration: 150_000, dir: -1 },
  { duration: 210_000, dir: 1 },
] as const;

const MoteRing = ({
  size,
  running,
  ring,
}: {
  size: number;
  running: boolean;
  ring: number;
}) => {
  const { duration, dir } = MOTE_RINGS[ring];
  // Fixed per-mount layout — three motes per ring at pseudo-random
  // angle / radius / size, like the mockup's seeded field.
  const motes = useMemo(
    () =>
      Array.from({ length: 3 }, (_, i) => ({
        angle: Math.random() * Math.PI * 2 + (i * Math.PI * 2) / 3,
        rad: size * (0.1 + Math.random() * 0.17),
        r: 0.7 + Math.random() * 1.3,
        delay: Math.random() * 3500,
      })),
    [size],
  );
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, duration]);
  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: dir === 1 ? ['0deg', '360deg'] : ['360deg', '0deg'],
  });
  const d = size * 0.68;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: d,
        height: d,
        opacity: running ? 1 : 0.5,
        transform: [{ rotate }],
      }}
    >
      {motes.map((m, i) => (
        <Mote
          key={i}
          x={d / 2 + Math.cos(m.angle) * m.rad - m.r}
          y={d / 2 + Math.sin(m.angle) * m.rad - m.r}
          r={m.r}
          delay={m.delay}
        />
      ))}
    </Animated.View>
  );
};

const Mote = ({
  x,
  y,
  r,
  delay,
}: {
  x: number;
  y: number;
  r: number;
  delay: number;
}) => {
  const tw = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(tw, {
          toValue: 1,
          duration: 3500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(tw, {
          toValue: 0,
          duration: 3500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tw, delay]);
  const opacity = tw.interpolate({
    inputRange: [0, 1],
    outputRange: [0.06, 0.2],
  });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: C.glow,
        opacity,
      }}
    />
  );
};

// ── Rising sparks — the hearth breathes out embers while running ─────
// A pool of six sparks, each with fixed per-mount random params
// (offset / drift / rise / duration / stagger) looping on one shared
// progress value: rise, fade in fast, gutter out. Only mounted while
// the session is running, matching the mockup (paused hearth = still).
const Spark = ({ size, index }: { size: number; index: number }) => {
  // Per-mount random flight plan. Fixed params + varied durations
  // across the pool read organic at these alphas — no per-cycle
  // re-randomization (which would force re-renders) needed.
  const plan = useMemo(
    () => ({
      x: size / 2 + (Math.random() - 0.5) * size * 0.28,
      y: size / 2 + size * 0.06,
      drift: (Math.random() - 0.5) * size * 0.08,
      rise: size * (0.16 + Math.random() * 0.1),
      duration: 3800 + Math.random() * 2200,
      delay: index * 900 + Math.random() * 700,
      r: 0.6 + Math.random() * 1.2,
    }),
    [size, index],
  );
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(plan.delay),
        Animated.timing(p, {
          toValue: 1,
          duration: plan.duration,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [p, plan]);
  const translateY = p.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -plan.rise],
  });
  const translateX = p.interpolate({
    inputRange: [0, 1],
    outputRange: [0, plan.drift],
  });
  const opacity = p.interpolate({
    inputRange: [0, 0.12, 0.7, 1],
    outputRange: [0, 0.55, 0.28, 0],
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: plan.x - plan.r,
        top: plan.y - plan.r,
        width: plan.r * 2,
        height: plan.r * 2,
        borderRadius: plan.r,
        backgroundColor: C.glow,
        opacity,
        transform: [{ translateY }, { translateX }],
      }}
    />
  );
};

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
  // when paused so the visual matches the state. Period matches the
  // mockup's "slow ~10s breath" (sin·0.62 running / sin·0.4 paused)
  // — a resting heartbeat, not a strobe.
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const dur = running ? 10_000 : 15_600;
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

      {/* Conic sheen — sits over the well, under the core. */}
      <WellSheen size={size} running={running} />

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

      {/* Ambient motes — orbiting slowly inside the well, over the
         core glow so they read as embers drifting in the light. */}
      {MOTE_RINGS.map((_, i) => (
        <MoteRing key={i} size={size} running={running} ring={i} />
      ))}

      {/* Sparks — only while running. Mount/unmount (vs opacity 0)
         so a paused hearth spends zero cycles on them. */}
      {running && (
        <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Spark key={i} size={size} index={i} />
          ))}
        </View>
      )}
    </View>
  );
}
