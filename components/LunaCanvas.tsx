import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, G, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '../constants/colors';
import { usePetStore } from '../store/petStore';
import { skins } from '../constants/skins';
import { LunaState } from '../lib/gamification';

/**
 * Pixel-art room renderer. The room is a 32×24 grid of "pixels".
 * Luna is rendered as a small pixel cat that walks/sits/sleeps depending
 * on her state. Equipped items drive the props on the floor.
 */

interface Props {
  state: LunaState;
  size?: number;
}

const COLS = 32;
const ROWS = 24;

const wallTone = (s: LunaState) => {
  // Warmer, dustier walls — like tungsten light on aged paper.
  if (s === 'thriving') return ['#3D2F36', '#26201D'];
  if (s === 'struggling') return ['#322820', '#1D1812'];
  return ['#1A1612', '#15110D'];
};
const floorTone = (s: LunaState) =>
  s === 'thriving' ? '#5C402A' : s === 'struggling' ? '#3C2E1F' : '#241A12';

type FrameKey = 'sit' | 'walkA' | 'walkB' | 'sleep' | 'groom';

const CAT_FRAMES: Record<FrameKey, [number, number][]> = {
  sit: [
    [0, 1], [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 0], [3, 0],
    [0, 3], [3, 3],
  ],
  walkA: [
    [0, 1], [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 0], [3, 0],
    [0, 3], [3, 3],
    [1, 3],
  ],
  walkB: [
    [0, 1], [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 0], [3, 0],
    [0, 3], [3, 3],
    [2, 3],
  ],
  sleep: [
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2],
    [0, 3], [1, 3], [2, 3], [3, 3], [4, 3],
    [0, 1], [1, 1],
  ],
  groom: [
    [0, 1], [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 0], [3, 0],
    [0, 3], [3, 3],
    [2, 0],
  ],
};

