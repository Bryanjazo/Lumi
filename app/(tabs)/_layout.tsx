// Lumi · tabs layout
//
// The bottom nav is the "Liquid Glass" floating pill in
// components/LumiFloatingNav.tsx — frosted, translucent, with a
// sliding ember highlight. Per lumi-floating-nav design composer
// mockup. The floating profile icon at the top-right is rendered
// here so it's structurally pinned to the layout, not re-mounted
// per screen.

import { Tabs, useSegments } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LumiFloatingNav from '../../components/LumiFloatingNav';
import { ProfileIcon } from '../../components/ProfileIcon';

// FloatingProfileIcon — pinned at a SINGLE canonical top-right
// coordinate across every tab. Hidden on Home (Luna nook plays the
// same role) and on Me (which IS the profile screen).
// pointerEvents="box-none" lets taps fall through to screen content
// everywhere except on the icon itself.
const FloatingProfileIcon = () => {
  const insets = useSafeAreaInsets();
  const segments = useSegments() as string[];
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
        screenOptions={{
          headerShown: false,
          // The floating nav positions itself absolutely (over the
          // screen content) — tell React Navigation not to reserve a
          // strip at the bottom for the legacy tabBar slot. Without
          // this, RN draws a default transparent box that intercepts
          // touches on the lower edge of every screen.
          tabBarStyle: { display: 'none' },
        }}
        tabBar={(props) => <LumiFloatingNav {...props} />}
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
