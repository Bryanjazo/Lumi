import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors } from '../../constants/colors';

export type LunaMood = 'idle' | 'happy' | 'excited' | 'sleep';

interface Props {
  mood?: LunaMood;
  size?: number;
}

/**
 * Pixel-art Luna sprite used on the auth screens. 20×20 logical grid
 * rendered through react-native-svg's Rect primitive so it stays crisp
 * at any size. The character has the chunky look from the mocks: round
 * head with glasses-like eyes, small body, two legs, and a tail.
 */

const GRID = 20;

// Pixel colors used by the sprite.
const FUR = colors.cream;
const FUR_DARK = colors.cream2;
const STROKE = '#1A140C';
const GLASS_RIM = '#1A140C';
const GLASS = '#8AACCF';
const GLASS_SHINE = '#FFFFFF';
const NOSE = '#D88878';
const SPARK = '#D4AA6A';
const BLUSH = 'rgba(216,136,120,0.45)';

const px = (
  x: number,
  y: number,
  cell: number,
  fill: string,
  key: string,
  w = 1,
  h = 1,
) => (
  <Rect
    key={key}
    x={x * cell}
    y={y * cell}
    width={w * cell + 0.4}
    height={h * cell + 0.4}
    fill={fill}
  />
);

export const LunaPixel = ({ mood = 'idle', size = 110 }: Props) => {
  const cell = size / GRID;
  const sleeping = mood === 'sleep';
  const happy = mood === 'happy' || mood === 'excited';

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
        {/* ─── Head outline (rows 3–10) ───────────────────── */}
        {/* top row */}
        {px(8, 2, 1, FUR, 't1')}
        {px(9, 2, 1, FUR, 't2')}
        {px(10, 2, 1, FUR, 't3')}
        {px(11, 2, 1, FUR, 't4')}

        {/* ears */}
        {px(7, 3, 1, FUR, 'eL1')}
        {px(8, 3, 1, FUR, 'eL2')}
        {px(11, 3, 1, FUR, 'eR1')}
        {px(12, 3, 1, FUR, 'eR2')}
        {/* inner ear pink */}
        {px(7, 3.4, 1, BLUSH, 'eLi', 0.6, 0.6)}
        {px(12, 3.4, 1, BLUSH, 'eRi', 0.6, 0.6)}

        {/* row 4: cheeks widen */}
        {px(6, 4, 1, FUR, 'r4-1')}
        {px(7, 4, 1, FUR, 'r4-2')}
        {px(8, 4, 1, FUR, 'r4-3')}
        {px(9, 4, 1, FUR, 'r4-4')}
        {px(10, 4, 1, FUR, 'r4-5')}
        {px(11, 4, 1, FUR, 'r4-6')}
        {px(12, 4, 1, FUR, 'r4-7')}
        {px(13, 4, 1, FUR, 'r4-8')}

        {/* rows 5–7: main head */}
        {[5, 6, 7].map((y) =>
          [6, 7, 8, 9, 10, 11, 12, 13].map((x) =>
            px(x, y, 1, FUR, `head-${x}-${y}`),
          ),
        )}

        {/* row 8 narrows */}
        {px(7, 8, 1, FUR, 'r8-1')}
        {px(8, 8, 1, FUR, 'r8-2')}
        {px(9, 8, 1, FUR, 'r8-3')}
        {px(10, 8, 1, FUR, 'r8-4')}
        {px(11, 8, 1, FUR, 'r8-5')}
        {px(12, 8, 1, FUR, 'r8-6')}

        {/* chin */}
        {px(8, 9, 1, FUR, 'r9-1')}
        {px(9, 9, 1, FUR, 'r9-2')}
        {px(10, 9, 1, FUR, 'r9-3')}
        {px(11, 9, 1, FUR, 'r9-4')}

        {/* ─── Glasses ──────────────────────────────────── */}
        {/* bridge */}
        {px(9.8, 5.8, 1, GLASS_RIM, 'bridge', 0.5, 0.4)}
        {/* left lens rim */}
        {px(7, 5, 1, GLASS_RIM, 'gL-top', 2.4, 0.4)}
        {px(7, 7, 1, GLASS_RIM, 'gL-bot', 2.4, 0.4)}
        {px(6.6, 5, 1, GLASS_RIM, 'gL-l', 0.4, 2.4)}
        {px(9, 5, 1, GLASS_RIM, 'gL-r', 0.4, 2.4)}
        {/* right lens rim */}
        {px(10.6, 5, 1, GLASS_RIM, 'gR-top', 2.4, 0.4)}
        {px(10.6, 7, 1, GLASS_RIM, 'gR-bot', 2.4, 0.4)}
        {px(10.6, 5, 1, GLASS_RIM, 'gR-l', 0.4, 2.4)}
        {px(13, 5, 1, GLASS_RIM, 'gR-r', 0.4, 2.4)}
        {/* lens fill */}
        {sleeping ? (
          <>
            {/* closed eyes — dark lines */}
            {px(7, 6, 1, STROKE, 'slpL', 2, 0.3)}
            {px(10.6, 6, 1, STROKE, 'slpR', 2, 0.3)}
          </>
        ) : (
          <>
            {/* lens glass */}
            {px(7, 5.4, 1, GLASS, 'lensL', 2, 1.6)}
            {px(10.6, 5.4, 1, GLASS, 'lensR', 2, 1.6)}
            {/* pupils — slightly different shape if happy */}
            {happy ? (
              <>
                {px(7.4, 6.4, 1, STROKE, 'pupL', 0.6, 0.5)}
                {px(11, 6.4, 1, STROKE, 'pupR', 0.6, 0.5)}
              </>
            ) : (
              <>
                {px(7.4, 5.6, 1, STROKE, 'pupL', 0.7, 1.1)}
                {px(11, 5.6, 1, STROKE, 'pupR', 0.7, 1.1)}
              </>
            )}
            {/* shines */}
            {px(7.3, 5.5, 1, GLASS_SHINE, 'shL', 0.3, 0.3)}
            {px(10.9, 5.5, 1, GLASS_SHINE, 'shR', 0.3, 0.3)}
          </>
        )}

        {/* ─── Face: nose + mouth + blush ──────────────── */}
        {px(9.6, 8, 1, NOSE, 'nose', 0.7, 0.5)}
        {happy ? (
          <>
            {/* smile */}
            {px(9, 8.7, 1, STROKE, 'sm1', 0.4, 0.3)}
            {px(9.4, 8.9, 1, STROKE, 'sm2', 1.1, 0.3)}
            {px(10.5, 8.7, 1, STROKE, 'sm3', 0.4, 0.3)}
          </>
        ) : sleeping ? (
          <>{px(9.4, 8.8, 1, STROKE, 'rest', 1.1, 0.3)}</>
        ) : (
          <>{px(9.3, 8.8, 1, STROKE, 'mouth', 1.2, 0.3)}</>
        )}
        {/* blush dots */}
        {happy && (
          <>
            {px(6.8, 7.6, 1, BLUSH, 'bL', 0.8, 0.5)}
            {px(12.4, 7.6, 1, BLUSH, 'bR', 0.8, 0.5)}
          </>
        )}

        {/* ─── Body ────────────────────────────────────── */}
        {/* neck/collar transition */}
        {px(9, 10, 1, FUR_DARK, 'neck1')}
        {px(10, 10, 1, FUR_DARK, 'neck2')}
        {/* main body */}
        {[11, 12, 13, 14].map((y) =>
          [7, 8, 9, 10, 11, 12].map((x) =>
            px(x, y, 1, FUR, `body-${x}-${y}`),
          ),
        )}
        {/* belly highlight */}
        {[11, 12, 13].map((y) =>
          [9, 10].map((x) =>
            px(x, y, 1, '#F5EAD0', `belly-${x}-${y}`),
          ),
        )}
        {/* row 15 narrows */}
        {px(8, 15, 1, FUR, 'r15-1')}
        {px(9, 15, 1, FUR, 'r15-2')}
        {px(10, 15, 1, FUR, 'r15-3')}
        {px(11, 15, 1, FUR, 'r15-4')}

        {/* ─── Legs ────────────────────────────────────── */}
        {px(8, 16, 1, FUR, 'lg-L1')}
        {px(8, 17, 1, FUR, 'lg-L2')}
        {px(11, 16, 1, FUR, 'lg-R1')}
        {px(11, 17, 1, FUR, 'lg-R2')}
        {px(7.5, 17.4, 1, STROKE, 'pawL', 1.5, 0.5)}
        {px(11, 17.4, 1, STROKE, 'pawR', 1.5, 0.5)}

        {/* ─── Tail (curls right) ─────────────────────── */}
        {px(13, 12, 1, FUR, 'tail1')}
        {px(14, 11, 1, FUR, 'tail2')}
        {px(15, 10, 1, FUR, 'tail3')}
        {px(15, 9, 1, FUR, 'tail4')}

        {/* ─── Sparkles (happy/excited only) ─────────── */}
        {happy && (
          <>
            {px(4, 4, 1, SPARK, 'sp1', 0.5, 0.5)}
            {px(15, 5, 1, SPARK, 'sp2', 0.5, 0.5)}
            {px(16, 9, 1, SPARK, 'sp3', 0.4, 0.4)}
            {px(3, 9, 1, SPARK, 'sp4', 0.4, 0.4)}
          </>
        )}
        {/* sleep Zs */}
        {sleeping && (
          <>
            {px(14, 4, 1, STROKE, 'z1', 1.2, 0.3)}
            {px(14, 4.3, 1, STROKE, 'z2', 0.3, 1)}
            {px(14, 5.3, 1, STROKE, 'z3', 1.2, 0.3)}
          </>
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
