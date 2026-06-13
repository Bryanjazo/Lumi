import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors } from '../../constants/colors';

export type LunaMood = 'idle' | 'happy' | 'excited' | 'sleep';

interface Props {
  mood?: LunaMood;
  size?: number;
}

/**
 * Chibi pixel-art Luna sprite. Strict 16×16 integer grid, single-color
 * cream body with glasses as the only prominent feature. Matches the
 * mock screenshots: small ears that blend into the head, no dark
 * outline strokes, no white facial markings — just a soft cream
 * silhouette with chunky glasses.
 */

const GRID = 16;

const FUR = colors.cream;
const FUR_SHADE = '#C4B68F';
const GLASS_RIM = '#1A140C';
const GLASS_LENS = '#8AACCF';
const PUPIL = '#1A140C';
const SHINE = '#FFFFFF';
const NOSE = '#D88878';
const BLUSH = 'rgba(216,136,120,0.35)';
const SPARK = '#D4AA6A';

const PALETTE: Record<string, string> = {
  F: FUR,
  S: FUR_SHADE,
  R: GLASS_RIM,
  G: GLASS_LENS,
  P: PUPIL,
  W: SHINE,
  N: NOSE,
  B: BLUSH,
  X: SPARK,
  '#': PUPIL, // dark mouth/closed-eye line
};

// Body silhouette — all cream, no dark outlines. Reads as a soft mascot.
const BODY: string[] = [
  // 0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
  '................', // 0
  '....F.......F...', // 1  small ear tips
  '...FF.......FF..', // 2
  '...FF.......FF..', // 3
  '..FFFFFFFFFFFFF.', // 4  top of head
  '..FFFFFFFFFFFFF.', // 5
  '..FFFFFFFFFFFFF.', // 6  glasses sit on this row
  '..FFFFFFFFFFFFF.', // 7
  '..FFFFFFFFFFFFF.', // 8  nose row
  '...FFFFFFFFFFF..', // 9  chin
  '....FFFFFFFFFF..', // 10 neck
  '...FFFFFFFFFFF..', // 11 body
  '...FFFFFFFFFFF..', // 12 body
  '...FF.FFFFFF.F..', // 13 body w/ leg-gap
  '...FF..FFF...F..', // 14 legs
  '...FF..FFF......', // 15 feet
];

// Subtle belly highlight
const BELLY: string[] = [
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
  '......SSSS......',
  '......SSSS......',
  '................',
  '................',
  '................',
];

// Glasses — the only prominent feature.
// Two round-ish frames connected by a bridge, sitting on rows 5-7.
const GLASSES: string[] = [
  '................',
  '................',
  '................',
  '................',
  '...RRR...RRR....', // 4 top of frames
  '..RGGGR.RGGGR...', // 5 frame + lens
  '..RGGGR.RGGGR...', // 6 lens
  '...RRR...RRR....', // 7 bottom of frames
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
  '....P....P......', // 5
  '....PW...PW.....', // 6 pupil + shine
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
  '..#PPR#.#PPR#...', // closed-arc happy eyes inside frames
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
  '..############..', // closed-eye line across frames
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
  '........N.......', // tiny nose
  '.......#.#......', // small smile-line
  '................',
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
  '........N.......',
  '.......#.#......',
  '........#.......', // little smile dot
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const blushDots: string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  'BB...........BB.',
  'BB...........BB.',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const sparkles: string[] = [
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

const renderLayer = (layer: string[], keyPrefix: string) => {
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
          x={c}
          y={r}
          width={1.02}
          height={1.02}
          fill={fill}
        />,
      );
    }
  }
  return rects;
};

export const LunaPixel = ({ mood = 'idle', size = 110 }: Props) => {
  const eyes =
    mood === 'sleep'
      ? eyesSleep
      : mood === 'happy' || mood === 'excited'
        ? eyesHappy
        : eyesIdle;

  const mouth =
    mood === 'happy' || mood === 'excited' ? mouthHappy : mouthIdle;

  const layers = [
    BODY,
    BELLY,
    GLASSES,
    eyes,
    mouth,
    ...(mood === 'happy' || mood === 'excited' ? [blushDots, sparkles] : []),
    ...(mood === 'sleep' ? [sleepZ] : []),
  ];

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
        {layers.flatMap((layer, i) => renderLayer(layer, `l${i}`))}
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