export const LunaCanvas = ({ state, size = 320 }: Props) => {
  const skinId = usePetStore((s) => s.skinId);
  const equipped = usePetStore((s) => s.equipped);
  const skin = skins.find((s) => s.id === skinId) ?? skins[0];

  const [frame, setFrame] = useState<FrameKey>('sit');
  const [x, setX] = useState(14);
  const dir = useRef(1);

  useEffect(() => {
    let cancel = false;
    const tick = () => {
      if (cancel) return;
      if (state === 'away') {
        setFrame('sleep');
      } else if (state === 'thriving') {
        // walk back and forth + occasional groom
        if (Math.random() < 0.18) {
          setFrame('groom');
        } else {
          setFrame((f) => (f === 'walkA' ? 'walkB' : 'walkA'));
          setX((cur) => {
            const next = cur + dir.current;
            if (next > 22) dir.current = -1;
            if (next < 8) dir.current = 1;
            return next + dir.current * 0;
          });
        }
      } else {
        setFrame((f) => (f === 'sit' ? 'groom' : 'sit'));
      }
    };
    tick();
    const id = setInterval(tick, state === 'thriving' ? 700 : 1400);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [state]);

  const cell = size / COLS;
  const [wallA, wallB] = wallTone(state);
  const floor = floorTone(state);

  const px = (cx: number, cy: number, color: string, key?: string) => (
    <Rect
      key={key ?? `${cx}-${cy}`}
      x={cx * cell}
      y={cy * cell}
      width={cell + 0.4}
      height={cell + 0.4}
      fill={color}
    />
  );

  return (
    <View style={[styles.wrap, { width: size, height: (size * ROWS) / COLS }]}>
      <Svg width={size} height={(size * ROWS) / COLS}>
        <Defs>
          <LinearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={wallA} />
            <Stop offset="1" stopColor={wallB} />
          </LinearGradient>
        </Defs>
        {/* wall */}
        <Rect x={0} y={0} width={size} height={cell * 16} fill="url(#wall)" />
        {/* floor */}
        <Rect x={0} y={cell * 16} width={size} height={cell * 8} fill={floor} />

        {/* baseboard */}
        <Rect
          x={0}
          y={cell * 15.5}
          width={size}
          height={cell * 0.6}
          fill={state === 'away' ? '#0E0B08' : '#1A130C'}
        />

        {/* Window decor */}
        {equipped.decor === 'decor-window' && (
          <G>
            <Rect
              x={cell * 22}
              y={cell * 3}
              width={cell * 7}
              height={cell * 7}
              fill={state === 'thriving' ? '#8AACCF' : '#3A4A5A'}
            />
            <Rect
              x={cell * 25.5}
              y={cell * 3}
              width={cell * 0.5}
              height={cell * 7}
              fill="#0E0B08"
            />
            <Rect
              x={cell * 22}
              y={cell * 6.5}
              width={cell * 7}
              height={cell * 0.5}
              fill="#0E0B08"
            />
          </G>
        )}
        {equipped.decor === 'decor-art' && (
          <G>
            <Rect x={cell * 22} y={cell * 4} width={cell * 6} height={cell * 5} fill={colors.plum} />
            <Rect x={cell * 23} y={cell * 5} width={cell * 4} height={cell * 3} fill={colors.bg} />
          </G>
        )}
        {equipped.decor === 'decor-clock' && (
          <G>
            <Rect x={cell * 24} y={cell * 4} width={cell * 4} height={cell * 4} fill={colors.caramel} />
            <Rect x={cell * 25.5} y={cell * 5} width={cell * 0.4} height={cell * 1.5} fill={colors.bg} />
            <Rect x={cell * 26} y={cell * 6} width={cell * 1} height={cell * 0.4} fill={colors.bg} />
          </G>
        )}

        {/* Lamp */}
        {equipped.lamp === 'lamp-warm' && (
          <G>
            <Rect x={cell * 2} y={cell * 11} width={cell * 3} height={cell * 1} fill={colors.caramel} />
            <Rect x={cell * 3} y={cell * 12} width={cell * 1} height={cell * 4} fill="#3A2D20" />
            {state !== 'away' && (
              <>
                <Rect x={cell * 0.5} y={cell * 10.5} width={cell * 6} height={cell * 1.4} fill="rgba(201,158,94,0.18)" />
                <Rect x={cell * 1.2} y={cell * 11.5} width={cell * 4.6} height={cell * 6} fill="rgba(201,158,94,0.08)" />
              </>
            )}
          </G>
        )}
        {equipped.lamp === 'lamp-plum' && (
          <G>
            <Rect x={cell * 2} y={cell * 11} width={cell * 3} height={cell * 1} fill={colors.plum} />
            <Rect x={cell * 3} y={cell * 12} width={cell * 1} height={cell * 4} fill="#3A2D20" />
          </G>
        )}
        {equipped.lamp === 'lamp-moss' && (
          <G>
            <Rect x={cell * 2} y={cell * 11} width={cell * 3} height={cell * 1} fill={colors.moss} />
            <Rect x={cell * 3} y={cell * 12} width={cell * 1} height={cell * 4} fill="#3A2D20" />
          </G>
        )}

        {/* Plant */}
        {equipped.plant === 'plant-fern' && (
          <G>
            <Rect x={cell * 28} y={cell * 14} width={cell * 2} height={cell * 2} fill="#5A3F2A" />
            <Rect x={cell * 27.5} y={cell * 12} width={cell * 3} height={cell * 2} fill={colors.moss} />
            <Rect x={cell * 28} y={cell * 11} width={cell * 2} height={cell * 1} fill={colors.moss} />
          </G>
        )}
        {equipped.plant === 'plant-monstera' && (
          <G>
            <Rect x={cell * 28} y={cell * 14} width={cell * 2} height={cell * 2} fill="#5A3F2A" />
            <Rect x={cell * 27} y={cell * 11} width={cell * 4} height={cell * 3} fill={colors.moss} />
          </G>
        )}
        {equipped.plant === 'plant-cactus' && (
          <G>
            <Rect x={cell * 28} y={cell * 14} width={cell * 2} height={cell * 2} fill="#5A3F2A" />
            <Rect x={cell * 28.5} y={cell * 11} width={cell * 1} height={cell * 3} fill={colors.moss} />
            <Rect x={cell * 29.5} y={cell * 12} width={cell * 0.5} height={cell * 2} fill={colors.moss} />
          </G>
        )}

        {/* Rug */}
        {equipped.rug && (
          <Rect
            x={cell * 9}
            y={cell * 19}
            width={cell * 14}
            height={cell * 2}
            fill={
              equipped.rug === 'rug-moss'
                ? colors.moss
                : equipped.rug === 'rug-caramel'
                  ? colors.caramel
                  : colors.plum
            }
            opacity={0.6}
          />
        )}

        {/* Sofa */}
        {equipped.sofa === 'sofa-cream' && (
          <G>
            <Rect x={cell * 16} y={cell * 14} width={cell * 7} height={cell * 3} fill={colors.cream2} />
            <Rect x={cell * 16} y={cell * 13} width={cell * 7} height={cell * 1.5} fill={colors.cream} />
            <Rect x={cell * 16} y={cell * 17} width={cell * 7} height={cell * 1} fill="#8B6F4E" />
          </G>
        )}
        {equipped.sofa === 'sofa-mist' && (
          <G>
            <Rect x={cell * 16} y={cell * 14} width={cell * 7} height={cell * 3} fill={colors.mist} />
            <Rect x={cell * 16} y={cell * 13} width={cell * 7} height={cell * 1.5} fill="#A8C2DE" />
          </G>
        )}
        {equipped.sofa === 'sofa-plum' && (
          <G>
            <Rect x={cell * 16} y={cell * 14} width={cell * 7} height={cell * 3} fill={colors.plumDark} />
            <Rect x={cell * 16} y={cell * 13} width={cell * 7} height={cell * 1.5} fill={colors.plum} />
          </G>
        )}

        {/* Toy on floor */}
        {equipped.toy === 'toy-yarn' && (
          <G>
            <Rect x={cell * 7} y={cell * 20} width={cell * 1.5} height={cell * 1.5} fill={colors.rose} />
          </G>
        )}
        {equipped.toy === 'toy-mouse' && (
          <G>
            <Rect x={cell * 7} y={cell * 20.3} width={cell * 1.6} height={cell * 1} fill={colors.terra} />
          </G>
        )}
        {equipped.toy === 'toy-feather' && (
          <G>
            <Rect x={cell * 7} y={cell * 19.5} width={cell * 0.3} height={cell * 2} fill={colors.plum} />
            <Rect x={cell * 6.4} y={cell * 19.2} width={cell * 1.5} height={cell * 0.5} fill={colors.plum} />
          </G>
        )}

        {/* Luna */}
        <G>
          {CAT_FRAMES[frame].map(([dx, dy], i) => {
            const cx = x + dx;
            const cy = (state === 'away' ? 16 : 16) + dy - 1;
            const color =
              (dx === 1 && dy === 0) || (dx === 2 && dy === 0)
                ? skin.secondary
                : skin.primary;
            return px(cx, cy, color, `cat-${i}`);
          })}
          {/* eyes (only when not sleeping) */}
          {state !== 'away' && (
            <>
              <Rect
                x={(x + 1) * cell + cell * 0.2}
                y={(15 + 1) * cell + cell * 0.2}
                width={cell * 0.35}
                height={cell * 0.35}
                fill={colors.bg}
              />
              <Rect
                x={(x + 2) * cell + cell * 0.2}
                y={(15 + 1) * cell + cell * 0.2}
                width={cell * 0.35}
                height={cell * 0.35}
                fill={colors.bg}
              />
            </>
          )}
        </G>
      </Svg>
      {state === 'thriving' && <View style={styles.warmGlow} pointerEvents="none" />}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
  },
  warmGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(201,158,94,0.07)',
  },
});
