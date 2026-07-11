import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  Image,
  LayoutChangeEvent,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
  Line,
  Path,
} from 'react-native-svg';
import { fonts } from '../../constants/fonts';
import { lunaSource, useLunaSkin, type LunaMood } from '../../lib/luna-source';
import { useAmbientLunaMood } from '../../lib/luna-mood';
import { useCompanionMode } from '../../lib/companion-mode';
import {
  UNLOCKS,
  UNLOCK_CATS,
  UNLOCK_ORDER,
  countEarned,
  type UnlockCategory,
} from '../../constants/unlocks';
import { computeVitality } from '../../lib/vitality';
import { last7DaysEnergy, useLearningDigest } from '../../lib/learning';
import { FLOATING_NAV_CLEARANCE } from '../../components/LumiFloatingNav';
import { ProfileIcon } from '../../components/ProfileIcon';
import {
  useQuestStore,
  selectTodayQuests,
  type Quest,
} from '../../store/questStore';
import { useCheckinStore, localYmdFromIso } from '../../store/checkinStore';
import { useUserStore } from '../../store/userStore';
import { todayKey, xpProgress, TITLES } from '../../lib/gamification';
import { useAccent, accentFor, type Accent } from '../../lib/theme';

// ═════════════════════════════════════════════════════════════════════
// Palette
// ═════════════════════════════════════════════════════════════════════
const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  emberDk: '#9C4E2E',
  glow: '#F4C98A',
  lichen: '#869072',
  honey: '#C9A06A',
  dusk: '#8EA0B4',
  amethyst: '#9A85A8',
  slate: '#7A8A95',
  leaf: '#7FA06A',
  bloom: '#E0A0B4',
  ash: '#5A5650',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

