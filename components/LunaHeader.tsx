import { useEffect, useState } from 'react';
import { View, StyleSheet, Dimensions, Image } from 'react-native';
import Svg, { Rect, G } from 'react-native-svg';
import { colors } from '../constants/colors';
import { lunaSource, useLunaSkin } from '../lib/luna-source';
import { useAmbientLunaMood } from '../lib/luna-mood';
import { LunaState } from '../lib/gamification';
import { usePetStore } from '../store/petStore';
import { skins } from '../constants/skins';

/**
 * Horizontal pixel-art room strip used as the Luna tab header. Renders at
 * 160×120 pixel grid (4:3) then scales up. Reuses the design language of
 * LunaCanvas but in a landscape format that fits the mock layout.
 */

interface Props {
  state: LunaState;
  height?: number;
}

const PX_W = 160;
const PX_H = 120;

const PAL = {
  thriving: {
    floorA: '#3D2E4A',
    floorB: '#352840',
    wallA: '#1E1628',
    wallB: '#261E32',
    winFrame: '#4A3A5A',
    winGlass: '#8AAAC8',
    winLight: '#C4D8F0',
    curtain: '#6A3A7A',
    lampBase: '#7A5A3A',
    lampShade: '#C4904A',
    lampGlow: 'rgba(212,170,106,0.20)',
    plantPot: '#6A3A2A',
    plantLeaf: '#4A8A4A',
    plantLeaf2: '#6AAA5A',
    sofaBody: '#4A3A6A',
    sofaTop: '#5A4A7A',
    sofaPillow: '#8A6AAA',
    tableBrown: '#5A3A28',
    tableTop: '#6A4A32',
    bookA: '#C4A0E0',
    bookB: '#8BBF96',
    bookC: '#D4AA6A',
    rugMain: '#5A3A6A',
    rugBorder: '#7A4A8A',
    rugAccent: '#C4A0E0',
  },
  struggling: {
    floorA: '#221A2A',
    floorB: '#1E1824',
    wallA: '#120E18',
    wallB: '#160C1C',
    winFrame: '#281E32',
    winGlass: '#3A4050',
    winLight: '#404858',
    curtain: '#2A1830',
    lampBase: '#3A2A18',
    lampShade: '#504028',
    lampGlow: 'rgba(60,44,20,0.08)',
    plantPot: '#3A2018',
    plantLeaf: '#2A5028',
    plantLeaf2: '#344A30',
    sofaBody: '#281E38',
    sofaTop: '#302840',
    sofaPillow: '#453260',
    tableBrown: '#301E14',
    tableTop: '#382416',
    bookA: '#5A4868',
    bookB: '#3A5A38',
    bookC: '#6A5030',
    rugMain: '#302038',
    rugBorder: '#3A2845',
    rugAccent: '#6A5080',
  },
  away: {
    floorA: '#160E1A',
    floorB: '#120C16',
    wallA: '#0C0810',
    wallB: '#0E0A14',
    winFrame: '#181020',
    winGlass: '#202028',
    winLight: '#282030',
    curtain: '#160E1C',
    lampBase: '#1E1410',
    lampShade: '#28201A',
    lampGlow: 'rgba(0,0,0,0)',
    plantPot: '#1E1008',
    plantLeaf: '#141C12',
    plantLeaf2: '#181E14',
    sofaBody: '#160E20',
    sofaTop: '#1A1228',
    sofaPillow: '#221830',
    tableBrown: '#16100A',
    tableTop: '#1A140C',
    bookA: '#302038',
    bookB: '#1C2C1C',
    bookC: '#302018',
    rugMain: '#1C1424',
    rugBorder: '#22182C',
    rugAccent: '#3A2850',
  },
} as const;

