// LumiFloatingNav — "Liquid Glass" tab bar
//
// Frosted, translucent pill that floats above content with a soft
// shadow, a bright top edge-light, and a sliding ember highlight
// that glides to the active tab. Ported from lumi-floating-nav.jsx
// (the canonical design composer mockup).
//
// Variants:
//   'pill' — detached, margin from edges, rounded 26 all around (default)
//   'dock' — edge-to-edge, rounded 28 on top corners only
// Flip via the VARIANT constant below.

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Circle } from 'react-native-svg';
import { fonts } from '../constants/fonts';
import { useTourTarget } from './SpotlightTour';

// ── Variant ────────────────────────────────────────────────────────
// 'pill' is the default — feels more "floating", more Lumi.
// Switch to 'dock' for an edge-to-edge glass strip if the pill ever
// reads as too busy on small screens.
const VARIANT: 'pill' | 'dock' = 'pill';

// ── Public layout constant ─────────────────────────────────────────
// How much vertical space the floating nav consumes from the bottom
// of the screen. Screens import this and add it to their bottom
// padding (ScrollView contentContainerStyle paddingBottom, fixed
// input bars, etc.) so content can scroll past / sit clear of the
// nav. Approximation: pill height (~80) + bottom offset (~40 on
// Dynamic Island devices). Slightly generous so the last row of
// content has breathing room above the glass, not jammed against it.
export const FLOATING_NAV_CLEARANCE = 120;

