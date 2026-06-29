// Lumi · canonical bottom tab bar (per lumi-nav-spec.md)
//
// Five labeled icon tabs: Home · Untangle · Time · Capture · Me.
// Each tab = icon above label. Active = ember pill behind icon + ember
// label (600). Inactive = mute. Theme-aware accent — but dusk stays
// reserved for Lumi's intelligence, never the nav accent.

import { Tabs, useSegments } from 'expo-router';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useTourTarget } from '../../components/SpotlightTour';
import { useAccent, accentFor, type Accent } from '../../lib/theme';
import { ProfileIcon } from '../../components/ProfileIcon';

type TabBarRoute = { key: string; name: string };
type TabBarDescriptor = {
  options: {
    tabBarLabel?: unknown;
    title?: string;
    tabBarAccessibilityLabel?: string;
  };
};
type LumiTabBarProps = {
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

// ─────────────────────────────────────────────────────────────────────
// NavIcon — port of the spec's line SVGs. Stroke 1.7, round caps,
// 23×23 in a 24-viewBox. Capture is FILLED when active.
// ─────────────────────────────────────────────────────────────────────
type IconKind = 'Home' | 'Untangle' | 'Time' | 'Capture' | 'Me';
const ICON_SIZE = 23;
const ICON_VIEW = 24;

const NavIcon = ({ k, color }: { k: IconKind; color: string }) => {
  const stroke = color;
  switch (k) {
    case 'Home':
      return (
        <Svg
          width={ICON_SIZE}
          height={ICON_SIZE}
          viewBox={`0 0 ${ICON_VIEW} ${ICON_VIEW}`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M4 11 11 5.2a1.6 1.6 0 0 1 2 0L20 11" />
          <Path d="M6 9.8V19h12V9.8" />
          <Path d="M10.4 19v-3.4a1.6 1.6 0 0 1 3.2 0V19" />
        </Svg>
      );
    case 'Untangle':
      return (
        <Svg
          width={ICON_SIZE}
          height={ICON_SIZE}
          viewBox={`0 0 ${ICON_VIEW} ${ICON_VIEW}`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M4 7h16" />
          <Path d="M6.5 12h11" />
          <Path d="M9.5 17h5" />
        </Svg>
      );
    case 'Time':
      return (
        <Svg
          width={ICON_SIZE}
          height={ICON_SIZE}
          viewBox={`0 0 ${ICON_VIEW} ${ICON_VIEW}`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M12 3.6v16.8" />
          <Circle cx={12} cy={12} r={2.3} fill={stroke} />
          <Path d="M12 7.6h4.2" opacity={0.65} />
          <Path d="M12 16.4h4.2" opacity={0.65} />
        </Svg>
      );
    case 'Capture':
      // Filled when active (color === ember), outlined when inactive
      // (color === mute) — small extra emphasis on the sparkle.
      return (
        <Svg
          width={ICON_SIZE}
          height={ICON_SIZE}
          viewBox={`0 0 ${ICON_VIEW} ${ICON_VIEW}`}
          fill={stroke === '#6E655A' ? 'none' : stroke}
          stroke={stroke}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M12 4 13.3 10.7 20 12 13.3 13.3 12 20 10.7 13.3 4 12 10.7 10.7Z" />
        </Svg>
      );
    case 'Me':
      // Luna — the cat face. The only "character" icon, by design.
      return (
        <Svg
          width={ICON_SIZE}
          height={ICON_SIZE}
          viewBox={`0 0 ${ICON_VIEW} ${ICON_VIEW}`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M8.6 7.6 7 4l3.1 2.3" />
          <Path d="M15.4 7.6 17 4l-3.1 2.3" />
          <Circle cx={12} cy={13.2} r={5.3} />
          <Circle cx={10.2} cy={12.8} r={0.45} fill={stroke} stroke="none" />
          <Circle cx={13.8} cy={12.8} r={0.45} fill={stroke} stroke="none" />
        </Svg>
      );
  }
};

// Map an expo-router route name to the icon kind (the label comes from
// Tabs.Screen options.title, so we look it up by route name here).
const ROUTE_TO_ICON: Record<string, IconKind> = {
  index: 'Home',
  checkin: 'Untangle',
  time: 'Time',
  capture: 'Capture',
  me: 'Me',
};

// ─────────────────────────────────────────────────────────────────────
// Tab bar
// ─────────────────────────────────────────────────────────────────────
const LumiTabBar = ({ state, descriptors, navigation }: LumiTabBarProps) => {
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  // Spotlight tour highlights the Me cell as its 3rd step.
  const meRef = useTourTarget('tour-nav-me');

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: insets.bottom > 0 ? insets.bottom : 14 },
      ]}
    >
      {/* (Removed: the top fade gradient AND the hairline. Both
         painted a lighter band across the bottom of every screen
         that uses the void background — visible as the "lighter
         section above the tab bar" on Time / Untangle / Capture /
         Me. The tab icons + label spacing alone read as the bar.) */}
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            (options.tabBarLabel as string) ?? options.title ?? route.name;
          const focused = state.index === index;
          const tintColor = focused ? accent.fg : MUTE;
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
              ref={route.name === 'me' ? (meRef as never) : undefined}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={
                options.tabBarAccessibilityLabel ?? String(label)
              }
              style={styles.cell}
              hitSlop={8}
            >
              <View style={styles.iconWrap}>
                {focused && (
                  // Ember rounded-pill highlight behind the active
                  // icon — soft 12px corners, ember@13% fill, ember@30%
                  // hairline, and a faint glow so it reads as "lit."
                  <View
                    style={[
                      styles.activePill,
                      {
                        backgroundColor: hexA(accent.fg, 0.13),
                        borderColor: hexA(accent.fg, 0.3),
                        shadowColor: accent.fg,
                      },
                    ]}
                  />
                )}
                <NavIcon k={kind} color={tintColor} />
              </View>
              <Text
                style={[
                  styles.label,
                  focused
                    ? { color: accent.fg, fontFamily: fonts.interSemi }
                    : { color: MUTE, fontFamily: fonts.inter },
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
  );
};

// FloatingProfileIcon — pinned at a SINGLE canonical top-right
// coordinate across every tab. Previously each tab mounted its own
// ProfileIcon inside its own header, and the icon visibly hopped
// because each header had a different paddingHorizontal / paddingTop /
// alignItems / wrapping title. Rendering it once at the layout level
// makes the position structural, not per-screen.
//
// Hidden on Home (the Luna nook in its top-right plays the same role)
// and on Me (which IS the profile screen).
//
// pointerEvents="box-none" lets taps fall through to the screen
// content behind it everywhere EXCEPT on the icon itself.
const FloatingProfileIcon = () => {
  const insets = useSafeAreaInsets();
  // Use segments rather than usePathname — pathname has been
  // observed to occasionally return inconsistent values during
  // transitions (e.g. after a router.push back to Home), which
  // caused the floating icon to flash onto the Home tab alongside
  // the Luna nook (or the all-done person glyph). Segments are
  // route-shape based and always correct for the current tab.
  const segments = useSegments() as string[];
  // Inside (tabs), segments[0] === '(tabs)' and segments[1] is the
  // current screen file ('index' = Home, 'me', 'checkin', etc.).
  // Hide on Home (Luna nook IS the profile entry) and on Me (the
  // whole tab is the profile/luna surface).
  const screen = segments[1];
  const onHome = !screen || screen === 'index';
  const onMe = screen === 'me';
  if (onHome || onMe) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[floatingStyles.wrap, { top: insets.top + 14 }]}
    >
      <ProfileIcon />
    </View>
  );
};

const floatingStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 20,
    zIndex: 50,
  },
});

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <LumiTabBar {...props} />}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="checkin" options={{ title: 'Untangle' }} />
        <Tabs.Screen name="time" options={{ title: 'Time' }} />
        <Tabs.Screen name="capture" options={{ title: 'Capture' }} />
        <Tabs.Screen name="me" options={{ title: 'Me' }} />
      </Tabs>
      <FloatingProfileIcon />
    </View>
  );
}

// ── Tokens + helpers (kept local to the bar) ─────────────────────────
const MUTE = '#6E655A';

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(
    h.slice(2, 4),
    16,
  )},${parseInt(h.slice(4, 6), 16)},${a})`;
};

// Silence the unused-import warning if Accent isn't referenced.
void accentFor;
type _accent = Accent;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg,
    paddingTop: 11,
    position: 'relative',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 0,
    paddingBottom: 4,
    gap: 5,
  },
  iconWrap: {
    position: 'relative',
    width: 42,
    height: 33,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Active pill behind the icon — inset 6px so it hugs the icon and
  // doesn't extend under the label.
  activePill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 6,
    right: 6,
    borderRadius: 12,
    borderWidth: 1,
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  label: {
    fontSize: 10.5,
    letterSpacing: -0.1,
    ...Platform.select({
      ios: { lineHeight: 13 },
      default: {},
    }),
  },
});