export const LunaHeader = ({ state, height = 140 }: Props) => {
  const skinId = usePetStore((s) => s.skinId);
  const skin = skins.find((s) => s.id === skinId) ?? skins[0];
  // Mood is derived from app-wide signals, with one override: the
  // legacy `state` prop's "away" still maps to sleep, since "away"
  // means the user hasn't shown up in a while.
  const ambient = useAmbientLunaMood();
  const mood = state === 'away' ? 'sleep' : ambient;
  const lunaSkin = useLunaSkin();

  const screenWidth = Math.min(Dimensions.get('window').width, 480);
  const width = screenWidth;
  const scale = width / PX_W;
  const renderHeight = PX_H * scale;
  const finalHeight = Math.min(height, renderHeight);

  const p = PAL[state];

  // Cat animation
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((x) => (x + 1) % 4), 600);
    return () => clearInterval(id);
  }, []);

  // Cat position — bottom-left on the rug for thriving, asleep for away.
  const catX = state === 'away' ? 65 : 70 + (phase % 2) * 2;
  const catY = state === 'away' ? 92 : 80;

  return (
    <View style={[styles.wrap, { height: finalHeight, width }]}>
      <Svg
        width={width}
        height={finalHeight}
        viewBox={`0 0 ${PX_W} ${PX_H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Floor banding */}
        <G>
          {Array.from({ length: PX_H }).map((_, r) => (
            <Rect
              key={`fl-${r}`}
              x={0}
              y={r}
              width={PX_W}
              height={1}
              fill={r % 4 < 2 ? p.floorA : p.floorB}
            />
          ))}
        </G>
        {/* Wall banding (top 46 rows) */}
        {Array.from({ length: 46 }).map((_, r) => (
          <Rect
            key={`wl-${r}`}
            x={0}
            y={r}
            width={PX_W}
            height={1}
            fill={r % 3 < 2 ? p.wallA : p.wallB}
          />
        ))}
        {/* Baseboard */}
        <Rect x={0} y={44} width={PX_W} height={2} fill={p.winFrame} />

        {/* Windows */}
        {[10, 118].map((wx) => (
          <G key={`win-${wx}`}>
            <Rect x={wx - 2} y={4} width={6} height={30} fill={p.curtain} />
            <Rect x={wx + 18} y={4} width={6} height={30} fill={p.curtain} />
            <Rect x={wx + 4} y={4} width={16} height={30} fill={p.winFrame} />
            <Rect x={wx + 5} y={5} width={14} height={28} fill={p.winGlass} />
            <Rect x={wx + 6} y={6} width={5} height={12} fill={p.winLight} />
            <Rect x={wx + 12} y={6} width={3} height={10} fill={p.winLight} />
            <Rect x={wx + 5} y={18} width={14} height={1} fill={p.winFrame} />
            <Rect x={wx + 12} y={5} width={1} height={28} fill={p.winFrame} />
          </G>
        ))}

        {/* Sofa */}
        <Rect x={44} y={8} width={72} height={24} fill={p.sofaBody} />
        <Rect x={44} y={20} width={72} height={16} fill={p.sofaTop} />
        <Rect x={44} y={12} width={8} height={24} fill={p.sofaBody} />
        <Rect x={108} y={12} width={8} height={24} fill={p.sofaBody} />
        <Rect x={54} y={14} width={18} height={10} fill={p.sofaPillow} />
        <Rect x={88} y={14} width={18} height={10} fill={p.sofaPillow} />

        {/* Lamp */}
        <Rect x={1} y={20} width={28} height={22} fill={p.lampGlow} />
        <Rect x={3} y={26} width={14} height={8} fill={p.lampShade} />
        <Rect x={5} y={23} width={10} height={4} fill={p.lampShade} />
        <Rect x={9} y={34} width={3} height={14} fill={p.lampBase} />
        <Rect x={6} y={46} width={8} height={2} fill={p.lampBase} />

        {/* Plant */}
        <Rect x={138} y={30} width={14} height={10} fill={p.plantPot} />
        <Rect x={139} y={28} width={12} height={3} fill={p.plantPot} />
        <Rect x={144} y={16} width={3} height={14} fill={p.plantLeaf} />
        <Rect x={138} y={12} width={12} height={8} fill={p.plantLeaf2} />
        <Rect x={136} y={16} width={6} height={8} fill={p.plantLeaf} />
        <Rect x={148} y={16} width={6} height={8} fill={p.plantLeaf} />
        <Rect x={142} y={8} width={6} height={7} fill={p.plantLeaf2} />

        {/* Bookshelf */}
        <Rect x={100} y={14} width={5} height={20} fill={p.bookA} />
        <Rect x={105} y={15} width={4} height={19} fill={p.bookB} />
        <Rect x={109} y={14} width={5} height={20} fill={p.bookC} />
        <Rect x={114} y={16} width={4} height={18} fill={p.bookA} />
        <Rect x={99} y={34} width={22} height={1} fill={p.lampBase} />

        {/* Rug */}
        <Rect x={20} y={52} width={120} height={56} fill={p.rugMain} />
        <Rect x={20} y={52} width={120} height={2} fill={p.rugBorder} />
        <Rect x={20} y={106} width={120} height={2} fill={p.rugBorder} />
        <Rect x={20} y={52} width={2} height={56} fill={p.rugBorder} />
        <Rect x={138} y={52} width={2} height={56} fill={p.rugBorder} />
        <Rect x={25} y={57} width={110} height={1} fill={p.rugAccent} />
        <Rect x={25} y={104} width={110} height={1} fill={p.rugAccent} />

        {/* Cat shadow — kept as a small ellipse on the rug so the
           GIF cat (overlaid outside the SVG below) doesn't look
           floaty. The pixel-rect cat body has been replaced by the
           GIF. */}
        <Rect
          x={catX - 6}
          y={catY + 9}
          width={12}
          height={2}
          fill="rgba(0,0,0,0.2)"
        />
      </Svg>
      {/* GIF cat — overlays the SVG room at the same screen position
         the SVG cat used to draw at. Position math: catX/catY are in
         SVG coords (160×120 viewBox), so we multiply by `scale` to
         get the rendered pixel position. The GIF is anchored so its
         FEET (bottom of the 64×64 sprite) sit at (catY+10)*scale —
         the same baseline as the old SVG cat's feet — and its center
         is at catX*scale. */}
      <Image
        source={lunaSource(mood, lunaSkin)}
        style={{
          position: 'absolute',
          left: catX * scale - 32,
          top: (catY + 10) * scale - 64,
          width: 64,
          height: 64,
        }}
        resizeMode="contain"
        accessibilityLabel="Luna"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0E0B18',
    overflow: 'hidden',
  },
});
