import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors } from '../../constants/colors';

export type LunaMood = 'idle' | 'happy' | 'excited' | 'sleep';

interface Props {
  mood?: LunaMood;
  size?: number;
}

/**
 * Chunky 16×16 pixel-art Luna sprite. Strict integer grid — every Rect
 * is exactly one logical pixel wide/tall. Renders through react-native-svg
 * so it stays crisp at any size. Inspired by retro game sprites; designed
 * to read clearly even at small sizes (60–130px on auth screens).
 */

const GRID = 16;

const FUR = colors.cream;
const FUR_SHADE = '#C4B68F';
const BELLY = '#F5EAD0';
const STROKE = '#1A140C';
const GLASS = '#8AACCF';
const SHINE = '#FFFFFF';
const NOSE = '#D88878';
const BLUSH = 'rgba(216,136,120,0.5)';
const SPARK = '#D4AA6A';

// Sprite pixel map. '.' = transparent, single chars map to a palette.
// Frames let us swap mouth/eyes without re-laying out the rest.
const PALETTE: Record<string, string> = {
  '#': STROKE, // outline / pupils / mouth
  'F': FUR,
  'S': FUR_SHADE,
  'B': BELLY,
  'G': GLASS,
  'W': SHINE,
  'N': NOSE,
  'P': BLUSH,
  'X': SPARK,
};

// Base body sprite (no eyes/mouth).
// Row index 0 = top.
const BASE: string[] = [
  // 0    1    2    3    4    5    6    7    8    9    10   11   12   13   14   15
  '................', // 0
  '....#.....#.....', // 1 — ear tips
  '...##....###....', // 2
  '...####.####....', // 3
  '..#FFFF#FFFF#...', // 4
  '..#FFFFFFFFF#...', // 5
  '..#FFFFFFFFF#...', // 6
  '..#FFFFFFFFF#...', // 7
  '..#FFFFFFFFF#...', // 8
  '...#FFFFFFF#....', // 9
  '....#FFFFF#.....', // 10
  '....#FFFFF#.....', // 11
  '...#FFFFFFF#....', // 12
  '...#FFFFFFF#....', // 13
  '...#F#...#F#....', // 14
  '...###...###....', // 15
];

// Overlay sprites — glasses, mouth, ears, accents.
const GLASSES: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..#GG#.#GG#.....',
  '.#G##G#G##G#....',
  '..#GG#.#GG#.....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

// Belly highlight
const BELLY_OVERLAY: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '....BBBBB.......',
  '....BBBBB.......',
  '....BBBBB.......',
  '................',
  '................',
  '................',
];

const earBlush = (mood: LunaMood): string[] => [
  '................',
  '................',
  '....P.....P.....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const eyesIdle: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...#..W..#..W...',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const eyesHappy: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..####..####....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const eyesSleep: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...####.####....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const mouthIdle: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '......N.........',
  '.....#.#........',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const mouthHappy: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '......N.........',
  '....#.#.#.......',
  '.....###........',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const blushOverlay: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.PP..........PP.',
  '.PP..........PP.',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const sparkleOverlay: string[] = [
  'X..............X',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  'X..............X',
];

const sleepZ: string[] = [
  '...........###..',
  '............#...',
  '...........#....',
  '..........###...',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const compose = (layers: string[][]): string[][] => layers;

const renderLayer = (layer: string[], cell: number, keyPrefix: string) => {
  const rects: React.ReactNode[] = [];
  for (let r = 0; r < layer.length; r++) {
    const row = layer[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const fill = PALETTE[ch];
      if (!fill) continue;
      rects.push(
        <Rect
          key={`${keyPrefix}-${r}-${c}`}
          x={c * cell}
          y={r * cell}
          width={cell + 0.5}
          height={cell + 0.5}
          fill={fill}
        />,
      );
    }
  }
  return rects;
};

export const LunaPixel = ({ mood = 'idle', size = 110 }: Props) => {
  const cell = size / GRID;

  const eyes =
    mood === 'sleep'
      ? eyesSleep
      : mood === 'happy' || mood === 'excited'
        ? eyesHappy
        : eyesIdle;

  const mouth =
    mood === 'happy' || mood === 'excited' ? mouthHappy : mouthIdle;

  const layers = [
    BASE,
    BELLY_OVERLAY,
    earBlush(mood),
    GLASSES,
    eyes,
    mouth,
    ...(mood === 'happy' || mood === 'excited'
      ? [blushOverlay, sparkleOverlay]
      : []),
    ...(mood === 'sleep' ? [sleepZ] : []),
  ];

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
        {compose(layers).flatMap((layer, i) =>
          renderLayer(layer, 1, `l${i}`),
        )}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