// Clamp + format alpha so we never emit `rgba(...,3.97e-7)` (which
// react-native-svg's color parser rejects as "not a valid color or
// brush"). Tiny positive values get snapped to 0; everything else
// renders with fixed-point precision.
const clampAlpha = (a: number): string => {
  if (!Number.isFinite(a) || a <= 0.001) return '0';
  if (a >= 1) return '1';
  return a.toFixed(3);
};

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clampAlpha(a)})`;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ═════════════════════════════════════════════════════════════════════
// Room — Luna's cozy bedroom, the DEFAULT world.
//
// Per lumi-me-architecture §3: a single rAF loop, eased vitality, every
// element (wall warmth, window sky, shelf decorations, plant, rug, lamp
// halo, dust motes, Luna's mood) is a continuous function of the 0–100
// score. Smooth transitions, never static-image switching. When the
// commissioned room layers arrive (base + plant states + lamp on/off +
// decor pieces), swap the SVG primitives for layered <Image>s — the
// vitality function and tier logic stay identical.
//
// (The old `Island` component is gone; the floating isle is now the
// first XP-unlock world.)
// ═════════════════════════════════════════════════════════════════════
// Commissioned pixel room (assets/room). Each PNG is pre-upscaled
// 6× with nearest-neighbor so RN's bilinear filter can't blur the
// pixels — same trick as the Luna GIFs. Art canvas is 172×144.
const ROOM_BG = require('../../assets/room/room-bg.png');
const ROOM_CABINET = require('../../assets/room/room-cabinet.png');
const ROOM_FRAME = require('../../assets/room/room-frame.png');
const ROOM_VASE = require('../../assets/room/room-vase.png');

// Wall-wash palette — light color veils the user paints the room
// with (Me hero swatch row). Soft enough to keep the pixel art true.
export const ROOM_TINTS: Record<
  Exclude<import('../../store/userStore').RoomTint, 'none'>,
  string
> = {
  rose: '#D98A9E',
  sage: '#8FAE82',
  sky: '#7FA8C9',
  lavender: '#9D8CC2',
  honey: '#D9A441',
};

interface RoomState {
  t: number;
  motes: { x: number; y: number; ph: number }[];
  seed: number;
  veased: number;
}

const Room = ({
  vitality,
  cheer = 0,
  width,
  height,
  active = true,
}: {
  vitality: number;
  cheer?: number;
  width?: number;
  height?: number;
  /** Tab focused — gates the 60fps loop + walk timers (audit C1). */
  active?: boolean;
}) => {
  const lunaMood = useAmbientLunaMood();
  const lunaSkin = useLunaSkin();
  const roomTint = useUserStore((s) => s.roomTint);
  const [, force] = useState(0);
  const S = useRef<RoomState & { joy: number }>({
    t: 0,
    motes: [],
    seed: Math.random() * 1000,
    veased: vitality,
    joy: 0,
  }).current;
  // Tap Luna → joy spike (decays on each frame so the bounce eases out).
  const lastCheer = useRef(cheer);
  useEffect(() => {
    if (cheer !== lastCheer.current) {
      S.joy = 1;
      lastCheer.current = cheer;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheer]);
  const W = width ?? 344;
  const H = height ?? 288;
  // The bg asset is the 172×144 art edge-extended to 200×164 so the
  // scene sits zoomed OUT a touch (owner request) — wall and floor
  // continue into the padding. All placement below is original art
  // coords + the padding offset, scaled by k.
  const kx = W / 200;
  const ky = H / 164;
  const OX = 14; // padding offset baked into room-bg.png
  const OY = 10;

  // ── Walking animation — paces the cat left↔right across the rug,
  // showing the walk GIF while in motion and dropping back to the
  // current emotion (idle/happy/sad) at each rest stop. Sequence:
  //   walk right → pause showing emotion → walk left → pause →
  //   walk right → … (loop)
  //
  // Implementation notes:
  //   - walkX (Animated.Value) → translateX
  //   - flipX (Animated.Value) → scaleX, ±1 by direction. Both
  //     Animated so the whole transform runs on the native driver —
  //     mixing a JS literal silently no-op'd the animation on iOS.
  //   - isWalking (useState) → swaps the rendered GIF between
  //     'walk' (animated walking sprite) and the current emotion
  //     (sitting pose). Reads as: cat strolls across the rug, sits
  //     and shows how it feels for a beat, then strolls back.
  //   - Wrapped in Animated.View around the Image so the transform
  //     composes cleanly with the Image's layout left/top.
  const walkX = useRef(new Animated.Value(0)).current;
  // Static scaleX (not animated). flipX is an Animated.Value only
  // so the whole transform stays on the native driver; we call
  // setValue() to instantly mirror the walking sprite per
  // direction. The swap happens DURING the sit-pause (between
  // legs), at the same instant the sprite changes from 'walk' →
  // emotion → 'walk', so the user never sees a flip animation.
  const flipX = useRef(new Animated.Value(1)).current;
  const [isWalking, setIsWalking] = useState(false);
  // During rest stops we sometimes interrupt the emotion sprite
  // with a brief grooming beat (cat licks itself) so the room
  // doesn't feel like a state machine — it feels like a real cat
  // with little personality quirks. Rolls a dice at each pause.
  const [isLicking, setIsLicking] = useState(false);
  // Defensive fallback — if luna-walk.gif failed to bundle (e.g.,
  // user is on an EAS build from before the asset was added but JS
  // hot-reloaded the latest code), the require resolves to a broken
  // asset id and the Image renders nothing. Flag the failure on
  // first onError and fall back to the emotion sprite for the rest
  // of the session so the cat is visible instead of invisible.
  const [walkAssetFailed, setWalkAssetFailed] = useState(false);

  // Which sprite to render this frame. Precedence: walking >
  // licking > current ambient emotion. activeSprite is also used
  // by the Image style block to decide whether to upscale (the
  // walk + lick GIFs need the 1.35× bump; sitting sprites don't).
  const activeSprite: LunaMood =
    isWalking && !walkAssetFailed
      ? 'walk'
      : isLicking
        ? 'lick'
        : lunaMood;
  useEffect(() => {
    // Cat doesn't walk during the sleep window — would be jarring.
    if (lunaMood === 'sleep') {
      walkX.stopAnimation();
      Animated.timing(walkX, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start();
      setIsWalking(false);
      setIsLicking(false);
      return;
    }
    // Wander bounds in ART coords: the floor runs ~x40..150 in this
    // room (window wall to the cabinet's front). Offsets are relative
    // to the rug-center anchor at x85, so she strolls the full floor
    // instead of pacing a fixed 70px strip of the old drawn rug.
    const MIN_X = (40 - 85) * kx;
    const MAX_X = (150 - 85) * kx;
    // Walk SPEED (px/sec) scales with mood; sad drags, happy zips.
    const pxPerSec =
      lunaMood === 'sad' ? 20 : lunaMood === 'happy' ? 40 : 28;
    if (!active) return; // audit C1 — no strolling on other tabs
    // Audit B3: a mood change mid-stroll used to freeze the walking
    // sprite in place and desync the position origin.
    setIsWalking(false);
    setIsLicking(false);
    let stopped = false;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    // Track where the cat is so each stroll can start from there —
    // strolls go to RANDOM spots on the rug, not end-to-end laps.
    let curX = 0;
    walkX.stopAnimation((v) => {
      curX = v; // resume from where the cat actually stands
    });

    // A real cat mostly SITS. Long, randomized rests (9–22s) between
    // short strolls — the room breathes instead of pacing. (The old
    // loop was walk-right → 2.4s → walk-left → 2.4s forever, which
    // read as constant side-to-side motion.)
    const restFor = () => 9_000 + Math.random() * 13_000;

    const rest = (ms: number) => {
      pauseTimer = setTimeout(() => {
        if (!stopped) stroll();
      }, ms);
    };

    // No flip ANIMATION — instead we set scaleX instantly at the
    // start of each leg. The walking GIF naturally faces left, so:
    //   walking right (positive translateX) → scaleX = -1 (mirror)
    //   walking left  (negative translateX) → scaleX = 1  (default)
    // While sitting + emoting, scaleX resets to 1 so the rest
    // sprites (luna-idle/happy/sad) never get mirrored.
    const stroll = () => {
      if (stopped) return;
      // Sometimes she doesn't feel like moving at all — she grooms
      // where she sits (or just keeps being a cat) and settles back.
      if (Math.random() < 0.35) {
        setIsLicking(true);
        pauseTimer = setTimeout(() => {
          if (stopped) return;
          setIsLicking(false);
          rest(restFor());
        }, 1600);
        return;
      }
      const to = MIN_X + Math.random() * (MAX_X - MIN_X);
      const dist = Math.abs(to - curX);
      if (dist < 22) {
        // Target too close to bother — skip this beat.
        rest(restFor());
        return;
      }
      flipX.setValue(to > curX ? -1 : 1);
      setIsWalking(true);
      setIsLicking(false);
      Animated.timing(walkX, {
        toValue: to,
        duration: (dist / pxPerSec) * 1000,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.sin),
      }).start(({ finished }) => {
        if (!finished || stopped) return;
        curX = to;
        // Arrived — sit, face forward, occasionally groom, then a
        // long rest before the next wander.
        flipX.setValue(1);
        setIsWalking(false);
        if (Math.random() < 0.33) {
          setIsLicking(true);
          pauseTimer = setTimeout(() => {
            if (stopped) return;
            setIsLicking(false);
            rest(restFor());
          }, 1600);
        } else {
          rest(restFor());
        }
      });
    };

    // Open on a settled cat — first wander comes after a short beat,
    // not the moment the tab mounts.
    rest(3_500 + Math.random() * 4_000);

    return () => {
      stopped = true;
      walkX.stopAnimation();
      flipX.stopAnimation();
      if (pauseTimer) clearTimeout(pauseTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lunaMood, active]);

  useEffect(() => {
    // AUDIT C1: this 60fps setState loop used to run for the whole
    // session once Me was visited (tabs stay mounted). Focus-gated.
    if (!active) return;
    let raf: number;
    const tick = () => {
      S.t++;
      S.veased += (vitality - S.veased) * 0.06;
      S.joy = Math.max(0, S.joy - 0.012);
      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitality, active]);

  const v = Math.max(0, Math.min(100, S.veased)) / 100;

  // ── Pixel room lighting — the drawn-SVG room is gone; the art is
  // the commissioned pixel background + decor layers. Vitality still
  // runs the light, per the architecture's "everything is a function
  // of the score": a dim veil lifts as vitality climbs, honey warmth
  // settles in on good days, and decor pieces fade in at the same
  // thresholds the old drawn props used (vase ~30, frame ~55).
  // The window shows the USER'S sky, not the mood — stars at noon /
  // sunshine at midnight read as a broken clock (audit B4). The art's
  // glass is painted daytime; at night a deep-blue pane with a few
  // stars settles over it. Day split: 6:00–19:59.
  const hourNow = new Date().getHours();
  const isNightSky = hourNow < 6 || hourNow >= 20;
  const dimAlpha = Math.min(1, Math.max(0, (1 - v) * 0.2 + (isNightSky ? 0.08 : 0)));
  const warmAlpha = Math.min(1, Math.max(0, v * 0.1));

  // Luna mood + position. Joy spikes (tap-to-cheer) amplify the bob
  // for ~80 frames so the cat visibly reacts to a tap.
  const happy = v >= 0.5;
  const sleeping = v < 0.25;
  const excited = (v >= 0.85 || S.joy > 0.2) && !sleeping;
  // Damped from 2.5/2.6 — the tap reaction read as violent bouncing
  // rather than a happy wiggle (owner feedback, Jul 9).
  const joyAmp = 1 + S.joy * 1.1;
  const lunaBob = isWalking
    ? 0 // feet glued to the floor mid-stroll — the bob under a
    : // native-driver translate read as vertical glitching
      (excited
        ? Math.sin(S.t * (0.1 + S.joy * 0.05)) * 1.8
        : happy
          ? Math.sin(S.t * 0.08) * 1.8
          : sleeping
            ? Math.sin(S.t * 0.025) * 0.7
            : Math.sin(S.t * 0.05) * 1.2) * joyAmp;
  // Rug center in the art ≈ (85, 121) — Luna lives on the rug.
  const lunaX = (85 + OX) * kx;
  const lunaY = (121 + OY) * ky - 6 + lunaBob;

  // GIF cat: anchor the sprite's center on lunaX and its FEET on
  // lunaY+12 so the cat plants on the rug naturally.
  const GIF_SIZE = 56;
  const gifLeft = lunaX - GIF_SIZE / 2;
  const gifTop = lunaY + 12 - GIF_SIZE;

  return (
    <View style={{ width: W, height: H }}>
    {/* Base room art — stretched to the hero box; the art's 172×144
        aspect is within ~2% of the box so distortion is invisible. */}
    <Image
      source={ROOM_BG}
      style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}
      resizeMode="stretch"
    />
    {/* Decor — the cat cabinet, vase and frame (commissioned set) */}
    <Image
      source={ROOM_CABINET}
      style={{
        position: 'absolute',
        left: (101 + OX) * kx,
        top: (65 + OY) * ky,
        width: 67 * kx,
        height: 43 * ky,
      }}
      resizeMode="stretch"
    />
    <Image
      source={ROOM_VASE}
      style={{
        position: 'absolute',
        left: (110 + OX) * kx,
        top: (48 + OY) * ky,
        width: 16 * kx,
        height: 18 * ky,
      }}
      resizeMode="stretch"
    />
    <Image
      source={ROOM_FRAME}
      style={{
        position: 'absolute',
        left: (138 + OX) * kx,
        top: (46 + OY) * ky,
        width: 16 * kx,
        height: 17 * ky,
      }}
      resizeMode="stretch"
    />
    {/* User-painted wall wash */}
    {roomTint !== 'none' && (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: W,
          height: H,
          backgroundColor: hexA(ROOM_TINTS[roomTint], 0.16),
        }}
      />
    )}
    {/* Night pane over the window glass (art glass ≈ x18–69, y11–62) */}
    {isNightSky && (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: (18 + OX) * kx,
          top: (11 + OY) * ky,
          width: 52 * kx,
          height: 52 * ky,
          backgroundColor: 'rgba(18,22,48,0.82)',
        }}
      >
        {[
          { x: 9, y: 9 },
          { x: 30, y: 5 },
          { x: 41, y: 21 },
          { x: 17, y: 33 },
        ].map((s, i2) => (
          <View
            key={'st' + i2}
            style={{
              position: 'absolute',
              left: s.x * kx,
              top: s.y * ky,
              width: 2.5,
              height: 2.5,
              borderRadius: 1.25,
              backgroundColor: 'rgba(240,236,220,0.85)',
            }}
          />
        ))}
      </View>
    )}
    {/* Vitality light — honey warmth up, dim veil down. Luna renders
        ABOVE the veils on purpose: she's the life of the room. */}
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: W,
        height: H,
        backgroundColor: hexA(C.glow, warmAlpha),
      }}
    />
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: W,
        height: H,
        backgroundColor: `rgba(14,10,8,${dimAlpha.toFixed(3)})`,
      }}
    />
    {/* Pixel cat overlay. The outer Animated.View owns the
       transform (translateX + scaleX, both Animated values so the
       native driver runs the whole thing) and the inner Image
       just fills it. Keeping the transform on a separate node
       avoids the silent-no-op iOS hit where a literal scaleX
       mixed with an Animated translateX failed to apply. */}
    {/* The wrapping Animated.View carries BOTH the cat image AND
       its shadow so the shadow translates with the cat as it
       walks the rug. The shadow View is positioned at the cat's
       feet — using View (not SVG) so it doesn't require touching
       the SVG node tree on every Animated frame. */}
    <Animated.View
      style={{
        position: 'absolute',
        left: gifLeft,
        top: gifTop,
        width: GIF_SIZE,
        height: GIF_SIZE,
        transform: [{ translateX: walkX }, { scaleX: flipX }],
      }}
      pointerEvents="none"
    >
      {/* Soft elliptical shadow at the cat's feet. Stays put
         under the cat as the wrapper translates; scaleX flip on
         the parent doesn't visually change a centered ellipse. */}
      <View
        style={{
          position: 'absolute',
          // Cat sits centered on lunaX, with FEET on lunaY+12
          // (which was the old shadow line in SVG coords). Inside
          // this wrapper the feet land at the bottom of the box.
          bottom: 4,
          left: GIF_SIZE / 2 - 9,
          width: 18,
          height: 4,
          borderRadius: 2,
          backgroundColor: 'rgba(0,0,0,0.22)',
        }}
      />
      {/* GIF swaps between walk sprite (while in motion) and the
         current emotion sprite (at each rest stop) so the cat
         visibly walks → sits + emotes → walks back. Sleep mood
         disables the walk loop entirely (see useEffect above).
         If luna-walk.gif isn't bundled (old EAS build + new JS),
         onError flips walkAssetFailed and we render the emotion
         sprite during the walk too — cat is visible, just sliding. */}
      {/* One square box for every sprite. All Luna GIFs are 512×512
         with content normalized to the same height, so walk/lick and
         the sitting poses render at identical scale — the old bigger
         walk-box (pre-normalization) made her visibly jump in size
         the moment a stroll started. */}
      <Image
        source={lunaSource(activeSprite, lunaSkin)}
        onError={() => {
          if (isWalking) setWalkAssetFailed(true);
        }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        accessibilityLabel="Luna"
      />
    </Animated.View>
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// EnergyTrend — 7-day sparkline bars
// ═════════════════════════════════════════════════════════════════════
const EnergyTrend = ({
  data,
}: {
  data: { day: string; v: number }[];
}) => (
  <View style={styles.trendRow}>
    {data.map((d, i) => {
      const h = Math.max(6, (d.v / 100) * 56);
      const col = d.v >= 66 ? C.honey : d.v >= 40 ? C.lichen : C.dusk;
      return (
        <View key={i} style={{ flex: 1, alignItems: 'center', gap: 5 }}>
          <View
            style={{
              width: '70%',
              maxWidth: 18,
              height: h,
              borderRadius: 5,
              backgroundColor: col,
            }}
          />
          <Text style={styles.trendDay}>{d.day}</Text>
        </View>
      );
    })}
  </View>
);

// ═════════════════════════════════════════════════════════════════════
// JourneyPath — the stretch of road you're ON. One honest segment:
// your current rank glows at the left end, the next waits at the
// right, and the walker bead sits exactly at your XP progress between
// them. Data is the REAL ladder from lib/gamification — nothing
// hardcoded. (The old multi-dot version implied meaningless distances
// and its dashed circle rendered broken on iOS.)
// ═════════════════════════════════════════════════════════════════════
const JourneyPath = ({ xp }: { xp: number }) => {
  const prog = xpProgress(xp);
  const nextTitle = TITLES[prog.level] ?? 'Threshold';
  const remaining = Math.max(0, prog.next - xp);
  const pct = Math.round(prog.pct * 100);
  return (
    <View>
      {/* rank labels — where you stand, what's ahead */}
      <View style={jpStyles.labelRow}>
        <Text numberOfLines={1} style={jpStyles.hereLabel}>
          {prog.title}
        </Text>
        <Text numberOfLines={1} style={jpStyles.nextLabel}>
          {nextTitle}
        </Text>
      </View>
      {/* the road — filled to your progress, bead walking it */}
      <View style={jpStyles.roadRow}>
        <View style={jpStyles.hereDot} />
        <View style={jpStyles.track}>
          <View style={[jpStyles.fill, { width: `${pct}%` }]} />
          <View style={[jpStyles.bead, { left: `${pct}%` }]} />
        </View>
        <View style={jpStyles.nextDot} />
      </View>
      <Text style={jpStyles.caption}>
        <Text style={jpStyles.captionXp}>
          {remaining.toLocaleString()} xp
        </Text>{' '}
        until {nextTitle} — mostly by just showing up.
      </Text>
    </View>
  );
};

const jpStyles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  hereLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: C.glow,
    flexShrink: 1,
  },
  nextLabel: {
    fontFamily: fonts.inter,
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: C.mute,
    flexShrink: 1,
    marginLeft: 12,
  },
  roadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hereDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: C.ember,
    borderWidth: 1.5,
    borderColor: hexA(C.glow, 0.8),
    shadowColor: C.ember,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  nextDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: hexA(C.glow, 0.45),
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 3,
    backgroundColor: hexA(C.bone, 0.08),
    position: 'relative',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: C.ember,
    shadowColor: C.ember,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  // The walker — you, mid-stride between ranks.
  bead: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    backgroundColor: C.glow,
    shadowColor: C.glow,
    shadowOpacity: 0.8,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  caption: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
    marginTop: 12,
    paddingLeft: 2,
  },
  captionXp: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    color: C.glow,
  },
});


// ═════════════════════════════════════════════════════════════════════
// UnlockThumb — tiny SVG placeholder until commissioned art lands
// ═════════════════════════════════════════════════════════════════════
const UnlockThumb = ({
  art,
  locked,
  color,
}: {
  art: string | null;
  locked: boolean;
  color: string;
}) => {
  const W = 88;
  const H = 64;
  return (
    <View style={{ width: '100%', height: H, borderRadius: 11, overflow: 'hidden' }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id={`thumb_${art ?? 'x'}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.22} />
            <Stop offset="1" stopColor="#0C0908" stopOpacity={0.9} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill={`url(#thumb_${art ?? 'x'})`} />
        {/* Star sprinkle */}
        {Array.from({ length: 10 }).map((_, i) => (
          <Rect
            key={i}
            x={(i * 37 + 9) % W}
            y={(i * 19 + 6) % (H * 0.6)}
            width={1.2}
            height={1.2}
            fill={hexA(C.bone, 0.35)}
          />
        ))}
        {art === 'peaks' ? (
          <>
            <Ellipse cx={W / 2} cy={H - 14} rx={30} ry={10} fill={hexA(color, 0.85)} />
            <Path
              d={`M ${W / 2 - 18} ${H - 14} L ${W / 2 - 6} ${H - 34} L ${W / 2 + 6} ${H - 14} Z`}
              fill={hexA(C.bone, 0.7)}
            />
          </>
        ) : art === 'room' ? (
          // Cozy room thumbnail: window square + small lamp glow.
          <>
            <Rect x={W / 2 - 28} y={H - 44} width={20} height={22} fill={hexA(color, 0.85)} />
            <Rect
              x={W / 2 - 28}
              y={H - 44}
              width={20}
              height={22}
              fill="none"
              stroke={hexA(C.bone, 0.4)}
              strokeWidth={1}
            />
            <Line
              x1={W / 2 + 14}
              y1={H - 14}
              x2={W / 2 + 14}
              y2={H - 30}
              stroke="#4A3526"
              strokeWidth={2}
            />
            <Circle cx={W / 2 + 14} cy={H - 32} r={5} fill={hexA(C.glow, 0.9)} />
            <Circle cx={W / 2 + 14} cy={H - 32} r={10} fill={hexA(C.glow, 0.2)} />
          </>
        ) : art === 'meadow' || art === 'isle' || art === 'tide' ? (
          <>
            <Ellipse cx={W / 2} cy={H - 14} rx={30} ry={10} fill={hexA(color, 0.85)} />
            <Line
              x1={W / 2 + 8}
              y1={H - 16}
              x2={W / 2 + 10}
              y2={H - 30}
              stroke="#4A3526"
              strokeWidth={2}
            />
            <Circle cx={W / 2 + 10} cy={H - 32} r={6} fill={hexA(color, 0.9)} />
          </>
        ) : (
          <>
            <Circle cx={W / 2} cy={H - 22} r={9} fill={hexA(color, 0.85)} />
            <Circle cx={W / 2 - 7} cy={H - 30} r={3} fill={hexA(color, 0.85)} />
            <Circle cx={W / 2 + 7} cy={H - 30} r={3} fill={hexA(color, 0.85)} />
          </>
        )}
        {locked && (
          <Rect x={0} y={0} width={W} height={H} fill="rgba(12,9,8,0.62)" />
        )}
      </Svg>
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// UnlocksShop — category tabs + XP-gated grid
// ═════════════════════════════════════════════════════════════════════
const UnlocksShop = ({ totalXp }: { totalXp: number }) => {
  const [cat, setCat] = useState<UnlockCategory>('world');
  const items = UNLOCKS.filter((u) => u.cat === cat);
  const earned = countEarned(totalXp);

  return (
    <View>
      <View style={styles.shopHead}>
        <Text style={styles.sectionLabel}>Unlocks</Text>
        <Text style={styles.shopHeadCount}>
          <Text style={styles.shopHeadCountNum}>{earned}</Text>/{UNLOCKS.length}{' '}
          earned
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shopTabs}
      >
        {UNLOCK_ORDER.map((k) => {
          const cc = UNLOCK_CATS[k];
          const on = cat === k;
          return (
            <Pressable
              key={k}
              onPress={() => {
                Haptics.selectionAsync();
                setCat(k);
              }}
              style={[
                styles.shopTab,
                {
                  backgroundColor: on ? `${cc.color}1f` : 'transparent',
                  borderColor: on ? cc.color : C.hair,
                },
              ]}
            >
              <Text style={[styles.shopTabGlyph, { color: cc.color }]}>
                {cc.glyph}
              </Text>
              <Text
                style={[
                  styles.shopTabLabel,
                  { color: on ? cc.color : C.boneDim },
                ]}
              >
                {cc.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.shopGrid}>
        {items.map((u) => {
          const owned = totalXp >= u.xp;
          const remaining = u.xp - totalXp;
          const cc = UNLOCK_CATS[u.cat];
          return (
            <View
              key={u.id}
              style={[
                styles.unlockCard,
                {
                  borderColor: owned ? `${cc.color}44` : C.hair,
                },
              ]}
            >
              <View style={{ position: 'relative', marginBottom: 10 }}>
                {u.art ? (
                  <UnlockThumb art={u.art} locked={!owned} color={cc.color} />
                ) : (
                  <View
                    style={[
                      styles.featureThumb,
                      { opacity: owned ? 1 : 0.5 },
                    ]}
                  >
                    <Text style={[styles.featureThumbGlyph, { color: cc.color }]}>
                      {cc.glyph}
                    </Text>
                  </View>
                )}
                {owned ? (
                  u.xp === 0 ? (
                    <View style={styles.activePill}>
                      <Text style={[styles.activePillText, { color: cc.color }]}>
                        Active
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.checkPill}>
                      <Text style={[styles.checkPillText, { color: cc.color }]}>
                        ✓
                      </Text>
                    </View>
                  )
                ) : (
                  <View style={styles.lockPill}>
                    <Text style={styles.lockPillText}>🔒</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.unlockName,
                  { color: owned ? C.bone : C.boneDim },
                ]}
              >
                {u.name}
              </Text>
              <Text style={styles.unlockSub}>{u.sub}</Text>
              {owned ? (
                <Pressable
                  style={[
                    styles.unlockBtn,
                    {
                      backgroundColor: u.xp === 0 ? 'transparent' : `${cc.color}1a`,
                      borderColor: u.xp === 0 ? C.hair : cc.color,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.unlockBtnText,
                      { color: u.xp === 0 ? C.mute : cc.color },
                    ]}
                  >
                    {u.xp === 0 ? 'Equipped' : 'Use it →'}
                  </Text>
                </Pressable>
              ) : (
                <View>
                  <View style={styles.lockProgressTrack}>
                    <View
                      style={[
                        styles.lockProgressFill,
                        {
                          width: `${Math.min(100, (totalXp / u.xp) * 100)}%`,
                          backgroundColor: cc.color,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.lockRemaining}>
                    {remaining.toLocaleString()} XP to go
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
      <Text style={styles.shopFoot}>
        XP is never spent — keep earning. Everything you reach is yours for
        good.
      </Text>
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════
// FocusedSnapshot — calm "Snapshot" strip rendered in Focused mode
// where the standing strip (Rank/Streak/Lifetime XP) would be.
//
// Reads the same quest history but speaks in neutral language:
// "Days with Lumi", "Done this week", "Done total". No XP unit, no
// rank, no flame — matches the "pure calm AI organizer" promise.
// ═════════════════════════════════════════════════════════════════════
const FocusedSnapshot = ({ quests }: { quests: Quest[] }) => {
  const accent = useAccent();
  const onboardedAt = useUserStore((s) => s.onboardedAt);
  const styles = useMemo(() => makeStyles(accent), [accent]);

  const daysWithLumi = useMemo(() => {
    if (!onboardedAt) return 0;
    const ms = Date.now() - new Date(onboardedAt).getTime();
    return Math.max(1, Math.floor(ms / 86_400_000));
  }, [onboardedAt]);

  const { doneThisWeek, doneTotal } = useMemo(() => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoIso = weekAgo.toISOString().slice(0, 10);
    let week = 0;
    let total = 0;
    for (const q of quests) {
      if (!q.completed) continue;
      total++;
      const completedDate = (q.completedAt ?? q.date)?.slice(0, 10);
      if (completedDate && completedDate >= weekAgoIso) week++;
    }
    return { doneThisWeek: week, doneTotal: total };
  }, [quests]);

  return (
    <View style={styles.standingStrip}>
      <View style={styles.standingCell}>
        <Text style={styles.standingCellNum}>{daysWithLumi}</Text>
        <Text style={styles.standingCellLabel}>DAYS WITH LUMI</Text>
      </View>
      <View style={styles.standingDivider} />
      <View style={styles.standingCell}>
        <Text style={styles.standingCellNum}>{doneThisWeek}</Text>
        <Text style={styles.standingCellLabel}>THIS WEEK</Text>
      </View>
      <View style={styles.standingDivider} />
      <View style={styles.standingCell}>
        <Text style={styles.standingCellNum}>{doneTotal}</Text>
        <Text style={styles.standingCellLabel}>DONE TOTAL</Text>
      </View>
    </View>
  );
};

// ═════════════════════════════════════════════════════════════════════
// HubRow — collapsible "Your corner" row.
// (lumi-me-v2-spec §2 — the demoted tidy hub.)
// ═════════════════════════════════════════════════════════════════════
const HubRow = ({
  glyph,
  color,
  label,
  sub,
  open,
  onToggle,
  children,
  chevronOnly,
  first,
}: {
  glyph: string;
  color: string;
  label: string;
  sub?: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  chevronOnly?: boolean;
  /** First row inside the grouped card — no top hairline. */
  first?: boolean;
}) => (
  <View style={[hubRowStyles.row, first && { borderTopWidth: 0 }]}>
    <Pressable onPress={onToggle} style={hubRowStyles.head} hitSlop={4}>
      <Text style={[hubRowStyles.glyph, { color }]}>{glyph}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={hubRowStyles.label}>{label}</Text>
        {sub && <Text style={hubRowStyles.sub}>{sub}</Text>}
      </View>
      <Text
        style={[
          hubRowStyles.chev,
          open && !chevronOnly && { transform: [{ rotate: '90deg' }] },
        ]}
      >
        ›
      </Text>
    </Pressable>
    {open && !chevronOnly && children && (
      <View style={hubRowStyles.body}>{children}</View>
    )}
  </View>
);

// Rows live INSIDE the grouped cornerCard container (mock style):
// hairline dividers between rows, no outer borders of their own.
const hubRowStyles = StyleSheet.create({
  row: {
    borderTopWidth: 1,
    borderTopColor: hexA('#2A2420', 0.7),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  glyph: {
    fontSize: 15,
    width: 22,
    textAlign: 'center',
  },
  label: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
    color: '#ECE0CB',
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: '#6E655A',
    marginTop: 2,
  },
  chev: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: '#6E655A',
  },
  body: {
    paddingTop: 2,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
});

export default function MeTab() {
  const router = useRouter();
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);

  // Companion-mode flags — gate the room/XP chrome and pick the
  // Me-tab variant (Full room vs Focused "You & Lumi" stats screen).
  const companion = useCompanionMode();

  // Real signals
  const quests = useQuestStore((s) => s.quests);
  const checkins = useCheckinStore((s) => s.checkins);
  const xpTotal = useUserStore((s) => s.xp);
  const streak = useUserStore((s) => s.streak);
  const shards = useUserStore((s) => s.shards);
  // Pet name flows into every "{name} is {stage}" / "{name}'s world"
  // copy so users who renamed their cat see THEIR name, not "Luna".
  const petName = useUserStore((s) => s.petName);
  const [meFocused, setMeFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setMeFocused(true);
      return () => setMeFocused(false);
    }, []),
  );
  const focusMinutesLifetime = useUserStore((s) => s.focusMinutesLifetime);
  const tasksEverCompleted = useUserStore((s) => s.tasksEverCompleted);

  const todayQuests = useMemo(() => selectTodayQuests(quests), [quests]);
  const questsToday = todayQuests.filter((q) => q.completed).length;
  const questGoal = Math.max(3, todayQuests.length || 5);

  const today = todayKey();
  // Untangle-era vitality signals (Lumi BUILD-STATUS §2.2 rebalance):
  //   - untangledToday: did the user open Untangle and use a move today
  //   - capturedToday: did anything reach quests via a new addition today
  // Both are proxied off the existing stores — we don't track
  // capture-time explicitly yet, but a quest whose createdAt-equivalent
  // (date == today and not from yesterday's rollover) is a reasonable
  // signal that something landed today.
  const untangledToday = checkins.some(
    (c) => localYmdFromIso(c.createdAt) === today,
  );
  const capturedToday = quests.some((q) => q.date === today);
  // avgEnergy left here for the recap section that still surfaces it;
  // it no longer feeds vitality.
  const avgEnergy = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const recent = checkins.filter(
      (c) => new Date(c.createdAt) >= cutoff,
    );
    if (recent.length === 0) return 0;
    return Math.round(
      recent.reduce((s, c) => s + c.energy, 0) / recent.length,
    );
  }, [checkins]);

  const signals = {
    questsToday,
    questGoal,
    streak,
    untangledToday,
    capturedToday,
  };
  // Vitality still drives the ROOM's ambience (wall warmth, lamp,
  // plant) — it just isn't displayed as a bar/number anymore. The
  // room IS the read; her health-bar UI is gone by design.
  const rawVitality = computeVitality(signals);
  // Afterglow (audit R1): carry ~55% of yesterday's closing vitality
  // into the morning, fading across the waking day — the room greets
  // you with residual warmth instead of a daily cold-open. Rest days
  // dim gently instead of going dark at dawn.
  const anchors = useUserStore((s) => s.anchors);
  const vitalitySnapshot = useUserStore((s) => s.vitalitySnapshot);
  const setVitalitySnapshot = useUserStore((s) => s.setVitalitySnapshot);
  const vitality = useMemo(() => {
    const yester = new Date();
    yester.setDate(yester.getDate() - 1);
    const yKey = `${yester.getFullYear()}-${String(yester.getMonth() + 1).padStart(2, '0')}-${String(yester.getDate()).padStart(2, '0')}`;
    if (!vitalitySnapshot || vitalitySnapshot.date !== yKey) {
      return rawVitality;
    }
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const wake = anchors.wake;
    const sleep = anchors.sleep;
    const span = Math.max(1, Math.min(sleep, 1439) - wake);
    const progress = Math.max(0, Math.min(1, (nowMin - wake) / span));
    const afterglow = vitalitySnapshot.value * 0.55 * (1 - progress);
    return Math.max(rawVitality, Math.round(afterglow));
  }, [rawVitality, vitalitySnapshot, anchors.wake, anchors.sleep]);
  // Snapshot today's RAW closing value (throttled to real changes).
  useEffect(() => {
    const t = todayKey();
    if (
      vitalitySnapshot?.date !== t ||
      Math.abs((vitalitySnapshot?.value ?? 0) - rawVitality) >= 2
    ) {
      setVitalitySnapshot({ date: t, value: rawVitality });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawVitality]);

  // Hearthside UI state — cheer pulses the room; hub rows collapse.
  const [cheer, setCheer] = useState(0);
  const [hub, setHub] = useState<null | 'unlocks' | 'rhythm'>(null);

  // Care toast — "A slow blink back…" feedback for Sit with her.
  const [careToast, setCareToast] = useState<string | null>(null);
  const careToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCareToast = (m: string) => {
    setCareToast(m);
    if (careToastRef.current) clearTimeout(careToastRef.current);
    careToastRef.current = setTimeout(() => setCareToast(null), 2600);
  };
  useEffect(
    () => () => {
      if (careToastRef.current) clearTimeout(careToastRef.current);
    },
    [],
  );
  // Room paint — a tiny swatch strip over the room, toggled by the
  // brush dot in the hero chrome. Persisted in userStore.roomTint.
  const roomTint = useUserStore((s) => s.roomTint);
  const setRoomTint = useUserStore((s) => s.setRoomTint);
  const [paintOpen, setPaintOpen] = useState(false);

  const sitWithHer = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCheer((c) => c + 1);
    showCareToast("A slow blink back. That's cat for love.");
  };

  // Days together — the bond, not a stat.
  const onboardedAt = useUserStore((s) => s.onboardedAt);
  const daysTogether = useMemo(() => {
    if (!onboardedAt) return 1;
    const ms = Date.now() - new Date(onboardedAt).getTime();
    return Math.max(1, Math.floor(ms / 86400000) + 1);
  }, [onboardedAt]);
  const bondLine =
    streak >= 3
      ? "She's warm and settled — you've been steady lately, and she can tell."
      : streak >= 1
        ? "She's settling in beside you — a little rhythm goes a long way."
        : "She's here either way — today counts whenever you start.";

  // Learning digest — drives "What Lumi noticed" + the Week card.
  const digest = useLearningDigest();

  // 7-day energy bars — shared helper from learning layer, which
  // does LOCAL date bucketing (so today's Untangle activity shows up
  // on today's bar, not on tomorrow's UTC date).
  const energyTrend = useMemo(() => last7DaysEnergy(checkins), [checkins]);

  // ── Your Week card numbers — real, not lifetime. ──────────────────
  // Counts completions within the last 7 days (rolling window) so a
  // fresh account doesn't crow about quests it doesn't have. Day
  // label reflects TODAY, not a hardcoded Sunday.
  const weekQuestsDone = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return quests.filter(
      (q) =>
        q.completed && q.completedAt && new Date(q.completedAt) >= cutoff,
    ).length;
  }, [quests]);
  // This week, as ONE story line in Lumi's voice — composed from
  // real numbers only (no invented "3 focus embers" like the mock).
  const storyLine = useMemo(() => {
    if (weekQuestsDone === 0) {
      return '“A quiet week so far — nothing finished yet, and that’s a fine place to start from.”';
    }
    const win = digest.win ? `, and ${digest.win.headline.toLowerCase()}` : '';
    const pattern = digest.pattern
      ? ' — and a pattern turned up worth a look'
      : '';
    return `“You did ${weekQuestsDone} thing${
      weekQuestsDone === 1 ? '' : 's'
    } this week${win}${pattern}. That counts.”`;
  }, [weekQuestsDone, digest]);

  // Rank — the REAL ladder from lib/gamification. (The old ad-hoc
  // 1000-xp-per-rank formula here disagreed with the app's actual
  // level thresholds; the road now tells the truth.)
  const road = xpProgress(xpTotal);

  const screenWidth = Dimensions.get('window').width;
  const roomHeight = Math.round(screenWidth * 0.82);

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: FLOATING_NAV_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══ Focused-mode header (no cat / no room) ═══
            Companion-mode spec §3: when the user dialed Lumi all the
            way down, the Me tab becomes "You & Lumi" — a calm header
            that lets them go to settings, with no game chrome. */}
        {companion.isFocused && (
          <View style={styles.focusedHero}>
            <Text style={styles.focusedHeroEyebrow}>YOU & LUMI</Text>
            <Text style={styles.focusedHeroTitle}>
              A calm organizer, at your pace.
            </Text>
            <Text style={styles.focusedHeroBody}>
              The cat and the game are off — Lumi is just here to
              keep your day clear. Switch back any time in profile.
            </Text>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.push('/profile');
              }}
              style={styles.focusedHeroLink}
              hitSlop={6}
            >
              <Text style={[styles.focusedHeroLinkText, { color: accent.fg }]}>
                Personalize Lumi →
              </Text>
            </Pressable>
          </View>
        )}

        {/* ═══ HERO — Luna's room, FULL-BLEED ═══
            Skipped entirely in Focused mode (the header above
            replaces it). Visible in Full + Minimal. The Fragment
            here lets the conditional wrap the hero Pressable +
            its sibling poetic/feed/week blocks as one unit. */}
        {!companion.isFocused && (
        <>
        <Pressable
          // Tapping the room IS "sitting with her" — cheer pulse +
          // the slow-blink toast. (The care buttons are gone; the
          // interaction lives where she lives.)
          onPress={sitWithHer}
          style={{ position: 'relative' }}
        >
          <Room
            active={meFocused}
            vitality={vitality}
            cheer={cheer}
            width={screenWidth}
            height={roomHeight}
          />
          {/* Floating chrome over the room — minimal (hearthside):
              just her room's name and the profile door. Rank moved
              down to "Your road"; shards to the care card. */}
          <View pointerEvents="none" style={styles.heroTopScrim} />
          <View style={styles.heroTopBar}>
            <Text style={styles.heroEyebrow}>{petName}&apos;s room</Text>
            <View style={{ flex: 1 }} />
            {/* Same canonical icon as every other tab (components/
                ProfileIcon) — Me used to draw its own honey variant
                and the mismatch read as a bug. */}
            <Pressable
              onPress={() => setPaintOpen((o) => !o)}
              hitSlop={8}
              style={styles.paintBtn}
              accessibilityLabel="Paint the room"
            >
              <View
                style={[
                  styles.paintDot,
                  {
                    backgroundColor:
                      roomTint === 'none'
                        ? '#E8DCC8'
                        : ROOM_TINTS[roomTint],
                  },
                ]}
              />
            </Pressable>
            <ProfileIcon />
          </View>
          {paintOpen && (
            <View style={styles.paintRow}>
              {(
                ['none', 'rose', 'sage', 'sky', 'lavender', 'honey'] as const
              ).map((t) => (
                <Pressable
                  key={t}
                  hitSlop={6}
                  onPress={() => {
                    setRoomTint(t);
                    setPaintOpen(false);
                    void Haptics.impactAsync(
                      Haptics.ImpactFeedbackStyle.Light,
                    );
                  }}
                  style={[
                    styles.paintSwatch,
                    {
                      backgroundColor:
                        t === 'none' ? '#E8DCC8' : ROOM_TINTS[t],
                    },
                    roomTint === t && styles.paintSwatchOn,
                  ]}
                  accessibilityLabel={
                    t === 'none' ? 'Original walls' : `${t} walls`
                  }
                />
              ))}
            </View>
          )}
        </Pressable>

        {/* ═══ The two of you — a bond, not a dashboard ═══ */}
        <View style={styles.bondBlock}>
          <Text style={styles.bondTitle}>
            {daysTogether} day{daysTogether === 1 ? '' : 's'}, the two of
            you.
          </Text>
          <Text style={styles.bondLine}>✦ {bondLine}</Text>
          {(focusMinutesLifetime > 0 || tasksEverCompleted > 4) && (
            <Text style={styles.bondLine}>
              {focusMinutesLifetime > 0
                ? `${Math.floor(focusMinutesLifetime / 60) > 0 ? `${Math.floor(focusMinutesLifetime / 60)}h ` : ''}${focusMinutesLifetime % 60}m by the hearth together`
                : ''}
              {focusMinutesLifetime > 0 && tasksEverCompleted > 4 ? ' · ' : ''}
              {tasksEverCompleted > 4
                ? `${tasksEverCompleted} things finished, ever`
                : ''}
            </Text>
          )}
        </View>

        {/* ═══ Your road — rank as a walked path ═══ */}
        {companion.showXp && (
          <View style={styles.roadBlock}>
            <View style={styles.roadHead}>
              <Text style={styles.sectionEyebrow}>Your road</Text>
              <Text style={styles.roadRankLabel}>
                Rank {road.level} · {road.title}
              </Text>
            </View>
            <View style={styles.roadCard}>
              <JourneyPath xp={xpTotal} />
            </View>
          </View>
        )}

        {/* ═══ This week, as a story ═══ */}
        <View style={styles.storyBlock}>
          <Text style={styles.sectionEyebrow}>This week&apos;s story</Text>
          <View style={styles.storyCard}>
            <Text style={styles.storyQuote}>{storyLine}</Text>
            <View style={styles.storyFootRow}>
              <View style={styles.storyCatBadge}>
                <Svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={C.dusk}
                  strokeWidth={1.8}
                >
                  <Path d="M8.6 7.6 7 4l3.1 2.3M15.4 7.6 17 4l-3.1 2.3" />
                  <Circle cx={12} cy={13.2} r={5.3} />
                </Svg>
              </View>
              <Text style={styles.storyByline}>
                — Lumi, your week in one breath
              </Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push('/recap');
                }}
                hitSlop={8}
              >
                <Text style={styles.storyCta}>full recap →</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </>
        )}

        {/* ═══ YOUR CORNER — the demoted tidy hub ═══
            Companion-mode spec §3: in Focused, the standing strip
            (Rank/Streak/Lifetime XP) + level bar are game chrome.
            Replace with a neutral snapshot ("Days with Lumi", "Done
            this week", "Captures sorted") that respects the
            "calm AI organizer" framing. */}
        <View style={styles.cornerBlock}>
          <Text style={styles.cornerEyebrow}>
            {companion.isFocused ? 'Snapshot' : 'The quiet corner'}
          </Text>

          {/* The standing strip + level bar are gone — "Your road"
              above carries rank/XP now, as a walked path instead of
              a dashboard. */}

          {/* Neutral snapshot — Focused mode only.
              Three calm stats that read as "you've been showing up,"
              not "you levelled up." No flame, no XP unit, no rank. */}
          {companion.isFocused && <FocusedSnapshot quests={quests} />}

          {/* One grouped container (mock style) — rows divided by
              hairlines inside a single rounded card, admin tucked
              where admin belongs. Unlocks/shop is game chrome —
              hidden in Minimal + Focused per spec §3. Shards live
              on the unlocks row now (where they're spent). */}
          <View style={styles.cornerCard}>
            {/* Worlds & unlocks: HIDDEN for v1 (launch sweep — a
                visible dead row with an accruing currency reads as
                broken, and App Review 2.1 dislikes placeholder UI).
                Shards keep accruing silently in the store; restore
                the teaser + UnlocksShop when the shop ships. */}

            <HubRow
              first
              glyph="◷"
              color="#8EA0B4"
              label="Your rhythm"
              sub={`energy this week · avg ${avgEnergy}`}
              open={hub === 'rhythm'}
              onToggle={() => setHub(hub === 'rhythm' ? null : 'rhythm')}
            >
              <View style={styles.rhythmCard}>
                <EnergyTrend data={energyTrend} />
                <Text style={styles.rhythmNote}>
                  ✦{' '}
                  {avgEnergy > 0
                    ? 'Your energy story builds with every check-in.'
                    : 'A few check-ins and Lumi will start to see your rhythm.'}
                </Text>
              </View>
            </HubRow>

            {/* The self-knowledge surface — a fully built screen that
                had no door until the Jul-9 deep dive found it. */}
            <HubRow
              glyph="✦"
              color="#8EA0B4"
              label="What Lumi knows"
              sub="your patterns, named gently"
              open={false}
              chevronOnly
              onToggle={() => {
                Haptics.selectionAsync();
                router.push('/(tabs)/patterns');
              }}
            />

            {/* One door, not two — Personalize and Account both live
                on /profile, so they share a row (skins, accent,
                playfulness, email, notifications — all one screen). */}
            <HubRow
              glyph="◐"
              color="#B0A38B"
              label="Account & settings"
              sub="personalize · skins · email · notifications"
              open={false}
              chevronOnly
              onToggle={() => {
                Haptics.selectionAsync();
                router.push('/profile');
              }}
            />
          </View>

          <Text style={styles.cornerFooter}>
            that&apos;s everything — no feed, no noise, just your corner
          </Text>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Care toast — "A slow blink back…" floats over the room. */}
      {careToast && (
        <View style={styles.careToast} pointerEvents="none">
          <Text style={styles.careToastText}>{careToast}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const makeStyles = (accent: Accent) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.void },

  // ── Focused-mode hero ──
  //
  //  Replaces the full-bleed Luna room when companionMode === 'focused'.
  //  Same vertical footprint, but no cat / vitality / cheer — just a
  //  calm "you and the organizer" framing + a way back to settings.
  focusedHero: {
    paddingTop: 64,
    paddingBottom: 36,
    paddingHorizontal: 28,
    gap: 14,
  },
  focusedHeroEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 11,
    color: C.boneDim,
    letterSpacing: 1.4,
  },
  focusedHeroTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    color: C.bone,
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  focusedHeroBody: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.boneDim,
    lineHeight: 21,
    marginTop: 2,
  },
  focusedHeroLink: {
    marginTop: 2,
    paddingVertical: 4,
  },
  focusedHeroLinkText: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    color: C.mute,
    textTransform: 'uppercase',
  },
  shardsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  shardsNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 15,
    color: C.bone,
    paddingRight: 3,
    includeFontPadding: false,
  },
  shardsLabel: {
    fontFamily: fonts.inter,
    fontSize: 10,
    color: C.mute,
    marginLeft: 2,
  },

  sectionLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: C.mute,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  block: { paddingHorizontal: 24, paddingTop: 22 },
  blockNote: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    marginTop: 12,
    lineHeight: 18,
  },

  // ── Hearthside — bond / care / road / story ──
  bondBlock: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  bondTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 24,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 29,
  },
  bondLine: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12.5,
    color: C.dusk,
    marginTop: 6,
    lineHeight: 19,
  },
  // The quiet corner's single grouped container (mock style) — rows
  // divide with hairlines INSIDE one rounded card.
  cornerCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: hexA(C.hair, 0.9),
    backgroundColor: hexA(C.bone, 0.02),
    overflow: 'hidden',
  },
  // Teaser rows — visibly present, clearly not interactive yet.
  comingSoonRow: {
    opacity: 0.55,
  },
  sectionEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.mute,
  },
  roadBlock: {
    paddingHorizontal: 24,
    marginTop: 18,
  },
  roadHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 12,
  },
  roadRankLabel: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 11,
    color: C.glow,
  },
  roadCard: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 14,
    borderRadius: 18,
    backgroundColor: hexA(C.bone, 0.03),
    borderWidth: 1,
    borderColor: hexA(C.hair, 0.9),
  },
  storyBlock: {
    paddingHorizontal: 24,
    marginTop: 18,
  },
  storyCard: {
    marginTop: 12,
    paddingHorizontal: 17,
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: hexA(C.dusk, 0.05),
    borderWidth: 1,
    borderColor: hexA(C.dusk, 0.22),
  },
  storyQuote: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 16.5,
    color: C.bone,
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  storyFootRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  storyCatBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: hexA(C.dusk, 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyByline: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.dusk,
  },
  storyCta: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.boneDim,
    textDecorationLine: 'underline',
  },
  careToast: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 100,
    backgroundColor: hexA('#241C17', 0.96),
    borderWidth: 1,
    borderColor: hexA(C.honey, 0.4),
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    zIndex: 50,
  },
  careToastText: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    color: C.bone,
  },
  cornerFooter: {
    textAlign: 'center',
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 10.5,
    color: C.mute,
    paddingTop: 12,
    paddingBottom: 4,
  },

  // ── Living world ──
  worldWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  worldFrame: {
    position: 'relative',
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: '#0C0908',
  },
  worldOverlay: {
    position: 'absolute',
    top: 14,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  ringNumWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: C.bone,
    paddingRight: 3,
    includeFontPadding: false,
  },
  worldEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 9,
    letterSpacing: 1.5,
    color: C.mute,
    textTransform: 'uppercase',
  },
  worldStage: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    letterSpacing: -0.1,
  },
  worldNote: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13.5,
    color: C.boneDim,
    lineHeight: 20,
    marginTop: 14,
    paddingHorizontal: 12,
    textAlign: 'center',
  },

  // ── Vitality breakdown ──
  breakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  breakdownChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: C.void2,
    borderWidth: 1,
  },
  breakdownDot: { width: 6, height: 6, borderRadius: 3 },
  breakdownLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 11.5,
    letterSpacing: -0.1,
  },
  breakdownVal: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 10.5,
    color: C.mute,
  },

  // ── Standing ──
  standingCard: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 16,
    padding: 18,
  },
  standingHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  standingRank: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 28,
    color: C.bone,
    letterSpacing: -0.5,
    lineHeight: 32,
    paddingRight: 6,
    includeFontPadding: false,
  },
  standingTitle: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 13,
    color: accent.fg,
  },
  standingStreak: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: accent.fg,
    lineHeight: 26,
    paddingRight: 5,
    includeFontPadding: false,
  },
  standingStreakLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 9,
    letterSpacing: 1.5,
    color: C.mute,
    textTransform: 'uppercase',
  },
  standingTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: C.surface,
    overflow: 'hidden',
    marginBottom: 7,
  },
  standingFill: {
    height: '100%',
    backgroundColor: accent.fg,
    borderRadius: 4,
  },
  standingMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  standingMetaText: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  standingLifetime: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.hair,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lifetimeLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 1,
    color: C.mute,
    textTransform: 'uppercase',
  },
  lifetimeNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 16,
    color: C.honey,
    paddingRight: 4,
    includeFontPadding: false,
  },

  // ── Unlocks Shop ──
  shopHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  shopHeadCount: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.boneDim,
  },
  shopHeadCountNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    color: C.bone,
  },
  shopTabs: {
    gap: 7,
    paddingVertical: 4,
    marginBottom: 8,
  },
  shopTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
  },
  shopTabGlyph: { fontSize: 11 },
  shopTabLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 12.5,
    letterSpacing: -0.1,
  },
  shopGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 11,
  },
  unlockCard: {
    width: '48%',
    backgroundColor: C.void2,
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
  },
  featureThumb: {
    height: 64,
    borderRadius: 11,
    backgroundColor: '#1A1310',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureThumbGlyph: { fontSize: 24 },
  activePill: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(12,9,8,0.7)',
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  activePillText: {
    fontFamily: fonts.interSemi,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  checkPill: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(12,9,8,0.7)',
    borderRadius: 100,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  checkPillText: { fontFamily: fonts.interSemi, fontSize: 10 },
  lockPill: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(12,9,8,0.78)',
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  lockPillText: { fontSize: 9.5 },
  unlockName: {
    fontFamily: fonts.interSemi,
    fontSize: 13.5,
    letterSpacing: -0.15,
    marginBottom: 2,
  },
  unlockSub: {
    fontFamily: fonts.inter,
    fontSize: 10.5,
    color: C.mute,
    lineHeight: 14,
    marginBottom: 9,
    minHeight: 28,
  },
  unlockBtn: {
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 8,
    alignItems: 'center',
  },
  unlockBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 11.5,
  },
  lockProgressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: C.surface,
    overflow: 'hidden',
    marginBottom: 6,
  },
  lockProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  lockRemaining: {
    textAlign: 'center',
    fontFamily: fonts.inter,
    fontSize: 10.5,
    color: C.mute,
  },
  shopFoot: {
    fontFamily: fonts.inter,
    fontSize: 11.5,
    color: C.mute,
    marginTop: 14,
    lineHeight: 18,
    textAlign: 'center',
  },

  // ── Rhythm ──
  rhythmHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rhythmAvg: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.boneDim,
  },
  rhythmAvgNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    color: C.bone,
    paddingRight: 3,
    includeFontPadding: false,
  },
  rhythmCard: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 16,
    padding: 18,
    paddingBottom: 14,
    marginTop: 4,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 56,
  },
  trendDay: {
    fontFamily: fonts.interSemi,
    fontSize: 9,
    color: C.mute,
  },
  rhythmNote: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 12,
    color: C.mute,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.hair,
    lineHeight: 18,
  },


  // ── Settings ──
  settingsCard: {
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 16,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  settingsRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: C.hair,
  },
  settingsTitle: {
    fontFamily: fonts.inter,
    fontSize: 14,
    color: C.bone,
    letterSpacing: -0.1,
    marginBottom: 1,
  },
  settingsSub: {
    fontFamily: fonts.inter,
    fontSize: 11,
    color: C.mute,
  },
  settingsChev: { fontSize: 14, color: C.mute },

  // ═════ v2 layout — Luna's room, full-bleed ═════
  heroTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 110,
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0,
  },
  heroTopBar: {
    position: 'absolute',
    top: 56,
    left: 22,
    right: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: C.bone,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  // Frosted profile door over the room (hearthside chrome).
  heroProfileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: hexA(C.honey, 0.5),
    backgroundColor: hexA(C.void, 0.5),
    alignItems: 'center',
    justifyContent: 'center',
  },
  paintBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,14,10,0.35)',
  },
  paintDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255,250,240,0.9)',
  },
  paintRow: {
    position: 'absolute',
    top: 96,
    right: 22,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(20,14,10,0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  paintSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,250,240,0.35)',
  },
  paintSwatchOn: {
    borderWidth: 2,
    borderColor: 'rgba(255,250,240,0.95)',
  },

  // ═════ Your corner ═════
  cornerBlock: { paddingHorizontal: 24, paddingTop: 26 },
  cornerEyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: C.mute,
    marginBottom: 12,
  },
  standingStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.void2,
    borderWidth: 1,
    borderColor: C.hair,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 15,
    marginBottom: 6,
  },
  standingCell: { flex: 1, alignItems: 'center' },
  standingCellNum: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    lineHeight: 24,
  },
  standingCellLabel: {
    fontFamily: fonts.interSemi,
    fontSize: 8.5,
    letterSpacing: 1,
    color: C.mute,
    marginTop: 4,
  },
  standingDivider: { width: 1, height: 28, backgroundColor: C.hair },
});

// Default ember-themed styles for module-level sub-components.
const styles = makeStyles(accentFor('ember'));