// ── Tokens (kept local — palette matches the mockup) ───────────────
const C = {
  void: '#120E0C',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  ember: '#E07A4F',
  emberLt: '#E0A488',
} as const;

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(
    h.slice(2, 4),
    16,
  )},${parseInt(h.slice(4, 6), 16)},${a})`;
};

// ── Icon set ───────────────────────────────────────────────────────
// Ported verbatim from the mockup's Icon() function. Active uses void
// color (dark on the ember pill); inactive uses boneDim. Time gets
// a filled node circle when active. Focus is a bullseye — three
// concentric circles that hint at the ember hearth without pulling
// in the whole visual.

type IconKind = 'Home' | 'Untangle' | 'Time' | 'Focus' | 'Me';

const Icon = ({ k, active }: { k: IconKind; active: boolean }) => {
  // Outline-style highlight: active icon uses the ember stroke
  // instead of void — the sliding highlight below is a transparent
  // pill with an ember border, so the icon has to be readable in
  // ember on the void background (not the old dark-on-ember pattern).
  const c = active ? C.ember : C.boneDim;
  const common = {
    width: 23,
    height: 23,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: c,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (k) {
    case 'Home':
      return (
        <Svg {...common}>
          <Path d="M4 11 11 5.2a1.6 1.6 0 0 1 2 0L20 11" />
          <Path d="M6 9.8V19h12V9.8" />
          <Path d="M10.4 19v-3.4a1.6 1.6 0 0 1 3.2 0V19" />
        </Svg>
      );
    case 'Untangle':
      return (
        <Svg {...common}>
          <Path d="M4 7h16" />
          <Path d="M6.5 12h11" />
          <Path d="M9.5 17h5" />
        </Svg>
      );
    case 'Time':
      return (
        <Svg {...common}>
          <Path d="M12 3.6v16.8" />
          <Circle cx={12} cy={12} r={2.3} fill={active ? c : 'none'} />
          <Path d="M12 7.6h4.2" opacity={0.6} />
          <Path d="M12 16.4h4.2" opacity={0.6} />
        </Svg>
      );
    case 'Focus':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={12} r={8} />
          <Circle cx={12} cy={12} r={4.2} />
          <Circle cx={12} cy={12} r={0.6} fill={c} stroke="none" />
        </Svg>
      );
    case 'Me':
      return (
        <Svg {...common}>
          <Path d="M8.6 7.6 7 4l3.1 2.3" />
          <Path d="M15.4 7.6 17 4l-3.1 2.3" />
          <Circle cx={12} cy={13.2} r={5.3} />
          <Circle cx={10.2} cy={12.8} r={0.5} fill={c} stroke="none" />
          <Circle cx={13.8} cy={12.8} r={0.5} fill={c} stroke="none" />
        </Svg>
      );
  }
};

// ── React Navigation props (subset we use) ─────────────────────────
type TabBarRoute = { key: string; name: string };
type TabBarDescriptor = {
  options: {
    tabBarLabel?: unknown;
    title?: string;
    tabBarAccessibilityLabel?: string;
  };
};
type Props = {
  state: { index: number; routes: TabBarRoute[] };
  descriptors: Record<string, TabBarDescriptor>;
  navigation: {
    emit: (e: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

const ROUTE_TO_ICON: Record<string, IconKind> = {
  index: 'Home',
  checkin: 'Untangle',
  time: 'Time',
  focus: 'Focus',
  me: 'Me',
};

// ── Pill geometry (matches mockup) ─────────────────────────────────
const INNER_PAD = 6;
const PILL_BOTTOM_OFFSET = 22; // distance from screen bottom for 'pill'
const PILL_SIDE_MARGIN = 18; // outer margin on each side for 'pill'
const PILL_RADIUS = 26;
const DOCK_RADIUS = 28;
const HIGHLIGHT_RADIUS_PILL = 20;
const HIGHLIGHT_RADIUS_DOCK = 22;

export default function LumiFloatingNav({
  state,
  descriptors,
  navigation,
}: Props) {
  const insets = useSafeAreaInsets();
  const meRef = useTourTarget('tour-nav-me');
  const n = state.routes.length;
  const dock = VARIANT === 'dock';

  // Measure the inner track so we can convert the active index into
  // a pixel translateX for the sliding highlight. Animating string
  // percentages is unreliable in RN's native driver; measuring + px
  // is the safe path.
  const [trackWidth, setTrackWidth] = useState(0);
  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && w !== trackWidth) setTrackWidth(w);
  };

  const slotWidth = trackWidth > 0 ? trackWidth / n : 0;

  // Animated translateX for the highlight. Spring with mild overshoot
  // mirrors the mockup's cubic-bezier(0.34,1.4,0.5,1) feel.
  const translateX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: state.index * slotWidth,
      duration: 420,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
  }, [state.index, slotWidth, translateX]);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.outer,
        dock
          ? { bottom: 0 }
          : { bottom: Math.max(PILL_BOTTOM_OFFSET, insets.bottom + 6) },
      ]}
    >
      <View
        style={[
          styles.pillWrap,
          dock
            ? styles.pillWrapDock
            : { marginHorizontal: PILL_SIDE_MARGIN },
        ]}
      >
        {/* Frosted glass background — BlurView under a translucent
           gradient layer so the warm Lumi tint reads on top of the
           blur. expo-blur tint 'dark' matches the void palette. */}
        <BlurView
          intensity={45}
          tint="dark"
          style={[
            { position: 'absolute' as const, top: 0, bottom: 0, left: 0, right: 0 },
            dock
              ? {
                  borderTopLeftRadius: DOCK_RADIUS,
                  borderTopRightRadius: DOCK_RADIUS,
                  overflow: 'hidden',
                }
              : { borderRadius: PILL_RADIUS, overflow: 'hidden' },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            { position: 'absolute' as const, top: 0, bottom: 0, left: 0, right: 0 },
            {
              backgroundColor: dock
                ? hexA('#140f0c', 0.72)
                : hexA('#160f0c', 0.6),
              borderWidth: 1,
              borderColor: hexA(C.bone, 0.07),
            },
            dock
              ? {
                  borderTopLeftRadius: DOCK_RADIUS,
                  borderTopRightRadius: DOCK_RADIUS,
                }
              : { borderRadius: PILL_RADIUS },
          ]}
        />

        {/* Inner content — padding wraps the track */}
        <View
          style={{
            padding: INNER_PAD,
            paddingBottom: dock ? INNER_PAD + 18 : INNER_PAD,
          }}
        >
          {/* Track — relative positioning context for the highlight
             AND the row of tabs. They share the same width, so the
             highlight's slot maps 1:1 to a tab cell. */}
          <View style={styles.track} onLayout={onTrackLayout}>
            {/* Sliding ember highlight — translateX animates between
               slots. inset 3px on each side so the pill sits inside
               the cell with breathing room. */}
            {slotWidth > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.highlightSlot,
                  {
                    width: slotWidth,
                    height: '100%',
                    transform: [{ translateX }],
                    // Center a small fixed-size box horizontally in
                    // the slot, pin it to the top so it wraps only
                    // the icon (the label sits below in the cell,
                    // outside the outline). Matches the mockup —
                    // outline reads as "around the icon", not "the
                    // whole cell".
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    paddingTop: 4,
                  },
                ]}
              >
                <View
                  style={{
                    // Sized to hug JUST the ~23px icon with a small
                    // even padding on all sides — height dropped so
                    // the box's bottom edge sits ABOVE where the
                    // label starts in the cell (label was reading
                    // as "inside" the box at 42-tall). Rounded
                    // square proportions match the mockup.
                    width: 44,
                    height: 34,
                    borderRadius: 11,
                    backgroundColor: hexA(C.ember, 0.16),
                    borderWidth: 1,
                    borderColor: hexA(C.ember, 0.5),
                    shadowColor: C.ember,
                    shadowOpacity: 0.32,
                    shadowRadius: 14,
                    shadowOffset: { width: 0, height: 4 },
                  }}
                />
              </Animated.View>
            )}

            {/* Tabs */}
            <View style={styles.row}>
              {state.routes.map((route, index) => {
                const { options } = descriptors[route.key];
                const label =
                  (options.tabBarLabel as string) ??
                  options.title ??
                  route.name;
                const focused = state.index === index;
                const kind = ROUTE_TO_ICON[route.name] ?? 'Home';

                const onPress = () => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    Haptics.selectionAsync();
                    navigation.navigate(route.name);
                  }
                };

                return (
                  <Pressable
                    key={route.key}
                    ref={
                      route.name === 'me' ? (meRef as never) : undefined
                    }
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityState={focused ? { selected: true } : {}}
                    accessibilityLabel={
                      options.tabBarAccessibilityLabel ?? String(label)
                    }
                    hitSlop={6}
                    style={styles.cell}
                  >
                    <View
                      style={{
                        transform: focused
                          ? [{ translateY: -1 }, { scale: 1.02 }]
                          : [],
                      }}
                    >
                      <Icon k={kind} active={focused} />
                    </View>
                    <Text
                      style={[
                        styles.label,
                        {
                          // Ember label on the active tab (matches the
                          // ember icon + border) instead of the old
                          // void-on-ember dark label. Idle stays mute.
                          color: focused ? C.ember : C.mute,
                          fontFamily: focused
                            ? fonts.interSemi
                            : fonts.inter,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {String(label)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 40,
  },
  pillWrap: {
    position: 'relative',
    // shadow lives on the WRAP, not the BlurView, so it casts
    // outside the rounded mask.
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 },
    borderRadius: 26,
  },
  pillWrapDock: {
    marginHorizontal: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  track: {
    position: 'relative',
  },
  highlightSlot: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  row: {
    position: 'relative',
    flexDirection: 'row',
    zIndex: 2,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    // Icon → label spacing bumped from 3 → 7 so the label sits
    // clearly BELOW the outlined box on the active tab (the box
    // wraps only the icon at ~34px tall; the label needs to land
    // outside its bottom edge with a visible gap, not tucked
    // right under it).
    gap: 7,
  },
  label: {
    fontSize: 9.5,
    letterSpacing: -0.1,
    ...Platform.select({
      ios: { lineHeight: 12 },
      default: {},
    }),
  },
});
